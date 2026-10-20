const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");

const capability = { version: 1, dangerPolicyVersion: "danger-policy-v1", maxPayloadBytes: 8192, decisions: ["once", "deny"] };

function agent(name) {
	const child = new EventEmitter();
	child.stdin = new PassThrough();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.commands = [];
	child.stdin.on("data", (chunk) => {
		if (child.failSpawn) return;
		for (const line of chunk.toString().trim().split("\n")) {
			const request = JSON.parse(line);
			child.commands.push(request);
			if (["approval_response", "extension_ui_response"].includes(request.type)) continue;
			if (request.type === "get_messages" && child.holdHydration) {
				child.holdHydration = false;
				child.pendingHydration = request;
				continue;
			}
			if (request.type === "list_project_sessions" && child.failListing) {
				child.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success: false, error: "session list failed" })}\n`);
				continue;
			}
			const data = request.type === "get_state" ? { sessionId: name, rpcCapabilities: { approvalDialog: capability, ...(child.projectSessions ? { projectSessions: true } : {}) } }
				: request.type === "get_messages" ? { messages: [{ role: "user", content: name }] }
				: request.type === "get_commands" ? { commands: [] }
				: request.type === "get_available_models" ? { models: [] }
				: request.type === "list_project_sessions" ? { sessions: child.savedSessions ?? [] }
				: request.type === "switch_session" ? { cancelled: Boolean(child.cancelResume) }
				: request.type === "client_capabilities" ? { approvalDialog: true } : {};
			child.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success: true, data })}\n`);
		}
	});
	child.stdin.on("end", () => child.emit("exit", 0));
	child.event = (event) => child.stdout.write(`${JSON.stringify(event)}\n`);
	child.releaseHydration = () => child.stdout.write(`${JSON.stringify({ id: child.pendingHydration.id, type: "response", command: "get_messages", success: true, data: { messages: [] } })}\n`);
	return child;
}

