const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

class Element {
	constructor() {
		this.children = [];
		this.listeners = new Map();
		this.value = "";
		this.textContent = "";
	}
	addEventListener(name, callback) { this.listeners.set(name, callback); }
	replaceChildren(...children) { this.children = children; }
	append(...children) { this.children.push(...children); }
	get childElementCount() { return this.children.length; }
	setAttribute() {}
	removeAttribute() {}
	focus() {}
}

test("model picker follows the active chat, reverts failed switches, and disables older runtimes", async () => {
	const elements = new Map();
	const document = {
		querySelector(selector) {
			if (!elements.has(selector)) elements.set(selector, new Element());
			return elements.get(selector);
		},
		createElement: () => new Element(),
	};
	const old = { provider: "test", id: "old", name: "Old" };
	const next = { provider: "test", id: "next", name: "Next" };
	let current = old;
	let capable = true;
	let fail = false;
	let event;
	const calls = [];
	const api = {
		pickProject: async () => ({ cwd: "/tmp/project", state: { model: current, rpcCapabilities: { sessionModelSwitch: capable } }, messages: [], commands: [], models: [old, next] }),
		onEvent: (callback) => { event = callback; },
		command: async (type, data) => {
			if (type === "set_session_model") {
				calls.push(data);
				if (fail) throw new Error("No API key");
				current = next;
				return next;
			}
			if (type === "get_state") return { model: current };
			if (type === "get_messages") return { messages: [] };
			throw new Error(`Unexpected RPC: ${type}`);
		},
	};
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window: { mewrite: api, mewriteMarkdown: { renderMarkdown: (node, text) => { node.textContent = text; } } }, document });
	const pick = elements.get("#project").listeners.get("click");
	const select = elements.get("#model-select");
	await pick();
	assert.equal(select.value, "0");
	assert.equal(select.disabled, false);
	assert.match(select.children[0].textContent, /Old/);
	select.value = "1";
	await select.listeners.get("change")();
	assert.equal(select.value, "1");
	assert.equal(calls[0].provider, "test");
	assert.equal(calls[0].modelId, "next");
	current = old;
	await event({ type: "desktop_models", models: [old, next], model: old });
	assert.equal(select.value, "0");
	fail = true;
	select.value = "1";
	await select.listeners.get("change")();
	assert.equal(select.value, "0");
	assert.match(elements.get("#status").textContent, /No API key/);
	fail = false;
	await event({ type: "agent_start" });
	assert.equal(select.disabled, true);
	await event({ type: "desktop_idle" });
	assert.equal(select.value, "0");
	capable = false;
	await pick();
	assert.equal(select.disabled, true);
	assert.equal(select.value, "0");
});
