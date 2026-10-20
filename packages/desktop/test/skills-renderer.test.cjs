const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

class Element {
	constructor() { this.children = []; this.listeners = new Map(); this.textContent = ""; this.value = ""; this.hidden = false; }
	addEventListener(name, callback) { this.listeners.set(name, callback); }
	removeEventListener(name) { this.listeners.delete(name); }
	setAttribute() {}
	removeAttribute() {}
	replaceChildren(...children) { this.children = children; }
	append(...children) { this.children.push(...children); }
	get childElementCount() { return this.children.length; }
	focus() {}
	showModal() { this.open = true; }
	close() { this.open = false; }
}

function setup() {
	const elements = new Map();
	const document = { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); }, createElement: () => new Element() };
	const calls = [];
	const inventory = (scope, enabled = true) => ({ revision: `${scope}-rev`, skills: [
		{ id: `${scope}-id`, name: "<skill>", source: "local", scope, status: "active", enabled, editable: true, path: "/private/path", description: "private description" },
		{ id: "bundled", name: "bundled", source: "distribution", scope: "temporary", status: "active", enabled: true, editable: false },
	] });
	let current = inventory("project");
	let fail = false;
	let pendingGet;
	let getCount = 0;
	let onEvent;
	const result = (id) => ({ desktopAgentId: id, cwd: `/tmp/${id}`, state: { rpcCapabilities: { skillsSettingsControl: true }, model: { provider: "test", id: "model" } }, messages: [{ role: "user", content: `Chat ${id}` }], commands: [], models: [] });
	const api = {
		pickProject: async () => result("A"),
		listSessions: async () => [],
		getSkills: () => { getCount++; const pending = pendingGet; pendingGet = undefined; return pending ?? Promise.resolve(current); },
		setSkillEnabled: async (input) => { calls.push(input); if (fail) throw new Error("Skill update failed"); current = inventory(input.scope, input.enabled); return { inventory: current }; },
		command: async (type) => type === "new_session" ? {} : type === "get_state" ? result("A").state : { messages: [{ role: "user", content: "Chat A" }] },
		onEvent: (callback) => { onEvent = callback; },
	};
	const window = { innerWidth: 1200, mewrite: api, mewriteMarkdown: { renderMarkdown: async () => {} }, addEventListener() {}, removeEventListener() {} };
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window, document, setTimeout, clearTimeout });
	return { elements, calls, inventory, api, result, getCount: () => getCount, onEvent: (event) => onEvent(event), fail: (value) => { fail = value; }, current: (value) => { current = value; }, holdGet: (promise) => { pendingGet = promise; } };
}

test("Skills Settings renders only safe fields, scopes toggles and leaves chat unchanged", async () => {
	const { elements, calls, onEvent } = setup();
	await elements.get("#project").listeners.get("click")();
	await onEvent({ type: "desktop_open_settings" });
	const list = elements.get("#skills-list");
	assert.equal(list.children.length, 2);
	assert.equal(list.children[1].children.length, 1);
	assert.match(list.children[0].children[0].textContent, /<skill> · local · project · active/);
	assert.doesNotMatch(list.children[0].children[0].textContent, /private|\/path/);
	assert.equal(list.children[0].children[1].textContent, "Disable");
	await list.children[0].children[1].listeners.get("click")();
	assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { skillId: "project-id", revision: "project-rev", scope: "project", enabled: false });
	assert.match(elements.get("#skills-note").textContent, /Used by new chats; current chat unchanged/);
	assert.equal(elements.get("#conversation").children[0].textContent, "Chat A");
	await onEvent({ type: "desktop_agents", agents: [{ desktopAgentId: "A", status: "Needs approval" }] });
	assert.equal(list.children[0].children[1].disabled, true);
	await onEvent({ type: "desktop_agents", agents: [{ desktopAgentId: "A", status: "Ready" }] });
	assert.equal(list.children[0].children[1].disabled, false);
	await onEvent({ type: "agent_start" });
	assert.equal(list.children[0].children[1].disabled, true);
});

test("failed toggle retains prior state and shows actionable error", async () => {
	const { elements, fail, onEvent } = setup();
	await elements.get("#project").listeners.get("click")();
	await onEvent({ type: "desktop_open_settings" });
	fail(true);
	const list = elements.get("#skills-list");
	await list.children[0].children[1].listeners.get("click")();
	assert.equal(list.children[0].children[1].textContent, "Disable");
	assert.match(elements.get("#skills-note").textContent, /Skill update failed.*retry/i);
});

test("saved change with failed inventory refresh is not reported as a failed write", async () => {
	const { elements, api, onEvent } = setup();
	await elements.get("#project").listeners.get("click")();
	await onEvent({ type: "desktop_open_settings" });
	api.setSkillEnabled = async () => ({ saved: true, warning: "Skill setting saved. Reopen Settings to refresh the list." });
	await elements.get("#skills-list").children[0].children[1].listeners.get("click")();
	assert.equal(elements.get("#skills-list").children.length, 0);
	assert.match(elements.get("#skills-note").textContent, /setting saved.*Reopen Settings/i);
	assert.equal(elements.get("#conversation").children[0].textContent, "Chat A");
});

