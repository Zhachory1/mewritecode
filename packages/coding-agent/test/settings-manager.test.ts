import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_DIR_NAME } from "../src/config.js";
import { createAgentSessionServices } from "../src/core/agent-session-services.js";
import type { ModelRegistry } from "../src/core/model-registry.js";
import { InMemorySettingsStorage, SettingsManager } from "../src/core/settings-manager.js";

describe("SettingsManager", () => {
	const testDir = join(process.cwd(), "test-settings-tmp");
	const agentDir = join(testDir, "agent");
	const projectDir = join(testDir, "project");

	beforeEach(() => {
		// Clean up and create fresh directories
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(projectDir, CONFIG_DIR_NAME), { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
	});

	describe("preserves externally added settings", () => {
		it("should preserve enabledModels when changing thinking level", async () => {
			// Create initial settings file
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					theme: "dark",
					defaultModel: "claude-sonnet",
				}),
			);

			// Create SettingsManager (simulates pi starting up)
			const manager = SettingsManager.create(projectDir, agentDir);

			// Simulate user editing settings.json externally to add enabledModels
			const currentSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			currentSettings.enabledModels = ["claude-opus-4-5", "gpt-5.2-codex"];
			writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));

			// User changes thinking level via Shift+Tab
			manager.setDefaultThinkingLevel("high");
			await manager.flush();

			// Verify enabledModels is preserved
			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.enabledModels).toEqual(["claude-opus-4-5", "gpt-5.2-codex"]);
			expect(savedSettings.defaultThinkingLevel).toBe("high");
			expect(savedSettings.theme).toBe("dark");
			expect(savedSettings.defaultModel).toBe("claude-sonnet");
		});

		it("should preserve custom settings when changing theme", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					defaultModel: "claude-sonnet",
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			// User adds custom settings externally
			const currentSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			currentSettings.shellPath = "/bin/zsh";
			currentSettings.extensions = ["/path/to/extension.ts"];
			writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));

			// User changes theme
			manager.setTheme("light");
			await manager.flush();

			// Verify all settings preserved
			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.shellPath).toBe("/bin/zsh");
			expect(savedSettings.extensions).toEqual(["/path/to/extension.ts"]);
			expect(savedSettings.theme).toBe("light");
		});

		it("should let in-memory changes override file changes for same key", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					theme: "dark",
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			// User externally sets thinking level to "low"
			const currentSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			currentSettings.defaultThinkingLevel = "low";
			writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));

			// But then changes it via UI to "high"
			manager.setDefaultThinkingLevel("high");
			await manager.flush();

			// In-memory change should win
			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.defaultThinkingLevel).toBe("high");
		});
	});

	describe("startup display settings", () => {
		it("defaults resource listings to quiet", () => {
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getQuietResourceListing()).toBe(true);
		});

		it("respects explicit resource listing opt-in", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ quietResourceListing: false }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getQuietResourceListing()).toBe(false);
		});

		it("defaults startup changelog display to off", () => {
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getShowChangelogOnStartup()).toBe(false);
		});

		it("persists startup changelog display opt-in", async () => {
			const manager = SettingsManager.create(projectDir, agentDir);

			manager.setShowChangelogOnStartup(true);
			await manager.flush();

			const savedSettings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
			expect(savedSettings.showChangelogOnStartup).toBe(true);
			expect(SettingsManager.create(projectDir, agentDir).getShowChangelogOnStartup()).toBe(true);
		});
	});

	describe("packages migration", () => {
		it("should keep local-only extensions in extensions array", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					extensions: ["/local/ext.ts", "./relative/ext.ts"],
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getPackages()).toEqual([]);
			expect(manager.getExtensionPaths()).toEqual(["/local/ext.ts", "./relative/ext.ts"]);
		});

		it("should handle packages with filtering objects", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					packages: [
						"npm:simple-pkg",
						{
							source: "npm:shitty-extensions",
							extensions: ["extensions/oracle.ts"],
							skills: [],
						},
					],
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			const packages = manager.getPackages();
			expect(packages).toHaveLength(2);
			expect(packages[0]).toBe("npm:simple-pkg");
			expect(packages[1]).toEqual({
				source: "npm:shitty-extensions",
				extensions: ["extensions/oracle.ts"],
				skills: [],
			});
		});
	});

	describe("reload", () => {
		it("should reload global settings from disk", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					theme: "dark",
					extensions: ["/before.ts"],
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			writeFileSync(
				settingsPath,
				JSON.stringify({
					theme: "light",
					extensions: ["/after.ts"],
					defaultModel: "claude-sonnet",
				}),
			);

			await manager.reload();

			expect(manager.getTheme()).toBe("light");
			expect(manager.getExtensionPaths()).toEqual(["/after.ts"]);
			expect(manager.getDefaultModel()).toBe("claude-sonnet");
		});

		it("should keep previous settings when file is invalid", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			writeFileSync(settingsPath, "{ invalid json");
			await manager.reload();

			expect(manager.getTheme()).toBe("dark");
		});
	});

	describe("error tracking", () => {
		it("should collect and clear load errors via drainErrors", () => {
			const globalSettingsPath = join(agentDir, "settings.json");
			const projectSettingsPath = join(projectDir, CONFIG_DIR_NAME, "settings.json");
			writeFileSync(globalSettingsPath, "{ invalid global json");
			writeFileSync(projectSettingsPath, "{ invalid project json");

			const manager = SettingsManager.create(projectDir, agentDir);
			const errors = manager.drainErrors();

			expect(errors).toHaveLength(2);
			expect(errors.map((e) => e.scope).sort()).toEqual(["global", "project"]);
			expect(manager.drainErrors()).toEqual([]);
		});
	});

	describe("project settings directory creation", () => {
		it("should not create .pi folder when only reading project settings", () => {
			// Create agent dir with global settings, but NO .pi folder in project
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

			// Delete the .pi folder that beforeEach created
			rmSync(join(projectDir, CONFIG_DIR_NAME), { recursive: true });

			// Create SettingsManager (reads both global and project settings)
			const manager = SettingsManager.create(projectDir, agentDir);

			// .pi folder should NOT have been created just from reading
			expect(existsSync(join(projectDir, CONFIG_DIR_NAME))).toBe(false);

			// Settings should still be loaded from global
			expect(manager.getTheme()).toBe("dark");
		});

		it("should create .pi folder when writing project settings", async () => {
			// Create agent dir with global settings, but NO .pi folder in project
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

			// Delete the .pi folder that beforeEach created
			rmSync(join(projectDir, CONFIG_DIR_NAME), { recursive: true });

			const manager = SettingsManager.create(projectDir, agentDir);

			// .pi folder should NOT exist yet
			expect(existsSync(join(projectDir, CONFIG_DIR_NAME))).toBe(false);

			// Write a project-specific setting
			manager.setProjectPackages([{ source: "npm:test-pkg" }]);
			await manager.flush();

			// Now .pi folder should exist
			expect(existsSync(join(projectDir, CONFIG_DIR_NAME))).toBe(true);

			// And settings file should be created
			expect(existsSync(join(projectDir, CONFIG_DIR_NAME, "settings.json"))).toBe(true);
		});
	});

	describe("shellCommandPrefix", () => {
		it("should load shellCommandPrefix from settings", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ shellCommandPrefix: "shopt -s expand_aliases" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getShellCommandPrefix()).toBe("shopt -s expand_aliases");
		});

		it("should return undefined when shellCommandPrefix is not set", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getShellCommandPrefix()).toBeUndefined();
		});

		it("should preserve shellCommandPrefix when saving unrelated settings", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ shellCommandPrefix: "shopt -s expand_aliases" }));

			const manager = SettingsManager.create(projectDir, agentDir);
			manager.setTheme("light");
			await manager.flush();

			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.shellCommandPrefix).toBe("shopt -s expand_aliases");
			expect(savedSettings.theme).toBe("light");
		});
	});

	describe("ponytail settings", () => {
		it("defaults Ponytail on at full intensity", () => {
			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getPonytailSettings()).toEqual({ enabled: true, intensity: "full" });
		});

		it("loads and persists Ponytail settings", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ ponytail: { enabled: false, intensity: "lite" } }));

			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getPonytailSettings()).toEqual({ enabled: false, intensity: "lite" });

			manager.setPonytailEnabled(true);
			manager.setPonytailIntensity("ultra");
			await manager.flush();

			expect(JSON.parse(readFileSync(settingsPath, "utf-8"))).toMatchObject({
				ponytail: { enabled: true, intensity: "ultra" },
			});
		});
	});

	describe("memory settings", () => {
		it("defaults durable memory to Cavemem with previewed capture and retrieval enabled", () => {
			const manager = SettingsManager.create(projectDir, agentDir);
			const settings = manager.getMemorySettings();

			expect(settings).toEqual({
				enabled: true,
				backend: "cavemem",
				command: undefined,
				capture: { requirePreview: true },
				retrieval: { enabled: true, maxResults: 5 },
			});
		});

		it("loads explicit Cavemem memory settings", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					memory: {
						enabled: false,
						backend: "cavemem",
						command: "/opt/bin/cavemem",
						capture: { requirePreview: false },
						retrieval: { enabled: false, maxResults: 3 },
					},
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);
			const settings = manager.getMemorySettings();

			expect(settings).toMatchObject({
				enabled: false,
				backend: "cavemem",
				command: "/opt/bin/cavemem",
				capture: { requirePreview: false },
				retrieval: { enabled: false, maxResults: 3 },
			});
		});
		it("rejects removed ZBrain and Codescry fields with migration instructions", () => {
			const storage = new InMemorySettingsStorage();
			storage.withLock("global", () =>
				JSON.stringify({
					memory: { backend: "zbrain", workspace: "~/.zbrain", capture: { defaultCollection: "inbox" } },
					contextEngine: { provider: "codescry", repoIndex: {}, setup: { mainCodeDir: "/tmp/code" } },
				}),
			);

			const manager = SettingsManager.fromStorage(storage);
			expect(() => manager.assertNoRemovedSettings()).toThrow(
				'Removed settings detected. Replace `memory.backend: "zbrain"` with `memory.backend: "cavemem"` (default, with Files fallback when unavailable) or `"files"`.',
			);
			expect(() => manager.assertNoRemovedSettings()).toThrow("Remove `memory.workspace`");
			expect(() => manager.assertNoRemovedSettings()).toThrow("Remove `memory.capture.defaultCollection`");
			expect(() => manager.assertNoRemovedSettings()).toThrow(
				'Replace `contextEngine.provider` with `"none"`, `"qmd"`, `"gbrain"`, or `"remote"`; Codescry, repo-index, and stack were removed.',
			);
			expect(() => manager.assertNoRemovedSettings()).toThrow("Remove `contextEngine.repoIndex`");
			expect(() => manager.assertNoRemovedSettings()).toThrow("Remove `contextEngine.setup.mainCodeDir`");
		});

		const invalidSettings = [
			{
				name: "removed memory backend",
				settings: { memory: { backend: "zbrain" } },
				expected: "memory.backend",
			},
			{
				name: "unknown memory backend",
				settings: { memory: { backend: "legacy" } },
				expected: 'Unsupported `memory.backend`: "legacy". Supported values are `"files"` and `"cavemem"`',
			},
			{
				name: "removed context provider",
				settings: { contextEngine: { provider: "codescry" } },
				expected: "contextEngine.provider",
			},
			{
				name: "unknown context provider",
				settings: { contextEngine: { provider: "custom" } },
				expected:
					'Unsupported `contextEngine.provider`: "custom". Supported values are `"none"`, `"qmd"`, `"gbrain"`, and `"remote"`',
			},
		] as const;

		for (const scope of ["global", "project"] as const) {
			for (const { name, settings, expected } of invalidSettings) {
				it(`rejects ${scope} ${name}`, () => {
					const storage = new InMemorySettingsStorage();
					storage.withLock(scope, () => JSON.stringify(settings));

					const manager = SettingsManager.fromStorage(storage);
					expect(() => manager.assertNoRemovedSettings()).toThrow(expected);
				});
			}
		}

		it("fails before capability discovery or resource loading", async () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ contextEngine: { provider: "codescry" } }));
			let capabilityDiscoveryStarted = false;
			let resourceLoadingStarted = false;
			const modelRegistry = {
				discoverAnthropicCapabilities: async () => {
					capabilityDiscoveryStarted = true;
				},
			} as unknown as ModelRegistry;

			await expect(
				createAgentSessionServices({
					cwd: projectDir,
					agentDir,
					modelRegistry,
					resourceLoaderOptions: {
						extensionFactories: [
							() => {
								resourceLoadingStarted = true;
							},
						],
						noSkills: true,
						noPromptTemplates: true,
						noThemes: true,
					},
				}),
			).rejects.toThrow("contextEngine.provider");
			expect(capabilityDiscoveryStarted).toBe(false);
			expect(resourceLoadingStarted).toBe(false);
		});
	});

	describe("context compression settings", () => {
		it("should default Headroom on while leaving context compression off", () => {
			const manager = SettingsManager.create(projectDir, agentDir);
			const settings = manager.getContextEngineSettings();

			expect(settings.compression.enabled).toBe(false);
			expect(settings.compression.headroom.enabled).toBe(true);
		});

		it("persists Headroom enabled from settings UI setter", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

			const manager = SettingsManager.create(projectDir, agentDir);
			manager.setHeadroomEnabled(false);
			await manager.flush();

			expect(JSON.parse(readFileSync(settingsPath, "utf-8"))).toMatchObject({
				contextEngine: { compression: { headroom: { enabled: false } } },
			});
			expect(
				SettingsManager.create(projectDir, agentDir).getContextEngineSettings().compression.headroom.enabled,
			).toBe(false);
		});

		it("should allow Headroom to be disabled explicitly", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					contextEngine: {
						compression: {
							enabled: true,
							headroom: { enabled: false },
						},
					},
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);
			const settings = manager.getContextEngineSettings();

			expect(settings.compression.enabled).toBe(true);
			expect(settings.compression.headroom.enabled).toBe(false);
		});
	});

	describe("rtk settings", () => {
		it("should default rtk.enabled to true", () => {
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getRtkEnabled()).toBe(true);
		});

		it("should persist rtk.enabled across sessions", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getRtkEnabled()).toBe(true);

			manager.setRtkEnabled(false);
			await manager.flush();

			expect(JSON.parse(readFileSync(settingsPath, "utf-8"))).toMatchObject({
				rtk: { enabled: false },
			});

			const disabledManager = SettingsManager.create(projectDir, agentDir);
			expect(disabledManager.getRtkEnabled()).toBe(false);

			disabledManager.setRtkEnabled(true);
			await disabledManager.flush();

			expect(JSON.parse(readFileSync(settingsPath, "utf-8"))).toMatchObject({
				rtk: { enabled: true },
			});

			const enabledManager = SettingsManager.create(projectDir, agentDir);
			expect(enabledManager.getRtkEnabled()).toBe(true);
		});
	});

	describe("getSessionDir", () => {
		it("should return undefined when not set", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ theme: "dark" }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getSessionDir()).toBeUndefined();
		});

		it("should return global sessionDir", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ sessionDir: "/tmp/sessions" }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getSessionDir()).toBe("/tmp/sessions");
		});

		it("should return project sessionDir, overriding global", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ sessionDir: "/global/sessions" }));
			writeFileSync(
				join(projectDir, CONFIG_DIR_NAME, "settings.json"),
				JSON.stringify({ sessionDir: "./sessions" }),
			);
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getSessionDir()).toBe("./sessions");
		});
	});
});
