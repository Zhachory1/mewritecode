#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, relative, resolve } from "node:path";

const DOCS_DIR = resolve("docs");
const MARKDOWN_LINK = /(?<!!)(?:\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|href=["']([^"']+)["'])/g;

function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) out.push(...walk(path));
		else if (path.endsWith(".md")) out.push(path);
	}
	return out;
}

function stripAnchor(link) {
	const hash = link.indexOf("#");
	return hash === -1 ? link : link.slice(0, hash);
}

function stripQuery(link) {
	const query = link.indexOf("?");
	return query === -1 ? link : link.slice(0, query);
}

function isExternal(link) {
	return /^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith("#") || link.startsWith("mailto:");
}

function candidatePaths(sourceFile, link) {
	const clean = decodeURIComponent(stripQuery(stripAnchor(link))).trim();
	if (!clean || isExternal(clean)) return [];
	const base = clean.startsWith("/") ? DOCS_DIR : resolve(sourceFile, "..");
	const raw = clean.startsWith("/") ? clean.slice(1) : clean;
	const target = normalize(join(base, raw));
	const candidates = [target];
	if (clean.startsWith("/")) candidates.push(normalize(join(DOCS_DIR, "public", raw)));
	if (!extname(target)) {
		candidates.push(`${target}.md`, join(target, "index.md"));
	}
	return candidates;
}

function collectLinks(text) {
	const links = [];
	for (const match of text.matchAll(MARKDOWN_LINK)) {
		const link = match[1] ?? match[2];
		if (link) links.push(link);
	}
	for (const match of text.matchAll(/^\s*(?:link|src):\s+([^\s#][^\s]*)\s*$/gm)) {
		links.push(match[1]);
	}
	return links;
}

const errors = [];
for (const file of walk(DOCS_DIR)) {
	const text = readFileSync(file, "utf8");
	for (const link of collectLinks(text)) {
		const candidates = candidatePaths(file, link);
		if (candidates.length === 0) continue;
		if (!candidates.some((candidate) => existsSync(candidate))) {
			errors.push(`${relative(process.cwd(), file)}: broken link ${link}`);
		}
	}
}

if (errors.length > 0) {
	console.error("Broken docs links:");
	for (const error of errors) console.error(`  - ${error}`);
	process.exit(1);
}

console.log("Docs links OK");
