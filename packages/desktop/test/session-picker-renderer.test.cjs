const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

class Element {
	constructor() {
		this.listeners = new Map();
		this.children = [];
		this.value = "";
		this.textContent = "";
		this.open = false;
	}
	addEventListener(name, callback) { this.listeners.set(name, callback); }
	replaceChildren(...children) { this.children = children; }
	append(...children) { this.children.push(...children); }
	get childElementCount() { return this.children.length; }
	showModal() { this.open = true; }
	close() { this.open = false; }
	setAttribute(name, value) { this[name] = value; }
	focus() {}
}

test("conversation picker shows recency, preserves chat on cancel, and loads selected session", async () => {
	const elements = new Map();
	const document = {
		querySelector(selector) {
			if (!elements.has(selector)) elements.set(selector, new Element());
			return elements.get(selector);
		},
		createElement: () => new Element(),
	};
	let capable = true;
	let cancelled = true;
	let active = "latest";
	let listCalls = 0;
	let savedSessions = [
		{ token: "latest", name: "Latest", modified: "2026-10-07T12:00:00Z" },
		{ token: "older", name: "Older task", modified: null },
	];
	let onAgentEvent;
	const switched = [];
	const api = {
		pickProject: async () => ({ desktopAgentId: "A", cwd: "/tmp/project", state: { rpcCapabilities: { projectSessions: capable } }, messages: [], commands: [], models: [] }),
		listSessions: async () => {
			listCalls++;
			return savedSessions.map((session) => ({ ...session, active: active === session.token }));
		},
		switchSession: async (token) => {
			switched.push(token);
			if (!cancelled) active = token;
			return cancelled ? { cancelled: true } : {
				cancelled: false,
				desktopAgentId: "B", cwd: "/tmp/project",
				state: { rpcCapabilities: { projectSessions: true }, model: { provider: "test", id: "model" } },
				messages: [{ role: "user", content: "earlier" }], commands: [], models: [],
			};
		},
		onEvent: (callback) => { onAgentEvent = callback; },
	};
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window: { mewrite: api }, document });
	await elements.get("#project").listeners.get("click")();
	const button = elements.get("#sessions");
	assert.equal(button.disabled, false);
	assert.equal(elements.get("#recent-list").children.length, 2);
	assert.equal(elements.get("#recent-list").children[0].disabled, true);
	const listNow = api.listSessions;
	let finishOldList;
	api.listSessions = () => new Promise((resolve) => { finishOldList = resolve; });
	const staleRequest = button.listeners.get("click")();
	elements.get("#sessions-close").listeners.get("click")();
	api.listSessions = listNow;
	await button.listeners.get("click")();
	finishOldList([{ token: "stale", name: "Stale", modified: null }]);
	await staleRequest;
	assert.equal(elements.get("#recent-list").children[0].textContent, "Latest · Current");
	const dialog = elements.get("#sessions-dialog");
	const entries = elements.get("#sessions-list").children;
	assert.equal(dialog.open, true);
	assert.equal(entries.length, 2);
	assert.equal(entries[0].disabled, true);
	assert.match(entries[1].textContent, /Older task/);
	assert.match(entries[1].textContent, /Unknown date/);
	await entries[1].listeners.get("click")();
	assert.equal(dialog.open, true);
	assert.match(elements.get("#sessions-error").textContent, /cancelled/);
	cancelled = false;
	await entries[1].listeners.get("click")();
	assert.deepEqual(switched, ["older", "older"]);
	assert.equal(dialog.open, false);
	assert.equal(elements.get("#conversation").children[0].textContent, "earlier");
	assert.equal(elements.get("#recent-list").children[1].disabled, true);
	const callsBeforeNew = listCalls;
	let newChats = 0;
	api.newChat = async () => ({ desktopAgentId: `fresh-${++newChats}`, cwd: "/tmp/project", state: { rpcCapabilities: { projectSessions: true } }, messages: [], commands: [], models: [] });
	api.command = async (type) => {
		if (type === "new_session") return { cancelled: false };
		if (type === "get_messages") return { messages: [] };
		if (type === "get_state") return { model: undefined };
	};
	await elements.get("#sidebar-new").listeners.get("click")();
	assert.ok(listCalls > callsBeforeNew);
	api.listSessions = async () => { throw new Error("list failed"); };
	await elements.get("#sidebar-new").listeners.get("click")();
	assert.equal(elements.get("#recent-list").children.length, 0);
	assert.match(elements.get("#recent-status").textContent, /list failed/);
	api.listSessions = listNow;
	savedSessions = Array.from({ length: 10 }, (_, index) => ({ token: `chat-${index}`, name: `Chat ${index}`, modified: null }));
	active = "chat-9";
	await onAgentEvent({ type: "desktop_idle", extensionOnly: true });
	assert.equal(elements.get("#recent-list").children.length, 8);
	assert.equal(elements.get("#recent-list").children[7].textContent, "Chat 9 · Current");
	assert.equal(elements.get("#recent-list").children[7].disabled, true);
	savedSessions = [
		{ token: "latest", name: "Latest", modified: "2026-10-07T12:00:00Z" },
		{ token: "older", name: "Older task", modified: null },
	];
	active = "older";
	await onAgentEvent({ type: "desktop_idle", extensionOnly: true });
	let finishRefresh;
	api.command = async (type) => {
		if (type === "get_state") return { model: undefined };
		assert.equal(type, "get_messages");
		return new Promise((resolve) => { finishRefresh = resolve; });
	};
	const staleRefresh = onAgentEvent({ type: "desktop_idle" });
	await button.listeners.get("click")();
	let finishSwitch;
	api.switchSession = async (token) => {
		switched.push(token);
		return new Promise((resolve) => { finishSwitch = resolve; });
	};
	const another = elements.get("#sessions-list").children[1];
	const pending = another.listeners.get("click")();
	await another.listeners.get("click")();
	assert.deepEqual(switched, ["older", "older", "older"]);
	assert.equal(elements.get("#project").disabled, true);
	finishSwitch({ cancelled: false, reloadRequired: true, error: "Choose project again." });
	await pending;
	assert.equal(elements.get("#send").disabled, true);
	assert.match(elements.get("#status").textContent, /Choose project again/);
	finishRefresh({ messages: [{ role: "user", content: "stale" }] });
	await staleRefresh;
	assert.equal(elements.get("#conversation").children[0].id, "welcome");
	capable = false;
	await elements.get("#project").listeners.get("click")();
	assert.equal(button.disabled, true);
});

