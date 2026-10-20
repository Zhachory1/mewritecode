const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

class Element {
	constructor() { this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.style = {}; this.textContent = ""; this.value = ""; this.hidden = false; }
	addEventListener(name, callback) { this.listeners.set(name, callback); }
	removeEventListener(name) { this.listeners.delete(name); }
	setAttribute(name, value) { this.attributes.set(name, String(value)); }
	removeAttribute(name) { this.attributes.delete(name); }
	replaceChildren(...children) { this.children = children; for (const child of children) child.parent = this; }
	append(...children) { this.children.push(...children); for (const child of children) child.parent = this; }
	remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
	get childElementCount() { return this.children.length; }
	getBoundingClientRect() { return { width: 320 }; }
	focus() {}
	showModal() { this.open = true; }
	close() { this.open = false; }
}

function setup() {
	const elements = new Map();
	const document = { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); }, createElement: () => new Element() };
	let onEvent;
	let active = "A";
	let aBusy = false, bBusy = false;
	let bMessages = [{ role: "user", content: "History B" }];
	const sent = [];
	const approvals = [];
	const hydration = (id) => ({ desktopAgentId: id, cwd: "/project", state: { rpcCapabilities: { projectSessions: true } }, messages: id === "A" ? [{ role: "user", content: "History A" }] : bMessages, commands: [], models: [], busy: id === "A" ? aBusy : bBusy });
	const api = {
		pickProject: async () => hydration("A"),
		listSessions: async () => [{ token: "a", name: "Chat A", active: active === "A", busy: aBusy, desktopAgentId: "A" }, { token: "b", name: "Chat B", active: active === "B", busy: bBusy, desktopAgentId: "B" }],
		switchSession: async (token) => { active = token === "a" ? "A" : "B"; return { ...hydration(active), cancelled: false }; },
		newChat: async () => { active = "B"; return hydration("B"); },
		command: async (type, data, id) => { sent.push({ type, data, id }); return {}; },
		approvalReply: async (...args) => { approvals.push(args); },
		setComposerDirty: () => true,
		onEvent: (callback) => { onEvent = callback; },
	};
	const window = { innerWidth: 1200, mewrite: api, mewriteMarkdown: { renderMarkdown: async (node, text) => { node.textContent = text; } }, addEventListener() {}, removeEventListener() {} };
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window, document, setTimeout, clearTimeout });
	return { elements, api, sent, approvals, onEvent: (event) => onEvent(event), setBusy: (id, busy) => { if (id === "A") aBusy = busy; else bBusy = busy; }, setBMessages: (messages) => { bMessages = messages; } };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("click Chat B while A runs; both can work and A remains reachable with its draft", async () => {
	const { elements, sent, onEvent, setBusy, setBMessages } = setup();
	await elements.get("#project").listeners.get("click")();
	setBusy("A", true);
	await onEvent({ type: "agent_start", desktopAgentId: "A" });
	await onEvent({ type: "desktop_agents", agents: [{ desktopAgentId: "A", busy: true, status: "Working" }, { desktopAgentId: "B", busy: false, status: "Ready" }] });
	await tick();
	const prompt = elements.get("#prompt");
	prompt.value = "Draft A";
	prompt.listeners.get("input")();
	const recent = elements.get("#recent-list");
	await recent.children[1].listeners.get("click")();
	assert.equal(elements.get("#conversation").children[0].textContent, "History B");
	assert.equal(recent.children[0].className, "recent-conversation chat-running");
	assert.match(recent.children[0].textContent, /Chat A · Running/);
	assert.equal(elements.get("#send").disabled, false);
	prompt.value = "B work";
	await elements.get("#composer").listeners.get("submit")({ preventDefault() {} });
	assert.equal(sent.at(-1).id, "B", "B's prompt cannot be routed to A");
	setBusy("B", true);
	await onEvent({ type: "agent_start", desktopAgentId: "B" });
	await onEvent({ type: "desktop_agents", agents: [{ desktopAgentId: "A", busy: true, status: "Working" }, { desktopAgentId: "B", busy: true, status: "Working" }] });
	assert.equal(recent.children[1].className, "recent-conversation chat-running");
	await recent.children[0].listeners.get("click")();
	assert.equal(prompt.value, "Draft A");
	assert.equal(elements.get("#conversation").children[0].textContent, "History A");
	setBusy("B", false);
	setBMessages([{ role: "user", content: "History B" }, { role: "assistant", content: "B finished" }]);
	await onEvent({ type: "desktop_agents", agents: [{ desktopAgentId: "A", busy: true, status: "Working" }, { desktopAgentId: "B", busy: false, status: "Ready" }] });
	assert.equal(recent.children[1].className, "recent-conversation", "B's running border settles promptly");
	await recent.children[1].listeners.get("click")();
	assert.equal(elements.get("#conversation").children.at(-1).textContent, "B finished");
});

test("busy transition never labels disabled background chats Current", async () => {
	const { elements, api, onEvent } = setup();
	await elements.get("#project").listeners.get("click")();
	await tick();
	const recent = elements.get("#recent-list");
	let release;
	api.command = async () => new Promise((resolve) => { release = resolve; });
	elements.get("#prompt").value = "A work";
	const submitting = elements.get("#composer").listeners.get("submit")({ preventDefault() {} });
	assert.equal(recent.children[1].disabled, true);
	await onEvent({ type: "desktop_agents", agents: [{ desktopAgentId: "A", busy: true }, { desktopAgentId: "B", busy: false }] });
	assert.doesNotMatch(recent.children[1].textContent, /Current/);
	release({});
	await submitting;
});

