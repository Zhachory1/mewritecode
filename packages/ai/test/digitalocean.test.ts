import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnvApiKey, getProviderAuthStatus } from "../src/env-api-keys.js";
import { getModel } from "../src/models.js";
import { _clearDiscoveryStateForTests, discoverDigitalOceanModels } from "../src/providers/anthropic-discovery.js";

const originalModelAccessKey = process.env.MODEL_ACCESS_KEY;

describe("DigitalOcean Inference", () => {
	afterEach(() => {
		_clearDiscoveryStateForTests();
		vi.unstubAllGlobals();
		if (originalModelAccessKey === undefined) delete process.env.MODEL_ACCESS_KEY;
		else process.env.MODEL_ACCESS_KEY = originalModelAccessKey;
	});

	it("uses MODEL_ACCESS_KEY and includes an OpenAI-compatible preset", () => {
		process.env.MODEL_ACCESS_KEY = "sk-do-test";

		expect(getEnvApiKey("digitalocean")).toBe("sk-do-test");
		expect(getProviderAuthStatus("digitalocean")).toMatchObject({
			kind: "env",
			configured: true,
			envVar: "MODEL_ACCESS_KEY",
		});
		expect(getModel("digitalocean", "openai-gpt-4.1")).toMatchObject({
			api: "openai-completions",
			baseUrl: "https://inference.do-ai.run/v1",
		});
	});

	it("discovers and replaces account models through the DigitalOcean catalog", async () => {
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
			const authorization = new Headers(init?.headers).get("Authorization");
			const id = authorization === "Bearer sk-do-Aa" ? "anthropic-claude-4.6-sonnet" : "openai-gpt-5";
			return new Response(JSON.stringify({ data: [{ id }] }), { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);

		await discoverDigitalOceanModels("https://inference.do-ai.run/v1", "sk-do-Aa");
		await discoverDigitalOceanModels("https://inference.do-ai.run/v1", "sk-do-BB");
		await discoverDigitalOceanModels("https://inference.do-ai.run/v1", "sk-do-Aa");

		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(
			fetchMock.mock.calls.map(([, init]) => new Headers((init as RequestInit).headers).get("Authorization")),
		).toEqual(["Bearer sk-do-Aa", "Bearer sk-do-BB", "Bearer sk-do-Aa"]);
		expect(getModel("digitalocean", "openai-gpt-5" as never)).toBeUndefined();
		expect(getModel("digitalocean", "anthropic-claude-4.6-sonnet" as never)).toMatchObject({
			api: "openai-completions",
			baseUrl: "https://inference.do-ai.run/v1",
		});
	});
});
