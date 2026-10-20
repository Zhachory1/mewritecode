const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

test("desktop assets resolve within the application bundle", () => {
	const css = readFileSync(join(__dirname, "../style.css"), "utf8");
	const worker = readFileSync(join(__dirname, "../markdown-worker.js"), "utf8");
	assert.match(worker, /importScripts\("\.\/assets\/marked\.min\.js"\)/);
	assert.doesNotMatch(css + worker, /\.\.\/\.\.\/node_modules/);
});
