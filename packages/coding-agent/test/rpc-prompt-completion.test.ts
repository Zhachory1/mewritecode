import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const rpcMode = pathToFileURL(join(packageDir, "src/modes/rpc/rpc-mode.ts")).href;

// Minimal runtime host: prompts are scripted by message text, no provider involved.
const fixture = `
import { runRpcMode } from ${JSON.stringify(rpcMode)};
let emit;
let ui;
const session = {
	bindExtensions: async (bindings) => { ui = bindings.uiContext; },
	subscribe: (handler) => { emit = handler; return () => {}; },
	messages: [],
	sessionId: "fixture",
	prompt: async (message) => {
		if (message === "/fail") throw new Error("handler failed");
		if (message === "/dialog") { await ui.confirm("Continue?", "Choose", { timeout: 5000 }); return; }
		if (message === "/turn") {
			emit({ type: "agent_start" });
			await new Promise((resolve) => setTimeout(resolve, 20));
			emit({ type: "agent_end", messages: [] });
		}
	},
};
await runRpcMode({ session, dispose: async () => {} });
`;

type RpcRecord = { type: string; id?: string; success?: boolean; method?: string; data?: any };

describe("RPC prompt completion", () => {
	let child: ChildProcess | undefined;

	afterEach(async () => {
		if (child && child.exitCode === null) {
			child.stdin?.end();
			await once(child, "exit");
		}
	});

	it("emits a correlated prompt_complete after the acknowledgement", { timeout: 20000 }, async () => {
		child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", fixture], {
			cwd: packageDir,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const records: RpcRecord[] = [];
		let buffer = "";
		let stderr = "";
		child.stderr?.on("data", (chunk) => {
			stderr += chunk;
		});
		child.stdout?.on("data", (chunk) => {
			buffer += chunk.toString();
			let index = buffer.indexOf("\n");
			while (index !== -1) {
				const line = buffer.slice(0, index);
				buffer = buffer.slice(index + 1);
				if (line) records.push(JSON.parse(line));
				index = buffer.indexOf("\n");
			}
		});
		const send = (message: object) => child?.stdin?.write(`${JSON.stringify(message)}\n`);
		const until = async (predicate: (record: RpcRecord) => boolean) => {
			for (let attempt = 0; attempt < 400; attempt++) {
				const found = records.find(predicate);
				if (found) return found;
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			throw new Error(`RPC record timed out: ${stderr}`);
		};
		const indexOf = (predicate: (record: RpcRecord) => boolean) => records.findIndex(predicate);
		const ack = (id: string) => (r: RpcRecord) => r.type === "response" && r.id === id && r.success === true;
		const complete = (id: string) => (r: RpcRecord) => r.type === "prompt_complete" && r.id === id;

		send({ id: "state", type: "get_state" });
		expect((await until((r) => r.id === "state")).data.rpcCapabilities).toEqual({ promptCompletion: true });

		send({ id: "simple", type: "prompt", message: "/simple" });
		await until(complete("simple"));
		expect(records.filter(complete("simple"))).toHaveLength(1);
		expect(indexOf(ack("simple"))).toBeLessThan(indexOf(complete("simple")));

		send({ id: "dialog", type: "prompt", message: "/dialog" });
		const request = await until((r) => r.type === "extension_ui_request" && r.method === "confirm");
		expect(records.some(complete("dialog"))).toBe(false);
		send({ type: "extension_ui_response", id: request.id, cancelled: true });
		await until(complete("dialog"));

		send({ id: "failed", type: "prompt", message: "/fail" });
		await until((r) => r.type === "response" && r.id === "failed" && r.success === false);
		expect(records.some(complete("failed"))).toBe(false);
		expect(indexOf(ack("failed"))).toBeLessThan(
			indexOf((r) => r.type === "response" && r.id === "failed" && r.success === false),
		);

		send({ id: "turn", type: "prompt", message: "/turn" });
		await until(complete("turn"));
		expect(indexOf((r) => r.type === "agent_end")).toBeLessThan(indexOf(complete("turn")));
	});
});
