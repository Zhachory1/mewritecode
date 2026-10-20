const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");

const sessions = [
	{ path: "/sessions/a.jsonl", id: "a", name: "Chat A", created: "2026-10-16T10:00:00Z", modified: "2026-10-16T10:00:00Z", messageCount: 2, firstMessage: "A" },
	{ path: "/sessions/b.jsonl", id: "b", name: "Chat B", created: "2026-10-15T10:00:00Z", modified: "2026-10-15T10:00:00Z", messageCount: 2, firstMessage: "B" },
];

function agent(id) {
	const child = new EventEmitter();
	child.stdin = new PassThrough();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.requests = [];
	child.sessionFile = `/sessions/new-${id}.jsonl`;
	child.sessionId = `new-${id}`;
	child.stdin.on("data", (data) => {
		for (const line of data.toString().trim().split("\n")) {
			const request = JSON.parse(line);
			child.requests.push(request);
			if (request.type === "get_state" && child.holdState) { child.holdState = false; child.pendingState = request; continue; }
			if (request.type === "get_messages" && child.failHydration) {
				child.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success: false, error: "read failed" })}\n`);
				continue;
			}
			if (request.type === "switch_session") {
			child.sessionFile = request.sessionPath;
			child.sessionId = sessions.find((session) => session.path === request.sessionPath)?.id;
			if (!child.sessionId) throw new Error("Unknown test session");
			}
			const value = request.type === "get_state" ? { sessionFile: child.sessionFile, sessionId: child.sessionId, sessionName: child.sessionId === "a" ? "Chat A" : child.sessionId === "b" ? "Chat B" : undefined, rpcCapabilities: { projectSessions: true } }
				: request.type === "get_messages" ? { messages: [{ role: "user", content: child.sessionId }] }
				: request.type === "get_commands" ? { commands: [] }
				: request.type === "get_available_models" ? { models: [] }
				: request.type === "list_project_sessions" ? { sessions }
				: request.type === "switch_session" ? { cancelled: false }
				: {};
			child.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success: true, data: value })}\n`);
		}
	});
	child.stdin.on("end", () => child.emit("exit", 0));
	child.event = (event) => child.stdout.write(`${JSON.stringify(event)}\n`);
	child.releaseState = () => child.stdout.write(`${JSON.stringify({ id: child.pendingState.id, type: "response", command: "get_state", success: true, data: { sessionFile: child.sessionFile, sessionId: child.sessionId, rpcCapabilities: { projectSessions: true } } })}\n`);
	return child;
}

async function setup() {
	const handlers = new Map();
	const children = [agent("a"), agent("b"), agent("c")];
	const started = [];
	let window;
	const app = new EventEmitter();
	app.whenReady = () => Promise.resolve();
	app.quit = () => {};
	class BrowserWindow extends EventEmitter {
		constructor() {
			super(); window = this;
			this.webContents = new EventEmitter();
			this.webContents.mainFrame = {};
			this.webContents.sent = [];
			this.webContents.send = (_channel, event) => this.webContents.sent.push(event);
			this.webContents.setWindowOpenHandler = () => {};
		}
		isDestroyed() { return false; }
		loadFile() {}
	}
	const original = Module._load;
	Module._load = function (name, parent, isMain) {
		if (name === "electron") return { app, BrowserWindow, Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} }, dialog: { showOpenDialog: async (_window, options) => ({ canceled: false, filePaths: [options.properties.includes("openFile") ? "/project/file.txt" : "/project"] }), showMessageBoxSync: () => 0 }, ipcMain: { handle: (key, handler) => handlers.set(key, handler), on: (key, handler) => handlers.set(key, handler) } };
		if (parent.filename.endsWith("/desktop/main.cjs") && name === "node:fs") return { existsSync: () => false, realpathSync: (path) => path };
		if (parent.filename.endsWith("/desktop/main.cjs") && name === "./file-editor.cjs") return { openProjectFile: async () => ({ proof: { path: "/project/file.txt" }, relativePath: "file.txt", content: "text" }), saveProjectFile: async () => ({ path: "/project/file.txt" }) };
		if (parent.filename.endsWith("/desktop/main.cjs") && name === "node:child_process") return { spawn: () => { const child = children.shift(); started.push(child); return child; } };
		return original.call(this, name, parent, isMain);
	};
	try { delete require.cache[require.resolve("../main.cjs")]; require("../main.cjs"); await new Promise((resolve) => setImmediate(resolve)); }
	finally { Module._load = original; }
	window.webContents.emit("did-finish-load");
	return { handlers, children, started, window, app, spawned: () => started.length, ipc: { sender: window.webContents, senderFrame: window.webContents.mainFrame } };
}

