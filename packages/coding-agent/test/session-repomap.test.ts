import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { RepomapInjector } from "../src/core/session-repomap.js";

const CWD = "/tmp/repomap-test";

describe("RepomapInjector chat-state", () => {
	test("add() promotes a mentioned file and dedupes against mention", () => {
		const r = new RepomapInjector({ cwd: CWD });
		r.mention(resolve(CWD, "a.ts"));
		r.add(resolve(CWD, "a.ts"));
		// a.ts now counts once, as an added file.
		expect(r.recentFileBasenames(10)).toEqual(["a.ts"]);
	});

	test("mention() is a no-op when the file is already added", () => {
		const r = new RepomapInjector({ cwd: CWD });
		r.add(resolve(CWD, "b.ts"));
		r.mention(resolve(CWD, "b.ts"));
		expect(r.recentFileBasenames(10)).toEqual(["b.ts"]);
	});

	test("recentFileBasenames returns added-then-mentioned basenames, capped at n", () => {
		const r = new RepomapInjector({ cwd: CWD });
		r.add(resolve(CWD, "src/added.ts"));
		r.mention(resolve(CWD, "src/mentioned.ts"));
		expect(r.recentFileBasenames(10)).toEqual(["added.ts", "mentioned.ts"]);
		expect(r.recentFileBasenames(1)).toEqual(["mentioned.ts"]);
	});
});

describe("RepomapInjector.updateFromTool", () => {
	test("edit/write add the file; read mentions it", () => {
		const r = new RepomapInjector({ cwd: CWD });
		r.updateFromTool("read", { path: "read.ts" });
		r.updateFromTool("edit", { path: "edit.ts" });
		r.updateFromTool("write", { path: "write.ts" });
		const names = r.recentFileBasenames(10).sort();
		expect(names).toEqual(["edit.ts", "read.ts", "write.ts"]);
	});

	test("no path → no-op", () => {
		const r = new RepomapInjector({ cwd: CWD });
		r.updateFromTool("bash", { command: "ls" });
		expect(r.recentFileBasenames(10)).toEqual([]);
	});

	test("disabled injector ignores tool updates", () => {
		const r = new RepomapInjector({ cwd: CWD });
		r.setEnabled(false);
		r.updateFromTool("edit", { path: "x.ts" });
		expect(r.recentFileBasenames(10)).toEqual([]);
	});
});

describe("RepomapInjector.scanUserMessage", () => {
	test("mentions relative source paths with a slash + known extension", () => {
		const r = new RepomapInjector({ cwd: CWD });
		r.scanUserMessage("please look at src/foo/bar.ts and pkg/baz.go");
		const names = r.recentFileBasenames(10).sort();
		expect(names).toEqual(["bar.ts", "baz.go"]);
	});

	test("ignores bare words and unknown extensions", () => {
		const r = new RepomapInjector({ cwd: CWD });
		r.scanUserMessage("just a sentence about foo.txt and README");
		expect(r.recentFileBasenames(10)).toEqual([]);
	});
});

describe("RepomapInjector.buildTransform", () => {
	test("returns the input unchanged when disabled", async () => {
		const r = new RepomapInjector({ cwd: CWD });
		r.setEnabled(false);
		const messages = [{ role: "user" as const, content: "hi", timestamp: 1 }];
		const out = await r.buildTransform(messages);
		expect(out).toBe(messages);
	});
});
