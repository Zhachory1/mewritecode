const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

class Element {
	constructor(tagName = "div") {
		this.tagName = tagName.toUpperCase();
		this.children = [];
		this.listeners = new Map();
		this.attributes = new Map();
		this.textContent = "";
		this.value = "";
		this.hidden = false;
		this.open = false;
	}
	addEventListener(name, callback) { this.listeners.set(name, callback); }
	removeEventListener(name) { this.listeners.delete(name); }
	setAttribute(name, value) { this.attributes.set(name, value); }
	removeAttribute(name) { this.attributes.delete(name); }
	replaceChildren(...children) { this.children = children; this.textContent = ""; for (const child of children) child.parent = this; }
	append(...children) { this.children.push(...children); for (const child of children) child.parent = this; }
	remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
	get childElementCount() { return this.children.length; }
	focus() {}
}

function harness() {
	const elements = new Map();
	const trackedById = new Map(); // tracks elements registered by id via .id= setter

	function makeElement(tagName) {
		const el = new Element(tagName);
		// Intercept .id = "foo" so querySelector("#foo") can find/lose it
		let _id = "";
		Object.defineProperty(el, "id", {
			get() { return _id; },
			set(value) {
				if (_id) trackedById.delete(`#${_id}`);
				_id = value;
				if (value) trackedById.set(`#${value}`, el);
			},
		});
		return el;
	}

	// IDs that the renderer only queries dynamically (never at init time) and that represent
	// DOM elements whose presence is conditional — querySelector must return null when absent.
	// Any id assigned via el.id = "..." lands in trackedById; the selector below ensures
	// these ids are never auto-created in elements, so querySelector returns null when not tracked.
	const conditionalIds = new Set(["#welcome"]);

	const document = {
		querySelector(selector) {
			// Return an id-tracked element if present (registered via el.id= setter)
			if (trackedById.has(selector)) return trackedById.get(selector);
			// Conditional ids: only present when explicitly inserted (tracked by id setter)
			if (conditionalIds.has(selector)) return null;
			// All other selectors: auto-create stable stubs (real DOM is always non-null for these)
			if (!elements.has(selector)) elements.set(selector, makeElement("div"));
			return elements.get(selector);
		},
		createElement: (tag) => makeElement(tag),
	};

	let onEvent;
	let rejectCommands = false;
	const api = {
		pickProject: async () => ({
			cwd: "/tmp/project",
			state: { rpcCapabilities: {} }, models: [], commands: [],
			messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "Saved reasoning" }, { type: "text", text: "Final" }] }],
		}),
		listSessions: async () => [],
		setComposerDirty: () => {},
		command: async () => { if (rejectCommands) throw new Error("offline"); return {}; },
		onEvent: (callback) => { onEvent = callback; },
	};
	const window = { innerWidth: 1200, mewrite: api, mewriteMarkdown: { renderMarkdown(node, text) { node.textContent = text; } }, addEventListener() {}, removeEventListener() {} };
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window, document, setTimeout, clearTimeout });

	// Patch conversation.replaceChildren (after vm init so the element exists) to un-register child ids from trackedById
	const conversation = elements.get("#conversation");
	const _origConvReplace = conversation.replaceChildren.bind(conversation);
	conversation.replaceChildren = (...children) => {
		for (const child of conversation.children) {
			if (child.id) trackedById.delete(`#${child.id}`);
		}
		_origConvReplace(...children);
	};

	return { elements, onEvent, rejectCommands: () => { rejectCommands = true; } };
}