test("New chat while A runs creates a distinct live session that remains reachable", async () => {
	const { handlers, ipc, spawned } = await setup();
	const a = await handlers.get("pick-project")();
	await handlers.get("agent-command")(ipc, "prompt", { message: "A work" }, a.desktopAgentId);
	await assert.rejects(handlers.get("new-chat")({ sender: {}, senderFrame: {} }), /unavailable/);
	const b = await handlers.get("new-chat")(ipc);
	assert.notEqual(b.desktopAgentId, a.desktopAgentId);
	assert.equal(spawned(), 2);
	await handlers.get("agent-command")(ipc, "prompt", { message: "B work" }, b.desktopAgentId);
	const recent = await handlers.get("list-sessions")();
	assert.equal(recent.find((entry) => entry.name === "New chat")?.busy, true);
	const fromA = recent.find((entry) => entry.name === "Chat A");
	assert.equal(fromA.busy, true);
	assert.equal((await handlers.get("switch-session")(ipc, fromA.token)).desktopAgentId, a.desktopAgentId);
});

test("renderer reload during B startup hydrates the new renderer with B", async () => {
	const { handlers, ipc, children, window, started } = await setup();
	await handlers.get("pick-project")();
	const listed = await handlers.get("list-sessions")();
	children[0].holdState = true;
	const opening = handlers.get("switch-session")(ipc, listed.find((entry) => entry.name === "Chat B").token);
	await new Promise((resolve) => setImmediate(resolve));
	window.webContents.sent.length = 0;
	window.webContents.emit("render-process-gone");
	window.webContents.emit("did-finish-load");
	await new Promise((resolve) => setImmediate(resolve));
	started[1].releaseState();
	const b = await opening;
	await new Promise((resolve) => setImmediate(resolve));
	const hydration = window.webContents.sent.filter((event) => event.type === "desktop_agent_hydrated");
	assert.equal(hydration.at(-1).result.desktopAgentId, b.desktopAgentId);
});

test("quitting the window terminates every live chat child", async () => {
	const { handlers, ipc, app, started } = await setup();
	await handlers.get("pick-project")();
	await handlers.get("new-chat")(ipc);
	app.emit("before-quit", { preventDefault() {} });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(started.length, 2);
	assert.equal(started.every((child) => child.stdin.writableEnded), true);
});

test("a second chat selection is blocked while a fresh chat is starting", async () => {
	const { handlers, ipc, children, started } = await setup();
	await handlers.get("pick-project")();
	const list = await handlers.get("list-sessions")();
	children[0].holdState = true;
	const opening = handlers.get("new-chat")(ipc);
	await new Promise((resolve) => setImmediate(resolve));
	await assert.rejects(handlers.get("switch-session")(ipc, list.find((entry) => entry.name === "Chat B").token), /Chat change already in progress/);
	assert.equal(started.length, 2);
	started[1].releaseState();
	const fresh = await opening;
	assert.notEqual(fresh.desktopAgentId, list.find((entry) => entry.active)?.desktopAgentId);
});

test("background work blocks project file save and an inactive chat draft blocks quit", async () => {
	const { handlers, ipc, app, started } = await setup();
	const a = await handlers.get("pick-project")();
	const opened = await handlers.get("open-project-file")(ipc);
	assert.equal(opened.relativePath, "file.txt");
	await handlers.get("agent-command")(ipc, "prompt", { message: "A work" }, a.desktopAgentId);
	const b = await handlers.get("new-chat")(ipc);
	await assert.rejects(handlers.get("save-project-file")(ipc, opened.token, "edit"), /agents? to finish/);
	const dirty = { ...ipc };
	handlers.get("composer-dirty")(dirty, true, a.desktopAgentId);
	assert.equal(dirty.returnValue, true);
	handlers.get("composer-dirty")(dirty, false, b.desktopAgentId);
	const quit = { preventDefault() { this.prevented = true; } };
	app.emit("before-quit", quit);
	assert.equal(quit.prevented, true);
	assert.equal(started.length, 2);
	assert.equal(started.every((child) => !child.stdin.writableEnded), true, "quit cancellation leaves both agents running");
	started[0].event({ type: "agent_end", messages: [] });
	await new Promise((resolve) => setTimeout(resolve, 120));
	const saved = await handlers.get("save-project-file")(ipc, opened.token, "edit");
	assert.notEqual(saved.token, opened.token, "file save becomes available when all project chats are idle");
});

test("background redacted thinking never forwards the provider placeholder as visible content", async () => {
	const { handlers, ipc, started, window } = await setup();
	const a = await handlers.get("pick-project")();
	await handlers.get("new-chat")(ipc);
	started[0].event({ type: "message_update", message: { role: "assistant", content: [{ type: "thinking", thinking: "[Reasoning redacted]", redacted: true }] }, assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "[Reasoning redacted]" } });
	await new Promise((resolve) => setImmediate(resolve));
	const update = window.webContents.sent.find((event) => event.type === "message_update" && event.desktopAgentId === a.desktopAgentId);
	assert.equal(update.assistantMessageEvent.redacted, true);
	assert.equal(update.assistantMessageEvent.content, undefined);
	assert.equal(update.assistantMessageEvent.delta, undefined);
});

