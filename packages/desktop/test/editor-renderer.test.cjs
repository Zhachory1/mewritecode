const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

class Element {
	constructor() { this.listeners = new Map(); this.children = []; this.attributes = new Map(); this.style = {}; this.value = ""; this.textContent = ""; this.hidden = false; }
	addEventListener(name, callback) { this.listeners.set(name, callback); }
	removeEventListener(name) { this.listeners.delete(name); }
	setAttribute(name, value) { this.attributes.set(name, String(value)); }
	removeAttribute(name) { this.attributes.delete(name); }
	replaceChildren(...children) { this.children = children; }
	append(...children) { this.children.push(...children); }
	get childElementCount() { return this.children.length; }
	attachShadow() { if (this.shadowRoot) throw new Error("Shadow root already attached"); return (this.shadowRoot = {}); }
	focus() {}
	showModal() { this.open = true; }
	close() { this.open = false; }
}

function deferred() {
	let resolve;
	const promise = new Promise((yes) => { resolve = yes; });
	return { promise, resolve };
}

function harness() {
	const elements = new Map();
	const document = {
		querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); },
		createElement: () => new Element(),
	};
	const views = [];
	const syncs = [];
	const agents = [{ desktopAgentId: "A", projectLabel: "alpha", status: "Ready" }, { desktopAgentId: "B", projectLabel: "beta", status: "Ready" }];
	const result = (id) => ({ desktopAgentId: id, cwd: `/project/${id}`, agents, state: { rpcCapabilities: {} }, messages: [], commands: [], models: [] });
	let pick = async () => result("A");
	let open = async () => ({ token: "token-1", relativePath: "src/index.js", content: "initial" });
	let save = async () => ({ token: "token-2" });
	let synchronize = async () => true;
	let onEvent;
	const api = {
		pickProject: () => pick(),
		openProjectFile: () => open(),
		saveProjectFile: (token, content) => save(token, content),
		setEditorDirty: (token, dirty) => { syncs.push([token, dirty]); return synchronize(token, dirty); },
		setComposerDirty: () => true,
		listSessions: async () => [],
		onEvent(callback) { onEvent = callback; },
	};
	const window = { innerWidth: 1200, mewrite: api, mewriteMarkdown: { renderMarkdown: async () => {} }, mewriteEditor: { create(host, content, filename, onChange) {
		host.attachShadow();
		const view = { content, filename, host, destroyed: false, getContent() { return this.content; }, focus() {}, destroy() { this.destroyed = true; }, edit(text) { this.content = text; onChange(text); } };
		views.push(view);
		return view;
	} } };
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window, document });
	const click = (id) => elements.get(id).listeners.get("click")();
	return { elements, views, syncs, api, click, result, onEvent: (event) => onEvent(event), setPick: (fn) => { pick = fn; }, setOpen: (fn) => { open = fn; }, setSave: (fn) => { save = fn; }, setSynchronize: (fn) => { synchronize = fn; } };
}

test("startup warns when an older runtime cannot safely resume project history", async () => {
	const h = harness();
	h.setPick(async () => ({ ...h.result("A"), startupWarning: "Update installed Me Write Code to resume saved chats safely. Started a new chat." }));
	await h.click("#project");
	assert.match(h.elements.get("#status").title, /Update installed Me Write Code/);
	assert.equal(h.elements.get("#status").className, "", "startup warnings remain visible");
});

test("Files tab opens a single editor and shows file name and clean status", async () => {
	const h = harness();
	await h.click("#project");
	await h.click("#file-open");
	assert.equal(h.views[0].filename, "src/index.js");
	assert.equal(h.elements.get("#panel-view-files").hidden, false);
	assert.equal(h.elements.get("#file-name").textContent, "src/index.js");
	assert.match(h.elements.get("#file-status").textContent, /saved|clean/i);
	await h.click("#file-open");
	assert.equal(h.views.length, 2);
	assert.equal(h.views[0].destroyed, true);
});

test("cancelled picker and new-window launch keep the current project and editor available", async () => {
	const h = harness();
	await h.click("#project");
	assert.equal(h.elements.get("#file-open").disabled, false);
	h.setPick(async () => null);
	await h.click("#project");
	assert.equal(h.elements.get("#file-open").disabled, false);
	h.setPick(async () => ({ openingNewWindow: true }));
	await h.click("#project");
	assert.equal(h.elements.get("#cwd").textContent, "/project/A");
	assert.equal(h.elements.get("#cwd").title, "/project/A", "truncated path stays reachable");
	assert.equal(h.elements.get("#file-open").disabled, false);
	assert.match(h.elements.get("#status").textContent, /Starting another window.*try.*Project again/i);
});