test("Escape from All chats restores Recent when it invalidated a loading request", async () => {
	const elements = new Map();
	const document = { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); }, createElement: () => new Element() };
	const saved = [{ token: "a", name: "Chat A", active: true }, { token: "b", name: "Chat B", active: false }];
	let onEvent;
	const api = {
		pickProject: async () => ({ desktopAgentId: "A", cwd: "/project", state: { rpcCapabilities: { projectSessions: true } }, messages: [], commands: [], models: [] }),
		listSessions: async () => saved,
		onEvent: (callback) => { onEvent = callback; },
	};
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window: { mewrite: api }, document });
	await elements.get("#project").listeners.get("click")();
	let finishSidebar, finishPicker;
	api.listSessions = () => new Promise((resolve) => { finishSidebar = resolve; });
	const loading = onEvent({ type: "desktop_idle", extensionOnly: true });
	api.listSessions = () => new Promise((resolve) => { finishPicker = resolve; });
	const picker = elements.get("#sessions").listeners.get("click")();
	api.listSessions = async () => saved;
	const dialog = elements.get("#sessions-dialog");
	dialog.listeners.get("cancel")({});
	dialog.close();
	finishSidebar(saved);
	finishPicker(saved);
	await Promise.all([loading, picker]);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(elements.get("#recent-list").children.length, 2);
	assert.notEqual(elements.get("#recent-status").textContent, "Loading conversations…");
});

test("closing a slow All chats request refreshes stale Recent selection tokens", async () => {
	const elements = new Map();
	const document = { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); }, createElement: () => new Element() };
	let listVersion = 0;
	let selected;
	let finishPicker;
	const sessions = () => {
		const version = ++listVersion;
		return [{ token: `a-${version}`, name: "Chat A", active: true }, { token: `b-${version}`, name: "Chat B", active: false }];
	};
	const api = {
		pickProject: async () => ({ desktopAgentId: "A", cwd: "/project", state: { rpcCapabilities: { projectSessions: true } }, messages: [], commands: [], models: [] }),
		listSessions: async () => sessions(),
		switchSession: async (token) => { selected = token; return { cancelled: true }; },
		onEvent() {},
	};
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window: { mewrite: api }, document });
	await elements.get("#project").listeners.get("click")();
	assert.equal(elements.get("#recent-list").children[1].textContent, "Chat B");
	api.listSessions = () => new Promise((resolve) => { finishPicker = resolve; });
	const pending = elements.get("#sessions").listeners.get("click")();
	elements.get("#sessions-close").listeners.get("click")();
	api.listSessions = async () => sessions();
	finishPicker(sessions());
	await pending;
	await new Promise((resolve) => setImmediate(resolve));
	await elements.get("#recent-list").children[1].listeners.get("click")();
	assert.equal(selected, `b-${listVersion}`, "Recent uses the latest token after a dismissed picker");
});

test("a timed-out chat switch keeps Recent available and lets the user retry", async () => {
	const elements = new Map();
	const document = { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); }, createElement: () => new Element() };
	const saved = [{ token: "a", name: "Chat A", active: true }, { token: "b", name: "Chat B", active: false }];
	let fail = true;
	let onEvent;
	const api = {
		pickProject: async () => ({ desktopAgentId: "A", cwd: "/project", state: { rpcCapabilities: { projectSessions: true } }, messages: [], commands: [], models: [] }),
		listSessions: async () => saved,
		switchSession: async () => { if (fail) throw new Error("Agent command timed out: list_project_sessions"); return { desktopAgentId: "B", cwd: "/project", state: { rpcCapabilities: { projectSessions: true } }, messages: [{ role: "user", content: "B" }], commands: [], models: [], cancelled: false }; },
		onEvent: (callback) => { onEvent = callback; },
	};
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window: { mewrite: api }, document });
	await elements.get("#project").listeners.get("click")();
	const recent = elements.get("#recent-list");
	await recent.children[1].listeners.get("click")();
	assert.equal(recent.children.length, 2, "a timeout must not erase the last usable chat list");
	assert.match(elements.get("#recent-status").textContent, /Try another chat again/);
	assert.equal(recent.children[1].disabled, false, "switch lock was released");
	fail = false;
	await recent.children[1].listeners.get("click")();
	assert.equal(elements.get("#conversation").children[0].textContent, "B");
	api.listSessions = async () => { throw new Error("Agent command timed out: list_project_sessions"); };
	await onEvent({ type: "desktop_idle", extensionOnly: true });
	assert.match(elements.get("#recent-status").textContent, /Open All chats to retry/);
	assert.equal(recent.children.length, 2, "a timeout does not discard previously usable chats");
	assert.equal(elements.get("#sessions").disabled, false);
});
