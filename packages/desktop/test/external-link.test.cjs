const assert = require("node:assert/strict");
const Module = require("node:module");
const { test } = require("node:test");

test("main process opens only absolute HTTP(S) links", async () => {
	const handlers = new Map();
	const opened = [];
	let response = 1;
	let holdPrompt = false;
	let finishPrompt;
	const originalLoad = Module._load;
	Module._load = function (name, parent, isMain) {
		if (name === "electron") return {
			app: { whenReady: () => new Promise(() => {}), on: () => {} }, BrowserWindow: class {},
			dialog: { showMessageBox: async (_window, options) => { assert.match(options.detail, /^https?:/); if (holdPrompt) return new Promise((resolve) => { finishPrompt = () => resolve({ response }); }); return { response }; } },
			ipcMain: { handle: (name, callback) => handlers.set(name, callback), on: (name, callback) => handlers.set(name, callback) },
			shell: { openExternal: async (url) => opened.push(url) },
		};
		return originalLoad.call(this, name, parent, isMain);
	};
	try {
		delete require.cache[require.resolve("../main.cjs")];
		require("../main.cjs");
	} finally { Module._load = originalLoad; }
	const open = handlers.get("open-external");
	await open(null, "https://example.com/path");
	await open(null, "http://example.com/");
	assert.deepEqual(opened, ["https://example.com/path", "http://example.com/"]);
	response = 0;
	assert.equal(await open(null, "https://example.com/cancelled"), false);
	for (const url of ["http://localhost/x", "http://127.0.0.1/x", "http://10.0.0.1/x", "http://[::1]/x"]) assert.equal(await open(null, url), false);
	assert.equal(opened.length, 2);
	holdPrompt = true;
	const first = open(null, "https://example.com/held");
	await new Promise((resolve) => setImmediate(resolve));
	await assert.rejects(open(null, "https://example.com/overlap"), /already open/);
	finishPrompt();
	await first;
	for (const url of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "/relative", "not a url", "https://user:pass@example.com", 3]) {
		await assert.rejects(open(null, url), /Unsupported external URL/);
	}
});
