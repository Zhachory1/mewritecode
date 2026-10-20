const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

class Element {
	constructor() { this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.style = {}; this.textContent = ""; this.value = ""; this.hidden = false; this.checked = false; }
	addEventListener(name, callback) { this.listeners.set(name, callback); }
	removeEventListener(name) { this.listeners.delete(name); }
	setAttribute(name, value) { this.attributes.set(name, String(value)); }
	removeAttribute(name) { this.attributes.delete(name); }
	replaceChildren(...children) { this.children = children; }
	append(...children) { this.children.push(...children); }
	get childElementCount() { return this.children.length; }
	getBoundingClientRect() { return { width: 320 }; }
	focus() {}
}

test("restores and persists System, Light, and Dark appearance choices", () => {
	const elements = new Map();
	const root = new Element();
	const document = {
		documentElement: root,
		querySelector(selector) {
			if (!elements.has(selector)) elements.set(selector, new Element());
			const element = elements.get(selector);
			if (selector.startsWith("#theme-")) element.value = selector.slice(7);
			return element;
		},
		createElement: () => new Element(),
	};
	const stored = new Map([["mewrite.desktop.theme", "dark"]]);
	const localStorage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
	const window = { innerWidth: 1200, localStorage, mewrite: { onEvent() {} }, mewriteMarkdown: {}, addEventListener() {}, removeEventListener() {} };
	vm.runInNewContext(readFileSync(join(__dirname, "../theme.js"), "utf8"), { localStorage, document });
	assert.equal(root.attributes.get("data-theme"), "dark");
	vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window, document, setTimeout, clearTimeout });
	assert.equal(root.attributes.get("data-theme"), "dark");
	assert.equal(elements.get("#theme-dark").checked, true);
	const light = elements.get("#theme-light");
	light.checked = true;
	light.listeners.get("change")();
	assert.equal(root.attributes.get("data-theme"), "light");
	assert.equal(stored.get("mewrite.desktop.theme"), "light");
	const system = elements.get("#theme-system");
	system.checked = true;
	system.listeners.get("change")();
	assert.equal(root.attributes.has("data-theme"), false);
	assert.equal(stored.get("mewrite.desktop.theme"), "system");
});

test("dark appearance uses the mewrite stone palette in explicit and system modes", () => {
	const css = readFileSync(join(__dirname, "../style.css"), "utf8");
	const palette = "--accent:#FF6B35;--ink:#E6E1D8;--theme-bg:#18181A;--theme-surface:#242428";
	assert.ok(css.includes(`:root[data-theme=dark]{${palette}`));
	assert.ok(css.includes(`:root:not([data-theme=light]){${palette}`));
	assert.match(css, /--accent:#A9461F;--ink:#252326;--theme-bg:#F7F0E2;--theme-surface:#FBF7EF/);
});

test("storage failures retain a usable system default and do not block explicit selection", () => {
	const elements = new Map();
	const root = new Element();
	const document = {
		documentElement: root,
		querySelector(selector) {
			if (!elements.has(selector)) elements.set(selector, new Element());
			const element = elements.get(selector);
			if (selector.startsWith("#theme-")) element.value = selector.slice(7);
			return element;
		},
		createElement: () => new Element(),
	};
	const localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
	assert.doesNotThrow(() => vm.runInNewContext(readFileSync(join(__dirname, "../theme.js"), "utf8"), { localStorage, document }));
	const window = { innerWidth: 1200, localStorage, mewrite: { onEvent() {} }, mewriteMarkdown: {}, addEventListener() {}, removeEventListener() {} };
	assert.doesNotThrow(() => vm.runInNewContext(readFileSync(join(__dirname, "../renderer.js"), "utf8"), { window, document, setTimeout, clearTimeout }));
	assert.equal(elements.get("#theme-system").checked, true);
	const dark = elements.get("#theme-dark");
	dark.checked = true;
	dark.listeners.get("change")();
	assert.equal(root.attributes.get("data-theme"), "dark");
});
