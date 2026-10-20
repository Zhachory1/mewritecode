const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

class Element {
	constructor() {
		this.listeners = new Map();
		this.children = [];
		this.attributes = new Map();
		this.style = {};
		this.value = "";
		this.textContent = "";
		this.hidden = false;
		this.open = false;
	}
	addEventListener(name, callback) { this.listeners.set(name, callback); }
	removeEventListener(name) { this.listeners.delete(name); }
	setAttribute(name, value) { this.attributes.set(name, String(value)); }
	removeAttribute(name) { this.attributes.delete(name); }
	replaceChildren(...children) { this.children = children; for (const child of children) child.parent = this; }
	append(...children) { this.children.push(...children); for (const child of children) child.parent = this; }
	remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
	get childElementCount() { return this.children.length; }
	getBoundingClientRect() { return { width: 320 }; }
	showModal() { this.open = true; }
	close() { this.open = false; }
	focus() {}
}

function harness() {
	const elements = new Map();
	const document = {
		querySelector(selector) {
			if (!elements.has(selector)) elements.set(selector, new Element());
			return elements.get(selector);
		},
		createElement: () => new Element(),
	};
	let onEvent;
	const commands = [];
	const api = {
		pickProject: async () => ({
			cwd: "/tmp/project",
			state: { sessionId: "session-1", model: { provider: "test", id: "model" }, rpcCapabilities: {} },
			messages: [{ role: "assistant", content: [{ type: "toolCall", id: "saved-1", name: "read", arguments: { path: "docs/history.md", content: "saved secret" } }] }], commands: [], models: [],
		}),
		listSessions: async () => [],
		command: async (type) => { commands.push(type); return {}; },
		onEvent: (callback) => { onEvent = callback; },
	};
	const window = {
		innerWidth: 1200,
		mewrite: api,
		mewriteMarkdown: { renderMarkdown: async () => {} },
		addEventListener() {},
		removeEventListener() {},
	};
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window, document, setTimeout, clearTimeout });
	return { api, commands, elements, onEvent, window };
}

function text(list) {
	return list.children.flatMap((row) => row.children.map((child) => child.textContent)).join("\n");
}

test("details panel derives bounded progress, tools, and references from RPC metadata", async () => {
	const { commands, elements, onEvent, window } = harness();
	const recent = elements.get("#recent-sidebar");
	const recentToggle = elements.get("#recent-toggle");
	assert.equal(recent.hidden, false);
	recentToggle.listeners.get("click")();
	assert.equal(recent.hidden, true);
	recentToggle.listeners.get("click")();
	assert.equal(recent.hidden, false);
	window.innerWidth = 700;
	window.onresize();
	assert.equal(recent.hidden, true, "recent sidebar starts closed when it floats above content");
	recentToggle.listeners.get("click")();
	assert.equal(recent.hidden, false, "recent sidebar remains available on narrow windows");
	assert.equal(recentToggle.attributes.get("aria-expanded"), "true");
	window.innerWidth = 1200;
	window.onresize();
	assert.equal(recent.hidden, false);
	await elements.get("#project").listeners.get("click")();
	assert.match(text(elements.get("#panel-context-list")), /\/tmp\/project/);
	assert.match(text(elements.get("#panel-context-list")), /RPC conversation/);
	assert.match(text(elements.get("#panel-docs-list")), /docs\/history\.md/);
	assert.match(text(elements.get("#panel-docs-list")), /Saved read tool arguments/);
	await onEvent({ type: "agent_start" });
	await onEvent({ type: "turn_start" });
	await onEvent({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "docs/runbook.md", content: "secret payload" } });
	await onEvent({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "read", result: { content: "secret result" }, isError: false });
	await onEvent({ type: "turn_end", message: { stopReason: "stop" }, toolResults: [] });
	await onEvent({ type: "tool_execution_start", toolCallId: "tool-2", toolName: "bash", args: { command: "secret command" } });
	await onEvent({ type: "tool_execution_end", toolCallId: "tool-2", toolName: "bash", result: { content: "secret result" }, isError: true });
	await onEvent({ type: "turn_end", message: { stopReason: "aborted" }, toolResults: [] });
	await onEvent({ type: "tool_execution_start", toolCallId: "tool-3", toolName: "find", args: { path: "src" } });
	await onEvent({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }] });
	assert.match(text(elements.get("#panel-progress-list")), /Run started/);
	assert.match(text(elements.get("#panel-progress-list")), /Turn completed/);
	assert.match(text(elements.get("#panel-progress-list")), /Turn stopped/);
	assert.match(text(elements.get("#panel-progress-list")), /Run failed/);
	assert.match(text(elements.get("#panel-tools-list")), /read · Done/);
	assert.match(text(elements.get("#panel-tools-list")), /bash · Failed/);
	assert.match(text(elements.get("#panel-tools-list")), /find · Failed/);
	assert.match(text(elements.get("#panel-context-list")), /docs\/runbook\.md/);
	assert.match(text(elements.get("#panel-docs-list")), /docs\/runbook\.md/);
	for (const id of ["#panel-progress-list", "#panel-tools-list", "#panel-context-list", "#panel-docs-list"]) {
		assert.doesNotMatch(text(elements.get(id)), /secret|%/);
	}
	for (let index = 0; index <= 100; index++) {
		await onEvent({ type: "tool_execution_start", toolCallId: `overflow-${index}`, toolName: "custom", args: {} });
	}
	assert.equal(elements.get("#panel-tools-list").children.length, 100);
	await onEvent({ type: "tool_execution_end", toolCallId: "overflow-0", toolName: "custom", result: {}, isError: false });
	assert.equal(elements.get("#panel-tools-list").children.length, 100);
	assert.match(text(elements.get("#panel-tools-list")), /custom · Done/);
	elements.get("#panel-tab-docs").listeners.get("click")();
	assert.equal(elements.get("#panel-view-docs").hidden, false);
	assert.equal(elements.get("#panel-view-progress").hidden, true);
	elements.get("#panel-resizer").listeners.get("keydown")({ key: "End", preventDefault() {} });
	assert.equal(elements.get("#context-panel").style.width, "420px");
	assert.equal(elements.get("#panel-resizer").attributes.get("aria-valuenow"), "420");
	elements.get("#panel-close").listeners.get("click")();
	assert.equal(elements.get("#context-panel").hidden, true);
	elements.get("#panel-toggle").listeners.get("click")();
	assert.equal(elements.get("#context-panel").hidden, false);
	await elements.get("#stop").listeners.get("click")();
	assert.deepEqual(commands, ["abort"]);
	assert.match(text(elements.get("#panel-progress-list")), /Stop requested/);
});

