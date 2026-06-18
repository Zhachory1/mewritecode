/**
 * Claude → caveman migration (#15) — planner + executor tests.
 *
 * Uses an in-memory `FsWriter` so the pure planning + the apply logic are tested
 * without touching disk. Covers: per-category planning, import/skip/merge/reuse
 * actions, idempotency (re-run is all-skip), dry-run writes nothing, settings
 * merge (cave keys win), and the CLI arg parse.
 */

import { describe, expect, it } from "vitest";
import { parseMigrateArgs } from "../../cli/migrate-cli.js";
import {
	executeClaudeMigration,
	type FsWriter,
	type MigrateCategory,
	mergeSettingsObjects,
	planClaudeMigration,
} from "../migrate-claude.js";

// ---- in-memory FsWriter ----------------------------------------------------
type Node = { dir: boolean; content?: string };

class MemFs implements FsWriter {
	private nodes = new Map<string, Node>();

	mkdirp(path: string): void {
		const parts = path.split("/").filter(Boolean);
		let cur = "";
		for (const p of parts) {
			cur += `/${p}`;
			if (!this.nodes.has(cur)) this.nodes.set(cur, { dir: true });
		}
	}
	addFile(path: string, content = ""): void {
		const parent = path.slice(0, path.lastIndexOf("/"));
		if (parent) this.mkdirp(parent);
		this.nodes.set(path, { dir: false, content });
	}
	exists(path: string): boolean {
		return this.nodes.has(path);
	}
	isDirectory(path: string): boolean {
		return this.nodes.get(path)?.dir === true;
	}
	readDir(path: string): string[] {
		const prefix = `${path}/`;
		const names = new Set<string>();
		for (const key of this.nodes.keys()) {
			if (!key.startsWith(prefix)) continue;
			const rest = key.slice(prefix.length);
			if (!rest.includes("/")) names.add(rest);
		}
		return [...names];
	}
	readFile(path: string): string {
		const n = this.nodes.get(path);
		if (!n || n.dir) throw new Error(`no file: ${path}`);
		return n.content ?? "";
	}
	writeFile(path: string, contents: string): void {
		this.addFile(path, contents);
	}
	copy(src: string, dst: string): void {
		const node = this.nodes.get(src);
		if (!node) throw new Error(`copy: missing src ${src}`);
		if (!node.dir) {
			this.addFile(dst, node.content ?? "");
			return;
		}
		this.mkdirp(dst);
		const prefix = `${src}/`;
		for (const [key, n] of this.nodes) {
			if (key.startsWith(prefix)) this.nodes.set(dst + key.slice(src.length), { ...n });
		}
	}
}

const CLAUDE = "/home/.claude";
const CAVE = "/home/.cave/agent";

function seededClaude(): MemFs {
	const fs = new MemFs();
	fs.mkdirp(CLAUDE);
	fs.addFile(`${CLAUDE}/skills/my-skill/SKILL.md`, "# skill");
	fs.addFile(`${CLAUDE}/agents/reviewer.md`, "# reviewer");
	fs.addFile(`${CLAUDE}/commands/deploy.md`, "# deploy");
	fs.addFile(`${CLAUDE}/settings.json`, JSON.stringify({ theme: "dark", env: { A: "1" } }));
	fs.addFile(`${CLAUDE}/CLAUDE.md`, "# global memory");
	fs.addFile(`${CLAUDE}/mcp.json`, "{}");
	return fs;
}

const plan = (fs: MemFs) => planClaudeMigration({ claudeDir: CLAUDE, caveDir: CAVE, fs });

