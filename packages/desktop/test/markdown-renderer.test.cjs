const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

class Element {
	constructor() { this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.textContent = ""; this.value = ""; }
	addEventListener(name, callback) { this.listeners.set(name, callback); }
	replaceChildren(...children) { this.children = children; }
	append(...children) { this.children.push(...children); }
	get childElementCount() { return this.children.length; }
	setAttribute(name, value) { this.attributes.set(name, value); }
	removeAttribute(name) { this.attributes.delete(name); }
	focus() {}
}

test("history and streaming assistant messages use the same Markdown renderer", async () => {
	const elements = new Map();
	const document = {
		querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); },
		createElement: () => new Element(),
	};
	let onEvent;
	const calls = [];
	const api = {
		pickProject: async () => ({ cwd: "/tmp/project", state: { rpcCapabilities: {} }, models: [], commands: [], messages: [
			{ role: "user", content: "**plain user**" }, { role: "assistant", content: [{ type: "text", text: "# Saved" }] },
		] }),
		onEvent: (callback) => { onEvent = callback; },
	};
	const markdown = { renderMarkdown(node, text) { calls.push(text); node.textContent = text ? `rendered:${text}` : ""; } };
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window: { mewrite: api, mewriteMarkdown: markdown }, document });
	await elements.get("#project").listeners.get("click")();
	assert.deepEqual(calls, ["# Saved"]);
	assert.equal(elements.get("#conversation").children[0].textContent, "**plain user**");
	assert.equal(elements.get("#conversation").children[1].textContent, "rendered:# Saved");
	const beforeToolOnly = elements.get("#conversation").children.length;
	await onEvent({ type: "message_start", message: { role: "assistant", content: [] } });
	await onEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", name: "read" }] } });
	assert.equal(elements.get("#conversation").children.length, beforeToolOnly);
	await onEvent({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "```js\nconst x" }] }, assistantMessageEvent: { type: "text_delta", delta: "```js\nconst x" } });
	assert.deepEqual(calls, ["# Saved"]);
	assert.equal(elements.get("#conversation").children[2].textContent, "```js\nconst x");
	assert.equal(elements.get("#conversation").children[2].attributes.get("aria-live"), "off");
	assert.equal(elements.get("#conversation").children[2].attributes.get("aria-busy"), "true");
	await onEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "```js\nconst x\n```" }] } });
	assert.deepEqual(calls, ["# Saved", "```js\nconst x\n```"]);
	assert.equal(elements.get("#conversation").children[2].attributes.has("aria-live"), false);
	assert.equal(elements.get("#conversation").children[2].attributes.has("aria-busy"), false);
	await onEvent({ type: "tool_execution_end", toolName: "read", isError: false });
	await onEvent({ type: "message_start", message: { role: "assistant", content: [] } });
	await onEvent({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "second" }] }, assistantMessageEvent: { type: "text_delta", delta: "second" } });
	await onEvent({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "second" }, { type: "text", text: "" }] }, assistantMessageEvent: { type: "text_start" } });
	await onEvent({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "second" }, { type: "text", text: "block" }] }, assistantMessageEvent: { type: "text_delta", delta: "block" } });
	await onEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "second" }, { type: "text", text: "block" }] } });
	assert.equal(elements.get("#conversation").children.length, 4);
	assert.equal(calls.at(-1), "second\nblock");
});

test("an older delayed chat load cannot scroll a newer chat", async () => {
	const elements = new Map();
	const document = { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); }, createElement: () => new Element() };
	const conversation = document.querySelector("#conversation");
	conversation.scrollHeight = 300;
	conversation.clientHeight = 100;
	let onEvent, finishOld;
	const api = {
		pickProject: async () => ({ desktopAgentId: "A", cwd: "/project", state: { rpcCapabilities: {} }, messages: [], models: [], commands: [] }),
		listSessions: async () => [],
		onEvent: (callback) => { onEvent = callback; },
	};
	const markdown = { renderMarkdown(node) { return new Promise((resolve) => { finishOld = () => { node.textContent = "Old"; resolve(); }; }); } };
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window: { mewrite: api, mewriteMarkdown: markdown }, document });
	await elements.get("#project").listeners.get("click")();
	const b = onEvent({ type: "desktop_agent_hydrated", result: { desktopAgentId: "B", cwd: "/project", state: { model: { provider: "test", id: "B" }, rpcCapabilities: {} }, messages: [{ role: "assistant", content: [{ type: "text", text: "Old" }] }], models: [], commands: [] } });
	await new Promise((resolve) => setImmediate(resolve));
	await onEvent({ type: "desktop_agent_hydrated", result: { desktopAgentId: "C", cwd: "/project", state: { model: { provider: "test", id: "C" }, rpcCapabilities: {} }, messages: [{ role: "user", content: "New" }], models: [], commands: [] } });
	conversation.scrollTop = 20;
	finishOld();
	await b;
	assert.equal(conversation.scrollTop, 20);
	assert.equal(conversation.children[0].textContent, "New");
	assert.match(elements.get("#status").textContent, /test\/C/, "stale load cannot rewrite the visible chat status");
});

