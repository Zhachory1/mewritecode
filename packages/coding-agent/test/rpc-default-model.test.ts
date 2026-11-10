import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (path: string) => JSON.stringify(pathToFileURL(join(packageDir, "src", path)).href);

const fixture = `
import { runRpcMode } from ${src("modes/rpc/rpc-mode.ts")};
import { SettingsManager } from ${src("core/settings-manager.ts")};
const settingsManager = SettingsManager.inMemory({ defaultProvider: "faux", defaultModel: "one" });
const models = [{ provider: "faux", id: "one" }, { provider: "faux", id: "two" }];
const session = {
	settingsManager,
	model: models[0],
	modelRegistry: { getAvailable: async () => models },
	messages: [],
	sessionId: "fixture",
	pendingMessageCount: 0,
	bindExtensions: async () => {},
	subscribe: () => () => {},
	setApprovalCallback: () => {},
};
await runRpcMode({ session, dispose: async () => {} });
`;

describe("RPC default model", () => {
	let child: ChildProcess | undefined;

	afterEach(async () => {
		if (child && child.exitCode === null) {
			child.stdin?.end();
			await once(child, "exit");
		}
	});

	it("lists candidates and saves a default without changing the session model", { timeout: 20000 }, async () => {
		child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", fixture], {
			cwd: packageDir,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const records: Array<{ type: string; id?: string; success?: boolean; data?: any; error?: string }> = [];
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
		const request = async (id: string, type: string, fields: object = {}) => {
			child?.stdin?.write(`${JSON.stringify({ id, type, ...fields })}\n`);
			for (let attempt = 0; attempt < 400; attempt++) {
				const found = records.find((r) => r.type === "response" && r.id === id);
				if (found) return found;
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			throw new Error(`RPC response timed out: ${stderr}`);
		};

		const initial = (await request("s0", "get_state")).data;
		expect(initial.rpcCapabilities.defaultModelControl).toBe(true);
		expect(initial.defaultModel).toEqual({ provider: "faux", id: "one" });
		expect(initial.defaultModelScope).toBe("global");

		expect((await request("list", "get_default_models")).data.models).toHaveLength(2);

		const saved = await request("set", "set_default_model", { provider: "faux", modelId: "two" });
		expect(saved.data).toMatchObject({ provider: "faux", id: "two" });
		const after = (await request("s1", "get_state")).data;
		expect(after.defaultModel).toEqual({ provider: "faux", id: "two" });
		expect(after.model).toMatchObject({ id: "one" });

		const missing = await request("bad", "set_default_model", { provider: "faux", modelId: "nope" });
		expect(missing.success).toBe(false);
		expect((await request("s2", "get_state")).data.defaultModel).toEqual({ provider: "faux", id: "two" });
	});
});