test("shows loading immediately and renders only real streamed or persisted thinking", async () => {
	const { elements, onEvent, rejectCommands } = harness();
	await elements.get("#project").listeners.get("click")();
	const conversation = elements.get("#conversation");
	assert.equal(conversation.children[0].tagName, "DETAILS");
	assert.equal(conversation.children[0].open, true, "persisted available thinking starts expanded");
	assert.equal(conversation.children[0].children[1].textContent, "Saved reasoning");
	assert.equal(conversation.children[1].textContent, "Final");
	const prompt = elements.get("#prompt");
	prompt.value = "hello";
	await elements.get("#composer").listeners.get("submit")({ preventDefault() {} });
	// History must survive submit: conversation had thinking+answer, no #welcome, so replaceChildren must NOT have fired
	assert.ok(conversation.children.length >= 3, "history nodes must persist after submit (thinking + answer + loading)");
	assert.equal(conversation.children[0].tagName, "DETAILS", "saved thinking must still be first child after submit");
	assert.equal(conversation.children[0].children[1].textContent, "Saved reasoning", "saved thinking text must be intact after submit");
	const loading = conversation.children.at(-1);
	assert.equal(loading.tagName, "DETAILS");
	assert.equal(loading.children[0].textContent, "Thinking…");
	assert.equal(loading.children[1].textContent, "");
	assert.equal(loading.attributes.get("aria-busy"), "true");
	assert.equal(loading.children[1].attributes.get("aria-live"), "off");
	await onEvent({ type: "message_update", message: { role: "assistant", content: [{ type: "thinking", thinking: "Checking" }] }, assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } });
	await onEvent({ type: "message_update", message: { role: "assistant", content: [{ type: "thinking", thinking: "Checking files" }] }, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Checking files" } });
	assert.equal(loading.hidden, false);
	assert.equal(loading.open, true, "live thinking remains expanded by default");
	assert.equal(loading.children[0].textContent, "Thinking");
	assert.equal(loading.children[1].textContent, "Checking files");
	await onEvent({ type: "message_update", message: { role: "assistant", content: [{ type: "thinking", thinking: "Checked" }] }, assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "Checked" } });
	assert.equal(loading.open, true, "thinking_end does not collapse available content");
	assert.equal(loading.children[1].textContent, "Checking files");
	loading.open = false;
	await onEvent({ type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: " more" } });
	assert.equal(loading.open, false, "manual collapse is respected during streaming");
	await onEvent({ type: "message_update", message: { role: "assistant", content: [{ type: "thinking", thinking: "Checked" }, { type: "text", text: "" }] }, assistantMessageEvent: { type: "text_start", contentIndex: 1 } });
	await onEvent({ type: "message_update", message: { role: "assistant", content: [{ type: "thinking", thinking: "Checked" }, { type: "text", text: "Done" }] }, assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "Done" } });
	await onEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "thinking", thinking: "Checked" }, { type: "text", text: "Done" }] } });
	assert.equal(loading.children[1].textContent, "Checked");
	assert.equal(loading.attributes.has("aria-busy"), false);
	assert.equal(conversation.children.filter((child) => child.tagName === "DETAILS").length, 2, "history and streamed thinking nodes must both be in transcript");
	assert.equal(conversation.children.at(-1).textContent, "Done");
	await onEvent({ type: "desktop_idle", extensionOnly: true });
	prompt.value = "again";
	await elements.get("#composer").listeners.get("submit")({ preventDefault() {} });
	const noThinking = conversation.children.at(-1);
	await onEvent({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "Answer" }] }, assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
	assert.equal(conversation.children.includes(noThinking), false);
	await onEvent({ type: "desktop_idle", extensionOnly: true });
	prompt.value = "tool turn";
	await elements.get("#composer").listeners.get("submit")({ preventDefault() {} });
	const toolLoading = conversation.children.at(-1);
	await onEvent({ type: "message_update", message: { role: "assistant", content: [{ type: "toolCall" }] }, assistantMessageEvent: { type: "toolcall_start", contentIndex: 0 } });
	assert.equal(conversation.children.includes(toolLoading), true, "activity remains while tool execution has not started");
	await onEvent({ type: "tool_execution_start", toolCallId: "call", toolName: "bash", args: {} });
	assert.equal(conversation.children.includes(toolLoading), false);
	assert.equal(conversation.children.at(-1).className, "tool-activity");
	await onEvent({ type: "tool_execution_end", toolCallId: "call", toolName: "bash", isError: false });
	await onEvent({ type: "turn_start" });
	assert.equal(conversation.children.at(-1).children[0].textContent, "Thinking…");
	await onEvent({ type: "desktop_idle", extensionOnly: true });
	rejectCommands();
	prompt.value = "offline";
	await elements.get("#composer").listeners.get("submit")({ preventDefault() {} });
	assert.equal(conversation.children.some((child) => child.className?.includes("thinking-loading")), false);
});

