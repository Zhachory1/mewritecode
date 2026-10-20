import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (path: string) => JSON.stringify(pathToFileURL(join(packageDir, "src", path)).href);

const fixture = `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runRpcMode } from ${src("modes/rpc/rpc-mode.ts")};
import { SessionManager } from ${src("core/session-manager.ts")};
const root = process.env.SESSION_TEST_ROOT;
const dir = join(root, "sessions");
for (const [project, name] of [["alpha", "Feature A"], ["beta", "Feature B"]]) {
	const manager = SessionManager.create(join(root, project), dir);
	manager.appendMessage({ role: "user", content: project + " prompt " + "x".repeat(300), timestamp: Date.now() });
	manager.appendMessage({ role: "assistant", provider: "test", model: "m", content: [{ type: "text", text: "ok" }], timestamp: Date.now() });
	manager.appendSessionInfo(name + "y".repeat(200));
}
writeFileSync(join(dir, "bad.jsonl"), JSON.stringify({ type: "session", cwd: join(root, "alpha"), timestamp: new Date().toISOString() }) + "\\n");
const session = {
	cwd: join(root, "alpha"),
	sessionManager: SessionManager.create(join(root, "alpha"), dir),
	sessionId: "fixture",
	messages: [],
	bindExtensions: async () => {},
	subscribe: () => () => {},
};
await runRpcMode({ session, dispose: async () => {} });
`;

describe("RPC list_project_sessions", () => {
	let child: ChildProcess | undefined;
	let root: string | undefined;

	afterEach(async () => {
		if (child && child.exitCode === null) {
			child.stdin?.end();
			await once(child, "exit");
		}
		if (root) rmSync(root, { recursive: true, force: true });
	});

	it("lists only persisted sessions for the active project with bounded metadata", { timeout: 20000 }, async () => {
		root = mkdtempSync(join(tmpdir(), "mewrite-project-sessions-"));
		child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", fixture], {
			cwd: packageDir,
			env: { ...process.env, SESSION_TEST_ROOT: root },
			stdio: ["pipe", "pipe", "pipe"],
		});
		const records: Array<{ type: string; id?: string; success?: boolean; data?: any }> = [];
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
		const request = async (id: string, type: string) => {
			child?.stdin?.write(`${JSON.stringify({ id, type })}\n`);
			for (let attempt = 0; attempt < 400; attempt++) {
				const found = records.find((r) => r.type === "response" && r.id === id);
				if (found) return found;
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			throw new Error(`RPC response timed out: ${stderr}`);
		};

		expect((await request("state", "get_state")).data.rpcCapabilities.projectSessions).toBe(true);
		const result = await request("list", "list_project_sessions");
		expect(result.success).toBe(true);
		expect(result.data.sessions).toHaveLength(1);
		const [listed] = result.data.sessions;
		expect(listed.path).toMatch(/\.jsonl$/);
		expect(listed.name).toHaveLength(120);
		expect(listed.name.startsWith("Feature A")).toBe(true);
		expect(listed.firstMessage).toHaveLength(160);
		expect(listed.firstMessage.startsWith("alpha prompt")).toBe(true);
		expect(listed.messageCount).toBe(2);
		expect(Number.isNaN(Date.parse(listed.modified))).toBe(false);
		expect(Object.keys(listed).sort()).toEqual(
			["created", "firstMessage", "id", "messageCount", "modified", "name", "path"].sort(),
		);
	});
});
