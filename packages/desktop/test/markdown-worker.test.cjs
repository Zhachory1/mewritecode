const assert = require("node:assert/strict");
const { test } = require("node:test");

class Node {
	constructor() { this.children = []; this.textContent = ""; }
	append(...children) { this.children.push(...children); }
	replaceChildren(...children) { this.children = children; }
	setAttribute() {}
	addEventListener() {}
}
const document = { createElement: () => new Node(), createTextNode: (text) => Object.assign(new Node(), { textContent: text }) };

test("worker timeout falls back to inert text instead of blocking forever", { timeout: 2000 }, async () => {
	const originalWorker = global.Worker;
	const originalLocation = global.location;
	class StalledWorker {
		postMessage() {}
		terminate() { this.terminated = true; }
	}
	global.Worker = StalledWorker;
	global.location = { href: "file:///app/index.html" };
	delete require.cache[require.resolve("../markdown.js")];
	try {
		const { renderMarkdown } = require("../markdown.js");
		const roots = [new Node(), new Node(), new Node()];
		const renders = roots.map((root, index) => renderMarkdown(root, `**safe fallback ${index}**`, { document }));
		await renders[2];
		assert.equal(roots[2].textContent, "**safe fallback 2**");
		await Promise.all(renders.slice(0, 2));
		assert.equal(roots[0].textContent, "**safe fallback 0**");
	} finally {
		delete require.cache[require.resolve("../markdown.js")];
		if (originalWorker === undefined) delete global.Worker; else global.Worker = originalWorker;
		if (originalLocation === undefined) delete global.location; else global.location = originalLocation;
	}
});
