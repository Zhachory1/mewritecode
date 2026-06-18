import type { memory as memoryNs } from "@zhachory1/mewrite-agent";
import { describe, expect, test } from "vitest";
import { MemoryInjector } from "../src/core/session-memory-injector.js";

type MemoryProviderInstance = memoryNs.MemoryProvider;

const CWD = "/tmp/memory-injector-test-does-not-exist";

type Hit = { id: number; preview?: string; kind?: string; ts?: string };

/** Minimal fake provider matching the surface MemoryInjector uses. */
function fakeProvider(opts: {
	available?: boolean;
	hits?: Hit[];
	observations?: Array<{ id: number; content?: string; kind?: string; ts?: string }>;
}) {
	const provider = {
		id: "files",
		isAvailable: async () => opts.available ?? true,
		search: async () => opts.hits ?? [],
		getObservations: async () => opts.observations ?? [],
	};
	return provider as unknown as MemoryProviderInstance;
}

function make(provider: MemoryProviderInstance | undefined, recent: string[] = []) {
	const m = new MemoryInjector({
		cwd: CWD,
		timeoutMs: 1000,
		tokenCap: 800,
		recentFileNames: () => recent,
	});
	if (provider) m.primeProvider(provider);
	return m;
}

const userMsg = (text: string) => [{ role: "user" as const, content: text, timestamp: 1 }];

describe("MemoryInjector basics", () => {
	test("tokenCap and enabled reflect constructor + setEnabled", () => {
		const m = make(undefined);
		expect(m.tokenCap).toBe(800);
		expect(m.enabled).toBe(true);
		m.setEnabled(false);
		expect(m.enabled).toBe(false);
	});

	test("getProvider returns the primed provider", async () => {
		const p = fakeProvider({});
		const m = make(p);
		expect(await m.getProvider()).toBe(p);
	});
});

describe("MemoryInjector.buildTransform", () => {
	test("disabled → input unchanged (referential identity)", async () => {
		const m = make(fakeProvider({}));
		m.setEnabled(false);
		const messages = userMsg("hello");
		expect(await m.buildTransform(messages)).toBe(messages);
	});

	test("no provider, no prelude → input unchanged", async () => {
		// MEMORY.md path does not exist and provider is undefined → prelude empty.
		const m = make(undefined);
		const messages = userMsg("hello");
		const out = await m.buildTransform(messages);
		// First-turn prelude attempt happens, but composeStartupPrelude with no
		// inputs yields nothing, so no blocks are inserted.
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ role: "user" });
	});

	test("inserts a memory-recall block before the user message when hits exist", async () => {
		const provider = fakeProvider({
			available: true,
			hits: [{ id: 1, preview: "did a thing", kind: "fact", ts: "2026-01-01" }],
			observations: [{ id: 1, content: "did a thing", kind: "fact", ts: "2026-01-01" }],
		});
		const m = make(provider);
		const messages = userMsg("what did I do");
		const out = await m.buildTransform(messages);
		const recall = out.find((x) => (x as { customType?: string }).customType === "memory-recall");
		expect(recall).toBeDefined();
		expect((recall as { content: string }).content).toContain("did a thing");
		// recall is inserted before the user message
		const recallIdx = out.indexOf(recall as (typeof out)[number]);
		const userIdx = out.findIndex((x) => x.role === "user");
		expect(recallIdx).toBeLessThan(userIdx);
	});

	test("prelude is injected at most once (second turn has no prelude)", async () => {
		const provider = fakeProvider({ available: true, hits: [] });
		const m = make(provider);
		await m.buildTransform(userMsg("turn one"));
		const out2 = await m.buildTransform(userMsg("turn two"));
		const prelude = out2.find((x) => (x as { customType?: string }).customType === "memory-prelude");
		expect(prelude).toBeUndefined();
	});
});
