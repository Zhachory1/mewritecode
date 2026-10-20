const assert = require("node:assert/strict");
const Module = require("node:module");
const { test } = require("node:test");

test("composer dirty updates reach main synchronously before native Close", () => {
	let api;
	const calls = [];
	const original = Module._load;
	Module._load = function (name, parent, isMain) {
		if (name === "electron" && parent.filename.endsWith("/desktop/preload.cjs")) return {
			contextBridge: { exposeInMainWorld: (_name, exposed) => { api = exposed; } },
			ipcRenderer: { sendSync: (...args) => { calls.push(args); return true; } },
		};
		return original.call(this, name, parent, isMain);
	};
	try {
		delete require.cache[require.resolve("../preload.cjs")];
		require("../preload.cjs");
	} finally { Module._load = original; }
	assert.equal(api.setComposerDirty(true, "agent-1"), true);
	assert.deepEqual(calls, [["composer-dirty", true, "agent-1"]]);
});