test("thinkingContent does not throw and returns empty string for string message.content", async () => {
	// Regression: assistant messages with string content (legacy shape) must not crash thinkingContent()
	const { elements, onEvent } = harness();
	await elements.get("#project").listeners.get("click")();
	const conversation = elements.get("#conversation");
	const initialDetailsCount = conversation.children.filter((child) => child.tagName === "DETAILS").length;

	// Simulate a live message_end with string content (legacy assistant message shape)
	await onEvent({ type: "message_end", message: { role: "assistant", content: "Plain answer" } });
	// Must not throw; the answer text must be rendered
	assert.ok(conversation.children.some((child) => child.textContent === "Plain answer"), "string-content answer must render without crashing");
	// And there must be no spurious thinking node added (only history DETAILS remain)
	assert.equal(conversation.children.filter((child) => child.tagName === "DETAILS").length, initialDetailsCount, "no thinking node must appear for string-content message");
});

test("redacted empty message keeps activity until the run actually ends", async () => {
	const { elements, onEvent } = harness();
	await elements.get("#project").listeners.get("click")();
	await onEvent({ type: "agent_start" });
	const conversation = elements.get("#conversation");
	const activity = conversation.children.at(-1);
	await onEvent({ type: "message_update", message: { role: "assistant", content: [{ type: "thinking", redacted: true, thinking: "[Reasoning redacted]" }] }, assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "[Reasoning redacted]" } });
	await onEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "thinking", redacted: true, thinking: "[Reasoning redacted]" }] } });
	assert.equal(conversation.children.includes(activity), true);
	await onEvent({ type: "agent_end", messages: [] });
	assert.equal(conversation.children.includes(activity), false);
});

test("redacted thinking_end does not leave placeholder text in transcript", async () => {
	// Regression: a thinking_end event with redacted:true must not copy its content ("[Reasoning redacted]") into the body
	const { elements, onEvent } = harness();
	await elements.get("#project").listeners.get("click")();
	const conversation = elements.get("#conversation");
	const historyDetailsCount = conversation.children.filter((child) => child.tagName === "DETAILS").length;
	const prompt = elements.get("#prompt");
	prompt.value = "hello";
	await elements.get("#composer").listeners.get("submit")({ preventDefault() {} });
	const loading = conversation.children.at(-1);

	// Simulate a redacted thinking block arriving
	await onEvent({ type: "message_update", message: { role: "assistant", content: [{ type: "thinking", redacted: true, thinking: "" }] }, assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } });
	await onEvent({ type: "message_update", message: { role: "assistant", content: [{ type: "thinking", redacted: true, thinking: "[Reasoning redacted]" }] }, assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "[Reasoning redacted]" } });
	// The thinking body must remain empty (redacted placeholder must not leak in)
	assert.equal(loading.children[1].textContent, "", "redacted thinking content must not appear in transcript body");
	assert.equal(conversation.children.includes(loading), true, "honest activity stays visible while the agent runs");
	assert.match(loading.className, /thinking-unavailable/);
	assert.equal(loading.open, true);
	await onEvent({ type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "toolcall_start" } });
	assert.equal(conversation.children.includes(loading), true, "the box stays until tool activity is visible");
	await onEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "thinking", redacted: true, thinking: "[Reasoning redacted]" }, { type: "toolCall", name: "bash", id: "tool", arguments: {} }] } });
	assert.equal(conversation.children.includes(loading), true, "message_end precedes tool execution and must not hide activity");
	await onEvent({ type: "tool_execution_start", toolCallId: "tool", toolName: "bash", args: {} });
	assert.equal(conversation.children.includes(loading), false, "tool status takes over without leaving an empty box");
	assert.equal(conversation.children.some((child) => child.className === "tool-activity"), true);
	await onEvent({ type: "tool_execution_end", toolCallId: "tool", toolName: "bash", isError: false });
	// Completed redacted reasoning must not remain as a fabricated transcript entry.
	await onEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "thinking", redacted: true, thinking: "" }, { type: "text", text: "Answer" }] } });
	assert.equal(conversation.children.filter((child) => child.tagName === "DETAILS").length, historyDetailsCount, "redacted thinking node must be removed; only pre-existing history DETAILS must remain");
});