test("background approvals name the chat before routing a decision", async () => {
	const { elements, approvals, onEvent, setBusy } = setup();
	await elements.get("#project").listeners.get("click")();
	setBusy("A", true);
	await tick();
	await elements.get("#recent-list").children[1].listeners.get("click")();
	await onEvent({ type: "desktop_approval_request", desktopAgentId: "A", token: "a-token", toolName: "bash", tier: "exec", argumentsJson: "{}", projectPath: "/project", chatLabel: "Chat A · a1b2c3d4", background: true });
	assert.match(elements.get("#dialog-title").textContent, /Chat A · a1b2c3d4 · Background chat/);
	const buttons = elements.get("#dialog-buttons").children;
	await buttons[1].listeners.get("click")();
	assert.deepEqual(approvals[0], ["A", "a-token", "once"]);
});

test("reopening an exited chat transfers its unsent draft to the new agent", async () => {
	const { elements, api } = setup();
	await elements.get("#project").listeners.get("click")();
	await tick();
	const recent = elements.get("#recent-list");
	await recent.children[1].listeners.get("click")();
	const prompt = elements.get("#prompt");
	prompt.value = "Unsent B";
	prompt.listeners.get("input")();
	await recent.children[0].listeners.get("click")();
	const originalSwitch = api.switchSession;
	api.switchSession = async (token) => {
		const result = await originalSwitch(token);
		return token === "b" ? { ...result, desktopAgentId: "C", replacesDesktopAgentId: "B" } : result;
	};
	await recent.children[1].listeners.get("click")();
	assert.equal(prompt.value, "Unsent B");
});

test("automatic fallback from a dead chat preserves its draft until reopened", async () => {
	const { elements, api, onEvent } = setup();
	await elements.get("#project").listeners.get("click")();
	await tick();
	const recent = elements.get("#recent-list");
	await recent.children[1].listeners.get("click")();
	const prompt = elements.get("#prompt");
	prompt.value = "Draft B";
	prompt.listeners.get("input")();
	const fallback = await api.switchSession("a");
	await onEvent({ type: "desktop_agent_hydrated", result: fallback });
	assert.equal(elements.get("#conversation").children[0].textContent, "History A");
	const originalSwitch = api.switchSession;
	api.switchSession = async (token) => token === "b" ? { ...await originalSwitch(token), desktopAgentId: "C", replacesDesktopAgentId: "B" } : originalSwitch(token);
	await recent.children[1].listeners.get("click")();
	assert.equal(prompt.value, "Draft B");
});

test("returning to a running chat does not restore a stale tool banner", async () => {
	const { elements, onEvent, setBusy } = setup();
	await elements.get("#project").listeners.get("click")();
	setBusy("A", true);
	await onEvent({ type: "agent_start", desktopAgentId: "A" });
	await onEvent({ type: "tool_execution_start", desktopAgentId: "A", toolCallId: "tool", toolName: "bash" });
	assert.equal(elements.get("#conversation").children.some((node) => node.className === "tool-activity"), true);
	await tick();
	const recent = elements.get("#recent-list");
	await recent.children[1].listeners.get("click")();
	await recent.children[0].listeners.get("click")();
	assert.equal(elements.get("#conversation").children.some((node) => node.className === "tool-activity"), false);
	await onEvent({ type: "tool_execution_end", desktopAgentId: "A", toolCallId: "tool", toolName: "bash", isError: false });
	assert.equal(elements.get("#conversation").children.some((node) => node.className === "tool-activity"), false);
});

test("rapid clicks cannot activate a stale chat while New chat is opening", async () => {
	const { elements, api, onEvent, setBusy } = setup();
	await elements.get("#project").listeners.get("click")();
	await tick();
	setBusy("A", true);
	await onEvent({ type: "agent_start", desktopAgentId: "A" });
	let finish;
	api.newChat = () => new Promise((resolve) => { finish = () => api.switchSession("b").then(resolve); });
	const pending = elements.get("#sidebar-new").listeners.get("click")();
	const recent = elements.get("#recent-list");
	assert.equal(recent.children[1].disabled, true);
	await recent.children[1].listeners.get("click")();
	assert.equal(elements.get("#cwd").textContent, "/project");
	await finish();
	await pending;
	await tick();
	assert.equal(recent.children[1].disabled, true, "the newly active chat cannot be selected again");
});

test("New chat while idle retains the old chat's unsent draft", async () => {
	const { elements, onEvent } = setup();
	await elements.get("#project").listeners.get("click")();
	const prompt = elements.get("#prompt");
	prompt.value = "Unsent A";
	prompt.listeners.get("input")();
	await elements.get("#sidebar-new").listeners.get("click")();
	assert.equal(prompt.value, "", "fresh B must not inherit A's composer draft");
	await onEvent({ type: "desktop_agents", agents: [{ desktopAgentId: "A", busy: false }, { desktopAgentId: "B", busy: false }] });
	await new Promise((resolve) => setImmediate(resolve));
	await elements.get("#recent-list").children[0].listeners.get("click")();
	assert.equal(prompt.value, "Unsent A");
});

test("New chat stays enabled while another chat runs", async () => {
	const { elements, onEvent, setBusy } = setup();
	await elements.get("#project").listeners.get("click")();
	setBusy("A", true);
	await onEvent({ type: "agent_start", desktopAgentId: "A" });
	assert.equal(elements.get("#sidebar-new").disabled, false);
	await elements.get("#sidebar-new").listeners.get("click")();
	assert.equal(elements.get("#conversation").children[0].textContent, "History B");
});
