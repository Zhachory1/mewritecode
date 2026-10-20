const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

class Element {
	constructor() {
		this.children = [];
		this.listeners = new Map();
		this.attributes = new Map();
		this.style = {};
		this.textContent = "";
		this.value = "";
		this.hidden = false;
	}
	addEventListener(name, callback) { this.listeners.set(name, callback); }
	removeEventListener(name) { this.listeners.delete(name); }
	setAttribute(name, value) { this.attributes.set(name, String(value)); }
	removeAttribute(name) { this.attributes.delete(name); }
	replaceChildren(...children) { this.children = children; }
	append(...children) { this.children.push(...children); }
	get childElementCount() { return this.children.length; }
	getBoundingClientRect() { return { width: 320 }; }
	focus() {}
	showModal() { this.open = true; }
	close() { this.open = false; }
}

test("switches between Chat and Settings without replacing the active session", async () => {
	const elements = new Map();
	const document = {
		querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); },
		createElement: () => new Element(),
	};
	let onEvent;
	let projectPicks = 0;
	const commands = [];
	const models = [{ provider: "test", id: "old", name: "Old" }, { provider: "test", id: "next", name: "Next" }];
	let mcp = { servers: [{ name: "local", owner: "project", editable: true, removable: true, transport: "stdio", status: "disconnected", hasArguments: false }, { name: "remote", owner: "claude", editable: false, removable: false, transport: "http", status: "restart-required", hasArguments: false }], revisions: { project: "project-token", user: "user-token" }, errors: [] };
	const api = {
		pickProject: async () => {
			projectPicks++;
			return { cwd: "/tmp/project", state: { model: models[0], defaultModel: models[0], approvalMode: true, rpcCapabilities: { approvalModeControl: true, defaultModelControl: true, mcpSettingsControl: true } }, messages: [{ role: "user", content: "Existing chat" }], commands: [], models, defaultModels: models, mcp };
		},
		listSessions: async () => [],
		setApprovalMode: async (enabled) => { commands.push({ type: "set_approval_mode", enabled }); return { enabled }; },
		setDefaultModel: async (provider, id) => { commands.push({ type: "set_default_model", provider, id }); return models.find((model) => model.id === id); },
		getMcpServers: async () => mcp,
		saveMcpServer: async (input) => { commands.push({ type: "save_mcp_server", input }); mcp = { ...mcp, servers: [{ name: input.name, owner: input.scope, editable: true, removable: true, transport: "stdio", status: "restart-required", hasArguments: input.args.length > 0 }] }; return { inventory: mcp }; },
		removeMcpServer: async (input) => { commands.push({ type: "remove_mcp_server", input }); mcp = { ...mcp, servers: [] }; return { inventory: mcp }; },
		onEvent: (callback) => { onEvent = callback; },
	};
	const window = { innerWidth: 1200, mewrite: api, mewriteMarkdown: { renderMarkdown: async () => {} }, addEventListener() {}, removeEventListener() {} };
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window, document, setTimeout, clearTimeout });
	let backFocused = false;
	elements.get("#settings-back").focus = () => { backFocused = true; };
	await onEvent({ type: "desktop_open_settings" });
	assert.equal(elements.get("#settings-view").hidden, false, "native menu opens Settings without a project");
	assert.equal(backFocused, true, "Settings focuses its back control");
	elements.get("#settings-back").listeners.get("click")();
	await elements.get("#project").listeners.get("click")();
	const conversation = elements.get("#conversation");
	assert.equal(conversation.children[0].textContent, "Existing chat");
	assert.match(elements.get("#status").textContent, /Ready · test\/old/);
	assert.equal(elements.get("#status").className, "sr-only", "routine Ready text is not visible");
	await onEvent({ type: "desktop_open_settings" });
	assert.equal(elements.get("#workspace").hidden, true);
	assert.equal(elements.get("#settings-view").hidden, false);
	assert.equal(elements.get("#panel-toggle").hidden, true);
	let scrolled = false;
	let focused = false;
	const skillsSection = document.querySelector("#settings-skills");
	skillsSection.scrollIntoView = () => { scrolled = true; };
	skillsSection.focus = () => { focused = true; };
	const toc = elements.get(".settings-toc");
	elements.get(".settings-sticky").offsetHeight = 120;
	let prevented = false;
	toc.listeners.get("click")({
		target: { closest: () => ({ getAttribute: () => "#settings-skills" }) },
		preventDefault: () => { prevented = true; },
	});
	assert.equal(scrolled, true, "TOC scrolls the existing Settings panel");
	assert.equal(skillsSection.style.scrollMarginTop, "136px", "sticky Back and TOC cannot cover the section");
	assert.equal(focused, true, "keyboard activation moves focus to the target section");
	assert.equal(prevented, true, "TOC does not navigate or reset the renderer");
	const approvalToggle = elements.get("#approval-mode-toggle");
	assert.equal(approvalToggle.checked, true);
	assert.match(elements.get("#approval-mode-note").textContent, /not a sandbox/);
	approvalToggle.checked = false;
	await approvalToggle.listeners.get("change")();
	assert.equal(commands.length, 1);
	assert.equal(commands[0].type, "set_approval_mode");
	assert.equal(commands[0].enabled, false);
	assert.equal(approvalToggle.checked, false);
	assert.match(elements.get("#approval-mode-note").textContent, /is off/);
	const defaultSelect = elements.get("#default-model-select");
	assert.equal(defaultSelect.value, "0");
	defaultSelect.value = "1";
	await defaultSelect.listeners.get("change")();
	assert.equal(commands[1].type, "set_default_model");
	assert.equal(commands[1].id, "next");
	assert.match(elements.get("#default-model-note").textContent, /current chat is unchanged/);
	const mcpList = elements.get("#mcp-list");
	assert.equal(mcpList.children.length, 2);
	assert.match(mcpList.children[0].children[0].textContent, /local · stdio · disconnected · project/);
	assert.equal(mcpList.children[1].children.length, 1, "non-canonical server must be read-only");
	mcpList.children[0].children[1].listeners.get("click")();
	elements.get("#mcp-name").value = "renamed";
	elements.get("#mcp-command").value = "node";
	elements.get("#mcp-args").value = "server.js";
	await elements.get("#mcp-save").listeners.get("click")();
	assert.deepEqual(JSON.parse(JSON.stringify(commands[2])), { type: "save_mcp_server", input: { scope: "project", revision: "project-token", previousName: "local", name: "renamed", transport: "stdio", command: "node", args: ["server.js"] } });
	await elements.get("#mcp-list").children[0].children[2].listeners.get("click")();
	assert.equal(commands[3].type, "remove_mcp_server");
	assert.equal(commands[3].input.name, "renamed");
	assert.match(elements.get("#mcp-note").textContent, /Server removed\. Start a new chat/);
	assert.equal(elements.get("#model-select").value, "0");
	await onEvent({ type: "agent_start" });
	assert.equal(elements.get("#status").textContent, "Working…");
	elements.get("#settings-back").listeners.get("click")();
	assert.equal(elements.get("#workspace").hidden, false);
	assert.equal(elements.get("#settings-view").hidden, true);
	assert.equal(elements.get("#panel-toggle").hidden, false);
	await onEvent({ type: "desktop_open_settings" });
	assert.equal(elements.get("#settings-view").hidden, false, "native menu reuses Settings navigation");
	assert.equal(elements.get("#panel-toggle").hidden, true);
	assert.equal(conversation.children[0].textContent, "Existing chat");
	assert.equal(projectPicks, 1);
	await onEvent({ type: "rpc_error", error: "disconnected" });
	assert.equal(elements.get("#status").className, "", "errors remain visible");
	assert.equal(approvalToggle.disabled, true);
	assert.equal(approvalToggle.checked, false);
	assert.match(elements.get("#approval-mode-note").textContent, /Choose a project/);
});

