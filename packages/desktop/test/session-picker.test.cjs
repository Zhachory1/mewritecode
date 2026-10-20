const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");

function agent(capable) {
	const child = new EventEmitter();
	child.stdin = new PassThrough();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.cwd = "/tmp/project";
	child.currentFile = "/tmp/sessions/latest.jsonl";
	child.sessions = [
		{ path: child.currentFile, id: "latest", name: "Latest", firstMessage: "now", created: "2026-10-07T11:00:00Z", modified: "2026-10-07T12:00:00Z", messageCount: 2 },
		{ path: "/tmp/sessions/older.jsonl", id: "older", name: "Older task", firstMessage: "earlier", created: "2026-10-06T11:00:00Z", modified: "2026-10-06T12:00:00Z", messageCount: 4 },
	];
	child.commands = [];
	child.stdin.on("data", (chunk) => {
		for (const line of chunk.toString().trim().split("\n")) {
			const request = JSON.parse(line);
			child.commands.push(request);
			if (request.type === "list_project_sessions" && child.holdList) { child.pendingList = request; child.holdList = false; continue; }
			if (request.type === "get_messages" && child.failHydration && child.currentFile.includes("latest")) {
				child.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success: false, error: "read failed" })}\n`);
				continue;
			}
			let data;
			if (request.type === "get_state") data = { sessionId: child.currentFile.includes("older") ? "older" : "latest", sessionFile: child.currentFile, rpcCapabilities: capable ? { projectSessions: true } : {} };
			else if (request.type === "get_messages") data = { messages: child.currentFile.includes("older") ? [{ role: "user", content: "earlier" }] : [] };
			else if (request.type === "get_commands") data = { commands: [] };
			else if (request.type === "get_available_models") data = { models: [] };
			else if (request.type === "list_project_sessions") data = { sessions: child.sessions };
			else if (request.type === "switch_session") {
				data = { cancelled: Boolean(child.cancelSwitch) };
				if (!child.cancelSwitch) child.currentFile = request.sessionPath;
			}
			child.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success: true, data })}\n`);
		}
	});
	child.stdin.on("end", () => child.emit("exit", 0));
	child.event = (event) => child.stdout.write(`${JSON.stringify(event)}\n`);
	child.releaseList = () => child.stdout.write(`${JSON.stringify({ id: child.pendingList.id, type: "response", command: "list_project_sessions", success: true, data: { sessions: child.sessions } })}\n`);
	return child;
}

async function setup(capable) {
	const handlers = new Map();
	const current = agent(capable);
	const next = agent(capable), resumed = agent(capable);
	const children = [current, next, resumed, agent(capable)];
	let window;
	const app = new EventEmitter();
	app.whenReady = () => Promise.resolve();
	class BrowserWindow extends EventEmitter {
		constructor() {
			super(); window = this;
			this.webContents = new EventEmitter();
			this.webContents.mainFrame = {};
			this.webContents.send = () => {};
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
			Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
			dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ["/tmp/project"] }) },
			ipcMain: { handle: (name, callback) => handlers.set(name, callback), on: (name, callback) => handlers.set(name, callback) },
		};
		if (name === "node:fs" && parent.filename.endsWith("/desktop/main.cjs")) return { existsSync: () => false, realpathSync: (path) => path };
		if (name === "node:child_process" && parent.filename.endsWith("/desktop/main.cjs")) return { spawn: () => children.shift(), execFile: (_binary, args, _options, callback) => callback(null, `${args[1]}\n`) };
		return originalLoad.call(this, name, parent, isMain);
	};
	try {
		delete require.cache[require.resolve("../main.cjs")];
		require("../main.cjs");
		await new Promise((resolve) => setImmediate(resolve));
	} finally {
		Module._load = originalLoad;
	}
	window.webContents.emit("did-finish-load");
	return { handlers, current, next, resumed, ipc: { sender: window.webContents, senderFrame: window.webContents.mainFrame } };
}

test("unresponsive conversation listing times out and permits retry", { timeout: 15000 }, async () => {
	const { handlers, current } = await setup(true);
	await handlers.get("pick-project")();
	current.holdList = true;
	await assert.rejects(handlers.get("list-sessions")(), /timed out: list_project_sessions/);
	const retry = await handlers.get("list-sessions")();
	assert.equal(retry.length, 2);
	current.releaseList();
});

