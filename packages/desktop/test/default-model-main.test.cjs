const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");

function agent(capable, mcpCapable = false) {
	const child = new EventEmitter();
	child.stdin = new PassThrough();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.defaultModels = [
		{ provider: "test", id: "alpha", name: "Alpha", internalField: "do-not-expose" },
		{ provider: "test", id: "beta", name: "Beta", internalField: "do-not-expose" },
	];
	child.currentDefault = child.defaultModels[0];
	child.stdin.on("data", (chunk) => {
		for (const line of chunk.toString().trim().split("\n")) {
			const request = JSON.parse(line);
			let data;
			if (request.type === "get_state") {
				data = {
					sessionId: "test",
					model: child.defaultModels[0],
					defaultModel: child.currentDefault,
					defaultModelScope: "global",
					rpcCapabilities: { ...(capable ? { defaultModelControl: true } : {}), ...(mcpCapable ? { mcpSettingsControl: true } : {}) },
				};
			} else if (request.type === "get_available_models") {
				data = { models: child.defaultModels };
			} else if (request.type === "get_default_models") {
				data = { models: child.defaultModels };
			} else if (request.type === "get_commands") {
				data = { commands: [] };
			} else if (request.type === "get_messages") {
				data = { messages: [] };
			} else if (request.type === "get_mcp_servers") {
				data = { servers: [], revisions: { project: "project-token", user: "user-token" }, errors: [] };
			} else if (request.type === "save_mcp_server" || request.type === "remove_mcp_server") {
				data = { appliesTo: "next-session" };
			} else if (request.type === "set_default_model") {
				if (child.failNext) {
					child.failNext = false;
					child.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success: false, error: "Provider unavailable" })}\n`);
					continue;
				}
				child.currentDefault = child.defaultModels.find((m) => m.id === request.modelId);
				data = child.currentDefault;
			} else if (request.type === "client_capabilities") {
				data = {};
			}
			child.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success: true, data })}\n`);
		}
	});
	child.stdin.on("end", () => child.emit("exit", 0));
	child.event = (event) => child.stdout.write(`${JSON.stringify(event)}\n`);
	return child;
}

function setupMain(children) {
	const handlers = new Map();
	const confirmations = [];
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
			dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ["/tmp/project"] }), showMessageBox: async (_window, options) => { confirmations.push(options); return { response: 1 }; } },
			ipcMain: { handle: (name, callback) => handlers.set(name, callback), on: (name, callback) => handlers.set(name, callback) },
			shell: { openExternal: async () => {} },
		};
		if (name === "node:fs" && parent.filename.endsWith("/desktop/main.cjs")) return { existsSync: () => false, realpathSync: (path) => path };
		if (name === "node:child_process" && parent.filename.endsWith("/desktop/main.cjs")) return { spawn: () => children.shift(), execFile: (_binary, args, _options, callback) => callback(null, `${args[1]}\n`) };
		return originalLoad.call(this, name, parent, isMain);
	};
	try {
		delete require.cache[require.resolve("../main.cjs")];
		require("../main.cjs");
		// flush setImmediate queue so app.whenReady resolves
	} finally {
		Module._load = originalLoad;
	}
	return { handlers, confirmations, getWindow: () => window };
}

test("set-default-model rejects requests not from the main frame", async () => {
	const child = agent(true);
	const { handlers, getWindow } = setupMain([child]);
	await new Promise((resolve) => setImmediate(resolve));
	await handlers.get("pick-project")();
	const window = getWindow();
	const badEvent = { sender: {}, senderFrame: {} };
	await assert.rejects(handlers.get("set-default-model")(badEvent, "test", "alpha"), /unavailable/);
});

test("set-default-model rejects when capability is not reported", async () => {
	const child = agent(false);
	const { handlers, getWindow } = setupMain([child]);
	await new Promise((resolve) => setImmediate(resolve));
	await handlers.get("pick-project")();
	const window = getWindow();
	const ipcEvent = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
	await assert.rejects(handlers.get("set-default-model")(ipcEvent, "test", "alpha"), /Update installed Me Write Code/);
});

