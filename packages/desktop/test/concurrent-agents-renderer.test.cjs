const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

class Element {
	constructor() { this.children = []; this.listeners = new Map(); this.value = ""; this.textContent = ""; this.hidden = false; }
	addEventListener(name, callback) { this.listeners.set(name, callback); }
	removeEventListener(name) { this.listeners.delete(name); }
	replaceChildren(...children) { this.children = children; }
	append(...children) { this.children.push(...children); }
	get childElementCount() { return this.children.length; }
	setAttribute(name, value) { this[name] = value; }
	removeAttribute() {}
	focus() {}
	showModal() { this.open = true; }
	close() { this.open = false; }
}

test("new project window leaves this window's draft, transcript and agent intact", async () => {
	const elements = new Map();
	const document = {
		querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); },
		createElement: () => new Element(),
	};
	let picks = 0;
	const dirty = [];
	let onEvent;
	const api = {
		pickProject: async () => ++picks === 1 ? { desktopAgentId: "A", cwd: "/project/A", state: { rpcCapabilities: {} }, messages: [{ role: "user", content: "Transcript A" }], commands: [], models: [] } : { openingNewWindow: true },
		listSessions: async () => [],
		setComposerDirty: (value) => dirty.push(value),
		command: async () => ({}),
		onEvent: (callback) => { onEvent = callback; },
	};
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window: { mewrite: api, mewriteMarkdown: { renderMarkdown: async (node, text) => { node.textContent = text; } } }, document });
	await elements.get("#project").listeners.get("click")();
	const prompt = elements.get("#prompt");
	prompt.value = "Unsent draft";
	prompt.listeners.get("input")();
	assert.equal(dirty.at(-1), true);
	await elements.get("#project").listeners.get("click")();
	assert.equal(picks, 2);
	assert.equal(elements.get("#project").disabled, false);
	assert.equal(elements.get("#cwd").textContent, "/project/A");
	assert.equal(prompt.value, "Unsent draft");
	assert.equal(elements.get("#conversation").children[0].textContent, "Transcript A");
	assert.match(elements.get("#status").textContent, /Starting another window.*try Project again/i);
	await onEvent({ type: "agent_start", desktopAgentId: "A" });
	assert.equal(elements.get("#status").textContent, "Working…");
	assert.equal(dirty.at(-1), true);
});