test("a slow but responsive conversation listing succeeds", async () => {
	const { handlers, current } = await setup(true);
	await handlers.get("pick-project")();
	current.holdList = true;
	const listing = handlers.get("list-sessions")();
	await new Promise((resolve) => setTimeout(resolve, 100));
	current.releaseList();
	assert.equal((await listing).length, 2);
});

test("unresponsive pre-switch listing releases the chat-change lock", { timeout: 15000 }, async () => {
	const { handlers, current, ipc } = await setup(true);
	await handlers.get("pick-project")();
	const sessions = await handlers.get("list-sessions")();
	current.holdList = true;
	await assert.rejects(handlers.get("switch-session")(ipc, sessions[1].token), /timed out: list_project_sessions/);
	const retry = await handlers.get("list-sessions")();
	assert.equal(retry.length, 2);
	current.releaseList();
});

test("desktop picker uses opaque project-scoped tokens and preserves chat on cancellation", async () => {
	const legacy = await setup(false);
	const old = await legacy.handlers.get("pick-project")();
	assert.equal("sessionFile" in old.state, false);
	await assert.rejects(legacy.handlers.get("list-sessions")(), /Update installed Me Write Code/);
	const { handlers, current, next, resumed, ipc } = await setup(true);
	const pick = handlers.get("pick-project");
	const list = handlers.get("list-sessions");
	const switchSession = handlers.get("switch-session");
	const command = handlers.get("agent-command");
	const chosen = await pick();
	assert.equal("sessionFile" in chosen.state, false);
	assert.equal("sessionFile" in await command(null, "get_state"), false);
	const sessions = await list();
	assert.equal(sessions.length, 2);
	assert.equal(sessions[1].name, "Older task");
	assert.equal("path" in sessions[1], false);
	assert.equal("id" in sessions[1], false);
	current.holdList = true;
	const staleList = list();
	const newest = await list();
	current.releaseList();
	await assert.rejects(staleList, /Newer conversation list/);
	await assert.rejects(switchSession(ipc, sessions[1].token), /Unknown conversation/);
	await assert.rejects(switchSession(ipc, "/tmp/sessions/older.jsonl"), /Unknown conversation/);
	next.cancelSwitch = true;
	await assert.rejects(switchSession(ipc, newest[1].token), /cancelled/);
	assert.equal(current.currentFile, "/tmp/sessions/latest.jsonl");
	assert.equal(next.stdin.writableEnded, true, "failed candidate must release its session reservation");
	const originalSessions = current.sessions;
	current.sessions = [originalSessions[0]];
	await assert.rejects(switchSession(ipc, newest[1].token), /Conversation changed; refresh and retry/);
	current.sessions = originalSessions;
	const fresh = await list();
	await command(null, "prompt", { message: "busy" });
	current.event({ type: "agent_start" });
	const selected = await switchSession(ipc, fresh[1].token);
	assert.notEqual(selected.desktopAgentId, chosen.desktopAgentId, "A keeps running in its original child");
	assert.equal(selected.cancelled, false);
	assert.equal("sessionFile" in selected.state, false);
	assert.deepEqual(selected.messages, [{ role: "user", content: "earlier" }]);
	assert.equal(current.commands.find((item) => item.type === "switch_session")?.sessionPath, "/tmp/sessions/latest.jsonl", "startup resumes the newest matching project session");
	assert.equal(resumed.commands.find((item) => item.type === "switch_session")?.sessionPath, "/tmp/sessions/older.jsonl", "B is opened in a separate child");
	await assert.rejects(switchSession(ipc, fresh[1].token), /Unknown conversation/);
	current.failHydration = true;
	const after = await list();
	const restored = await switchSession(ipc, after[0].token);
	assert.equal(restored.desktopAgentId, chosen.desktopAgentId);
	assert.equal(restored.degraded, true, "a failed re-hydration leaves B's saved session untouched");
	await assert.rejects(switchSession(ipc, after[0].token), /Unknown conversation/);
});
