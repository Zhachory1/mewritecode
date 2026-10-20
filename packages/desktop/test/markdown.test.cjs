const assert = require("node:assert/strict");
const { test } = require("node:test");
const { marked } = require("marked");
const { renderMarkdown } = require("../markdown.js");

class Node {
	constructor(tagName = "#text") {
		this.tagName = tagName.toUpperCase();
		this.children = [];
		this._textContent = "";
		this.listeners = new Map();
		this.attributes = new Map();
	}
	append(...children) { this.children.push(...children); }
	replaceChildren(...children) { this.children = children; this._textContent = ""; }
	get textContent() { return this._textContent + this.children.map((child) => child.textContent).join(""); }
	set textContent(value) { this._textContent = value; this.children = []; }
	addEventListener(name, callback) { this.listeners.set(name, callback); }
	setAttribute(name, value) { this.attributes.set(name, value); }
	set innerHTML(_value) { throw new Error("unsafe HTML insertion"); }
}
const document = { createElement: (tag) => new Node(tag), createTextNode: (text) => Object.assign(new Node(), { textContent: text }) };
function tree(node) { return { tag: node.tagName, text: node.textContent, children: node.children.map(tree) }; }
function find(node, tag) { return node.tagName === tag ? node : node.children.map((child) => find(child, tag)).find(Boolean); }
function findAll(node, tag) { return [...(node.tagName === tag ? [node] : []), ...node.children.flatMap((child) => findAll(child, tag))]; }

test("renders safe Markdown DOM consistently as an incomplete fence becomes complete", async () => {
	const root = new Node("div");
	const opened = [];
	const render = (text) => renderMarkdown(root, text, { document, marked, openExternal: async (url) => opened.push(url) });
	await render("# Heading\n\n3. one **bold**\n4. two [site][docs]\n\n[docs]: https://example.com\n\n```js\nconst x");
	assert.ok(find(root, "H1"));
	assert.equal(find(root, "OL").attributes.get("start"), "3");
	assert.equal(find(root, "CODE").textContent, "const x");
	const link = find(root, "A");
	assert.equal(link.attributes.get("href"), undefined);
	assert.ok(JSON.stringify(tree(link)).includes("https://example.com/"));
	assert.doesNotMatch(JSON.stringify(tree(root)), /\[docs\]:/);
	assert.equal(opened.length, 0);
	await link.listeners.get("click")({ preventDefault() {} });
	assert.deepEqual(opened, ["https://example.com/"]);
	const partial = tree(root);
	await render("# Heading\n\n3. one **bold**\n4. two [site][docs]\n\n[docs]: https://example.com\n\n```js\nconst x\n```");
	assert.equal(find(root, "CODE").textContent, "const x");
	assert.equal(partial.children[0].tag, tree(root).children[0].tag);
});

test("renders GFM tables with inline Markdown, alignment, and escaped pipes", async () => {
	const root = new Node("div");
	const partial = "| Name | Value |\n| :--- |";
	await renderMarkdown(root, partial, { document, marked });
	assert.equal(find(root, "TABLE"), undefined);
	await renderMarkdown(root, '| Name | Value |\n| :--- | ---: |\n| A **bold** | x\\|y |\n| <img src=x onerror=alert(1)> | safe |', { document, marked });
	const table = find(root, "TABLE");
	assert.ok(table);
	assert.equal(findAll(table, "TH").length, 2);
	assert.equal(findAll(table, "TD").length, 4);
	assert.equal(find(table, "STRONG").textContent, "bold");
	assert.match(table.textContent, /x\|y/);
	assert.equal(find(table, "IMG"), undefined);
	assert.equal(findAll(table, "TH")[0].className, "md-align-left");
	assert.equal(findAll(table, "TH")[1].className, "md-align-right");
});

test("renders hostile HTML and unsafe links as inert text and bounds large output", async () => {
	const root = new Node("div");
	await renderMarkdown(root, '<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n\n[x](javascript:alert(1)) [f](file:///etc/passwd) ![pic](https://example.com/x.png)', { document, marked });
	assert.equal(find(root, "IMG"), undefined);
	assert.equal(find(root, "SCRIPT"), undefined);
	assert.equal(find(root, "A"), undefined);
	const text = JSON.stringify(tree(root));
	assert.match(text, /img src=x/);
	assert.match(text, /javascript:alert/);
	assert.match(text, /\[image: pic\]/);
	await renderMarkdown(root, "0. zero", { document, marked });
	assert.equal(find(root, "OL").attributes.get("start"), "0");
	const nested = `${"> ".repeat(33)}deep`;
	await renderMarkdown(root, nested, { document, marked });
	assert.equal(root.textContent, nested);
	await renderMarkdown(root, "x".repeat(256 * 1024 + 1), { document, marked });
	assert.equal(root.textContent.length, 256 * 1024 + 1);
	const longUrl = `https://example.com/${"a".repeat(1900)}`;
	const amplified = `${Array.from({ length: 300 }, () => "[x][u]").join(" ")}\n\n[u]: ${longUrl}`;
	await renderMarkdown(root, amplified, { document, marked, openExternal() {} });
	assert.equal(root.textContent, amplified);
});
