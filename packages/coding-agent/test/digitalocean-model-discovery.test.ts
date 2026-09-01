import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { defaultModelPerProvider } from "../src/core/model-resolver.js";

const originalModelAccessKey = process.env.MODEL_ACCESS_KEY;

describe("DigitalOcean model discovery", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `mewrite-digitalocean-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		if (originalModelAccessKey === undefined) delete process.env.MODEL_ACCESS_KEY;
		else process.env.MODEL_ACCESS_KEY = originalModelAccessKey;
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
	});

	it("adds discovered models to the session registry", async () => {
		process.env.MODEL_ACCESS_KEY = "sk-do-test";
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		const registry = ModelRegistry.inMemory(authStorage);
		const fetchMock = vi.fn(
			async () => new Response(JSON.stringify({ data: [{ id: "anthropic-claude-4.6-sonnet" }] }), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await registry.discoverAnthropicCapabilities();

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(registry.find("digitalocean", "anthropic-claude-4.6-sonnet")).toBeDefined();
		expect(defaultModelPerProvider.digitalocean).toBe("openai-gpt-4.1");
	});
});
