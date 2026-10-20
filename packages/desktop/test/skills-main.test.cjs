const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");

function child(capable = true) {
	const agent = new EventEmitter();
	agent.stdin = new PassThrough();
	agent.stdout = new PassThrough();
	agent.stderr = new PassThrough();
	agent.requests = [];
	agent.revision = 0;
	agent.enabled = false;
	agent.stdin.on("data", (chunk) => {
		for (const line of chunk.toString().trim().split("\n")) {
			const request = JSON.parse(line);
			agent.requests.push(request);
			if (request.type === "get_skills" && agent.holdGet) {
				agent.pendingGet = () => agent.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success: true, data: { revision: "held", skills: [] } })}\n`);
				continue;
			}
			if (request.type === "get_skills" && (agent.failSkills || agent.failNextSkills)) {
				agent.failNextSkills = false;
				agent.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success: false, error: "Inventory unavailable" })}\n`);
				continue;
			}
			if (request.type === "set_skill_enabled" && agent.holdToggle) {
				agent.pendingToggle = () => agent.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success: true, data: { appliesTo: "next-session" } })}\n`);
				continue;
			}
			const data = request.type === "get_state" ? { rpcCapabilities: { skillsSettingsControl: capable } }
				: request.type === "get_messages" ? { messages: [] }
				: request.type === "get_commands" ? { commands: [] }
				: request.type === "get_available_models" ? { models: [] }
				: request.type === "get_skills" ? { revision: `rev-${++agent.revision}`, skills: [
					{ id: "editable", name: "local", source: "local", scope: "project", enabled: agent.enabled, status: "active", editable: true, ...(agent.replacement ? { replacement: agent.replacement } : {}), ...(agent.displaces ? { displaces: agent.displaces } : {}) },
					{ id: "readonly", name: "bundled", source: "distribution", scope: "temporary", enabled: true, status: "active", editable: false },
				] }
				: request.type === "set_skill_enabled" ? { appliesTo: "next-session" } : {};
			if (request.type === "set_skill_enabled") agent.enabled = request.enabled;
			agent.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success: true, data })}\n`);
		}
	});
	agent.stdin.on("end", () => agent.emit("exit", 0));
	return agent;
}

async function setup(children) {
	const handlers = new Map();
	const confirmations = [];
	const launches = [];
	let confirmEnable = true;
	const app = new EventEmitter();
	app.whenReady = () => Promise.resolve();
	let window;
	class BrowserWindow extends EventEmitter {
		constructor() {
			super(); window = this;
			this.webContents = new EventEmitter();
			this.webContents.mainFrame = {};
			this.webContents.setWindowOpenHandler = () => {};
			this.webContents.send = () => {};
		}
		isDestroyed() { return false; }
		loadFile() {}
	}
	const original = Module._load;
	Module._load = function (name, parent, isMain) {
		if (name === "electron") return { app, BrowserWindow, Menu: { buildFromTemplate: (items) => ({ items }), setApplicationMenu() {} }, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [`/project-${children.length}`] }), showMessageBox: async (_window, options) => { confirmations.push(options); return { response: confirmEnable ? 1 : 0 }; } }, ipcMain: { handle: (key, fn) => handlers.set(key, fn), on: (key, fn) => handlers.set(key, fn) } };
		if (parent.filename.endsWith("/desktop/main.cjs") && name === "node:fs") return { existsSync: () => false, realpathSync: (path) => path };
		if (parent.filename.endsWith("/desktop/main.cjs") && name === "node:child_process") return {
			execFile: (_binary, args, _options, callback) => { launches.push(args); callback(null); },
			spawn: (binary, args) => {
				if (binary !== process.execPath) return children.shift();
				launches.push(args);
				const instance = new EventEmitter();
				instance.unref = () => {};
				setImmediate(() => instance.emit("spawn"));
				return instance;
			},
		};
		return original.call(this, name, parent, isMain);
	};
	try { delete require.cache[require.resolve("../main.cjs")]; require("../main.cjs"); await new Promise((resolve) => setImmediate(resolve)); }
	finally { Module._load = original; }
	return { handlers, confirmations, launches, confirmEnable: (value) => { confirmEnable = value; }, ipc: { sender: window.webContents, senderFrame: window.webContents.mainFrame } };
}