test("cancelled skill enable retains its disabled state", async () => {
	const { elements, api, inventory, current, onEvent } = setup();
	current(inventory("project", false));
	await elements.get("#project").listeners.get("click")();
	await onEvent({ type: "desktop_open_settings" });
	api.setSkillEnabled = async () => ({ cancelled: true });
	const button = elements.get("#skills-list").children[0].children[1];
	assert.equal(button.textContent, "Enable");
	await button.listeners.get("click")();
	assert.equal(button.textContent, "Enable");
});

test("unsupported runtime shows an actionable Skills message without controls", async () => {
	const { elements, api, result, onEvent } = setup();
	api.pickProject = async () => ({ ...result("A"), state: { rpcCapabilities: {} } });
	await elements.get("#project").listeners.get("click")();
	await onEvent({ type: "desktop_open_settings" });
	assert.equal(elements.get("#skills-list").children.length, 0);
	assert.match(elements.get("#skills-note").textContent, /Update installed Me Write Code/);
});

test("inventory failure on Settings open leaves chat usable and offers a retry", async () => {
	const { elements, api, getCount, onEvent } = setup();
	api.getSkills = async () => { throw new Error("Inventory unavailable"); };
	await elements.get("#project").listeners.get("click")();
	assert.equal(getCount(), 0);
	await onEvent({ type: "desktop_open_settings" });
	assert.match(elements.get("#skills-note").textContent, /Inventory unavailable.*Reopen Settings to retry/);
	assert.equal(elements.get("#conversation").children[0].textContent, "Chat A");
});

test("chat switch leaves inventory unloaded while Settings is hidden", async () => {
	const { elements, api, inventory, result, current, getCount, onEvent } = setup();
	api.pickProject = async () => ({ ...result("A"), state: { rpcCapabilities: { skillsSettingsControl: true, projectSessions: true } } });
	api.listSessions = async () => [{ token: "other", name: "Other", active: false }];
	api.switchSession = async () => ({ ...result("B"), cancelled: false, messages: [{ role: "user", content: "Other chat" }] });
	await elements.get("#project").listeners.get("click")();
	await elements.get("#sessions").listeners.get("click")();
	current(inventory("project", false));
	await elements.get("#sessions-list").children[0].listeners.get("click")();
	assert.equal(getCount(), 0);
	assert.equal(elements.get("#skills-list").children.length, 0);
	assert.equal(elements.get("#conversation").children[0].textContent, "Other chat");
	await onEvent({ type: "desktop_open_settings" });
	assert.equal(elements.get("#skills-list").children[0].children[1].textContent, "Enable");
});

test("Settings-visible chat switch clears stale rows while inventory loads", async () => {
	const { elements, api, inventory, result, current, holdGet, onEvent } = setup();
	api.pickProject = async () => ({ ...result("A"), state: { rpcCapabilities: { skillsSettingsControl: true, projectSessions: true } } });
	api.listSessions = async () => [{ token: "other", name: "Other", active: false }];
	api.switchSession = async () => ({ ...result("B"), cancelled: false, messages: [{ role: "user", content: "Other chat" }] });
	await elements.get("#project").listeners.get("click")();
	await onEvent({ type: "desktop_open_settings" });
	assert.equal(elements.get("#skills-list").children[0].children[1].textContent, "Disable");
	await elements.get("#sessions").listeners.get("click")();
	let release;
	holdGet(new Promise((resolve) => { release = resolve; }));
	current(inventory("project", false));
	await elements.get("#sessions-list").children[0].listeners.get("click")();
	assert.equal(elements.get("#skills-list").children.length, 0);
	assert.equal(elements.get("#conversation").children[0].textContent, "Other chat");
	release(inventory("project", false));
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(elements.get("#skills-list").children[0].children[1].textContent, "Enable");
});

test("opening another window leaves this project's skills inventory intact; new chat refreshes it", async () => {
	const { elements, inventory, api, result, onEvent, holdGet, current, getCount } = setup();
	await elements.get("#project").listeners.get("click")();
	let release;
	holdGet(new Promise((resolve) => { release = resolve; }));
	const opening = onEvent({ type: "desktop_open_settings" });
	current(inventory("project", false));
	api.pickProject = async () => ({ openingNewWindow: true });
	await elements.get("#project").listeners.get("click")();
	assert.equal(elements.get("#cwd").textContent, "/tmp/A", "another window does not switch this project");
	release(inventory("project", false));
	await opening;
	assert.match(elements.get("#skills-list").children[0].children[0].textContent, /project/);
	assert.equal(elements.get("#skills-list").children[0].children[1].textContent, "Enable");
	current(inventory("project", true));
	api.newChat = async () => result("C");
	await elements.get("#sidebar-new").listeners.get("click")();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(elements.get("#skills-list").children[0].children[1].textContent, "Disable");
	assert.equal(elements.get("#conversation").children[0].textContent, "Chat C");
	assert.equal(getCount(), 2, "another process did not refresh this window's skills");
});
