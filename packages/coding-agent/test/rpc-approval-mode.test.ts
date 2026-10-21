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
const settingsManager = SettingsManager.inMemory();
const session = {
	settingsManager,
	get approvalMode() { return settingsManager.getApprovalMode(); },
	setApprovalMode(enabled) { settingsManager.setApprovalMode(enabled); },
	isStreaming: false,
	isRetrying: false,
	isCompacting: false,
	isBashRunning: false,
	pendingMessageCount: 0,
	messages: [],
	sessionId: "fixture",
	bindExtensions: async () => {},
	subscribe: () => () => {},
	setApprovalCallback: () => {},
	prompt: async (text) => { if (text === "busy") session.isStreaming = true; },
};
await runRpcMode({ session, dispose: async () => {} });
`;

describe("RPC set_approval_mode", () => {
	let child: ChildProcess | undefined;

	afterEach(async () => {
		if (child && child.exitCode === null) {
			child.stdin?.end();
			await once(child, "exit");
		}
	});

	it(
		"turns approval mode on, refuses to turn it off or run bash, and refuses while busy",
		{ timeout: 20000 },
		async () => {
			child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", fixture], {
				cwd: packageDir,
				env: { ...process.env, CAVE_APPROVAL_MODE: "" },
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

			const initial = await request("s0", "get_state");
			expect(initial.data.rpcCapabilities.approvalModeControl).toBe(true);
			expect(initial.data.approvalMode).toBe(false);

			expect((await request("on", "set_approval_mode", { enabled: true })).data).toEqual({ enabled: true });
			expect((await request("s1", "get_state")).data.approvalMode).toBe(true);

			expect((await request("bad", "set_approval_mode", { enabled: "yes" })).success).toBe(false);

			const off = await request("off", "set_approval_mode", { enabled: false });
			expect(off.success).toBe(false);
			expect(off.error).toMatch(/only be turned off/);
			expect((await request("s2", "get_state")).data.approvalMode).toBe(true);
			const bash = await request("bash", "bash", { command: "echo hi" });
			expect(bash.success).toBe(false);
			expect(bash.error).toMatch(/approval mode/);

			await request("p", "prompt", { message: "busy" });
			const busy = await request("on-busy", "set_approval_mode", { enabled: true });
			expect(busy.success).toBe(false);
			expect(busy.error).toMatch(/busy/);
		},
	);
});
