const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, chmodSync, linkSync, symlinkSync, renameSync, unlinkSync, statSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { openProjectFile, saveProjectFile } = require("../file-editor.cjs");

function project(t) {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "mewrite-file-editor-")));
	t.after(() => require("node:fs").rmSync(base, { recursive: true, force: true }));
	const root = join(base, "project");
	mkdirSync(root);
	const outside = join(base, "outside.txt");
	writeFileSync(outside, "outside");
	const file = join(root, "note.txt");
	writeFileSync(file, "original\n");
	return { root, file, outside };
}

test("open reads project-relative text; save atomically replaces it and refreshes proof", async (t) => {
	const { root, file } = project(t);
	chmodSync(file, 0o640);
	const opened = await openProjectFile(root, file);
	assert.equal(opened.relativePath, "note.txt");
	assert.equal(opened.content, "original\n");
	const next = await saveProjectFile(opened.proof, "edited\n");
	assert.equal(readFileSync(file, "utf8"), "edited\n");
	assert.equal(statSync(file).mode & 0o777, 0o640);
	assert.equal(statSync(file).gid, opened.proof.gid);
	await assert.rejects(saveProjectFile(opened.proof, "stale"), /changed|replaced/i);
	await saveProjectFile(next, "again\n");
	assert.equal(readFileSync(file, "utf8"), "again\n");
});

test("save does not adopt an external edit made between rename and proof refresh", async (t) => {
	const { root, file } = project(t);
	const { proof } = await openProjectFile(root, file);
	const fsPromises = require("node:fs/promises");
	const originalRename = fsPromises.rename;
	t.mock.method(fsPromises, "rename", async (...args) => {
		await originalRename(...args);
		if (args[1] === file) writeFileSync(file, "unseen external edit\n");
	});
	const modulePath = require.resolve("../file-editor.cjs");
	delete require.cache[modulePath];
	t.after(() => { delete require.cache[modulePath]; });
	const { saveProjectFile: saveWithInterleaving } = require("../file-editor.cjs");
	await assert.rejects(saveWithInterleaving(proof, "submitted edit\n"), /changed|replaced/i);
	assert.equal(readFileSync(file, "utf8"), "unseen external edit\n");
});

test("literal leading-@ project paths open and save without path expansion", async (t) => {
	const { root } = project(t);
	const dir = join(root, "@scope");
	mkdirSync(dir);
	const file = join(dir, "index.ts");
	writeFileSync(file, "const value = 1;\n");
	const opened = await openProjectFile(root, file);
	assert.equal(opened.relativePath, "@scope/index.ts");
	await saveProjectFile(opened.proof, "const value = 2;\n");
	assert.equal(readFileSync(file, "utf8"), "const value = 2;\n");
});

test("open and save preserve UTF-8 BOM without exposing it in content", async (t) => {
	const { root, file } = project(t);
	writeFileSync(file, Buffer.from("\ufeffhéllo", "utf8"));
	const opened = await openProjectFile(root, file);
	assert.equal(opened.content, "héllo");
	await saveProjectFile(opened.proof, "goodbye");
	assert.deepEqual(readFileSync(file), Buffer.from("\ufeffgoodbye", "utf8"));
});

test("small edits preserve CRLF and reject mixed line endings", async (t) => {
	const { root, file } = project(t);
	writeFileSync(file, "first\r\nsecond\r\n");
	const opened = await openProjectFile(root, file);
	assert.equal(opened.content, "first\r\nsecond\r\n");
	await assert.rejects(saveProjectFile(opened.proof, "first\r\nsecond\n"), /mixed line endings/);
	assert.equal(readFileSync(file, "utf8"), "first\r\nsecond\r\n");
	await saveProjectFile(opened.proof, opened.content.replace("first", "changed"));
	assert.equal(readFileSync(file, "utf8"), "changed\r\nsecond\r\n");
	writeFileSync(file, "first\r\nsecond\n");
	await assert.rejects(openProjectFile(root, file), /mixed line endings/);
});

test("open accepts an existing file of exactly 1 MiB", async (t) => {
	const { root, file } = project(t);
	writeFileSync(file, "a".repeat(1024 * 1024));
	assert.equal((await openProjectFile(root, file)).content.length, 1024 * 1024);
});