test("skills IPC rejects subframes, unsupported runtimes, unknown IDs and stale revisions", async () => {
	const legacy = await setup([child(false)]);
	await legacy.handlers.get("pick-project")();
	await assert.rejects(legacy.handlers.get("get-skills")({ sender: legacy.ipc.sender, senderFrame: {} }), /unavailable/);
	await assert.rejects(legacy.handlers.get("set-skill-enabled")({ sender: legacy.ipc.sender, senderFrame: {} }, {}), /unavailable/);
	await assert.rejects(legacy.handlers.get("get-skills")(legacy.ipc), /Update installed Me Write Code/);
	const agent = child();
	const { handlers, ipc } = await setup([agent]);
	const opened = await handlers.get("pick-project")();
	assert.equal(opened.skills, undefined);
	assert.equal(agent.requests.some((request) => request.type === "get_skills"), false);
	const old = await handlers.get("get-skills")(ipc);
	const inventory = await handlers.get("get-skills")(ipc);
	for (const input of [
		{ skillId: "unknown", revision: inventory.revision, scope: "project", enabled: true },
		{ skillId: "editable", revision: old.revision, scope: "project", enabled: true },
		{ skillId: "readonly", revision: inventory.revision, scope: "temporary", enabled: false },
		{ skillId: "editable", revision: inventory.revision, scope: "user", enabled: true },
	]) await assert.rejects(handlers.get("set-skill-enabled")(ipc, input), /refresh/i);
	assert.equal(agent.requests.some((request) => request.type === "set_skill_enabled"), false);
});

test("opening another app instance leaves this window's pending skill inventory scoped to its agent", async () => {
	const a = child();
	const { handlers, ipc, launches } = await setup([a]);
	await handlers.get("pick-project")();
	a.holdGet = true;
	const pending = handlers.get("get-skills")(ipc);
	assert.deepEqual(await handlers.get("pick-project")(), { openingNewWindow: true });
	assert.equal(launches.length, 1);
	a.pendingGet();
	assert.equal((await pending).revision, "held");
	await assert.rejects(handlers.get("set-skill-enabled")(ipc, { skillId: "editable", revision: "held", scope: "project", enabled: true }), /refresh/i);
});

test("failed skill inventory does not block chat hydration", async () => {
	const agent = child();
	agent.failSkills = true;
	const { handlers, ipc } = await setup([agent]);
	const opened = await handlers.get("pick-project")();
	assert.equal(opened.skills, undefined);
	assert.equal(agent.requests.some((request) => request.type === "get_skills"), false);
	assert.deepEqual(opened.messages, []);
	await assert.rejects(handlers.get("get-skills")(ipc), /Inventory unavailable/);
	assert.deepEqual(opened.messages, []);
});

test("disabling a skill confirms that another source may become active", async () => {
	const agent = child();
	agent.enabled = true;
	agent.replacement = { name: "local", source: "local", scope: "user" };
	const { handlers, ipc, confirmations, confirmEnable } = await setup([agent]);
	await handlers.get("pick-project")();
	const inventory = await handlers.get("get-skills")(ipc);
	const toggle = handlers.get("set-skill-enabled");
	const input = { skillId: "editable", revision: inventory.revision, scope: "project", enabled: false };
	confirmEnable(false);
	assert.deepEqual(await toggle(ipc, input), { cancelled: true });
	assert.equal(agent.requests.some((request) => request.type === "set_skill_enabled"), false);
	assert.match(confirmations.at(-1).message, /Another same-named skill may become active/);
	assert.match(confirmations.at(-1).detail, /Next if unchanged: local · local · user/);
	confirmEnable(true);
	await toggle(ipc, input);
	assert.equal(agent.enabled, false);
});