test("edit syncs dirty transitions before opening another file, then save uses new token", async () => {
	const h = harness();
	await h.click("#project");
	await h.click("#file-open");
	const syncing = deferred();
	h.setSynchronize(() => syncing.promise);
	h.views[0].edit("draft");
	h.views[0].edit("initial");
	assert.equal(h.elements.get("#file-save").disabled, true);
	h.views[0].edit("draft");
	let opened = false;
	h.setOpen(async () => { opened = true; return null; });
	const pending = h.click("#file-open");
	await Promise.resolve();
	assert.equal(opened, false);
	assert.equal(h.elements.get("#file-open").disabled, true);
	assert.equal(h.elements.get("#file-save").disabled, true);
	syncing.resolve(true);
	await pending;
	assert.equal(opened, true);
	assert.deepEqual(h.syncs, [["token-1", true], ["token-1", false], ["token-1", true]]);
	h.setSynchronize(async () => true);
	let saved;
	h.setSave(async (...args) => { saved = args; return { token: "token-2" }; });
	await h.click("#file-save");
	assert.deepEqual(saved, ["token-1", "draft"]);
	assert.equal(h.elements.get("#file-save").disabled, true);
	assert.match(h.elements.get("#file-status").textContent, /saved/i);
	h.views[0].edit("next draft");
	await h.click("#file-save");
	assert.deepEqual(saved, ["token-2", "next draft"]);
});

test("save conflict retains unsaved text and offers retry guidance", async () => {
	const h = harness();
	await h.click("#project");
	await h.click("#file-open");
	h.views[0].edit("my draft");
	h.setSave(async () => { throw new Error("File changed on disk"); });
	await h.click("#file-save");
	assert.equal(h.views[0].getContent(), "my draft");
	assert.equal(h.elements.get("#file-save").disabled, false);
	assert.match(h.elements.get("#file-status").textContent, /file changed on disk/i);
	assert.match(h.elements.get("#file-status").textContent, /copy it before reopening/i);
});

test("edit while save is pending stays dirty on new token", async () => {
	const h = harness();
	await h.click("#project");
	await h.click("#file-open");
	h.views[0].edit("snapshot");
	const saving = deferred();
	const started = deferred();
	h.setSave(() => { started.resolve(); return saving.promise; });
	const pending = h.click("#file-save");
	await started.promise;
	h.views[0].edit("newer");
	saving.resolve({ token: "token-2" });
	await pending;
	assert.equal(h.views[0].getContent(), "newer");
	assert.equal(h.elements.get("#file-save").disabled, false);
	assert.deepEqual(h.syncs.at(-1), ["token-2", true]);
});

test("cancelled project selection and new-window launch retain the editor draft", async () => {
	const h = harness();
	await h.click("#project");
	await h.click("#file-open");
	h.views[0].edit("draft");
	h.setPick(async () => null);
	await h.click("#project");
	assert.deepEqual(h.syncs[0], ["token-1", true]);
	assert.equal(h.views[0].getContent(), "draft");
	assert.equal(h.elements.get("#file-save").disabled, false);
	h.setPick(async () => ({ openingNewWindow: true }));
	await h.click("#project");
	assert.equal(h.views[0].destroyed, false);
	assert.equal(h.views[0].getContent(), "draft");
	assert.equal(h.elements.get("#file-save").disabled, false);
});

test("renderer reload reports an unrecoverable composer draft", async () => {
	const h = harness();
	await h.click("#project");
	await h.onEvent({ type: "desktop_agent_hydrated", result: { ...h.result("A"), composerDraftLost: true } });
	const warning = h.elements.get("#composer-warning");
	assert.match(warning.textContent, /Unsent message draft was lost/);
	assert.equal(warning.hidden, false, "warning persists beside the composer");
	h.elements.get("#prompt").value = "new draft";
	h.elements.get("#prompt").listeners.get("input")();
	assert.equal(warning.hidden, true, "typing a replacement dismisses the old warning");
});

test("renderer restart reports unrecoverable edits and clears the stale editor", async () => {
	const h = harness();
	await h.click("#project");
	await h.click("#file-open");
	h.views[0].edit("unwritten draft");
	await h.onEvent({ type: "desktop_file_draft_lost", desktopAgentId: "A" });
	assert.equal(h.views[0].destroyed, true);
	assert.equal(h.elements.get("#file-save").disabled, true);
	assert.equal(h.elements.get("#panel-view-files").hidden, false);
	assert.equal(h.elements.get("#context-panel").hidden, false);
	assert.match(h.elements.get("#file-status").textContent, /Unsaved file edits could not be recovered/);
	assert.match(h.elements.get("#file-status").textContent, /If Save was in progress, inspect the file on disk/);
});

test("same-project activation preserves editor; stale open response cannot replace newer context", async () => {
	const h = harness();
	await h.click("#project");
	await h.click("#file-open");
	h.views[0].edit("draft");
	h.setPick(async () => h.result("A"));
	await h.click("#project");
	assert.equal(h.views[0].destroyed, false);
	const opening = deferred();
	h.setOpen(() => opening.promise);
	const pending = h.click("#file-open");
	const newContext = h.result("B");
	await h.onEvent({ type: "desktop_agent_hydrated", result: newContext });
	opening.resolve({ token: "stale", relativePath: "wrong.js", content: "wrong" });
	await pending;
	assert.notEqual(h.elements.get("#file-name").textContent, "wrong.js");
});