test("open refuses outside paths, directories, symlinks, hardlinks and oversized files", async (t) => {
	const { root, file, outside } = project(t);
	await assert.rejects(openProjectFile(root, outside));
	await assert.rejects(openProjectFile(root, root));
	const dir = join(root, "dir");
	mkdirSync(dir);
	symlinkSync(outside, join(root, "linked.txt"));
	symlinkSync(dir, join(root, "linked-dir"));
	writeFileSync(join(dir, "nested.txt"), "nested");
	await assert.rejects(openProjectFile(root, join(root, "linked.txt")));
	await assert.rejects(openProjectFile(root, join(root, "linked-dir", "nested.txt")));
	linkSync(file, join(root, "hardlink.txt"));
	await assert.rejects(openProjectFile(root, file));
	unlinkSync(join(root, "hardlink.txt"));
	writeFileSync(file, "x".repeat(1024 * 1024 + 1));
	await assert.rejects(openProjectFile(root, file));
});

test("open refuses invalid UTF-8 and binary control bytes", async (t) => {
	const { root, file } = project(t);
	writeFileSync(file, Buffer.from([0xc3, 0x28]));
	await assert.rejects(openProjectFile(root, file));
	writeFileSync(file, Buffer.from([0x61, 0x00, 0x62]));
	await assert.rejects(openProjectFile(root, file));
	writeFileSync(file, Buffer.from([0x61, 0x01, 0x62]));
	await assert.rejects(openProjectFile(root, file));
});

test("save enforces encoded byte limit including preserved BOM", async (t) => {
	const { root, file } = project(t);
	writeFileSync(file, Buffer.from("\ufefforiginal", "utf8"));
	const { proof } = await openProjectFile(root, file);
	await assert.rejects(saveProjectFile(proof, "é".repeat(512 * 1024)));
	assert.deepEqual(readFileSync(file), Buffer.from("\ufefforiginal", "utf8"));
});

test("save refuses changed content, replacement and deletion without writing", async (t) => {
	const { root, file } = project(t);
	const opened = await openProjectFile(root, file);
	writeFileSync(file, "modified\n");
	await assert.rejects(saveProjectFile(opened.proof, "draft"), /changed|replaced/i);
	assert.equal(readFileSync(file, "utf8"), "modified\n");
	const replacement = join(root, "replacement.txt");
	writeFileSync(replacement, "another\n");
	renameSync(replacement, file);
	await assert.rejects(saveProjectFile(opened.proof, "draft"), /changed|replaced/i);
	assert.equal(readFileSync(file, "utf8"), "another\n");
	unlinkSync(file);
	await assert.rejects(saveProjectFile(opened.proof, "draft"), /changed or was replaced/);
	assert.equal(require("node:fs").existsSync(file), false);
	assert.equal(readdirSync(root).some((name) => name.startsWith(".mewrite-")), false);
});

test("save refuses path changes to a symlink or hardlink", async (t) => {
	const { root, file } = project(t);
	const opened = await openProjectFile(root, file);
	const other = join(root, "other.txt");
	writeFileSync(other, "untouched");
	unlinkSync(file);
	symlinkSync(other, file);
	await assert.rejects(saveProjectFile(opened.proof, "draft"));
	assert.equal(readFileSync(other, "utf8"), "untouched");
	unlinkSync(file);
	writeFileSync(file, "new file");
	linkSync(file, join(root, "hardlink.txt"));
	await assert.rejects(saveProjectFile(opened.proof, "draft"));
	assert.equal(readFileSync(file, "utf8"), "new file");
});

test("save refuses a symlink ancestor introduced after open", async (t) => {
	const { root } = project(t);
	const dir = join(root, "dir");
	mkdirSync(dir);
	const file = join(dir, "nested.txt");
	writeFileSync(file, "nested");
	const { proof } = await openProjectFile(root, file);
	renameSync(dir, join(root, "moved"));
	symlinkSync(join(root, "moved"), dir);
	await assert.rejects(saveProjectFile(proof, "draft"));
	assert.equal(readFileSync(join(root, "moved", "nested.txt"), "utf8"), "nested");
	assert.equal(readdirSync(join(root, "moved")).length, 1);
});

test("save rejects invalid payload before touching original", async (t) => {
	const { root, file } = project(t);
	const { proof } = await openProjectFile(root, file);
	await assert.rejects(saveProjectFile(proof, "x".repeat(1024 * 1024 + 1)));
	await assert.rejects(saveProjectFile(proof, "a\0b"));
	await assert.rejects(saveProjectFile(proof, "\ud800"));
	await assert.rejects(saveProjectFile(proof, null));
	assert.equal(readFileSync(file, "utf8"), "original\n");
});
