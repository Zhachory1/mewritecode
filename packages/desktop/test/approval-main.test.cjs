const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");

const capability = { version: 1, dangerPolicyVersion: "danger-policy-v1", maxPayloadBytes: 8192, decisions: ["once", "deny"] };

function agent() {
	const child = new EventEmitter();
	child.stdin = new PassThrough();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.commands = [];
	child.stdin.on("data", (chunk) => {
		for (const line of chunk.toString().trim().split("\n")) {
			const request = JSON.parse(line);
			child.commands.push(request);
			if (request.type === "approval_response") continue;
			let data;
			if (request.type === "get_state") data = { sessionId: "test", approvalMode: true, rpcCapabilities: { approvalDialog: capability, approvalModeControl: true } };
			else if (request.type === "get_messages") data = { messages: [] };
			else if (request.type === "get_commands") data = { commands: [] };
			else if (request.type === "get_available_models") data = { models: [] };
			else if (request.type === "client_capabilities") data = { approvalDialog: true };
			else if (request.type === "set_approval_mode") data = { enabled: request.enabled };
			child.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success: true, data })}\n`);
		}
	});
	child.event = (event) => child.stdout.write(`${JSON.stringify(event)}\n`);
	return child;
}

test("main negotiates approval and keeps runtime ids outside renderer", async () => {
	const handlers = new Map();
	const child = agent();
	const app = new EventEmitter();
	app.whenReady = () => Promise.resolve();
	app.quit = () => {};
	let window;
	class BrowserWindow extends EventEmitter {
		constructor() {
			super();
			window = this;
			this.webContents = new EventEmitter();
			this.webContents.mainFrame = {};
			this.webContents.sent = [];
			this.webContents.send = (channel, event) => this.webContents.sent.push({ channel, event });
			this.webContents.setWindowOpenHandler = () => {};
		}
		isDestroyed() { return false; }
		loadFile() {}
	}
	const originalLoad = Module._load;
	Module._load = function (name, parent, isMain) {
		if (name === "electron") return {
			app,
			BrowserWindow,
			Menu: { buildFromTemplate: (items) => ({ items }), setApplicationMenu() {} },
			dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ["/tmp/project"] }) },
			ipcMain: { handle: (name, callback) => handlers.set(name, callback), on: (name, callback) => handlers.set(name, callback) },
			shell: { openExternal: async () => {} },
		};
		if (name === "node:fs" && parent.filename.endsWith("/desktop/main.cjs")) return { existsSync: () => false, realpathSync: (path) => path };
		if (name === "node:child_process" && parent.filename.endsWith("/desktop/main.cjs")) return { spawn: () => child, execFile: (_binary, args, _options, callback) => callback(null, `${args[1]}\n`) };
		return originalLoad.call(this, name, parent, isMain);
	};
	try {
		delete require.cache[require.resolve("../main.cjs")];
		require("../main.cjs");
		await new Promise((resolve) => setImmediate(resolve));
	} finally {
		Module._load = originalLoad;
	}
	const ipcEvent = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
	window.webContents.emit("did-finish-load");
	await handlers.get("pick-project")();
	assert.deepEqual(child.commands.find((command) => command.type === "client_capabilities").approvalDialog, capability);
	await assert.rejects(handlers.get("set-approval-mode")({ sender: {}, senderFrame: {} }, false), /unavailable/);
	assert.deepEqual(await handlers.get("set-approval-mode")(ipcEvent, false), { enabled: false });
	assert.deepEqual(child.commands.find((command) => command.type === "set_approval_mode"), { id: "7", type: "set_approval_mode", enabled: false });
	child.event({ type: "approval_request", id: "runtime-secret", version: 1, dangerPolicyVersion: "danger-policy-v1", toolName: "write", tier: "write", argumentsJson: '{"path":"file"}', decisions: ["once", "deny"], timeoutMs: 120000 });
	await new Promise((resolve) => setImmediate(resolve));
	const shown = window.webContents.sent.findLast(({ event }) => event.type === "desktop_approval_request").event;
	assert.equal(shown.type, "desktop_approval_request");
	assert.equal("id" in shown, false);
	assert.notEqual(shown.token, "runtime-secret");
	assert.equal(handlers.get("approval-reply")({ sender: {}, senderFrame: {} }, shown.desktopAgentId, shown.token, "once"), false);
	assert.equal(child.commands.some((command) => command.type === "approval_response"), false);
	assert.equal(handlers.get("approval-reply")(ipcEvent, shown.desktopAgentId, shown.token, "once"), true);
	assert.deepEqual(child.commands.at(-1), { type: "approval_response", id: "runtime-secret", version: 1, dangerPolicyVersion: "danger-policy-v1", decision: "once" });
	child.event({ type: "approval_request", id: "lost", version: 1, dangerPolicyVersion: "danger-policy-v1", toolName: "bash", tier: "exec", argumentsJson: '{"command":"true"}', decisions: ["once", "deny"], timeoutMs: 120000 });
	await new Promise((resolve) => setImmediate(resolve));
	window.webContents.emit("render-process-gone");
	assert.deepEqual(child.commands.at(-1), { type: "approval_response", id: "lost", version: 1, dangerPolicyVersion: "danger-policy-v1", decision: "deny" });
	const shownCount = window.webContents.sent.length;
	child.event({ type: "approval_request", id: "during-crash", version: 1, dangerPolicyVersion: "danger-policy-v1", toolName: "write", tier: "write", argumentsJson: "{}", decisions: ["once", "deny"], timeoutMs: 120000 });
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(child.commands.at(-1), { type: "approval_response", id: "during-crash", version: 1, dangerPolicyVersion: "danger-policy-v1", decision: "deny" });
	assert.equal(window.webContents.sent.length, shownCount);
	child.stderr.emit("error", new Error("pipe closed"));
});
