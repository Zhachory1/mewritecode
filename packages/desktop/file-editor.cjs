const { createHash, randomUUID } = require("node:crypto");
const { constants } = require("node:fs");
const { lstat, open, readFile, realpath, rename, unlink } = require("node:fs/promises");
const { dirname, isAbsolute, join, relative, resolve, sep } = require("node:path");

const MAX_BYTES = 1024 * 1024;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const identityFields = ["dev", "ino", "size", "mtimeMs", "mode", "uid", "gid", "nlink"];
const matches = (a, b) => identityFields.every((field) => a[field] === b[field]);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (root, target) => { const rel = relative(root, target); return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };

// Canonical, symlink-free, singly-linked, user-owned file inside root.
async function inspectProjectFile(root, relativePath) {
	const target = resolve(root, relativePath);
	if (!inside(root, target)) throw new Error("Path is outside the project");
	let current = root;
	for (const part of relative(root, target).split(sep)) {
		current = join(current, part);
		if ((await lstat(current)).isSymbolicLink()) throw new Error("Symlinks cannot be edited");
	}
	const info = await lstat(target);
	if (!info.isFile() || info.nlink !== 1 || (process.geteuid && info.uid !== process.geteuid())) throw new Error("Edit target must be a singly-linked regular file owned by this user");
	if ((await realpath(target)) !== target) throw new Error("Path is not canonical within the project");
	const { dev, ino, size, mtimeMs, mode, uid, gid, nlink } = info;
	return { root, absolutePath: target, relativePath: relative(root, target).split(sep).join("/"), dev, ino, size, mtimeMs, mode, uid, gid, nlink, digest: digest(await readFile(target)) };
}

async function snapshot(root, path) {
	const relativePath = relative(root, path);
	if (!isAbsolute(path) || !relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
		throw new Error("File must be inside the selected project");
	}
	let initial;
	try { initial = await lstat(path); }
	catch (error) { if (error.code === "ENOENT") throw new Error("File changed or was replaced"); throw error; }
	if (!initial.isFile() || initial.size > MAX_BYTES) throw new Error("File must be a regular file of at most 1 MiB");
	const proof = await inspectProjectFile(root, relativePath);
	if (proof.absolutePath !== path || proof.root !== root || !matches(initial, proof)) throw new Error("File changed or was replaced");
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const info = await handle.stat();
		if (!matches(proof, info)) throw new Error("File changed or was replaced");
		const bytes = Buffer.alloc(info.size + 1);
		let count = 0;
		while (count < bytes.length) {
			const { bytesRead } = await handle.read(bytes, count, bytes.length - count, count);
			if (!bytesRead) break;
			count += bytesRead;
		}
		if (count !== info.size || !matches(proof, await handle.stat()) || !matches(proof, await lstat(path)) || digest(bytes.subarray(0, count)) !== proof.digest) {
			throw new Error("File changed or was replaced");
		}
		return { proof, bytes: bytes.subarray(0, count) };
	} finally {
		await handle.close();
	}
}

function decode(bytes) {
	const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content)) throw new Error("Binary files cannot be edited");
	if (new Set(content.match(/\r\n|\r|\n/g) ?? []).size > 1) throw new Error("File has mixed line endings and cannot be edited safely");
	return content;
}

async function openProjectFile(cwd, absolutePath) {
	const root = await realpath(cwd);
	const { proof, bytes } = await snapshot(root, absolutePath);
	const bom = bytes.subarray(0, 3).equals(BOM);
	return {
		relativePath: proof.relativePath,
		content: decode(bytes),
		proof: Object.freeze({ ...proof, bom }),
	};
}

async function saveProjectFile(proof, content) {
	if (typeof content !== "string" || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content)) throw new Error("Save requires UTF-8 text without binary controls");
	const encoded = Buffer.from(content, "utf8");
	if (encoded.toString("utf8") !== content) throw new Error("Save requires valid UTF-8 text");
	const bytes = proof.bom ? Buffer.concat([BOM, encoded]) : encoded;
	if (bytes.length > MAX_BYTES) throw new Error("Save exceeds 1 MiB");
	decode(bytes);
	const temp = join(dirname(proof.absolutePath), `.mewrite-${randomUUID()}.tmp`);
	let created = false;
	try {
		const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
		created = true;
		try {
			await handle.writeFile(bytes);
			const replacement = await handle.stat();
			if (replacement.uid !== proof.uid || replacement.gid !== proof.gid) throw new Error("File ownership cannot be preserved");
			await handle.chmod(proof.mode & 0o7777);
			await handle.sync();
		} finally {
			await handle.close();
		}
		const current = (await snapshot(proof.root, proof.absolutePath)).proof;
		if (!matches(proof, current) || proof.digest !== current.digest) throw new Error("File changed or was replaced");
		await rename(temp, proof.absolutePath);
		created = false;
		const refreshed = (await openProjectFile(proof.root, proof.absolutePath)).proof;
		if (refreshed.digest !== digest(bytes)) throw new Error("File changed or was replaced");
		return refreshed;
	} finally {
		if (created) await unlink(temp);
	}
}

module.exports = { openProjectFile, saveProjectFile };
