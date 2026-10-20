const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");

function child() {
	const proc = new EventEmitter();
	proc.stdin = new PassThrough();
	proc.stdout = new PassThrough();
	proc.stderr = new PassThrough();
	proc.stdin.on("data", (chunk) => {
		for (const line of chunk.toString().trim().split("\n")) {
			const request = JSON.parse(line);
			const data = request.type === "get_state" ? { rpcCapabilities: {} }
				: request.type === "get_messages" ? { messages: [] }
				: request.type === "get_commands" ? { commands: [] }
				: request.type === "get_available_models" ? { models: [] } : {};
			proc.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success: true, data })}\n`);
		}
	});
	proc.stdin.on("end", () => proc.emit("exit", 0));
	return proc;
}

async function setup(t) {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "mewrite-editor-main-")));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const roots = [join(base, "a"), join(base, "b")];
	for (const root of roots) mkdirSync(root);
	const file = join(roots[0], "note.txt");
	const other = join(roots[1], "note.txt");
	const outside = join(base, "outside.txt");
	for (const path of [file, other, outside]) writeFileSync(path, "original\n");
	const handlers = new Map();
	const picks = [];
	const files = [];
	const responses = [];
	const children = [];
	const app = new EventEmitter();
	let quitCount = 0;
	app.quit = () => { quitCount++; };
	app.whenReady = () => Promise.resolve();
	let window;
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
	const original = Module._load;
	Module._load = function (name, parent, isMain) {
		if (name === "electron") return {
			app, BrowserWindow,
			Menu: { buildFromTemplate: (items) => ({ items }), setApplicationMenu() {} },
			dialog: {
				showOpenDialog: async (_window, options) => options.properties.includes("openDirectory") ? { canceled: false, filePaths: [picks.shift()] } : { canceled: false, filePaths: [files.shift()] },
				showMessageBoxSync: () => responses.shift() ?? 0,
			},
			ipcMain: { handle: (name, handler) => handlers.set(name, handler), on: (name, handler) => handlers.set(name, handler) },
		};
		if (name === "node:child_process" && parent.filename.endsWith("/desktop/main.cjs")) return {
			spawn: (binary) => {
				// Non-macOS opens new windows by spawning this executable and waiting for "spawn".
				if (binary === process.execPath) {
					const instance = new EventEmitter();
					instance.unref = () => {};
					setImmediate(() => instance.emit("spawn"));
					return instance;
				}
				const proc = child(); children.push(proc); return proc;
			},
			execFile: (_command, args, _options, callback) => callback(null, `${args[1]}\n`),
		};
		return original.call(this, name, parent, isMain);
	};
	try {
		delete require.cache[require.resolve("../main.cjs")];
		require("../main.cjs");
		await new Promise((resolve) => setImmediate(resolve));
	} finally { Module._load = original; }
	const ipc = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
	return { handlers, roots, file, other, outside, picks, files, responses, children, app, window, ipc, quitCount: () => quitCount };
}

async function selected(env) {
	env.picks.push(env.roots[0]);
	return env.handlers.get("pick-project")();
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
function setDirty(env, token, dirty, event = env.ipc) {
	env.handlers.get("set-editor-dirty")(event, token, dirty);
	return event.returnValue;
}

test("editor IPC rejects subframes and paths outside selected project", async (t) => {
	const env = await setup(t);
	await selected(env);
	const { handlers, ipc, files, outside } = env;
	const bad = { sender: ipc.sender, senderFrame: {} };
	await assert.rejects(handlers.get("open-project-file")(bad), /unavailable/i);
	files.push(outside);
	await assert.rejects(handlers.get("open-project-file")(ipc), /inside the selected project/i);
	assert.equal(readFileSync(outside, "utf8"), "original\n");
	files.push(env.file);
	const opened = await handlers.get("open-project-file")(ipc);
	assert.deepEqual(Object.keys(opened).sort(), ["content", "relativePath", "token"]);
	await assert.rejects(handlers.get("save-project-file")(bad, opened.token, "bad"), /unavailable/i);
	assert.equal(setDirty(env, opened.token, true, bad), false);
});

test("save accepts only opened token in active project and refreshes proof", async (t) => {
	const env = await setup(t);
	await selected(env);
	env.files.push(env.file);
	const { token } = await env.handlers.get("open-project-file")(env.ipc);
	await assert.rejects(env.handlers.get("save-project-file")(env.ipc, "other", "bad"), /no longer open here\. Open it again/);
	const saved = await env.handlers.get("save-project-file")(env.ipc, token, "edited\n");
	assert.deepEqual(Object.keys(saved), ["token"]);
	assert.equal(readFileSync(env.file, "utf8"), "edited\n");
	assert.equal(setDirty(env, saved.token, false), true);
	const next = await env.handlers.get("save-project-file")(env.ipc, saved.token, "again\n");
	assert.equal(setDirty(env, next.token, false), true);
	assert.deepEqual(await env.handlers.get("pick-project")(), { openingNewWindow: true }, "another project opens in its own process");
	assert.equal(setDirty(env, next.token, false), true, "original window keeps its editor token");
	await env.handlers.get("save-project-file")(env.ipc, next.token, "still here\n");
	assert.equal(readFileSync(env.file, "utf8"), "still here\n");
});

test("save waits for an active agent turn in the same project", async (t) => {
	const env = await setup(t);
	await selected(env);
	env.files.push(env.file);
	const { token } = await env.handlers.get("open-project-file")(env.ipc);
	assert.equal(setDirty(env, token, true), true);
	await env.handlers.get("agent-command")(null, "prompt", { message: "working" });
	await assert.rejects(env.handlers.get("save-project-file")(env.ipc, token, "draft"), /agents? to finish/);
	assert.equal(readFileSync(env.file, "utf8"), "original\n");
});

test("external edit conflict preserves file and dirty token", async (t) => {
	const env = await setup(t);
	await selected(env);
	env.files.push(env.file);
	const { token } = await env.handlers.get("open-project-file")(env.ipc);
	assert.equal(setDirty(env, token, true), true);
	writeFileSync(env.file, "external\n");
	await assert.rejects(env.handlers.get("save-project-file")(env.ipc, token, "draft\n"), /changed|replaced/i);
	assert.equal(readFileSync(env.file, "utf8"), "external\n");
	assert.equal(setDirty(env, token, true), true);
	env.responses.push(0);
	env.files.push(env.file);
	assert.equal(await env.handlers.get("open-project-file")(env.ipc), null);
	assert.equal(setDirty(env, token, true), true);
});

test("dirty file replacement cancel and new project window keep the original draft", async (t) => {
	const env = await setup(t);
	await selected(env);
	env.files.push(env.file);
	const { token } = await env.handlers.get("open-project-file")(env.ipc);
	assert.equal(setDirty(env, token, true), true);
	env.files.push(env.file);
	assert.equal(await env.handlers.get("open-project-file")(env.ipc), null);
	assert.equal(setDirty(env, token, true), true);
	assert.deepEqual(await env.handlers.get("pick-project")(), { openingNewWindow: true });
	assert.equal(setDirty(env, token, true), true);
	assert.equal(readFileSync(env.file, "utf8"), "original\n");
});

test("a failed agent does not bypass draft warnings or prevent manual file save", async (t) => {
	const env = await setup(t);
	await selected(env);
	env.files.push(env.file);
	const { token } = await env.handlers.get("open-project-file")(env.ipc);
	env.children[0].emit("exit", 1);
	assert.equal(setDirty(env, token, true), true);
	env.app.emit("before-quit", { preventDefault() {} });
	assert.equal(env.quitCount(), 0);
	const saved = await env.handlers.get("save-project-file")(env.ipc, token, "edited after agent exit\n");
	assert.equal(readFileSync(env.file, "utf8"), "edited after agent exit\n");
	assert.equal(setDirty(env, saved.token, false), true);
});

test("opening a new window after agent exit preserves the old window's draft", async (t) => {
	const env = await setup(t);
	await selected(env);
	env.files.push(env.file);
	const { token } = await env.handlers.get("open-project-file")(env.ipc);
	assert.equal(setDirty(env, token, true), true);
	env.children[0].emit("exit", 1);
	assert.deepEqual(await env.handlers.get("pick-project")(), { openingNewWindow: true });
	assert.equal(env.children.length, 1);
	assert.equal(setDirty(env, token, true), true);
	assert.equal(readFileSync(env.file, "utf8"), "original\n");
});

test("renderer reload revokes the file token and reports lost unsaved edits", async (t) => {
	const env = await setup(t);
	await selected(env);
	env.files.push(env.file);
	const { token } = await env.handlers.get("open-project-file")(env.ipc);
	assert.equal(setDirty(env, token, true), true);
	env.window.webContents.emit("render-process-gone");
	env.window.webContents.emit("did-finish-load");
	assert.equal(setDirty(env, token, true), false);
	assert.equal(env.window.webContents.sent.some((event) => event.type === "desktop_file_draft_lost"), true);
	assert.equal(readFileSync(env.file, "utf8"), "original\n");
});

test("renderer reload during Save reports draft loss even when the write completes", async (t) => {
	const env = await setup(t);
	await selected(env);
	env.files.push(env.file);
	const { token } = await env.handlers.get("open-project-file")(env.ipc);
	assert.equal(setDirty(env, token, true), true);
	const saving = env.handlers.get("save-project-file")(env.ipc, token, "pending save\n");
	env.window.webContents.emit("render-process-gone");
	env.window.webContents.emit("did-finish-load");
	await assert.rejects(saving, /Project changed while saving file/);
	assert.equal(readFileSync(env.file, "utf8"), "pending save\n");
	assert.equal(env.window.webContents.sent.some((event) => event.type === "desktop_file_draft_lost"), true);
});

test("save remains protected from quit until the renderer acknowledges the clean state", async (t) => {
	const env = await setup(t);
	await selected(env);
	env.files.push(env.file);
	const { token } = await env.handlers.get("open-project-file")(env.ipc);
	const saved = await env.handlers.get("save-project-file")(env.ipc, token, "edited\n");
	const cancel = { preventDefault() {} };
	env.app.emit("before-quit", cancel);
	assert.equal(env.quitCount(), 0);
	assert.equal(setDirty(env, saved.token, false), true);
	env.app.emit("before-quit", cancel);
	await tick();
	assert.equal(env.quitCount(), 1);
});

test("dirty close cancels and quit confirmation closes only this window's child", async (t) => {
	const env = await setup(t);
	const first = await selected(env);
	env.files.push(env.file);
	const { token } = await env.handlers.get("open-project-file")(env.ipc);
	assert.equal(setDirty(env, token, true), true);
	assert.deepEqual(await env.handlers.get("close-agent")(env.ipc, first.desktopAgentId), { cancelled: true });
	assert.deepEqual(await env.handlers.get("pick-project")(), { openingNewWindow: true });
	assert.equal(setDirty(env, token, true), true);
	const cancel = { preventDefault() { this.prevented = true; } };
	env.app.emit("before-quit", cancel);
	assert.equal(cancel.prevented, true);
	assert.equal(env.quitCount(), 0);
	assert.equal(env.children.every((proc) => !proc.stdin.writableEnded), true);
	env.responses.push(1);
	env.app.emit("before-quit", { preventDefault() {} });
	await tick();
	assert.equal(env.children.every((proc) => proc.stdin.writableEnded), true);
	assert.equal(env.quitCount(), 1);
});