test("an older chat load waiting on refresh cannot overwrite a newer chat", async () => {
	const elements = new Map();
	const document = { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); }, createElement: () => new Element() };
	let onEvent, finishRefresh;
	const api = {
		pickProject: async () => ({ desktopAgentId: "A", cwd: "/project", state: { rpcCapabilities: {} }, messages: [], models: [], commands: [] }),
		listSessions: async () => [],
		command: (type, _data, owner) => type === "get_messages" && owner === "B" ? new Promise((resolve) => { finishRefresh = () => resolve({ messages: [] }); }) : Promise.resolve({ model: undefined }),
		onEvent: (callback) => { onEvent = callback; },
	};
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window: { mewrite: api, mewriteMarkdown: {} }, document });
	await elements.get("#project").listeners.get("click")();
	const b = onEvent({ type: "desktop_agent_hydrated", result: { desktopAgentId: "B", cwd: "/project", state: { model: { provider: "test", id: "B" }, rpcCapabilities: {} }, messages: [{ role: "user", content: "Old" }], models: [], commands: [] } });
	await onEvent({ type: "desktop_agents", agents: [{ desktopAgentId: "B" }, { desktopAgentId: "C" }] });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(typeof finishRefresh, "function");
	await onEvent({ type: "desktop_agent_hydrated", result: { desktopAgentId: "C", cwd: "/project", state: { model: { provider: "test", id: "C" }, rpcCapabilities: {} }, messages: [{ role: "user", content: "New" }], models: [], commands: [] } });
	elements.get("#prompt").value = "C draft";
	finishRefresh();
	await b;
	assert.equal(elements.get("#conversation").children[0].textContent, "New");
	assert.equal(elements.get("#prompt").value, "C draft");
	assert.match(elements.get("#status").textContent, /test\/C/);
});

test("opening a long saved chat lands at the latest message after Markdown settles", async () => {
	const elements = new Map();
	const document = { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); }, createElement: () => new Element() };
	const conversation = document.querySelector("#conversation");
	conversation.scrollHeight = 300;
	conversation.clientHeight = 100;
	let scrollTop = 0;
	Object.defineProperty(conversation, "scrollTop", { get: () => scrollTop, set: (value) => { scrollTop = Math.max(0, Math.min(value, conversation.scrollHeight - conversation.clientHeight)); } });
	let finishMarkdown;
	let delayMarkdown = true;
	let onEvent;
	const longChat = [{ role: "user", content: "Earlier message" }, { role: "assistant", content: [{ type: "text", text: "long history" }] }];
	const api = {
		pickProject: async () => ({ desktopAgentId: "A", cwd: "/project", state: { rpcCapabilities: { projectSessions: true } }, messages: [{ role: "user", content: "A" }], commands: [], models: [] }),
		listSessions: async () => [{ token: "a", name: "A", active: false }, { token: "b", name: "B", active: false }],
		switchSession: async () => ({ desktopAgentId: "B", cwd: "/project", state: { rpcCapabilities: { projectSessions: true } }, messages: longChat, commands: [], models: [], cancelled: false }),
		command: async (type) => type === "get_messages" ? { messages: longChat } : { model: undefined },
		onEvent: (callback) => { onEvent = callback; },
	};
	const markdown = { renderMarkdown(node, text) {
		if (!delayMarkdown) { node.textContent = text; conversation.scrollHeight = 1200; return Promise.resolve(); }
		return new Promise((resolve) => { finishMarkdown = () => { node.textContent = text; conversation.scrollHeight = 1000; resolve(); }; });
	} };
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window: { mewrite: api, mewriteMarkdown: markdown }, document });
	await elements.get("#project").listeners.get("click")();
	const opening = elements.get("#recent-list").children[1].listeners.get("click")();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(conversation.scrollTop, 200, "pre-Markdown scroll is not the final position");
	finishMarkdown();
	await opening;
	assert.equal(conversation.scrollTop, 900, "opening lands on the browser's clamped bottom position");
	conversation.scrollTop = 20;
	delayMarkdown = false;
	await onEvent({ type: "desktop_idle", extensionOnly: false });
	assert.equal(conversation.scrollTop, 20, "refresh does not move a reader who scrolled up");
});