describe("planClaudeMigration", () => {
	it("plans every category from a seeded ~/.claude", () => {
		const p = plan(seededClaude());
		expect(p.claudeMissing).toBe(false);
		const byCat = (c: MigrateCategory) => p.items.filter((i) => i.category === c);
		expect(byCat("skills").map((i) => i.action)).toEqual(["import"]);
		expect(byCat("agents").map((i) => i.action)).toEqual(["import"]);
		expect(byCat("commands").map((i) => i.action)).toEqual(["import"]);
		expect(byCat("settings")[0].action).toBe("import"); // no cave settings yet
		expect(byCat("memory").map((i) => i.action)).toEqual(["import"]);
		expect(byCat("mcp")[0].action).toBe("reuse"); // auto-read, never copied
	});

	it("flags claudeMissing when ~/.claude is absent", () => {
		expect(plan(new MemFs()).claudeMissing).toBe(true);
	});

	it("skips copy-required items whose destination already exists", () => {
		const fs = seededClaude();
		fs.addFile(`${CAVE}/agents/reviewer.md`, "# existing");
		const agents = plan(fs).items.filter((i) => i.category === "agents");
		expect(agents[0].action).toBe("skip");
	});
});

describe("executeClaudeMigration", () => {
	it("imports copy-required artifacts and reuses MCP", () => {
		const fs = seededClaude();
		const r = executeClaudeMigration(plan(fs), { dryRun: false, fs });
		expect(fs.exists(`${CAVE}/agents/reviewer.md`)).toBe(true);
		expect(fs.exists(`${CAVE}/commands/deploy.md`)).toBe(true);
		expect(fs.exists(`${CAVE}/CLAUDE.md`)).toBe(true);
		expect(fs.exists(`${CAVE}/settings.json`)).toBe(true);
		expect(r.counts.mcp.reuse).toBe(1);
		expect(r.noWrites).toBe(false);
	});

	it("is idempotent — a second run writes nothing (all skip)", () => {
		const fs = seededClaude();
		executeClaudeMigration(plan(fs), { dryRun: false, fs });
		const second = executeClaudeMigration(plan(fs), { dryRun: false, fs }); // re-plan sees dsts now present
		expect(second.noWrites).toBe(true);
		// every copy-required category is now skip
		expect(second.counts.skills.import + second.counts.agents.import + second.counts.commands.import).toBe(0);
	});

	it("dry-run writes nothing", () => {
		const fs = seededClaude();
		const r = executeClaudeMigration(plan(fs), { dryRun: true, fs });
		expect(r.dryRun).toBe(true);
		expect(r.noWrites).toBe(true);
		expect(fs.exists(`${CAVE}/agents/reviewer.md`)).toBe(false); // nothing written
	});

	it("merges settings.json with existing cave keys winning", () => {
		const fs = seededClaude();
		fs.addFile(`${CAVE}/settings.json`, JSON.stringify({ theme: "light", env: { B: "2" } }));
		const r = executeClaudeMigration(plan(fs), { dryRun: false, fs });
		const merged = JSON.parse(fs.readFile(`${CAVE}/settings.json`));
		expect(merged.theme).toBe("light"); // cave wins
		expect(merged.env).toEqual({ A: "1", B: "2" }); // one-level merge
		const settingsItem = r.items.find((i) => i.category === "settings");
		expect(settingsItem?.action).toBe("merge");
	});
});

describe("mergeSettingsObjects", () => {
	it("adopts only new keys; existing cave keys win", () => {
		const { merged, adopted } = mergeSettingsObjects({ a: 1 }, { a: 99, b: 2 });
		expect(merged).toEqual({ a: 1, b: 2 });
		expect(adopted).toEqual(["b"]);
	});
});

describe("parseMigrateArgs", () => {
	it("parses --from, --from=, --dry-run, --help", () => {
		expect(parseMigrateArgs(["--from", "claude"]).from).toBe("claude");
		expect(parseMigrateArgs(["--from=claude"]).from).toBe("claude");
		expect(parseMigrateArgs(["--dry-run"]).dryRun).toBe(true);
		expect(parseMigrateArgs(["--help"]).help).toBe(true);
		expect(parseMigrateArgs([]).from).toBeUndefined();
	});
});