test("chat reports overlapping tool activity without exposing Bash or MCP payloads", async () => {
	const { elements, onEvent } = harness();
	await elements.get("#project").listeners.get("click")();
	const chat = elements.get("#conversation");
	const status = () => chat.children.find((child) => child.className === "tool-activity");
	await onEvent({ type: "agent_start" });
	await onEvent({ type: "tool_execution_start", toolCallId: "bash", toolName: "bash", args: { command: "secret command" } });
	assert.match(status().textContent, /tool.*running/i);
	assert.doesNotMatch(status().textContent, /secret|command/);
	await onEvent({ type: "tool_execution_start", toolCallId: "mcp", toolName: "mcp__private__lookup", args: { token: "secret payload" } });
	assert.match(status().textContent, /2 tools running/i);
	assert.doesNotMatch(status().textContent, /private|lookup|secret/);
	await onEvent({ type: "tool_execution_end", toolCallId: "bash", toolName: "bash", isError: false });
	assert.match(status().textContent, /MCP tool running/i, "remaining call keeps its safe category");
	await onEvent({ type: "tool_execution_end", toolCallId: "mcp", toolName: "mcp__private__lookup", isError: true });
	assert.match(status().textContent, /tool failed/i);
	await onEvent({ type: "turn_end", message: { stopReason: "error" } });
	assert.equal(status(), undefined);
	await onEvent({ type: "tool_execution_start", toolCallId: "failed", toolName: "bash" });
	await onEvent({ type: "turn_end", message: { stopReason: "error" } });
	assert.match(text(elements.get("#panel-tools-list")), /bash · Failed/);
	assert.equal(status(), undefined);
	await onEvent({ type: "tool_execution_start", toolCallId: "unknown", toolName: "bash" });
	await onEvent({ type: "desktop_idle", extensionOnly: true });
	assert.match(text(elements.get("#panel-tools-list")), /bash · Status unknown/);
	assert.equal(status(), undefined);
	await onEvent({ type: "tool_execution_start", toolCallId: "stuck", toolName: "bash" });
	assert.ok(status());
	await onEvent({ type: "rpc_error", error: "disconnected" });
	assert.equal(status(), undefined);
});

test("completed tools announce completion before their visual status clears", async () => {
	const { elements, onEvent } = harness();
	await elements.get("#project").listeners.get("click")();
	const chat = elements.get("#conversation");
	await onEvent({ type: "tool_execution_start", toolCallId: "mcp", toolName: "mcp_tool_call" });
	assert.match(chat.children.at(-1).textContent, /MCP tool running/);
	assert.equal(chat.children.at(-1).attributes.get("aria-hidden"), "true");
	await onEvent({ type: "tool_execution_end", toolCallId: "mcp", toolName: "mcp_tool_call", isError: false });
	assert.match(chat.children.at(-1).textContent, /Tool finished/);
	assert.equal(elements.get("#tool-activity-status").textContent, "Tool finished");
	await onEvent({ type: "turn_end", message: { stopReason: "stop" } });
	assert.equal(chat.children.some((child) => child.className === "tool-activity"), false);
});

test("narrow Recent overlay returns focus after cancelled chat switch and New chat", async () => {
	const { api, elements, window } = harness();
	api.pickProject = async () => ({ cwd: "/tmp/project", state: { rpcCapabilities: { projectSessions: true } }, messages: [], commands: [], models: [] });
	api.listSessions = async () => [{ token: "other", name: "Other", active: false }];
	api.switchSession = async () => ({ cancelled: true });
	window.innerWidth = 700;
	window.onresize();
	await elements.get("#project").listeners.get("click")();
	const toggle = elements.get("#recent-toggle");
	const recent = elements.get("#recent-sidebar");
	let focusCount = 0;
	toggle.focus = () => { focusCount++; };
	toggle.listeners.get("click")();
	await elements.get("#recent-list").children[0].listeners.get("click")();
	assert.equal(recent.hidden, true);
	assert.equal(focusCount, 1);
	toggle.listeners.get("click")();
	api.command = async (type) => type === "get_messages" ? { messages: [] } : { model: undefined };
	await elements.get("#sidebar-new").listeners.get("click")();
	assert.equal(recent.hidden, true);
	assert.equal(focusCount, 2);
});