test("background requests include the originating chat identity", async () => {
	const { handlers, ipc, started, window } = await setup();
	const a = await handlers.get("pick-project")();
	await handlers.get("new-chat")(ipc);
	started[0].event({ type: "extension_ui_request", id: "a-dialog", method: "confirm", title: "Continue?" });
	await new Promise((resolve) => setImmediate(resolve));
	const request = window.webContents.sent.find((event) => event.type === "extension_ui_request" && event.id === "a-dialog");
	assert.equal(request.desktopAgentId, a.desktopAgentId);
	assert.equal(request.background, true);
	assert.match(request.chatLabel, /Chat A · a/);
});

test("a failed B startup that cannot stop never opens a second writer for B", { timeout: 10000 }, async () => {
	const { handlers, ipc, children, started } = await setup();
	await handlers.get("pick-project")();
	const first = await handlers.get("list-sessions")();
	children[0].failHydration = true;
	children[0].stdin.removeAllListeners("end");
	children[0].kill = () => {};
	await assert.rejects(handlers.get("switch-session")(ipc, first.find((entry) => entry.name === "Chat B").token), /read failed/);
	const retry = await handlers.get("list-sessions")();
	await assert.rejects(handlers.get("switch-session")(ipc, retry.find((entry) => entry.name === "Chat B").token), /still starting or shutting down/);
	assert.equal(started.length, 2, "no second child may write B's session");
});

test("an exited unsaved chat reopens fresh with its unsent draft still guarded", async () => {
	const { handlers, ipc, started, app } = await setup();
	await handlers.get("pick-project")();
	const b = await handlers.get("new-chat")(ipc);
	const dirty = { ...ipc };
	handlers.get("composer-dirty")(dirty, true, b.desktopAgentId);
	assert.equal(dirty.returnValue, true);
	started[1].emit("exit", 1);
	await new Promise((resolve) => setImmediate(resolve));
	const listed = await handlers.get("list-sessions")();
	const unsaved = listed.find((entry) => entry.name === "New chat");
	assert.ok(unsaved);
	const reopened = await handlers.get("switch-session")(ipc, unsaved.token);
	assert.equal(reopened.replacesDesktopAgentId, b.desktopAgentId);
	assert.notEqual(reopened.desktopAgentId, b.desktopAgentId);
	assert.equal(started.length, 3);
	assert.equal(started[2].requests.some((request) => request.type === "switch_session"), false, "unsaved file cannot be resumed");
	const quitting = { preventDefault() {} };
	app.emit("before-quit", quitting);
	assert.equal(started[0].stdin.writableEnded, false, "transferred draft still blocks quit");
});

test("an exited background chat reopens its saved session without stranding the healthy chat", async () => {
	const { handlers, ipc, started, window } = await setup();
	const a = await handlers.get("pick-project")();
	const initial = await handlers.get("list-sessions")();
	const b = await handlers.get("switch-session")(ipc, initial.find((entry) => entry.name === "Chat B").token);
	const file = await handlers.get("open-project-file")(ipc);
	const dirty = { ...ipc };
	handlers.get("set-editor-dirty")(dirty, file.token, true);
	assert.equal(dirty.returnValue, true);
	started[1].emit("exit", 1);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(window.webContents.sent.some((event) => event.type === "desktop_agent_hydrated" && event.result.desktopAgentId === a.desktopAgentId), true);
	const listed = await handlers.get("list-sessions")();
	const reopened = await handlers.get("switch-session")(ipc, listed.find((entry) => entry.name === "Chat B").token);
	assert.equal(reopened.replacesDesktopAgentId, b.desktopAgentId);
	assert.notEqual(reopened.desktopAgentId, b.desktopAgentId);
	assert.equal(reopened.messages[0].content, "b");
	assert.equal(started.length, 3);
	const saved = await handlers.get("save-project-file")(ipc, file.token, "kept draft");
	assert.notEqual(saved.token, file.token, "the project editor remains owned after B is replaced");
});

test("clicking Chat B while A runs keeps both turns alive in the same project window", async () => {
	const { handlers, spawned, ipc } = await setup();
	const a = await handlers.get("pick-project")();
	assert.equal("sessionFile" in a.state, false);
	await handlers.get("agent-command")(ipc, "prompt", { message: "A work" }, a.desktopAgentId);
	const fromA = await handlers.get("list-sessions")();
	const bEntry = fromA.find((entry) => entry.name === "Chat B");
	assert.ok(bEntry);
	const b = await handlers.get("switch-session")(ipc, bEntry.token);
	assert.notEqual(b.desktopAgentId, a.desktopAgentId);
	assert.equal(b.messages[0].content, "b");
	await handlers.get("agent-command")(ipc, "prompt", { message: "B work" }, b.desktopAgentId);
	const fromB = await handlers.get("list-sessions")();
	const aEntry = fromB.find((entry) => entry.name === "Chat A");
	assert.equal(aEntry.busy, true);
	const returned = await handlers.get("switch-session")(ipc, aEntry.token);
	assert.equal(returned.desktopAgentId, a.desktopAgentId);
	assert.equal(returned.busy, true);
	assert.equal(spawned(), 2, "reselecting A reuses its agent rather than opening a second session writer");
});