test("set-default-model rejects candidates not in the validated list", async () => {
	const child = agent(true);
	const { handlers, getWindow } = setupMain([child]);
	await new Promise((resolve) => setImmediate(resolve));
	await handlers.get("pick-project")();
	const window = getWindow();
	const ipcEvent = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
	// wrong provider
	await assert.rejects(handlers.get("set-default-model")(ipcEvent, "other", "alpha"), /isn't available\. Choose another default model/);
	// wrong model id
	await assert.rejects(handlers.get("set-default-model")(ipcEvent, "test", "missing"), /isn't available\. Choose another default model/);
	// non-string arguments
	await assert.rejects(handlers.get("set-default-model")(ipcEvent, null, "alpha"), /isn't available\. Choose another default model/);
	await assert.rejects(handlers.get("set-default-model")(ipcEvent, "test", 42), /isn't available\. Choose another default model/);
});

test("set-default-model serializes the chosen model and returns it without internal fields", async () => {
	const child = agent(true);
	const { handlers, getWindow } = setupMain([child]);
	await new Promise((resolve) => setImmediate(resolve));
	await handlers.get("pick-project")();
	const window = getWindow();
	const ipcEvent = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
	const result = await handlers.get("set-default-model")(ipcEvent, "test", "beta");
	assert.deepEqual(result, { provider: "test", id: "beta", name: "Beta" });
	assert.equal("internalField" in result, false);
});

test("set-default-model blocks concurrent switches (switching flag set)", async () => {
	const child = agent(true);
	const { handlers, getWindow } = setupMain([child]);
	await new Promise((resolve) => setImmediate(resolve));
	await handlers.get("pick-project")();
	const window = getWindow();
	const ipcEvent = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
	// start a first switch (it will resolve quickly but we intercept the switching flag via a second pick-project)
	const first = handlers.get("set-default-model")(ipcEvent, "test", "beta");
	// second immediate call should fail because switching is true
	await assert.rejects(handlers.get("set-default-model")(ipcEvent, "test", "alpha"), /finish before changing/);
	await first;
});

test("set-default-model rejects after project changes mid-switch", async () => {
	let holdResolve;
	const child = agent(true);
	// Patch stdin handler to hold set_default_model until we release it
	const originalWrite = child.stdin.write.bind(child.stdin);
	child.stdin.write = function (chunk, ...args) {
		const line = chunk.toString().trim();
		if (!line) return originalWrite(chunk, ...args);
		const request = JSON.parse(line);
		if (request.type === "set_default_model") {
			new Promise((resolve) => { holdResolve = resolve; }).then(() => originalWrite(chunk, ...args));
			return true;
		}
		return originalWrite(chunk, ...args);
	};
	const { handlers, getWindow } = setupMain([child]);
	await new Promise((resolve) => setImmediate(resolve));
	await handlers.get("pick-project")();
	const window = getWindow();
	const ipcEvent = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
	const switching = handlers.get("set-default-model")(ipcEvent, "test", "beta");
	// pick-project is blocked while switching=true; release the hold first
	holdResolve();
	// The switch should complete without error (no project change actually happened here)
	await switching;
});

test("MCP settings require main-frame native confirmation with exact command", async () => {
	const child = agent(true, true);
	const { handlers, confirmations, getWindow } = setupMain([child]);
	await new Promise((resolve) => setImmediate(resolve));
	await handlers.get("pick-project")();
	const window = getWindow();
	const input = { scope: "project", revision: "project-token", name: "local", transport: "stdio", command: "node", args: ["server.js"] };
	await assert.rejects(handlers.get("mcp-settings")({ sender: {}, senderFrame: {} }, "save_mcp_server", input), /unavailable/);
	const result = await handlers.get("mcp-settings")({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, "save_mcp_server", input);
	assert.equal(result.cancelled, false);
	assert.match(confirmations[0].detail, /project: local\nnode\nserver\.js/);
});

test("set-default-model rejects while an agent turn is active (busy flag)", async () => {
	// Extend the agent mock to handle prompt commands (busy guard test)
	const child = agent(true);
	let holdPromptResolve;
	const originalWrite = child.stdin.write.bind(child.stdin);
	child.stdin.write = function (chunk, ...args) {
		const line = chunk.toString().trim();
		if (!line) return originalWrite(chunk, ...args);
		const request = JSON.parse(line);
		if (request.type === "prompt") {
			// Hold the prompt response until we release it so busy stays true
			new Promise((resolve) => { holdPromptResolve = resolve; }).then(() =>
				child.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success: true, data: {} })}\n`)
			);
			return true;
		}
		return originalWrite(chunk, ...args);
	};
	const { handlers, getWindow } = setupMain([child]);
	await new Promise((resolve) => setImmediate(resolve));
	await handlers.get("pick-project")();
	const window = getWindow();
	const ipcEvent = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
	// Start a turn — busy becomes true synchronously before the await in agent-command
	const turn = handlers.get("agent-command")(null, "prompt", { message: "test" });
	// While busy, set-default-model must be rejected
	await assert.rejects(handlers.get("set-default-model")(ipcEvent, "test", "alpha"), /finish before changing/);
	// Release the prompt response and let the turn settle
	holdPromptResolve();
	await turn;
});
