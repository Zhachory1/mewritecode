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
	removeEventListener(name) { this.listeners.delete(name); }
	replaceChildren(...children) { this.children = children; }
	append(...children) { this.children.push(...children); }
	get childElementCount() { return this.children.length; }
	showModal() { this.open = true; }
	close() { this.open = false; }
	setAttribute() {}
	removeAttribute() {}
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
	const replies = [];
	let onEvent;
	const api = {
		approvalReply: async (desktopAgentId, token, decision) => { replies.push({ desktopAgentId, token, decision }); },
		reply: async (response) => { replies.push(response); },
		onEvent: (callback) => { onEvent = callback; },
	};
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), {
		window: { mewrite: api, mewriteMarkdown: { renderMarkdown: async () => {} } },
		document,
		setTimeout,
		clearTimeout,
	});
	return { elements, onEvent, replies };
}

test("approval dialog renders canonical arguments verbatim and returns one scoped decision", async () => {
	const { elements, onEvent, replies } = harness();
	const argumentsJson = `{"command":"printf \\u202e","tail":"space "}\n${"x".repeat(8192 - 52)}`;
	await onEvent({ type: "desktop_approval_request", desktopAgentId: "agent-A", projectLabel: "Project A", projectPath: "/worktrees/project-a", token: "opaque", toolName: "bash", tier: "exec", argumentsJson });
	assert.equal(elements.get("#extension-dialog").open, true);
	assert.equal(elements.get("#dialog-title").textContent, "Approval required · /worktrees/project-a");
	assert.equal(elements.get("#dialog-message").textContent, "Tool: bash · Risk: exec");
	assert.equal(elements.get("#dialog-content").children[0].textContent, argumentsJson);
	const buttons = elements.get("#dialog-buttons").children;
	assert.deepEqual(buttons.map((button) => button.textContent), ["Deny", "Approve once"]);
	buttons[1].listeners.get("click")();
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(replies, [{ desktopAgentId: "agent-A", token: "opaque", decision: "once" }]);
	assert.equal(elements.get("#extension-dialog").open, false);
});

test("extension requests cannot impersonate trusted approval chrome", async () => {
	const { elements, onEvent } = harness();
	await onEvent({ type: "extension_ui_request", method: "confirm", id: "extension", title: "Approval required", message: "Tool: bash · Risk: exec" });
	assert.equal(elements.get("#dialog-title").textContent, "Extension request");
	assert.match(elements.get("#dialog-message").textContent, /Approval required/);
	assert.deepEqual(elements.get("#dialog-buttons").children.map((button) => button.textContent), ["Decline", "Confirm", "Cancel"]);
});

test("approval dialogs queue, close by token, and cancel to deny", async () => {
	const { elements, onEvent, replies } = harness();
	await onEvent({ type: "desktop_approval_request", desktopAgentId: "agent-A", projectLabel: "Project A", token: "first", toolName: "write", tier: "write", argumentsJson: "{}" });
	await onEvent({ type: "desktop_approval_request", desktopAgentId: "agent-A", projectLabel: "Project A", token: "second", toolName: "bash", tier: "exec", argumentsJson: '{"command":"true"}' });
	await onEvent({ type: "desktop_approval_closed", desktopAgentId: "agent-A", token: "first" });
	assert.equal(elements.get("#dialog-message").textContent, "Tool: bash · Risk: exec");
	const cancel = elements.get("#extension-dialog").listeners.get("cancel");
	cancel({ preventDefault() {} });
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(replies, [{ desktopAgentId: "agent-A", token: "second", decision: "deny" }]);
});
