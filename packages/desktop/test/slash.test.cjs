const { EventEmitter } = require("node:events");
const Module = require("node:module");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");
const assert = require("node:assert/strict");

function agent(capable) {
	const child = new EventEmitter();
	child.stdin = new PassThrough();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.promptId = undefined;
	child.replies = [];
	child.stdin.on("data", (chunk) => {
		for (const line of chunk.toString().trim().split("\n")) {
			const command = JSON.parse(line);
			if (command.type === "extension_ui_response") { child.replies.push(command); continue; }
			const data = command.type === "get_state" ? { sessionId: "test", rpcCapabilities: capable ? { promptCompletion: true } : undefined }
				: command.type === "get_messages" ? { messages: [] }
				: command.type === "get_available_models" ? { models: [] }
				: command.type === "get_commands" ? { commands: [
					{ name: "tips", source: "extension", description: "Show tips" },
					{ name: "theme", source: "extension" },
					{ name: "theme", source: "prompt" },
					{ name: "tips", source: "prompt" },
					{ name: "skill:inspect", source: "skill" },
					{ name: "template", source: "prompt" },
				] }
				: undefined;
			if (command.type === "prompt") child.promptId = command.id;
			child.stdout.write(`${JSON.stringify({ id: command.id, type: "response", command: command.type, success: true, data })}\n`);
		}
	});
	child.stdin.on("end", () => child.emit("exit", 0));
	child.event = (event) => child.stdout.write(`${JSON.stringify(event)}\n`);
	return child;
}

async function setup(capable) {
	const handlers = new Map();
	let window;
	const child = agent(capable);
	const originalLoad = Module._load;
	Module._load = function (name, parent, isMain) {
		if (name === "electron") return {
			app: { whenReady: () => Promise.resolve(), on: () => {} },
			Menu: { buildFromTemplate: (items) => ({ items }), setApplicationMenu() {} },
			BrowserWindow: class extends EventEmitter {
				constructor() { super(); window = this; this.webContents = new EventEmitter(); this.webContents.mainFrame = {}; this.webContents.send = () => {}; this.webContents.setWindowOpenHandler = () => {}; }
				isDestroyed() { return false; }
				loadFile() {}
			},
			dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ["/tmp/project"] }) },
			ipcMain: { handle: (name, handler) => handlers.set(name, handler), on: (name, handler) => handlers.set(name, handler) },
		};
		if (name === "node:fs" && parent.filename.endsWith("/desktop/main.cjs")) return { existsSync: () => false, realpathSync: (path) => path };
		if (name === "node:child_process" && parent.filename.endsWith("/desktop/main.cjs")) return { spawn: () => child, execFile: (_binary, args, _options, callback) => callback(null, `${args[1]}\n`) };
		return originalLoad.call(this, name, parent, isMain);
	};
	try {
		delete require.cache[require.resolve("../main.cjs")];
		require("../main.cjs");
	} finally {
		Module._load = originalLoad;
	}
	await new Promise((resolve) => setImmediate(resolve));
	const ipcEvent = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
	window.webContents.emit("did-finish-load");
	return { child, handlers, ipcEvent };
}

test("desktop gates slash commands on installed runtime and waits for matching completion", async () => {
	const legacy = await setup(false);
	const old = await legacy.handlers.get("pick-project")();
	assert.equal(old.state.rpcCapabilities, undefined);
	await assert.rejects(legacy.handlers.get("agent-command")(null, "prompt", { message: "/tips" }), /Update installed Me Write Code/);
	const { child, handlers, ipcEvent } = await setup(true);
	const command = handlers.get("agent-command");
	const current = await handlers.get("pick-project")();
	assert.equal(current.state.rpcCapabilities.promptCompletion, true);
	assert.deepEqual(current.commands.map((item) => item.name), ["tips", "skill:inspect", "template"]);
	await assert.rejects(command(null, "prompt", { message: "/settings" }), /\/settings isn't available in the desktop app\. Type \/ to see/);
	await assert.rejects(command(null, "prompt", { message: "/theme" }), /\/theme isn't available in the desktop app/);
	await assert.rejects(command(null, "prompt", { message: "/tips\nmore" }), /Use a space/);
	await command(null, "prompt", { message: "/tips" });
	await assert.rejects(command(null, "prompt", { message: "next" }), /Wait for current turn/);
	child.event({ type: "prompt_complete", id: "wrong" });
	await new Promise((resolve) => setTimeout(resolve, 120));
	await assert.rejects(command(null, "prompt", { message: "next" }), /Wait for current turn/);
	child.event({ type: "prompt_complete", id: child.promptId });
	await new Promise((resolve) => setTimeout(resolve, 120));
	await command(null, "prompt", { message: "/tips" });
	child.event({ type: "extension_ui_request", method: "confirm", id: "dialog", title: "Continue?" });
	handlers.get("extension-reply")(ipcEvent, { desktopAgentId: current.desktopAgentId, id: "dialog", cancelled: true });
	assert.deepEqual(child.replies[0], { type: "extension_ui_response", id: "dialog", cancelled: true });
	await assert.rejects(command(null, "prompt", { message: "next" }), /Wait for current turn/);
	child.event({ type: "prompt_complete", id: child.promptId });
	await new Promise((resolve) => setTimeout(resolve, 120));
	await command(null, "prompt", { message: "next" });
	child.event({ type: "agent_end" });
	await new Promise((resolve) => setTimeout(resolve, 120));
	await command(null, "prompt", { message: "/tips" });
	child.event({ type: "agent_start" });
	child.event({ type: "agent_end" });
	child.event({ type: "auto_retry_start" });
	await new Promise((resolve) => setTimeout(resolve, 120));
	await assert.rejects(command(null, "prompt", { message: "next" }), /Wait for current turn/);
	child.event({ type: "auto_retry_end", success: false });
	child.event({ type: "prompt_complete", id: child.promptId });
	await new Promise((resolve) => setTimeout(resolve, 120));
	await command(null, "prompt", { message: "/tips" });
	child.event({ type: "response", command: "prompt", id: child.promptId, success: false, error: "failed" });
	await command(null, "prompt", { message: "next" });
});
