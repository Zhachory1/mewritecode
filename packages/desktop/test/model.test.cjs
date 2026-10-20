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
	child.models = [
		{ provider: "test", id: "old", name: "Old", internalField: "do-not-expose" },
		{ provider: "test", id: "next", name: "Next", internalField: "do-not-expose" },
	];
	child.current = child.models[0];
	child.respond = (request, success, data) => child.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success, ...(success ? { data } : { error: data }) })}\n`);
	child.stdin.on("data", (chunk) => {
		for (const line of chunk.toString().trim().split("\n")) {
			const request = JSON.parse(line);
			if (request.type === "set_session_model") {
				if (child.holdSwitch) { child.pendingSwitch = request; continue; }
				if (child.failNext) { child.failNext = false; child.respond(request, false, "No API key"); continue; }
				else { child.current = child.models.find((model) => model.id === request.modelId); child.respond(request, true, child.current); }
				continue;
			}
			if (request.type === "new_session") child.current = child.models[0];
			const data = request.type === "get_state" ? { sessionId: "test", model: child.current, rpcCapabilities: capable ? { sessionModelSwitch: true } : {} }
				: request.type === "get_available_models" ? { models: child.models }
				: request.type === "get_commands" ? { commands: [] }
				: request.type === "get_messages" ? { messages: [] }
				: request.type === "new_session" ? { cancelled: false }
				: undefined;
			child.respond(request, true, data);
		}
	});
	child.stdin.on("end", () => child.emit("exit", 0));
	child.event = (event) => child.stdout.write(`${JSON.stringify(event)}\n`);
	child.completeSwitch = () => {
		const request = child.pendingSwitch;
		child.pendingSwitch = undefined;
		child.holdSwitch = false;
		child.current = child.models.find((model) => model.id === request.modelId);
		child.respond(request, true, child.current);
	};
	return child;
}

function setup(capable) {
	const handlers = new Map();
	const current = agent(capable);
	const originalLoad = Module._load;
	Module._load = function (name, parent, isMain) {
		if (name === "electron") return {
			app: { whenReady: () => new Promise(() => {}), on: () => {} },
			BrowserWindow: class {},
			dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ["/tmp/project"] }) },
			ipcMain: { handle: (name, handler) => handlers.set(name, handler), on: (name, handler) => handlers.set(name, handler) },
		};
		if (name === "node:fs" && parent.filename.endsWith("/desktop/main.cjs")) return { existsSync: () => false, realpathSync: (path) => path };
		if (name === "node:child_process" && parent.filename.endsWith("/desktop/main.cjs")) return { spawn: () => current, execFile: (_binary, args, _options, callback) => callback(null, `${args[1]}\n`) };
		return originalLoad.call(this, name, parent, isMain);
	};
	try {
		delete require.cache[require.resolve("../main.cjs")];
		require("../main.cjs");
	} finally {
		Module._load = originalLoad;
	}
	return { handlers, current };
}

test("desktop switches the active chat model without exposing full model metadata or racing turns", async () => {
	const legacy = setup(false);
	const old = await legacy.handlers.get("pick-project")();
	assert.equal(old.state.rpcCapabilities.sessionModelSwitch, undefined);
	await assert.rejects(legacy.handlers.get("agent-command")(null, "set_session_model", { provider: "test", modelId: "next" }), /Update installed Me Write Code/);
	const { handlers, current } = setup(true);
	const pick = handlers.get("pick-project");
	const command = handlers.get("agent-command");
	const selected = await pick();
	assert.deepEqual(selected.models, [{ provider: "test", id: "old", name: "Old" }, { provider: "test", id: "next", name: "Next" }]);
	assert.equal(selected.state.model.id, "old");
	await command(null, "prompt", { message: "hello" });
	current.event({ type: "agent_start" });
	await assert.rejects(command(null, "set_session_model", { provider: "test", modelId: "next" }), /Wait for current turn/);
	current.event({ type: "agent_end" });
	await new Promise((resolve) => setTimeout(resolve, 120));
	current.holdSwitch = true;
	const switching = command(null, "set_session_model", { provider: "test", modelId: "next" });
	await assert.rejects(command(null, "prompt", { message: "while switching" }), /Model switch in progress/);
	await assert.rejects(command(null, "new_session"), /Model switch in progress/);
	await assert.rejects(pick(), /Model switch in progress/);
	current.completeSwitch();
	assert.deepEqual(await switching, { provider: "test", id: "next", name: "Next" });
	await assert.rejects(command(null, "set_session_model", { provider: "test", modelId: "missing" }), /isn't available for this chat\. Choose another model/);
	current.failNext = true;
	await assert.rejects(command(null, "set_session_model", { provider: "test", modelId: "old" }), /No API key/);
	assert.equal((await command(null, "get_state")).model.id, "next");
	await command(null, "new_session");
	assert.equal((await command(null, "get_state")).model.id, "old");
});
