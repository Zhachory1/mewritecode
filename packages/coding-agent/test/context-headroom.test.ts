import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compressContextPack } from "../src/core/context-compression.js";
import type { ContextBundle, ContextPack } from "../src/core/context-engine.js";
import { createHeadroomCompressor, resolveHeadroomPython } from "../src/core/context-headroom.js";

function fakePython(body: string): string {
	const dir = join(tmpdir(), `headroom-fake-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "python");
	writeFileSync(path, `#!/usr/bin/env node\n${body}\n`);
	chmodSync(path, 0o755);
	return path;
}

function bundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
	return {
		id: "bundle-1",
		source: "test",
		entityType: "json",
		title: "Events",
		content: '{"events":[{"id":1,"latency":123},{"id":2,"latency":456}]}',
		compression: { mode: "lossy-ok" },
		provenance: { path: "events.json" },
		...overrides,
	};
}

function pack(bundles: ContextBundle[]): ContextPack {
	return { bundles, sources: { test: { ok: true } } };
}

describe("Headroom local compressor", () => {
	it("compresses through local python JSON protocol", async () => {
		const python = fakePython(`
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  process.stdout.write(JSON.stringify({protocolVersion:1,id:payload.id,content:'short json'}));
});
`);
		const compressor = createHeadroomCompressor({ enabled: true, python, timeoutMs: 1000 });
		const result = await compressContextPack(pack([bundle()]), compressor, { enabled: true });

		expect(result.pack.bundles[0].content).toBe("short json");
		expect(result.stats.compressed).toBe(1);
	});

	it("is built in by default and can be disabled", () => {
		expect(createHeadroomCompressor({ enabled: false, python: "/tmp/python" })).toBeUndefined();
		expect(createHeadroomCompressor({ enabled: true })).toBeDefined();
	});

	it("resolves python override only as an advanced escape hatch", () => {
		expect(resolveHeadroomPython("/tmp/custom-python")).toBe("/tmp/custom-python");
	});

	it("falls back when python is missing", async () => {
		const compressor = createHeadroomCompressor({ enabled: true, python: join(tmpdir(), "missing-python") });
		const result = await compressContextPack(pack([bundle()]), compressor, { enabled: true });

		expect(result.pack.bundles[0].content).toContain("events");
		expect(result.stats.failed).toBe(1);
		expect(result.stats.fallbackReason).toBe("compressor-error");
	});

	it("falls back on timeout", async () => {
		const python = fakePython("setTimeout(() => {}, 10000);");
		const compressor = createHeadroomCompressor({ enabled: true, python, timeoutMs: 10 });
		const result = await compressContextPack(pack([bundle()]), compressor, { enabled: true });

		expect(result.pack.bundles[0].content).toContain("events");
		expect(result.stats.fallbackReason).toBe("compressor-error");
	});

	it("falls back on malformed stdout", async () => {
		const python = fakePython("process.stdout.write('nope')");
		const compressor = createHeadroomCompressor({ enabled: true, python, timeoutMs: 1000 });
		const result = await compressContextPack(pack([bundle()]), compressor, { enabled: true });

		expect(result.pack.bundles[0].content).toContain("events");
		expect(result.stats.failed).toBe(1);
	});

	it("does not spawn for exact-preserve bundles", async () => {
		const python = fakePython("process.exit(9)");
		const compressor = createHeadroomCompressor({ enabled: true, python, timeoutMs: 1000 });
		const result = await compressContextPack(
			pack([bundle({ compression: { mode: "exact-preserve" } })]),
			compressor,
			{
				enabled: true,
			},
		);

		expect(result.pack.bundles[0].content).toContain("events");
		expect(result.stats.skippedExact).toBe(1);
	});

	it("falls back before spawn when input exceeds cap", async () => {
		const python = fakePython("process.exit(9)");
		const compressor = createHeadroomCompressor({ enabled: true, python, timeoutMs: 1000, maxInputBytes: 4 });
		const result = await compressContextPack(pack([bundle()]), compressor, { enabled: true });

		expect(result.pack.bundles[0].content).toContain("events");
		expect(result.stats.failed).toBe(1);
	});
});
