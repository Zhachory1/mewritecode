import type { Api, Model } from "@zhachory1/mewrite-ai";
import type { TUI } from "@zhachory1/mewrite-tui";
import stripAnsi from "strip-ansi";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import type { SettingsManager } from "../src/core/settings-manager.js";
import { ModelSelectorComponent } from "../src/modes/interactive/components/model-selector.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

const googleVertexModel: Model<Api> = {
	id: "test-model",
	name: "Test Model",
	api: "anthropic-messages",
	provider: "google-vertex",
	baseUrl: "https://example.com",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 64_000,
};

const amazonBedrockModel: Model<Api> = { ...googleVertexModel, provider: "amazon-bedrock" };

function createSelector(modelRegistry: ModelRegistry): ModelSelectorComponent {
	const settingsManager = {
		getFavoriteModels: () => [],
		getRecentModels: () => [],
	} as unknown as SettingsManager;
	const tui = { requestRender: () => {} } as unknown as TUI;
	return new ModelSelectorComponent(
		tui,
		undefined,
		settingsManager,
		modelRegistry,
		[],
		() => {},
		() => {},
	);
}

function mockPricingRefresh(modelRegistry: ModelRegistry): void {
	vi.spyOn(modelRegistry, "refreshPricingFromSource").mockResolvedValue({ ok: false, error: "unavailable" });
}

beforeAll(() => initTheme("dark"));

describe("ModelSelectorComponent", () => {
	test("marks Anthropic models with stored OAuth credentials as configured", async () => {
		const authStorage = AuthStorage.inMemory({
			anthropic: { type: "oauth", access: "access", refresh: "refresh", expires: Date.now() + 60_000 },
		});
		const modelRegistry = ModelRegistry.inMemory(authStorage);
		mockPricingRefresh(modelRegistry);

		const selector = createSelector(modelRegistry);
		await Promise.resolve();

		expect(stripAnsi(selector.render(120).join("\n"))).toContain("🔑 anthropic");
	});

	test("preserves provider setup requirements despite registry credentials", async () => {
		const modelRegistry = {
			refresh: () => {},
			getError: () => undefined,
			getAll: () => [googleVertexModel],
			hasConfiguredAuth: () => true,
			isUsingOAuth: () => false,
			refreshPricingFromSource: async () => ({ ok: false as const, error: "unavailable" }),
		} as unknown as ModelRegistry;

		const selector = createSelector(modelRegistry);
		await Promise.resolve();

		const rendered = stripAnsi(selector.render(120).join("\n"));
		expect(rendered).toContain("⚙ google-vertex");
		expect(rendered).toContain("GOOGLE_CLOUD_PROJECT/LOCATION");
	});

	test("preserves the Bedrock region requirement despite registry credentials", async () => {
		vi.stubEnv("AWS_ACCESS_KEY_ID", "access-key");
		vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secret-key");
		vi.stubEnv("AWS_REGION", undefined);
		vi.stubEnv("AWS_DEFAULT_REGION", undefined);
		try {
			const modelRegistry = {
				refresh: () => {},
				getError: () => undefined,
				getAll: () => [amazonBedrockModel],
				hasConfiguredAuth: () => true,
				isUsingOAuth: () => false,
				refreshPricingFromSource: async () => ({ ok: false as const, error: "unavailable" }),
			} as unknown as ModelRegistry;

			const selector = createSelector(modelRegistry);
			await Promise.resolve();

			const rendered = stripAnsi(selector.render(120).join("\n"));
			expect(rendered).toContain("⚙ amazon-bedrock");
			expect(rendered).toContain("set AWS_REGION");
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