async function setup(paths, chooseProject = false) {
	const handlers = new Map();
	const children = Array.from({ length: paths.length }, (_, index) => agent(String.fromCharCode(65 + index)));
	const [a, b, c] = children;
	const spawned = [];
	const started = [];
	const agentLaunches = [];
	const launched = [];
	let failLaunch = false;
	let failMissing = true;
	const app = new EventEmitter();
	app.whenReady = () => Promise.resolve();
	app.quit = () => {};
	let window;
	let confirmations = 0;
	let confirmChoice = 0;
	class BrowserWindow extends EventEmitter {
		constructor() {
			super();
			window = this;
			this.webContents = new EventEmitter();
			this.webContents.mainFrame = {};
			this.webContents.sent = [];
			this.webContents.send = (_channel, event) => this.webContents.sent.push(event);
			this.webContents.setWindowOpenHandler = () => {};
		}
		isDestroyed() { return false; }
		loadFile() {}
	}
	const originalLoad = Module._load;
	Module._load = function (name, parent, isMain) {
		if (name === "electron") return {
			app, BrowserWindow,
			Menu: { buildFromTemplate: (items) => ({ items }), setApplicationMenu() {} },
			dialog: {
				showOpenDialog: async () => { const path = paths.shift(); return { canceled: !path, filePaths: path ? [path] : [] }; },
				showMessageBoxSync: () => { confirmations++; return confirmChoice; },
			},
			ipcMain: { handle: (key, callback) => handlers.set(key, callback), on: (key, callback) => handlers.set(key, callback) },
		};
		if (parent.filename.endsWith("/desktop/main.cjs") && name === "node:fs") return { existsSync: () => false, realpath: (path, callback) => callback(null, path === "/link" ? "/a" : path), realpathSync: (path) => path === "/link" ? "/a" : path };
		if (parent.filename.endsWith("/desktop/main.cjs") && name === "node:child_process") return {
			execFile: (binary, args, _options, callback) => { launched.push({ binary, args }); callback(failLaunch ? new Error("Launch failed") : null); },
			spawn: (binary, args, options) => {
				if (binary === process.execPath) {
					launched.push({ binary, args });
					const instance = new EventEmitter();
					instance.unref = () => {};
					setImmediate(() => instance.emit(failLaunch ? "error" : "spawn", new Error("Launch failed")));
					return instance;
				}
				spawned.push(options.cwd);
				agentLaunches.push({ binary, args, cwd: options.cwd, env: options.env });
				const child = children.shift();
				started.push(child);
				if (options.cwd === "/missing" && failMissing) { failMissing = false; child.failSpawn = true; setImmediate(() => child.emit("error", new Error("ENOENT"))); }
				return child;
			},
		};
		return originalLoad.call(this, name, parent, isMain);
	};
	const argv = process.argv;
	if (chooseProject) process.argv = [...argv, "--choose-project"];
	try {
		delete require.cache[require.resolve("../main.cjs")];
		require("../main.cjs");
		await new Promise((resolve) => setImmediate(resolve));
	} finally { Module._load = originalLoad; process.argv = argv; }
	window.webContents.emit("did-finish-load");
	return { handlers, a, b, c, spawned, started, agentLaunches, launched, failLaunch: (value) => { failLaunch = value; }, confirm: (value) => { confirmChoice = value; }, app, window, confirmations: () => confirmations, ipc: { sender: window.webContents, senderFrame: window.webContents.mainFrame } };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("packaged desktop starts only its bundled Node and CLI", async () => {
	const resources = Object.getOwnPropertyDescriptor(process, "resourcesPath");
	process.resourcesPath = "/tmp/MeWriteCode.app/Contents/Resources";
	try {
		const env = await setup(["/project"]);
		env.app.isPackaged = true;
		await env.handlers.get("pick-project")();
		assert.equal(env.agentLaunches[0].binary, "/tmp/MeWriteCode.app/Contents/Resources/app/runtime/bin/node");
		assert.deepEqual(env.agentLaunches[0].args, ["/tmp/MeWriteCode.app/Contents/Resources/app/runtime/node_modules/@zhachory1/mewrite-code/dist/cli.js", "--mode", "rpc"]);
		assert.equal(env.agentLaunches[0].cwd, "/project");
	} finally {
		if (resources) Object.defineProperty(process, "resourcesPath", resources);
		else delete process.resourcesPath;
	}
});

test("occupied Project starts another app instance without interrupting its agent", async () => {
	const { handlers, a, window, app, spawned, launched, failLaunch, confirmations } = await setup(["/a", "/b"]);
	const pick = handlers.get("pick-project");
	const first = await pick();
	await handlers.get("agent-command")(null, "prompt", { message: "A turn" });
	assert.deepEqual(await pick(), { openingNewWindow: true });
	assert.deepEqual(spawned, ["/a"], "no second RPC child in this process");
	assert.equal(launched.length, 1);
	assert.ok(launched[0].args.includes("--choose-project"));
	assert.equal(a.stdin.writableEnded, false);
	assert.equal(window.webContents.sent.at(-1).activeAgentId, first.desktopAgentId);
	failLaunch(true);
	await assert.rejects(pick(), /Launch failed/);
	assert.equal(a.stdin.writableEnded, false, "launch failure leaves current agent running");
	failLaunch(false);
	app.isPackaged = true;
	await pick();
	assert.deepEqual(launched.at(-1).args.slice(process.platform === "darwin" ? 3 : 0), process.platform === "darwin" ? ["--args", "--choose-project"] : ["--choose-project"], "packaged app receives chooser flag without a source directory");
	const close = { preventDefault() { this.prevented = true; } };
	window.emit("close", close);
	assert.equal(close.prevented, true);
	assert.equal(confirmations(), 1);
	app.emit("will-quit");
	assert.equal(a.stdin.writableEnded, true);
});

test("unsent composer draft blocks Close and Quit until confirmed; forged updates are ignored", async () => {
	const env = await setup(["/draft"]);
	await env.handlers.get("pick-project")();
	const setDirty = env.handlers.get("composer-dirty");
	assert.equal(typeof setDirty, "function");
	const forged = { sender: {}, senderFrame: {} };
	setDirty(forged, true, "other");
	assert.equal(forged.returnValue, false);
	const fake = { preventDefault() { this.prevented = true; } };
	env.window.emit("close", fake);
	assert.equal(env.confirmations(), 0, "other renderers cannot make this window dirty");
	const guarded = await setup(["/protected"]);
	const selected = await guarded.handlers.get("pick-project")();
	guarded.handlers.get("composer-dirty")(guarded.ipc, true, selected.desktopAgentId);
	assert.deepEqual(await guarded.handlers.get("close-agent")(guarded.ipc, selected.desktopAgentId), { cancelled: true });
	assert.equal(guarded.a.stdin.writableEnded, false);
	const close = { preventDefault() { this.prevented = true; } };
	guarded.window.emit("close", close);
	assert.equal(close.prevented, true);
	assert.equal(guarded.confirmations(), 2);
	assert.equal(guarded.a.stdin.writableEnded, false);
	guarded.app.emit("before-quit", close);
	assert.equal(guarded.confirmations(), 3);
	assert.equal(guarded.a.stdin.writableEnded, false);
	guarded.confirm(1);
	guarded.app.emit("before-quit", close);
	await tick();
	assert.equal(guarded.a.stdin.writableEnded, true);
});

test("new window with chooser opens its own selected project after renderer load", async () => {
	const chosen = await setup(["/chosen"], true);
	await tick();
	assert.deepEqual(chosen.spawned, ["/chosen"]);
	assert.equal(chosen.window.webContents.sent.some((event) => event.type === "desktop_agent_hydrated" && event.result.cwd === "/chosen"), true);
	const cancelled = await setup([null], true);
	await tick();
	assert.deepEqual(cancelled.spawned, []);
	assert.equal(cancelled.window.webContents.sent.some((event) => event.type === "desktop_agent_hydrated"), false);
});

test("independent app instances may open the same directory without coordination", async () => {
	const first = await setup(["/a"]), second = await setup(["/a"]);
	const a = await first.handlers.get("pick-project")();
	const b = await second.handlers.get("pick-project")();
	assert.notEqual(a.desktopAgentId, b.desktopAgentId);
	assert.deepEqual(first.spawned, ["/a"]);
	assert.deepEqual(second.spawned, ["/a"]);
	first.app.emit("will-quit");
	assert.equal(first.a.stdin.writableEnded, true);
	assert.equal(second.a.stdin.writableEnded, false);
	second.app.emit("will-quit");
});

test("desktop instances resume sessions listed for their selected directories", async () => {
	const first = await setup(["/workspace/app/lib"]), second = await setup(["/workspace/app-lib"]);
	first.a.projectSessions = second.a.projectSessions = true;
	first.a.savedSessions = [{ path: "/sessions/lib.jsonl" }];
	second.a.savedSessions = [{ path: "/sessions/app-lib.jsonl" }];
	await first.handlers.get("pick-project")();
	await second.handlers.get("pick-project")();
	assert.equal(first.a.commands.find((command) => command.type === "switch_session")?.sessionPath, "/sessions/lib.jsonl");
	assert.equal(second.a.commands.find((command) => command.type === "switch_session")?.sessionPath, "/sessions/app-lib.jsonl");
});

test("legacy runtimes and cancelled or failed recent-session lookup start new chats with warnings", async () => {
	const legacy = await setup(["/legacy"]);
	const opened = await legacy.handlers.get("pick-project")();
	assert.match(opened.startupWarning, /Update installed Me Write Code/);
	assert.equal(legacy.a.commands.some((command) => command.type === "switch_session"), false);
	const cancel = await setup(["/cancel"]);
	cancel.a.projectSessions = true;
	cancel.a.savedSessions = [{ path: "/sessions/old.jsonl" }];
	cancel.a.cancelResume = true;
	assert.match((await cancel.handlers.get("pick-project")()).startupWarning, /switch was cancelled/);
	const failure = await setup(["/failed"]);
	failure.a.projectSessions = true;
	failure.a.failListing = true;
	assert.match((await failure.handlers.get("pick-project")()).startupWarning, /could not be listed/);
});

test("failed spawn releases its project reservation after terminal error", async () => {
	const { handlers, spawned } = await setup(["/missing", "/missing"]);
	await assert.rejects(handlers.get("pick-project")(), /ENOENT/);
	const reopened = await handlers.get("pick-project")();
	assert.ok(reopened.desktopAgentId);
	assert.deepEqual(spawned, ["/missing", "/missing"]);
});

test("non-Git directory launches a project agent", async () => {
	const { handlers, spawned } = await setup(["/ordinary"]);
	const opened = await handlers.get("pick-project")();
	assert.equal(opened.cwd, "/ordinary");
	assert.deepEqual(spawned, ["/ordinary"]);
});

test("renderer reload restores its sole project and reports an unrecoverable composer draft", async () => {
	const { handlers, window, spawned, ipc } = await setup(["/a"]);
	const first = await handlers.get("pick-project")();
	handlers.get("composer-dirty")(ipc, true, first.desktopAgentId);
	window.webContents.sent.length = 0;
	window.webContents.emit("render-process-gone");
	window.webContents.emit("did-finish-load");
	await tick();
	const inventory = window.webContents.sent.find((event) => event.type === "desktop_agents");
	assert.equal(inventory.activeAgentId, first.desktopAgentId);
	assert.equal(inventory.agents.length, 1);
	assert.deepEqual(spawned, ["/a"]);
	assert.equal(window.webContents.sent.some((event) => event.type === "desktop_agent_hydrated" && event.desktopAgentId === first.desktopAgentId && event.result.composerDraftLost === true), true);
});

test("consecutive renderer reloads still report the lost composer draft", async () => {
	const env = await setup(["/a"]);
	const selected = await env.handlers.get("pick-project")();
	env.handlers.get("composer-dirty")(env.ipc, true, selected.desktopAgentId);
	env.a.holdHydration = true;
	env.window.webContents.sent.length = 0;
	env.window.webContents.emit("render-process-gone");
	env.window.webContents.emit("did-finish-load");
	await tick();
	env.window.webContents.emit("render-process-gone");
	env.window.webContents.emit("did-finish-load");
	await tick();
	env.a.releaseHydration();
	await tick();
	const warnings = env.window.webContents.sent.filter((event) => event.type === "desktop_agent_hydrated" && event.result.composerDraftLost);
	assert.equal(warnings.length, 1, "warning is sent to the current renderer, not the stale generation");
});

test("closing the sole idle slot lets the same window pick a new project", async () => {
	const { handlers, spawned, a } = await setup(["/a", "/b"]);
	const first = await handlers.get("pick-project")();
	const closed = await handlers.get("close-agent")(null, first.desktopAgentId);
	assert.equal(closed.closed, true);
	assert.equal(a.stdin.writableEnded, true);
	const reopened = await handlers.get("pick-project")();
	assert.notEqual(reopened.desktopAgentId, first.desktopAgentId);
	assert.deepEqual(spawned, ["/a", "/b"]);
});

test("approval and extension replies stay in their app instances; renderer loss affects only its agent", async () => {
	const first = await setup(["/a"]), second = await setup(["/b"]);
	const openedA = await first.handlers.get("pick-project")();
	const openedB = await second.handlers.get("pick-project")();
	const approval = (id) => ({ type: "approval_request", id, ...capability, toolName: "write", tier: "write", argumentsJson: "{}", timeoutMs: 120000 });
	first.a.event(approval("a-approval"));
	second.a.event(approval("b-approval"));
	first.a.event({ type: "extension_ui_request", id: "same", method: "confirm" });
	second.a.event({ type: "extension_ui_request", id: "same", method: "confirm" });
	await tick();
	first.a.event({ type: "desktop_agents", agents: [{ desktopAgentId: "spoof", status: "Ready" }] });
	first.a.event({ type: "desktop_approval_request", token: "spoof", toolName: "bash" });
	await tick();
	assert.equal(first.window.webContents.sent.some((event) => event.type === "desktop_agents" && event.desktopAgentId === openedA.desktopAgentId), false);
	assert.equal(first.window.webContents.sent.some((event) => event.token === "spoof"), false);
	const aRequest = first.window.webContents.sent.find((event) => event.type === "desktop_approval_request");
	const bRequest = second.window.webContents.sent.find((event) => event.type === "desktop_approval_request");
	assert.equal(first.handlers.get("approval-reply")(first.ipc, openedB.desktopAgentId, bRequest.token, "once"), false);
	assert.equal(first.handlers.get("approval-reply")(first.ipc, openedA.desktopAgentId, aRequest.token, "once"), true);
	assert.equal(first.handlers.get("extension-reply")(first.ipc, { desktopAgentId: openedA.desktopAgentId, id: "same", confirmed: true }), true);
	assert.equal(first.a.commands.at(-1).type, "extension_ui_response");
	assert.equal(second.a.commands.some((entry) => entry.type === "extension_ui_response"), false);
	first.a.event(approval("a-lost"));
	first.a.event({ type: "extension_ui_request", id: "a-lost-ui", method: "select" });
	await tick();
	first.window.webContents.emit("render-process-gone");
	assert.equal(first.a.commands.find((entry) => entry.type === "approval_response" && entry.id === "a-lost").decision, "deny");
	assert.equal(first.a.commands.find((entry) => entry.type === "extension_ui_response" && entry.id === "a-lost-ui").cancelled, true);
	assert.equal(second.a.commands.some((entry) => entry.type === "approval_response" && entry.id === "b-approval"), false);
	assert.equal(second.handlers.get("approval-reply")(second.ipc, openedB.desktopAgentId, bRequest.token, "once"), true);
	first.a.event({ type: "extension_ui_request", id: "during-loss", method: "input" });
	await tick();
	assert.equal(first.a.commands.find((entry) => entry.id === "during-loss" && entry.type === "extension_ui_response")?.cancelled, true);
});