test("default-model selector is disabled while a turn is running and re-enabled when the turn ends", async () => {
	const elements = new Map();
	const document = {
		querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); },
		createElement: () => new Element(),
	};
	let onEvent;
	const models = [{ provider: "test", id: "alpha", name: "Alpha" }, { provider: "test", id: "beta", name: "Beta" }];
	const state = { model: models[0], defaultModel: models[0], approvalMode: false, rpcCapabilities: { approvalModeControl: true, defaultModelControl: true } };
	const api = {
		pickProject: async () => ({ cwd: "/tmp/project", state, messages: [], commands: [], models, defaultModels: models }),
		listSessions: async () => [],
		setApprovalMode: async (enabled) => ({ enabled }),
		setDefaultModel: async (provider, id) => models.find((m) => m.id === id),
		// command() is called by refresh() during desktop_idle — return minimal stubs
		command: async (type) => type === "get_messages" ? { messages: [] } : type === "get_state" ? state : {},
		onEvent: (callback) => { onEvent = callback; },
	};
	const window = { innerWidth: 1200, mewrite: api, mewriteMarkdown: { renderMarkdown: async () => {} }, addEventListener() {}, removeEventListener() {} };
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window, document, setTimeout, clearTimeout });
	await elements.get("#project").listeners.get("click")();
	const defaultSelect = elements.get("#default-model-select");
	// Connected and idle — selector should be enabled
	assert.equal(defaultSelect.disabled, false);
	// Simulate an agent turn starting
	await onEvent({ type: "agent_start" });
	assert.equal(defaultSelect.disabled, true, "selector must be disabled while a turn is running");
	// Simulate the turn ending via desktop_idle (which clears running in the renderer)
	await onEvent({ type: "desktop_idle" });
	assert.equal(defaultSelect.disabled, false, "selector must re-enable after turn ends");
});
