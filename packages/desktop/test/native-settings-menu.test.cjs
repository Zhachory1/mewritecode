const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const { dirname, join, resolve } = require("node:path");
const { test } = require("node:test");

test("macOS application menu opens Settings only in a ready renderer", async () => {
	const platform = Object.getOwnPropertyDescriptor(process, "platform");
	Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
	let menu;
	let window;
	const launches = [];
	const app = new EventEmitter();
	app.whenReady = () => Promise.resolve();
	app.quit = () => {};
	class BrowserWindow extends EventEmitter {
		constructor() {
			super();
			window = this;
			this.destroyed = false;
			this.webContents = new EventEmitter();
			this.webContents.sent = [];
			this.webContents.send = (channel, event) => this.webContents.sent.push({ channel, event });
			this.webContents.setWindowOpenHandler = () => {};
		}
		isDestroyed() { return this.destroyed; }
		loadFile() {}
	}
	const original = Module._load;
	Module._load = function (name, parent, isMain) {
		if (name === "electron") return {
			app,
			BrowserWindow,
			Menu: { buildFromTemplate: (items) => ({ items }), setApplicationMenu: (built) => { menu = built; } },
			dialog: {}, ipcMain: { handle() {}, on() {} }, shell: {},
		};
		if (name === "node:child_process" && parent.filename.endsWith("/desktop/main.cjs")) return {
			execFile: (binary, args, _options, callback) => { launches.push({ binary, args }); callback(null); },
		};
		return original.call(this, name, parent, isMain);
	};
	try {
		delete require.cache[require.resolve("../main.cjs")];
		require("../main.cjs");
		await new Promise((resolve) => setImmediate(resolve));
	} finally {
		Module._load = original;
		Object.defineProperty(process, "platform", platform);
	}
	const appMenu = menu?.items[0];
	assert.equal(appMenu?.label, "Me Write Code");
	const settings = appMenu.submenu.find((item) => item.label === "Settings…");
	assert.equal(settings.accelerator, "Command+,");
	assert.ok(menu.items.some((item) => item.role === "editMenu"));
	assert.ok(menu.items.some((item) => item.role === "windowMenu"));
	assert.ok(appMenu.submenu.some((item) => item.role === "quit"));
	const fileMenu = menu.items.find((item) => item.label === "File");
	const newWindow = fileMenu.submenu.find((item) => item.label === "New Window");
	assert.equal(newWindow.accelerator, "Command+N");
	assert.ok(fileMenu.submenu.some((item) => item.role === "close"));
	Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
	try { newWindow.click(); }
	finally { Object.defineProperty(process, "platform", platform); }
	assert.equal(launches[0].binary, "open");
	const bundle = join(dirname(process.execPath), "../..");
	assert.deepEqual(launches[0].args, ["-n", "-a", bundle, "--args", resolve(__dirname, "..")]);
	app.isPackaged = true;
	Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
	try { newWindow.click(); }
	finally { Object.defineProperty(process, "platform", platform); }
	assert.deepEqual(launches[1].args, ["-n", "-a", bundle], "packaged app needs no source path");
	settings.click();
	assert.equal(window.webContents.sent.length, 0, "ignore clicks before renderer load");
	window.webContents.emit("did-finish-load");
	settings.click();
	assert.deepEqual(window.webContents.sent.at(-1), { channel: "agent-event", event: { type: "desktop_open_settings" } });
	let sent = window.webContents.sent.length;
	window.webContents.emit("did-start-navigation", {}, "file:///desktop/index.html", false, true);
	settings.click();
	assert.equal(window.webContents.sent.length, sent, "ignore clicks during reload");
	window.webContents.emit("did-finish-load");
	sent = window.webContents.sent.length;
	settings.click();
	assert.equal(window.webContents.sent.length, sent + 1, "menu works after reload");
	window.destroyed = true;
	settings.click();
	assert.equal(window.webContents.sent.length, sent + 1, "ignore clicks after window close");
});

test("File menu keeps Settings reachable without the header button on non-macOS", async () => {
	const platform = Object.getOwnPropertyDescriptor(process, "platform");
	Object.defineProperty(process, "platform", { ...platform, value: "linux" });
	let menu;
	let window;
	const app = new EventEmitter();
	app.whenReady = () => Promise.resolve();
	class BrowserWindow extends EventEmitter {
		constructor() {
			super(); window = this;
			this.webContents = new EventEmitter();
			this.webContents.sent = [];
			this.webContents.send = (channel, event) => this.webContents.sent.push({ channel, event });
			this.webContents.setWindowOpenHandler = () => {};
		}
		isDestroyed() { return false; }
		loadFile() {}
	}
	const original = Module._load;
	Module._load = function (name, parent, isMain) {
		if (name === "electron") return { app, BrowserWindow, Menu: { buildFromTemplate: (items) => ({ items }), setApplicationMenu: (built) => { menu = built; } }, dialog: {}, ipcMain: { handle() {}, on() {} }, shell: {} };
		return original.call(this, name, parent, isMain);
	};
	try {
		delete require.cache[require.resolve("../main.cjs")];
		require("../main.cjs");
		await new Promise((resolve) => setImmediate(resolve));
	} finally { Module._load = original; Object.defineProperty(process, "platform", platform); }
	const settings = menu.items[0].submenu.find((item) => item.label === "Settings…");
	assert.equal(settings.accelerator, "Ctrl+,");
	window.webContents.emit("did-finish-load");
	settings.click();
	assert.deepEqual(window.webContents.sent.at(-1), { channel: "agent-event", event: { type: "desktop_open_settings" } });
});