test("enabling a project copy previews the user skill it may replace", async () => {
	const agent = child();
	agent.displaces = { name: "local", source: "local", scope: "user" };
	const { handlers, ipc, confirmations } = await setup([agent]);
	await handlers.get("pick-project")();
	const inventory = await handlers.get("get-skills")(ipc);
	await handlers.get("set-skill-enabled")(ipc, { skillId: "editable", revision: inventory.revision, scope: "project", enabled: true });
	assert.match(confirmations[0].message, /may replace another skill/);
	assert.match(confirmations[0].detail, /Current: local · local · user/);
});

test("saved toggle reports success even if its inventory refresh fails", async () => {
	const agent = child();
	const { handlers, ipc } = await setup([agent]);
	await handlers.get("pick-project")();
	const inventory = await handlers.get("get-skills")(ipc);
	agent.failNextSkills = true;
	const result = await handlers.get("set-skill-enabled")(ipc, { skillId: "editable", revision: inventory.revision, scope: "project", enabled: true });
	assert.equal(agent.enabled, true);
	assert.equal(result.saved, true);
	assert.match(result.warning, /saved.*Reopen Settings/);
	await assert.rejects(handlers.get("set-skill-enabled")(ipc, { skillId: "editable", revision: inventory.revision, scope: "project", enabled: false }), /refresh/);
});

test("skill enable stays in its app instance, refreshes inventory, and blocks busy changes", async () => {
	const a = child(), b = child();
	const other = await setup([a]);
	await other.handlers.get("pick-project")();
	const { handlers, ipc, confirmations, confirmEnable } = await setup([b]);
	const first = await handlers.get("pick-project")();
	assert.equal(first.skills, undefined);
	const inventory = await handlers.get("get-skills")(ipc);
	const toggle = handlers.get("set-skill-enabled");
	const input = { skillId: "editable", revision: inventory.revision, scope: "project", enabled: true };
	const get = handlers.get("get-skills");
	const command = handlers.get("agent-command");
	const turn = command(null, "prompt", { message: "Hello" });
	const duringTurn = await get(ipc);
	assert.equal(duringTurn.skills[0].name, "local");
	input.revision = duringTurn.revision;
	await assert.rejects(toggle(ipc, input), /finish/i);
	await turn;
	b.stdout.write(`${JSON.stringify({ type: "agent_end", messages: [] })}\n`);
	await new Promise((resolve) => setTimeout(resolve, 120));
	confirmEnable(false);
	assert.deepEqual(await toggle(ipc, input), { cancelled: true });
	assert.equal(b.requests.some((request) => request.type === "set_skill_enabled"), false);
	confirmEnable(true);
	b.holdToggle = true;
	const pending = toggle(ipc, input);
	await assert.rejects(toggle(ipc, input), /finish/i);
	await assert.rejects(handlers.get("activate-agent")(null, first.desktopAgentId), /Finish/);
	await assert.rejects(handlers.get("pick-project")(), /already in progress/i);
	await assert.rejects(get(ipc), /progress|finish/i);
	b.holdToggle = false;
	b.enabled = true;
	b.pendingToggle();
	const result = await pending;
	assert.equal(result.inventory.skills[0].enabled, true);
	assert.match(confirmations.at(-1).message, /instructions can influence agent actions/i);
	assert.match(confirmations.at(-1).detail, /local · project/);
	assert.equal(result.inventory.revision, "rev-3");
	assert.deepEqual(b.requests.find((request) => request.type === "set_skill_enabled"), { id: b.requests.find((request) => request.type === "set_skill_enabled").id, type: "set_skill_enabled", ...input });
	assert.equal(a.requests.some((request) => request.type === "set_skill_enabled"), false);
	await assert.rejects(toggle(ipc, input), /refresh/i);
	await handlers.get("activate-agent")(null, first.desktopAgentId);
	await assert.rejects(toggle(ipc, { ...input, revision: result.inventory.revision }), /refresh/i);
});
