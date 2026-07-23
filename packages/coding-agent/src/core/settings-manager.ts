import type { Transport } from "@zhachory1/mewrite-ai";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import lockfile from "proper-lockfile";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.js";

export interface CompactionSettings {
	enabled?: boolean; // default: true
	reserveTokens?: number; // default: 16384
	keepRecentTokens?: number; // default: 20000
}

export interface BranchSummarySettings {
	reserveTokens?: number; // default: 16384 (tokens reserved for prompt + LLM response)
	skipPrompt?: boolean; // default: false - when true, skips "Summarize branch?" prompt and defaults to no summary
}

export interface RetrySettings {
	enabled?: boolean; // default: true
	maxRetries?: number; // default: 3
	baseDelayMs?: number; // default: 2000 (exponential backoff: 2s, 4s, 8s)
	maxDelayMs?: number; // default: 60000 (max server-requested delay before failing)
}

export interface TerminalSettings {
	showImages?: boolean; // default: true (only relevant if terminal supports images)
	clearOnShrink?: boolean; // default: false (clear empty rows when content shrinks)
}

export interface ImageSettings {
	autoResize?: boolean; // default: true (resize images to 2000x2000 max for better model compatibility)
	blockImages?: boolean; // default: false - when true, prevents all images from being sent to LLM providers
}

export interface ThinkingBudgetsSettings {
	minimal?: number;
	low?: number;
	medium?: number;
	high?: number;
}

export interface MarkdownSettings {
	codeBlockIndent?: string; // default: "  "
}

export interface CaveModeSettings {
	enabled?: boolean; // default: true
	intensity?: "lite" | "full" | "ultra"; // default: "full"
	toolCompression?: boolean; // default: true
	mlCompression?: boolean; // default: false — enables LLMLingua-2 ONNX compression
}

export interface PonytailSettings {
	enabled?: boolean; // default: true
	intensity?: "lite" | "full" | "ultra"; // default: "full"
}

export interface RtkSettings {
	enabled?: boolean; // default: true
}

export type MemoryBackend = "cavemem" | "files";

export interface MemorySettings {
	enabled?: boolean; // default: true
	backend?: MemoryBackend; // default: files
	command?: string; // cavemem command override
	capture?: {
		requirePreview?: boolean; // default: true
	};
	retrieval?: {
		enabled?: boolean; // default: true
		maxResults?: number; // default: 5
	};
}

export interface GbrainContextSettings {
	command?: string; // default: gbrain
	maxResults?: number; // default: 5
	project?: string;
	allowedPrefixes?: string[];
	disallowPrefixes?: string[];
	allowAllMemory?: boolean;
}

export interface QmdContextSettings {
	command?: string; // default: qmd
	maxResults?: number; // default: 5
	collections?: string[];
}

export interface RemoteContextRequestedScopeSettings {
	org?: string;
	team?: string;
	project?: string;
	user?: string;
}

export interface RemoteContextSettings {
	endpoint?: string;
	tokenEnv?: string; // default: MEWRITE_CONTEXT_REMOTE_TOKEN
	requestedScope?: RemoteContextRequestedScopeSettings;
	allowInsecureLocalhost?: boolean; // default: true
	maxRequestBytes?: number; // default: 65536
	maxResponseBytes?: number; // default: 524288
	maxBundleBytes?: number; // default: 16384
	maxBundles?: number; // default: 12
	failureThreshold?: number; // default: 2
	failureTtlMs?: number; // default: 30000
}

export interface HeadroomCompressionSettings {
	enabled?: boolean; // default: true when context compression is enabled
	python?: string;
	timeoutMs?: number; // default: 500
	maxInputBytes?: number; // default: 65536
	maxOutputBytes?: number; // default: 131072
}

export interface ContextCompressionSettings {
	enabled?: boolean; // default: false
	headroom?: HeadroomCompressionSettings;
}

export interface ContextSetupSettings {
	hasSeenSetupPrompt?: boolean;
	skippedAt?: string;
	mainDocsDir?: string;
}

export interface ContextEngineSettings {
	enabled?: boolean; // default: false
	provider?: string; // default: "none"
	budgetTokens?: number; // default: 4000
	timeoutMs?: number; // default: 1000
	setup?: ContextSetupSettings;
	compression?: ContextCompressionSettings;
	gbrain?: GbrainContextSettings;
	qmd?: QmdContextSettings;
	remote?: RemoteContextSettings;
}

/** First-run onboarding state (WS11). Persisted in the global settings file. */
export interface OnboardingSettings {
	hasCompletedOnboarding?: boolean; // default: false
	completedAt?: string; // ISO timestamp
	completedVersion?: string; // version string at the time of completion
}

/** Telemetry config. WS11 mandates default OFF. */
export interface TelemetrySettings {
	enabled?: boolean; // default: false (off-by-default)
}

export interface DiagnosticsSettings {
	enabled?: boolean; // default: true after first-run notice
	noticeShown?: boolean;
	noticeShownAt?: string;
	noticeShownVersion?: string;
	lastExportPath?: string;
	lastExportedAt?: string;
	wrapperMetadata?: Record<string, string | number | boolean>;
	redaction?: {
		additionalSecretKeys?: string[];
		additionalPatterns?: string[];
	};
}

/** Self-update channel. */
export type UpdateChannel = "stable" | "beta" | "canary";

export interface UpdateSettings {
	channel?: UpdateChannel; // default: "stable"
	autoCheck?: boolean; // default: true (check once per 24h)
	lastCheckedAt?: string; // ISO timestamp of last GitHub releases poll
	lastNotifiedVersion?: string; // version we last surfaced to the user
}

/**
 * Hooks settings — Claude Code v2.1.119-compatible.
 *
 * Schema source of truth: https://code.claude.com/docs/en/hooks
 * (settings.json `hooks` key).
 *
 * The structured `HooksConfig` shape lives in `core/hooks/events.ts`.
 * Here we keep the value typed as `unknown`-record so this file does not
 * import from `core/hooks/` (which would create a cycle once WS5 wires
 * skills + commands through settings) and so unknown Claude Code event
 * names are preserved verbatim for forward-compat. Use
 * `HooksRegistry.setLayer()` to validate before consumption.
 */
export type HooksSettings = Record<string, unknown>;

/**
 * Status line settings — Claude Code v2.1.119-compatible.
 *
 * Schema source of truth: https://code.claude.com/docs/en/statusline
 * (settings.json `statusLine` key).
 *
 * Shape:
 *   { type: "command" | "default" | "detailed", command?: string, padding?: number }
 *
 * Typed as `Record<string, unknown>` to avoid a settings ↔ tui import cycle
 * and to forward-compat unknown fields. Use
 * `parseStatusLineSettings` from `@zhachory1/mewrite-tui` to validate before consumption.
 */
export type StatusLineSettings = Record<string, unknown>;

export type TransportSetting = Transport;

/**
 * Package source for npm/git packages.
 * - String form: load all resources from the package
 * - Object form: filter which resources to load
 */
export type PackageSource =
	| string
	| {
			source: string;
			extensions?: string[];
			skills?: string[];
			prompts?: string[];
			themes?: string[];
	  };

export interface Settings {
	lastChangelogVersion?: string;
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	transport?: TransportSetting; // default: "sse"
	steeringMode?: "all" | "one-at-a-time";
	followUpMode?: "all" | "one-at-a-time";
	theme?: string;
	compaction?: CompactionSettings;
	branchSummary?: BranchSummarySettings;
	retry?: RetrySettings;
	hideThinkingBlock?: boolean;
	shellPath?: string; // Custom shell path (e.g., for Cygwin users on Windows)
	quietStartup?: boolean;
	quietResourceListing?: boolean; // default: true - hide Skills/Extensions/Themes/Conflicts listing at startup (keeps ASCII header)
	shellCommandPrefix?: string; // Prefix prepended to every bash command (e.g., "shopt -s expand_aliases" for alias support)
	npmCommand?: string[]; // Command used for npm package lookup/install operations, argv-style (e.g., ["mise", "exec", "node@20", "--", "npm"])
	showChangelogOnStartup?: boolean; // default: false - show changelog automatically after updates
	collapseChangelog?: boolean; // Show condensed startup changelog when showChangelogOnStartup is enabled
	packages?: PackageSource[]; // Array of npm/git package sources (string or object with filtering)
	extensions?: string[]; // Array of local extension file paths or directories
	skills?: string[]; // Array of local skill file paths or directories
	prompts?: string[]; // Array of local prompt template paths or directories
	themes?: string[]; // Array of local theme file paths or directories
	enableSkillCommands?: boolean; // default: true - register skills as /skill:name commands
	terminal?: TerminalSettings;
	images?: ImageSettings;
	enabledModels?: string[]; // Model patterns for cycling (same format as --models CLI flag)
	doubleEscapeAction?: "fork" | "tree" | "none"; // Action for double-escape with empty editor (default: "tree")
	treeFilterMode?: "default" | "no-tools" | "user-only" | "labeled-only" | "all"; // Default filter when opening /tree
	thinkingBudgets?: ThinkingBudgetsSettings; // Custom token budgets for thinking levels
	editorPaddingX?: number; // Horizontal padding for input editor (default: 0)
	autocompleteMaxVisible?: number; // Max visible items in autocomplete dropdown (default: 5)
	showHardwareCursor?: boolean; // Show terminal cursor while still positioning it for IME
	markdown?: MarkdownSettings;
	sessionDir?: string; // Custom session storage directory (same format as --session-dir CLI flag)
	caveMode?: CaveModeSettings;
	ponytail?: PonytailSettings;
	rtk?: RtkSettings;
	memory?: MemorySettings;
	contextEngine?: ContextEngineSettings;
	onboarding?: OnboardingSettings;
	telemetry?: TelemetrySettings;
	diagnostics?: DiagnosticsSettings;
	update?: UpdateSettings;
	/** Claude Code-compatible lifecycle hooks. See `core/hooks/events.ts` for shape. */
	hooks?: HooksSettings;
	/** When true, all hooks are skipped regardless of `hooks` content. */
	disableAllHooks?: boolean;
	/**
	 * Claude Code-compatible status line config (WS10). See
	 * `parseStatusLineSettings` in `@zhachory1/mewrite-tui` for the validated shape.
	 */
	statusLine?: StatusLineSettings;
	/** Pinned models surfaced at the top of the model picker. */
	favoriteModels?: ModelRef[];
	/** Most-recently selected models, capped to a small N (LRU). */
	recentModels?: ModelRef[];
	/**
	 * OPT-IN approval mode (#14). When true, writes/bash/destructive/unknown tool
	 * calls require interactive human approval before running; reads run free.
	 * Default false (autopilot — the documented default — stays unchanged).
	 *
	 * This is ORTHOGONAL to chat mode (plan/edit/auto): it composes with them and
	 * is NOT a 4th ChatMode value. It is a "human-review speed-bump", NOT a
	 * security perimeter (real containment = enforced sandbox, #46).
	 */
	approvalMode?: boolean;
}

export interface ModelRef {
	provider: string;
	id: string;
}

function dedupeModelRefs(refs: ModelRef[]): ModelRef[] {
	const seen = new Set<string>();
	const out: ModelRef[] = [];
	for (const ref of refs) {
		const key = `${ref.provider}/${ref.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ provider: ref.provider, id: ref.id });
	}
	return out;
}

/** Deep merge settings: project/overrides take precedence, nested objects merge recursively */
function deepMergeSettings(base: Settings, overrides: Settings): Settings {
	const result: Settings = { ...base };

	for (const key of Object.keys(overrides) as (keyof Settings)[]) {
		const overrideValue = overrides[key];
		const baseValue = base[key];

		if (overrideValue === undefined) {
			continue;
		}

		// For nested objects, merge recursively
		if (
			typeof overrideValue === "object" &&
			overrideValue !== null &&
			!Array.isArray(overrideValue) &&
			typeof baseValue === "object" &&
			baseValue !== null &&
			!Array.isArray(baseValue)
		) {
			(result as Record<string, unknown>)[key] = { ...baseValue, ...overrideValue };
		} else {
			// For primitives and arrays, override value wins
			(result as Record<string, unknown>)[key] = overrideValue;
		}
	}

	return result;
}

export type SettingsScope = "global" | "project";

export interface SettingsStorage {
	withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void;
}

export interface SettingsError {
	scope: SettingsScope;
	error: Error;
}

export class RemovedSettingsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RemovedSettingsError";
	}
}

export class FileSettingsStorage implements SettingsStorage {
	private globalSettingsPath: string;
	private projectSettingsPath: string;

	constructor(cwd: string = process.cwd(), agentDir: string = getAgentDir()) {
		this.globalSettingsPath = join(agentDir, "settings.json");
		this.projectSettingsPath = join(cwd, CONFIG_DIR_NAME, "settings.json");
	}

	private acquireLockSyncWithRetry(path: string): () => void {
		const maxAttempts = 10;
		const delayMs = 20;
		let lastError: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				return lockfile.lockSync(path, { realpath: false });
			} catch (error) {
				const code =
					typeof error === "object" && error !== null && "code" in error
						? String((error as { code?: unknown }).code)
						: undefined;
				if (code !== "ELOCKED" || attempt === maxAttempts) {
					throw error;
				}
				lastError = error;
				const start = Date.now();
				while (Date.now() - start < delayMs) {
					// Sleep synchronously to avoid changing callers to async.
				}
			}
		}

		throw (lastError as Error) ?? new Error("Failed to acquire settings lock");
	}

	withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
		const path = scope === "global" ? this.globalSettingsPath : this.projectSettingsPath;
		const dir = dirname(path);

		let release: (() => void) | undefined;
		try {
			// Only create directory and lock if file exists or we need to write
			const fileExists = existsSync(path);
			if (fileExists) {
				release = this.acquireLockSyncWithRetry(path);
			}
			const current = fileExists ? readFileSync(path, "utf-8") : undefined;
			const next = fn(current);
			if (next !== undefined) {
				// Only create directory when we actually need to write
				if (!existsSync(dir)) {
					mkdirSync(dir, { recursive: true });
				}
				if (!release) {
					release = this.acquireLockSyncWithRetry(path);
				}
				writeFileSync(path, next, "utf-8");
			}
		} finally {
			if (release) {
				release();
			}
		}
	}
}

export class InMemorySettingsStorage implements SettingsStorage {
	private global: string | undefined;
	private project: string | undefined;

	withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
		const current = scope === "global" ? this.global : this.project;
		const next = fn(current);
		if (next !== undefined) {
			if (scope === "global") {
				this.global = next;
			} else {
				this.project = next;
			}
		}
	}
}

export class SettingsManager {
	private storage: SettingsStorage;
	private globalSettings: Settings;
	private projectSettings: Settings;
	private settings: Settings;
	private modifiedFields = new Set<keyof Settings>(); // Track global fields modified during session
	private modifiedNestedFields = new Map<keyof Settings, Set<string>>(); // Track global nested field modifications
	private modifiedProjectFields = new Set<keyof Settings>(); // Track project fields modified during session
	private modifiedProjectNestedFields = new Map<keyof Settings, Set<string>>(); // Track project nested field modifications
	private globalSettingsLoadError: Error | null = null; // Track if global settings file had parse errors
	private projectSettingsLoadError: Error | null = null; // Track if project settings file had parse errors
	private writeQueue: Promise<void> = Promise.resolve();
	private errors: SettingsError[];

	private constructor(
		storage: SettingsStorage,
		initialGlobal: Settings,
		initialProject: Settings,
		globalLoadError: Error | null = null,
		projectLoadError: Error | null = null,
		initialErrors: SettingsError[] = [],
	) {
		this.storage = storage;
		this.globalSettings = initialGlobal;
		this.projectSettings = initialProject;
		this.globalSettingsLoadError = globalLoadError;
		this.projectSettingsLoadError = projectLoadError;
		this.errors = [...initialErrors];
		this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
	}

	/** Create a SettingsManager that loads from files */
	static create(cwd: string = process.cwd(), agentDir: string = getAgentDir()): SettingsManager {
		const storage = new FileSettingsStorage(cwd, agentDir);
		return SettingsManager.fromStorage(storage);
	}

	/** Create a SettingsManager from an arbitrary storage backend */
	static fromStorage(storage: SettingsStorage): SettingsManager {
		const globalLoad = SettingsManager.tryLoadFromStorage(storage, "global");
		const projectLoad = SettingsManager.tryLoadFromStorage(storage, "project");
		const initialErrors: SettingsError[] = [];
		if (globalLoad.error) {
			initialErrors.push({ scope: "global", error: globalLoad.error });
		}
		if (projectLoad.error) {
			initialErrors.push({ scope: "project", error: projectLoad.error });
		}

		return new SettingsManager(
			storage,
			globalLoad.settings,
			projectLoad.settings,
			globalLoad.error,
			projectLoad.error,
			initialErrors,
		);
	}

	/** Create an in-memory SettingsManager (no file I/O) */
	static inMemory(settings: Partial<Settings> = {}): SettingsManager {
		const storage = new InMemorySettingsStorage();
		return new SettingsManager(storage, settings, {});
	}

	private static loadFromStorage(storage: SettingsStorage, scope: SettingsScope): Settings {
		let content: string | undefined;
		storage.withLock(scope, (current) => {
			content = current;
			return undefined;
		});

		if (!content) {
			return {};
		}
		const settings = JSON.parse(content);
		return SettingsManager.migrateSettings(settings);
	}

	private static tryLoadFromStorage(
		storage: SettingsStorage,
		scope: SettingsScope,
	): { settings: Settings; error: Error | null } {
		try {
			return { settings: SettingsManager.loadFromStorage(storage, scope), error: null };
		} catch (error) {
			return { settings: {}, error: error as Error };
		}
	}

	/** Migrate old settings format to new format */
	private static migrateSettings(settings: Record<string, unknown>): Settings {
		SettingsManager.throwForRemovedSettings(settings);

		// Migrate queueMode -> steeringMode
		if ("queueMode" in settings && !("steeringMode" in settings)) {
			settings.steeringMode = settings.queueMode;
			delete settings.queueMode;
		}

		// Migrate legacy websockets boolean -> transport enum
		if (!("transport" in settings) && typeof settings.websockets === "boolean") {
			settings.transport = settings.websockets ? "websocket" : "sse";
			delete settings.websockets;
		}

		// Migrate old skills object format to new array format
		if (
			"skills" in settings &&
			typeof settings.skills === "object" &&
			settings.skills !== null &&
			!Array.isArray(settings.skills)
		) {
			const skillsSettings = settings.skills as {
				enableSkillCommands?: boolean;
				customDirectories?: unknown;
			};
			if (skillsSettings.enableSkillCommands !== undefined && settings.enableSkillCommands === undefined) {
				settings.enableSkillCommands = skillsSettings.enableSkillCommands;
			}
			if (Array.isArray(skillsSettings.customDirectories) && skillsSettings.customDirectories.length > 0) {
				settings.skills = skillsSettings.customDirectories;
			} else {
				delete settings.skills;
			}
		}

		return settings as Settings;
	}

	private static throwForRemovedSettings(settings: Record<string, unknown>): void {
		const memory = settings.memory;
		const contextEngine = settings.contextEngine;
		const messages: string[] = [];
		if (memory && typeof memory === "object") {
			const value = memory as Record<string, unknown>;
			if (value.backend === "zbrain") {
				messages.push(
					'Replace `memory.backend: "zbrain"` with `memory.backend: "files"` (default) or `"cavemem"`.',
				);
			} else if ("backend" in value && value.backend !== "files" && value.backend !== "cavemem") {
				messages.push(
					`Unsupported \`memory.backend\`: ${JSON.stringify(value.backend)}. Supported values are \`"files"\` and \`"cavemem"\`; replace it with one of them.`,
				);
			}
			if ("workspace" in value) {
				messages.push("Remove `memory.workspace`; Files memory is stored in `.mewrite/memory`.");
			}
			if (value.capture && typeof value.capture === "object" && "defaultCollection" in value.capture) {
				messages.push("Remove `memory.capture.defaultCollection`; Files memory has no collections.");
			}
		}
		if (contextEngine && typeof contextEngine === "object") {
			const value = contextEngine as Record<string, unknown>;
			if (value.provider === "codescry" || value.provider === "repo-index" || value.provider === "stack") {
				messages.push(
					'Replace `contextEngine.provider` with `"none"`, `"qmd"`, `"gbrain"`, or `"remote"`; Codescry, repo-index, and stack were removed.',
				);
			} else if (
				"provider" in value &&
				value.provider !== "none" &&
				value.provider !== "qmd" &&
				value.provider !== "gbrain" &&
				value.provider !== "remote"
			) {
				messages.push(
					`Unsupported \`contextEngine.provider\`: ${JSON.stringify(value.provider)}. Supported values are \`"none"\`, \`"qmd"\`, \`"gbrain"\`, and \`"remote"\`; replace it with one of them.`,
				);
			}
			if ("repoIndex" in value) {
				messages.push("Remove `contextEngine.repoIndex`; Codescry configuration is no longer supported.");
			}
			const setup = value.setup;
			if (setup && typeof setup === "object" && "mainCodeDir" in setup) {
				messages.push(
					"Remove `contextEngine.setup.mainCodeDir`; `/context setup docs-dir <path>` configures QMD only.",
				);
			}
		}
		if (messages.length > 0) {
			throw new RemovedSettingsError(`Removed settings detected. ${messages.join(" ")}`);
		}
	}

	assertNoRemovedSettings(): void {
		const error = [this.globalSettingsLoadError, this.projectSettingsLoadError].find(
			(value): value is RemovedSettingsError => value instanceof RemovedSettingsError,
		);
		if (error) throw error;
	}

	getGlobalSettings(): Settings {
		return structuredClone(this.globalSettings);
	}

	getProjectSettings(): Settings {
		return structuredClone(this.projectSettings);
	}

	async reload(): Promise<void> {
		await this.writeQueue;
		const globalLoad = SettingsManager.tryLoadFromStorage(this.storage, "global");
		if (!globalLoad.error) {
			this.globalSettings = globalLoad.settings;
			this.globalSettingsLoadError = null;
		} else {
			this.globalSettingsLoadError = globalLoad.error;
			this.recordError("global", globalLoad.error);
		}

		this.modifiedFields.clear();
		this.modifiedNestedFields.clear();
		this.modifiedProjectFields.clear();
		this.modifiedProjectNestedFields.clear();

		const projectLoad = SettingsManager.tryLoadFromStorage(this.storage, "project");
		if (!projectLoad.error) {
			this.projectSettings = projectLoad.settings;
			this.projectSettingsLoadError = null;
		} else {
			this.projectSettingsLoadError = projectLoad.error;
			this.recordError("project", projectLoad.error);
		}

		this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
	}

	/** Apply additional overrides on top of current settings */
	applyOverrides(overrides: Partial<Settings>): void {
		this.settings = deepMergeSettings(this.settings, overrides);
	}

	/** Mark a global field as modified during this session */
	private markModified(field: keyof Settings, nestedKey?: string): void {
		this.modifiedFields.add(field);
		if (nestedKey) {
			if (!this.modifiedNestedFields.has(field)) {
				this.modifiedNestedFields.set(field, new Set());
			}
			this.modifiedNestedFields.get(field)!.add(nestedKey);
		}
	}

	/** Mark a project field as modified during this session */
	private markProjectModified(field: keyof Settings, nestedKey?: string): void {
		this.modifiedProjectFields.add(field);
		if (nestedKey) {
			if (!this.modifiedProjectNestedFields.has(field)) {
				this.modifiedProjectNestedFields.set(field, new Set());
			}
			this.modifiedProjectNestedFields.get(field)!.add(nestedKey);
		}
	}

	private recordError(scope: SettingsScope, error: unknown): void {
		const normalizedError = error instanceof Error ? error : new Error(String(error));
		this.errors.push({ scope, error: normalizedError });
	}

	private clearModifiedScope(scope: SettingsScope): void {
		if (scope === "global") {
			this.modifiedFields.clear();
			this.modifiedNestedFields.clear();
			return;
		}

		this.modifiedProjectFields.clear();
		this.modifiedProjectNestedFields.clear();
	}

	private enqueueWrite(scope: SettingsScope, task: () => void): void {
		this.writeQueue = this.writeQueue
			.then(() => {
				task();
				this.clearModifiedScope(scope);
			})
			.catch((error) => {
				this.recordError(scope, error);
			});
	}

	private cloneModifiedNestedFields(source: Map<keyof Settings, Set<string>>): Map<keyof Settings, Set<string>> {
		const snapshot = new Map<keyof Settings, Set<string>>();
		for (const [key, value] of source.entries()) {
			snapshot.set(key, new Set(value));
		}
		return snapshot;
	}

	private persistScopedSettings(
		scope: SettingsScope,
		snapshotSettings: Settings,
		modifiedFields: Set<keyof Settings>,
		modifiedNestedFields: Map<keyof Settings, Set<string>>,
	): void {
		this.storage.withLock(scope, (current) => {
			const currentFileSettings = current
				? SettingsManager.migrateSettings(JSON.parse(current) as Record<string, unknown>)
				: {};
			const mergedSettings: Settings = { ...currentFileSettings };
			for (const field of modifiedFields) {
				const value = snapshotSettings[field];
				if (modifiedNestedFields.has(field) && typeof value === "object" && value !== null) {
					const nestedModified = modifiedNestedFields.get(field)!;
					const baseNested = (currentFileSettings[field] as Record<string, unknown>) ?? {};
					const inMemoryNested = value as Record<string, unknown>;
					const mergedNested = { ...baseNested };
					for (const nestedKey of nestedModified) {
						mergedNested[nestedKey] = inMemoryNested[nestedKey];
					}
					(mergedSettings as Record<string, unknown>)[field] = mergedNested;
				} else {
					(mergedSettings as Record<string, unknown>)[field] = value;
				}
			}

			return JSON.stringify(mergedSettings, null, 2);
		});
	}

	private save(): void {
		this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);

		if (this.globalSettingsLoadError) {
			return;
		}

		const snapshotGlobalSettings = structuredClone(this.globalSettings);
		const modifiedFields = new Set(this.modifiedFields);
		const modifiedNestedFields = this.cloneModifiedNestedFields(this.modifiedNestedFields);

		this.enqueueWrite("global", () => {
			this.persistScopedSettings("global", snapshotGlobalSettings, modifiedFields, modifiedNestedFields);
		});
	}

	private saveProjectSettings(settings: Settings): void {
		this.projectSettings = structuredClone(settings);
		this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);

		if (this.projectSettingsLoadError) {
			return;
		}

		const snapshotProjectSettings = structuredClone(this.projectSettings);
		const modifiedFields = new Set(this.modifiedProjectFields);
		const modifiedNestedFields = this.cloneModifiedNestedFields(this.modifiedProjectNestedFields);
		this.enqueueWrite("project", () => {
			this.persistScopedSettings("project", snapshotProjectSettings, modifiedFields, modifiedNestedFields);
		});
	}

	async flush(): Promise<void> {
		await this.writeQueue;
	}

	drainErrors(): SettingsError[] {
		const drained = [...this.errors];
		this.errors = [];
		return drained;
	}

	getLastChangelogVersion(): string | undefined {
		return this.settings.lastChangelogVersion;
	}

	setLastChangelogVersion(version: string): void {
		this.globalSettings.lastChangelogVersion = version;
		this.markModified("lastChangelogVersion");
		this.save();
	}

	getSessionDir(): string | undefined {
		return this.settings.sessionDir;
	}

	getDefaultProvider(): string | undefined {
		return this.settings.defaultProvider;
	}

	getDefaultModel(): string | undefined {
		return this.settings.defaultModel;
	}

	setDefaultProvider(provider: string): void {
		this.globalSettings.defaultProvider = provider;
		this.markModified("defaultProvider");
		this.save();
	}

	setDefaultModel(modelId: string): void {
		this.globalSettings.defaultModel = modelId;
		this.markModified("defaultModel");
		this.save();
	}

	setDefaultModelAndProvider(provider: string, modelId: string): void {
		this.globalSettings.defaultProvider = provider;
		this.globalSettings.defaultModel = modelId;
		this.markModified("defaultProvider");
		this.markModified("defaultModel");
		this.save();
	}

	getFavoriteModels(): ModelRef[] {
		return [...(this.settings.favoriteModels ?? [])];
	}

	setFavoriteModels(refs: ModelRef[]): void {
		this.globalSettings.favoriteModels = dedupeModelRefs(refs);
		this.markModified("favoriteModels");
		this.save();
	}

	toggleFavoriteModel(provider: string, modelId: string): boolean {
		const current = this.getFavoriteModels();
		const index = current.findIndex((r) => r.provider === provider && r.id === modelId);
		if (index >= 0) {
			current.splice(index, 1);
			this.setFavoriteModels(current);
			return false;
		}
		current.push({ provider, id: modelId });
		this.setFavoriteModels(current);
		return true;
	}

	getRecentModels(): ModelRef[] {
		return [...(this.settings.recentModels ?? [])];
	}

	pushRecentModel(provider: string, modelId: string, cap: number = 5): void {
		const previous = this.getRecentModels();
		const filtered = previous.filter((r) => !(r.provider === provider && r.id === modelId));
		filtered.unshift({ provider, id: modelId });
		const capped = filtered.slice(0, Math.max(1, cap));
		this.globalSettings.recentModels = capped;
		this.markModified("recentModels");
		this.save();
	}

	getSteeringMode(): "all" | "one-at-a-time" {
		return this.settings.steeringMode || "one-at-a-time";
	}

	setSteeringMode(mode: "all" | "one-at-a-time"): void {
		this.globalSettings.steeringMode = mode;
		this.markModified("steeringMode");
		this.save();
	}

	getFollowUpMode(): "all" | "one-at-a-time" {
		return this.settings.followUpMode || "one-at-a-time";
	}

	setFollowUpMode(mode: "all" | "one-at-a-time"): void {
		this.globalSettings.followUpMode = mode;
		this.markModified("followUpMode");
		this.save();
	}

	getTheme(): string | undefined {
		return this.settings.theme;
	}

	setTheme(theme: string): void {
		this.globalSettings.theme = theme;
		this.markModified("theme");
		this.save();
	}

	getDefaultThinkingLevel(): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined {
		return this.settings.defaultThinkingLevel;
	}

	setDefaultThinkingLevel(level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"): void {
		this.globalSettings.defaultThinkingLevel = level;
		this.markModified("defaultThinkingLevel");
		this.save();
	}

	getTransport(): TransportSetting {
		return this.settings.transport ?? "sse";
	}

	setTransport(transport: TransportSetting): void {
		this.globalSettings.transport = transport;
		this.markModified("transport");
		this.save();
	}

	getCompactionEnabled(): boolean {
		return this.settings.compaction?.enabled ?? true;
	}

	setCompactionEnabled(enabled: boolean): void {
		if (!this.globalSettings.compaction) {
			this.globalSettings.compaction = {};
		}
		this.globalSettings.compaction.enabled = enabled;
		this.markModified("compaction", "enabled");
		this.save();
	}

	getCompactionReserveTokens(): number {
		return this.settings.compaction?.reserveTokens ?? 16384;
	}

	getCompactionKeepRecentTokens(): number {
		return this.settings.compaction?.keepRecentTokens ?? 20000;
	}

	getCompactionSettings(): { enabled: boolean; reserveTokens: number; keepRecentTokens: number } {
		return {
			enabled: this.getCompactionEnabled(),
			reserveTokens: this.getCompactionReserveTokens(),
			keepRecentTokens: this.getCompactionKeepRecentTokens(),
		};
	}

	getBranchSummarySettings(): { reserveTokens: number; skipPrompt: boolean } {
		return {
			reserveTokens: this.settings.branchSummary?.reserveTokens ?? 16384,
			skipPrompt: this.settings.branchSummary?.skipPrompt ?? false,
		};
	}

	getBranchSummarySkipPrompt(): boolean {
		return this.settings.branchSummary?.skipPrompt ?? false;
	}

	getRetryEnabled(): boolean {
		return this.settings.retry?.enabled ?? true;
	}

	setRetryEnabled(enabled: boolean): void {
		if (!this.globalSettings.retry) {
			this.globalSettings.retry = {};
		}
		this.globalSettings.retry.enabled = enabled;
		this.markModified("retry", "enabled");
		this.save();
	}

	getRetrySettings(): { enabled: boolean; maxRetries: number; baseDelayMs: number; maxDelayMs: number } {
		return {
			enabled: this.getRetryEnabled(),
			maxRetries: this.settings.retry?.maxRetries ?? 3,
			baseDelayMs: this.settings.retry?.baseDelayMs ?? 2000,
			maxDelayMs: this.settings.retry?.maxDelayMs ?? 60000,
		};
	}

	getHideThinkingBlock(): boolean {
		return this.settings.hideThinkingBlock ?? false;
	}

	setHideThinkingBlock(hide: boolean): void {
		this.globalSettings.hideThinkingBlock = hide;
		this.markModified("hideThinkingBlock");
		this.save();
	}

	getShellPath(): string | undefined {
		return this.settings.shellPath;
	}

	setShellPath(path: string | undefined): void {
		this.globalSettings.shellPath = path;
		this.markModified("shellPath");
		this.save();
	}

	getQuietStartup(): boolean {
		return this.settings.quietStartup ?? false;
	}

	setQuietStartup(quiet: boolean): void {
		this.globalSettings.quietStartup = quiet;
		this.markModified("quietStartup");
		this.save();
	}

	getQuietResourceListing(): boolean {
		return this.settings.quietResourceListing ?? true;
	}

	setQuietResourceListing(quiet: boolean): void {
		this.globalSettings.quietResourceListing = quiet;
		this.markModified("quietResourceListing");
		this.save();
	}

	getShellCommandPrefix(): string | undefined {
		return this.settings.shellCommandPrefix;
	}

	setShellCommandPrefix(prefix: string | undefined): void {
		this.globalSettings.shellCommandPrefix = prefix;
		this.markModified("shellCommandPrefix");
		this.save();
	}

	getNpmCommand(): string[] | undefined {
		return this.settings.npmCommand ? [...this.settings.npmCommand] : undefined;
	}

	setNpmCommand(command: string[] | undefined): void {
		this.globalSettings.npmCommand = command ? [...command] : undefined;
		this.markModified("npmCommand");
		this.save();
	}

	getShowChangelogOnStartup(): boolean {
		return this.settings.showChangelogOnStartup ?? false;
	}

	setShowChangelogOnStartup(show: boolean): void {
		this.globalSettings.showChangelogOnStartup = show;
		this.markModified("showChangelogOnStartup");
		this.save();
	}

	getCollapseChangelog(): boolean {
		return this.settings.collapseChangelog ?? false;
	}

	setCollapseChangelog(collapse: boolean): void {
		this.globalSettings.collapseChangelog = collapse;
		this.markModified("collapseChangelog");
		this.save();
	}

	getPackages(): PackageSource[] {
		return [...(this.settings.packages ?? [])];
	}

	setPackages(packages: PackageSource[]): void {
		this.globalSettings.packages = packages;
		this.markModified("packages");
		this.save();
	}

	setProjectPackages(packages: PackageSource[]): void {
		const projectSettings = structuredClone(this.projectSettings);
		projectSettings.packages = packages;
		this.markProjectModified("packages");
		this.saveProjectSettings(projectSettings);
	}

	getExtensionPaths(): string[] {
		return [...(this.settings.extensions ?? [])];
	}

	setExtensionPaths(paths: string[]): void {
		this.globalSettings.extensions = paths;
		this.markModified("extensions");
		this.save();
	}

	setProjectExtensionPaths(paths: string[]): void {
		const projectSettings = structuredClone(this.projectSettings);
		projectSettings.extensions = paths;
		this.markProjectModified("extensions");
		this.saveProjectSettings(projectSettings);
	}

	getSkillPaths(): string[] {
		return [...(this.settings.skills ?? [])];
	}

	setSkillPaths(paths: string[]): void {
		this.globalSettings.skills = paths;
		this.markModified("skills");
		this.save();
	}

	setProjectSkillPaths(paths: string[]): void {
		const projectSettings = structuredClone(this.projectSettings);
		projectSettings.skills = paths;
		this.markProjectModified("skills");
		this.saveProjectSettings(projectSettings);
	}

	getPromptTemplatePaths(): string[] {
		return [...(this.settings.prompts ?? [])];
	}

	setPromptTemplatePaths(paths: string[]): void {
		this.globalSettings.prompts = paths;
		this.markModified("prompts");
		this.save();
	}

	setProjectPromptTemplatePaths(paths: string[]): void {
		const projectSettings = structuredClone(this.projectSettings);
		projectSettings.prompts = paths;
		this.markProjectModified("prompts");
		this.saveProjectSettings(projectSettings);
	}

	getThemePaths(): string[] {
		return [...(this.settings.themes ?? [])];
	}

	setThemePaths(paths: string[]): void {
		this.globalSettings.themes = paths;
		this.markModified("themes");
		this.save();
	}

	setProjectThemePaths(paths: string[]): void {
		const projectSettings = structuredClone(this.projectSettings);
		projectSettings.themes = paths;
		this.markProjectModified("themes");
		this.saveProjectSettings(projectSettings);
	}

	getEnableSkillCommands(): boolean {
		return this.settings.enableSkillCommands ?? true;
	}

	setEnableSkillCommands(enabled: boolean): void {
		this.globalSettings.enableSkillCommands = enabled;
		this.markModified("enableSkillCommands");
		this.save();
	}

	getThinkingBudgets(): ThinkingBudgetsSettings | undefined {
		return this.settings.thinkingBudgets;
	}

	getShowImages(): boolean {
		return this.settings.terminal?.showImages ?? true;
	}

	setShowImages(show: boolean): void {
		if (!this.globalSettings.terminal) {
			this.globalSettings.terminal = {};
		}
		this.globalSettings.terminal.showImages = show;
		this.markModified("terminal", "showImages");
		this.save();
	}

	getClearOnShrink(): boolean {
		// Settings takes precedence, then env var, then default false
		if (this.settings.terminal?.clearOnShrink !== undefined) {
			return this.settings.terminal.clearOnShrink;
		}
		return process.env.PI_CLEAR_ON_SHRINK === "1";
	}

	setClearOnShrink(enabled: boolean): void {
		if (!this.globalSettings.terminal) {
			this.globalSettings.terminal = {};
		}
		this.globalSettings.terminal.clearOnShrink = enabled;
		this.markModified("terminal", "clearOnShrink");
		this.save();
	}

	getImageAutoResize(): boolean {
		return this.settings.images?.autoResize ?? true;
	}

	setImageAutoResize(enabled: boolean): void {
		if (!this.globalSettings.images) {
			this.globalSettings.images = {};
		}
		this.globalSettings.images.autoResize = enabled;
		this.markModified("images", "autoResize");
		this.save();
	}

	getBlockImages(): boolean {
		return this.settings.images?.blockImages ?? false;
	}

	setBlockImages(blocked: boolean): void {
		if (!this.globalSettings.images) {
			this.globalSettings.images = {};
		}
		this.globalSettings.images.blockImages = blocked;
		this.markModified("images", "blockImages");
		this.save();
	}

	getEnabledModels(): string[] | undefined {
		return this.settings.enabledModels;
	}

	setEnabledModels(patterns: string[] | undefined): void {
		this.globalSettings.enabledModels = patterns;
		this.markModified("enabledModels");
		this.save();
	}

	getDoubleEscapeAction(): "fork" | "tree" | "none" {
		return this.settings.doubleEscapeAction ?? "tree";
	}

	setDoubleEscapeAction(action: "fork" | "tree" | "none"): void {
		this.globalSettings.doubleEscapeAction = action;
		this.markModified("doubleEscapeAction");
		this.save();
	}

	getTreeFilterMode(): "default" | "no-tools" | "user-only" | "labeled-only" | "all" {
		const mode = this.settings.treeFilterMode;
		const valid = ["default", "no-tools", "user-only", "labeled-only", "all"];
		return mode && valid.includes(mode) ? mode : "default";
	}

	setTreeFilterMode(mode: "default" | "no-tools" | "user-only" | "labeled-only" | "all"): void {
		this.globalSettings.treeFilterMode = mode;
		this.markModified("treeFilterMode");
		this.save();
	}

	getShowHardwareCursor(): boolean {
		return this.settings.showHardwareCursor ?? process.env.PI_HARDWARE_CURSOR === "1";
	}

	setShowHardwareCursor(enabled: boolean): void {
		this.globalSettings.showHardwareCursor = enabled;
		this.markModified("showHardwareCursor");
		this.save();
	}

	getEditorPaddingX(): number {
		return this.settings.editorPaddingX ?? 0;
	}

	setEditorPaddingX(padding: number): void {
		this.globalSettings.editorPaddingX = Math.max(0, Math.min(3, Math.floor(padding)));
		this.markModified("editorPaddingX");
		this.save();
	}

	getAutocompleteMaxVisible(): number {
		return this.settings.autocompleteMaxVisible ?? 5;
	}

	setAutocompleteMaxVisible(maxVisible: number): void {
		this.globalSettings.autocompleteMaxVisible = Math.max(3, Math.min(20, Math.floor(maxVisible)));
		this.markModified("autocompleteMaxVisible");
		this.save();
	}

	getCodeBlockIndent(): string {
		return this.settings.markdown?.codeBlockIndent ?? "  ";
	}

	getCaveModeEnabled(): boolean {
		return this.settings.caveMode?.enabled ?? true;
	}

	setCaveModeEnabled(enabled: boolean): void {
		if (!this.globalSettings.caveMode) {
			this.globalSettings.caveMode = {};
		}
		this.globalSettings.caveMode.enabled = enabled;
		this.markModified("caveMode", "enabled");
		this.save();
	}

	getCaveModeIntensity(): "lite" | "full" | "ultra" {
		return this.settings.caveMode?.intensity ?? "full";
	}

	setCaveModeIntensity(intensity: "lite" | "full" | "ultra"): void {
		if (!this.globalSettings.caveMode) {
			this.globalSettings.caveMode = {};
		}
		this.globalSettings.caveMode.intensity = intensity;
		this.markModified("caveMode", "intensity");
		this.save();
	}

	getCaveModeToolCompression(): boolean {
		return this.settings.caveMode?.toolCompression ?? true;
	}

	setCaveModeToolCompression(enabled: boolean): void {
		if (!this.globalSettings.caveMode) {
			this.globalSettings.caveMode = {};
		}
		this.globalSettings.caveMode.toolCompression = enabled;
		this.markModified("caveMode", "toolCompression");
		this.save();
	}

	getCaveModeMLCompression(): boolean {
		return this.settings.caveMode?.mlCompression ?? false;
	}

	setCaveModeMLCompression(enabled: boolean): void {
		if (!this.globalSettings.caveMode) {
			this.globalSettings.caveMode = {};
		}
		this.globalSettings.caveMode.mlCompression = enabled;
		this.markModified("caveMode", "mlCompression");
		this.save();
	}

	getCaveModeSettings(): {
		enabled: boolean;
		intensity: "lite" | "full" | "ultra";
		toolCompression: boolean;
		mlCompression: boolean;
	} {
		return {
			enabled: this.getCaveModeEnabled(),
			intensity: this.getCaveModeIntensity(),
			toolCompression: this.getCaveModeToolCompression(),
			mlCompression: this.getCaveModeMLCompression(),
		};
	}

	getPonytailEnabled(): boolean {
		return this.settings.ponytail?.enabled ?? true;
	}

	setPonytailEnabled(enabled: boolean): void {
		if (!this.globalSettings.ponytail) {
			this.globalSettings.ponytail = {};
		}
		this.globalSettings.ponytail.enabled = enabled;
		this.markModified("ponytail", "enabled");
		this.save();
	}

	getPonytailIntensity(): "lite" | "full" | "ultra" {
		return this.settings.ponytail?.intensity ?? "full";
	}

	setPonytailIntensity(intensity: "lite" | "full" | "ultra"): void {
		if (!this.globalSettings.ponytail) {
			this.globalSettings.ponytail = {};
		}
		this.globalSettings.ponytail.intensity = intensity;
		this.markModified("ponytail", "intensity");
		this.save();
	}

	getPonytailSettings(): { enabled: boolean; intensity: "lite" | "full" | "ultra" } {
		return {
			enabled: this.getPonytailEnabled(),
			intensity: this.getPonytailIntensity(),
		};
	}

	/**
	 * OPT-IN approval mode (#14). Resolution order: explicit setting wins; if
	 * unset, the `CAVE_APPROVAL_MODE` env var (truthy "1"/"true") enables it; else
	 * false. The env path lets a guarded parent process force approval into
	 * spawned subagents (which inherit env) without writing to disk.
	 *
	 * Honest framing: this forces human review of writes/bash — it is NOT a
	 * security perimeter. See #46 for the enforced sandbox.
	 */
	getApprovalMode(): boolean {
		if (this.settings.approvalMode !== undefined) {
			return this.settings.approvalMode;
		}
		const env = process.env.CAVE_APPROVAL_MODE;
		return env === "1" || env === "true";
	}

	setApprovalMode(enabled: boolean): void {
		this.globalSettings.approvalMode = enabled;
		this.markModified("approvalMode");
		this.save();
		// Mirror into the process env so subagents spawned by this process (whose
		// childEnv spreads process.env) inherit the guard unconditionally (#14;
		// ties #41). A runtime `/approval on` toggle must propagate to children.
		if (enabled) {
			process.env.CAVE_APPROVAL_MODE = "1";
		} else {
			delete process.env.CAVE_APPROVAL_MODE;
		}
	}

	getRtkEnabled(): boolean {
		return this.settings.rtk?.enabled ?? true;
	}

	setRtkEnabled(enabled: boolean): void {
		if (!this.globalSettings.rtk) {
			this.globalSettings.rtk = {};
		}
		this.globalSettings.rtk.enabled = enabled;
		this.markModified("rtk", "enabled");
		this.save();
	}

	getMemorySettings(): {
		enabled: boolean;
		backend: MemoryBackend;
		command?: string;
		capture: { requirePreview: boolean };
		retrieval: { enabled: boolean; maxResults: number };
	} {
		const backend = this.settings.memory?.backend ?? "files";
		return {
			enabled: this.settings.memory?.enabled ?? true,
			backend,
			command: this.settings.memory?.command,
			capture: {
				requirePreview: this.settings.memory?.capture?.requirePreview ?? true,
			},
			retrieval: {
				enabled: this.settings.memory?.retrieval?.enabled ?? true,
				maxResults: this.settings.memory?.retrieval?.maxResults ?? 5,
			},
		};
	}

	getContextSetupSettings(): {
		hasSeenSetupPrompt: boolean;
		skippedAt?: string;
		mainDocsDir?: string;
	} {
		return {
			hasSeenSetupPrompt: this.settings.contextEngine?.setup?.hasSeenSetupPrompt ?? false,
			skippedAt: this.settings.contextEngine?.setup?.skippedAt,
			mainDocsDir: this.settings.contextEngine?.setup?.mainDocsDir,
		};
	}

	setContextSetupSettings(setup: Partial<ContextSetupSettings>): void {
		if (!this.globalSettings.contextEngine) this.globalSettings.contextEngine = {};
		this.globalSettings.contextEngine.setup = {
			...this.settings.contextEngine?.setup,
			...setup,
		};
		this.markModified("contextEngine", "setup");
		this.save();
	}

	setHeadroomEnabled(enabled: boolean): void {
		if (!this.globalSettings.contextEngine) this.globalSettings.contextEngine = {};
		this.globalSettings.contextEngine.compression = {
			...this.settings.contextEngine?.compression,
			headroom: {
				...this.settings.contextEngine?.compression?.headroom,
				enabled,
			},
		};
		this.markModified("contextEngine", "compression");
		this.save();
	}

	getContextEngineSettings(): {
		enabled: boolean;
		provider: string;
		budgetTokens: number;
		timeoutMs: number;
		compression: {
			enabled: boolean;
			headroom: {
				enabled: boolean;
				python?: string;
				timeoutMs: number;
				maxInputBytes: number;
				maxOutputBytes: number;
			};
		};
		gbrain: {
			command: string;
			maxResults: number;
			project?: string;
			allowedPrefixes: string[];
			disallowPrefixes: string[];
			allowAllMemory: boolean;
		};
		qmd: { command: string; maxResults: number; collections: string[] };
		remote: {
			endpoint?: string;
			tokenEnv: string;
			requestedScope: RemoteContextRequestedScopeSettings;
			allowInsecureLocalhost: boolean;
			maxRequestBytes: number;
			maxResponseBytes: number;
			maxBundleBytes: number;
			maxBundles: number;
			failureThreshold: number;
			failureTtlMs: number;
		};
	} {
		const remoteFromGlobal =
			this.globalSettings.contextEngine?.enabled === true &&
			this.globalSettings.contextEngine?.provider === "remote";
		const provider = remoteFromGlobal ? "remote" : (this.settings.contextEngine?.provider ?? "none");
		const effectiveContextEngine = remoteFromGlobal ? this.globalSettings.contextEngine : this.settings.contextEngine;
		const remoteSettings = this.globalSettings.contextEngine?.remote;
		return {
			enabled: provider === "remote" ? remoteFromGlobal : (this.settings.contextEngine?.enabled ?? false),
			provider,
			budgetTokens: effectiveContextEngine?.budgetTokens ?? 4000,
			timeoutMs: effectiveContextEngine?.timeoutMs ?? 1000,
			compression: {
				enabled: effectiveContextEngine?.compression?.enabled ?? false,
				headroom: {
					enabled: effectiveContextEngine?.compression?.headroom?.enabled ?? true,
					python: effectiveContextEngine?.compression?.headroom?.python,
					timeoutMs: effectiveContextEngine?.compression?.headroom?.timeoutMs ?? 500,
					maxInputBytes: effectiveContextEngine?.compression?.headroom?.maxInputBytes ?? 64 * 1024,
					maxOutputBytes: effectiveContextEngine?.compression?.headroom?.maxOutputBytes ?? 128 * 1024,
				},
			},
			gbrain: {
				command: this.settings.contextEngine?.gbrain?.command ?? "gbrain",
				maxResults: this.settings.contextEngine?.gbrain?.maxResults ?? 5,
				project: this.settings.contextEngine?.gbrain?.project,
				allowedPrefixes: [...(this.settings.contextEngine?.gbrain?.allowedPrefixes ?? [])],
				disallowPrefixes: [...(this.settings.contextEngine?.gbrain?.disallowPrefixes ?? ["notes"])],
				allowAllMemory: this.settings.contextEngine?.gbrain?.allowAllMemory ?? true,
			},
			qmd: {
				command: this.settings.contextEngine?.qmd?.command ?? "qmd",
				maxResults: this.settings.contextEngine?.qmd?.maxResults ?? 5,
				collections: [...(this.settings.contextEngine?.qmd?.collections ?? [])],
			},
			remote: {
				endpoint: remoteSettings?.endpoint,
				tokenEnv: remoteSettings?.tokenEnv ?? "MEWRITE_CONTEXT_REMOTE_TOKEN",
				requestedScope: { ...(remoteSettings?.requestedScope ?? {}) },
				allowInsecureLocalhost: remoteSettings?.allowInsecureLocalhost ?? true,
				maxRequestBytes: remoteSettings?.maxRequestBytes ?? 64 * 1024,
				maxResponseBytes: remoteSettings?.maxResponseBytes ?? 512 * 1024,
				maxBundleBytes: remoteSettings?.maxBundleBytes ?? 16 * 1024,
				maxBundles: remoteSettings?.maxBundles ?? 12,
				failureThreshold: remoteSettings?.failureThreshold ?? 2,
				failureTtlMs: remoteSettings?.failureTtlMs ?? 30_000,
			},
		};
	}

	// --- WS11: onboarding / telemetry / update settings ---

	getHasCompletedOnboarding(): boolean {
		return this.settings.onboarding?.hasCompletedOnboarding ?? false;
	}

	markOnboardingCompleted(version: string): void {
		if (!this.globalSettings.onboarding) {
			this.globalSettings.onboarding = {};
		}
		this.globalSettings.onboarding.hasCompletedOnboarding = true;
		this.globalSettings.onboarding.completedAt = new Date().toISOString();
		this.globalSettings.onboarding.completedVersion = version;
		this.markModified("onboarding", "hasCompletedOnboarding");
		this.markModified("onboarding", "completedAt");
		this.markModified("onboarding", "completedVersion");
		this.save();
	}

	getTelemetryEnabled(): boolean {
		// WS11: telemetry is off by default. The user must opt-in explicitly.
		return this.settings.telemetry?.enabled === true;
	}

	setTelemetryEnabled(enabled: boolean): void {
		if (!this.globalSettings.telemetry) {
			this.globalSettings.telemetry = {};
		}
		this.globalSettings.telemetry.enabled = enabled;
		this.markModified("telemetry", "enabled");
		this.save();
	}

	getDiagnosticsEnabled(): boolean {
		return this.settings.diagnostics?.enabled ?? true;
	}

	setDiagnosticsEnabled(enabled: boolean): void {
		if (!this.globalSettings.diagnostics) {
			this.globalSettings.diagnostics = {};
		}
		this.globalSettings.diagnostics.enabled = enabled;
		this.markModified("diagnostics", "enabled");
		this.save();
	}

	getDiagnosticsNoticeShown(): boolean {
		return this.settings.diagnostics?.noticeShown ?? false;
	}

	markDiagnosticsNoticeShown(version: string): void {
		if (!this.globalSettings.diagnostics) {
			this.globalSettings.diagnostics = {};
		}
		this.globalSettings.diagnostics.noticeShown = true;
		this.globalSettings.diagnostics.noticeShownAt = new Date().toISOString();
		this.globalSettings.diagnostics.noticeShownVersion = version;
		this.markModified("diagnostics", "noticeShown");
		this.markModified("diagnostics", "noticeShownAt");
		this.markModified("diagnostics", "noticeShownVersion");
		this.save();
	}

	setDiagnosticsLastExport(path: string, exportedAt: string): void {
		if (!this.globalSettings.diagnostics) {
			this.globalSettings.diagnostics = {};
		}
		this.globalSettings.diagnostics.lastExportPath = path;
		this.globalSettings.diagnostics.lastExportedAt = exportedAt;
		this.markModified("diagnostics", "lastExportPath");
		this.markModified("diagnostics", "lastExportedAt");
		this.save();
	}

	getDiagnosticsSettings(): {
		enabled: boolean;
		noticeShown: boolean;
		lastExportPath?: string;
		lastExportedAt?: string;
	} {
		return {
			enabled: this.getDiagnosticsEnabled(),
			noticeShown: this.getDiagnosticsNoticeShown(),
			lastExportPath: this.settings.diagnostics?.lastExportPath,
			lastExportedAt: this.settings.diagnostics?.lastExportedAt,
		};
	}

	getDiagnosticsWrapperMetadata(): Record<string, string | number | boolean> {
		return { ...(this.settings.diagnostics?.wrapperMetadata ?? {}) };
	}

	getDiagnosticsRedactionConfig(): { additionalSecretKeys?: string[]; additionalPatterns?: string[] } {
		return {
			additionalSecretKeys: [...(this.settings.diagnostics?.redaction?.additionalSecretKeys ?? [])],
			additionalPatterns: [...(this.settings.diagnostics?.redaction?.additionalPatterns ?? [])],
		};
	}

	getUpdateChannel(): UpdateChannel {
		return this.settings.update?.channel ?? "stable";
	}

	setUpdateChannel(channel: UpdateChannel): void {
		if (!this.globalSettings.update) {
			this.globalSettings.update = {};
		}
		this.globalSettings.update.channel = channel;
		this.markModified("update", "channel");
		this.save();
	}

	getUpdateAutoCheck(): boolean {
		return this.settings.update?.autoCheck ?? true;
	}

	setUpdateAutoCheck(enabled: boolean): void {
		if (!this.globalSettings.update) {
			this.globalSettings.update = {};
		}
		this.globalSettings.update.autoCheck = enabled;
		this.markModified("update", "autoCheck");
		this.save();
	}

	getUpdateLastCheckedAt(): string | undefined {
		return this.settings.update?.lastCheckedAt;
	}

	setUpdateLastCheckedAt(iso: string): void {
		if (!this.globalSettings.update) {
			this.globalSettings.update = {};
		}
		this.globalSettings.update.lastCheckedAt = iso;
		this.markModified("update", "lastCheckedAt");
		this.save();
	}

	getUpdateLastNotifiedVersion(): string | undefined {
		return this.settings.update?.lastNotifiedVersion;
	}

	setUpdateLastNotifiedVersion(version: string): void {
		if (!this.globalSettings.update) {
			this.globalSettings.update = {};
		}
		this.globalSettings.update.lastNotifiedVersion = version;
		this.markModified("update", "lastNotifiedVersion");
		this.save();
	}

	// =========================================================================
	// Hooks (WS4) — Claude Code-compatible lifecycle hooks
	// =========================================================================

	/** Merged `hooks` block (project overrides global). May be undefined. */
	getHooks(): HooksSettings | undefined {
		return this.settings.hooks;
	}

	/** Global-scope `hooks` block, used by HooksRegistry.setLayer("global", ...). */
	getGlobalHooks(): HooksSettings | undefined {
		return this.globalSettings.hooks;
	}

	/** Project-scope `hooks` block, used by HooksRegistry.setLayer("project", ...). */
	getProjectHooks(): HooksSettings | undefined {
		return this.projectSettings.hooks;
	}

	setGlobalHooks(hooks: HooksSettings | undefined): void {
		this.globalSettings.hooks = hooks;
		this.markModified("hooks");
		this.save();
	}

	setProjectHooks(hooks: HooksSettings | undefined): void {
		const projectSettings = structuredClone(this.projectSettings);
		projectSettings.hooks = hooks;
		this.markProjectModified("hooks");
		this.saveProjectSettings(projectSettings);
	}

	getDisableAllHooks(): boolean {
		return this.settings.disableAllHooks ?? false;
	}

	setDisableAllHooks(disabled: boolean): void {
		this.globalSettings.disableAllHooks = disabled;
		this.markModified("disableAllHooks");
		this.save();
	}

	// =========================================================================
	// Status line (WS10) — Claude Code-compatible statusLine config
	// =========================================================================

	/** Merged `statusLine` block (project overrides global). May be undefined. */
	getStatusLine(): StatusLineSettings | undefined {
		return this.settings.statusLine;
	}

	setGlobalStatusLine(statusLine: StatusLineSettings | undefined): void {
		this.globalSettings.statusLine = statusLine;
		this.markModified("statusLine");
		this.save();
	}

	setProjectStatusLine(statusLine: StatusLineSettings | undefined): void {
		const projectSettings = structuredClone(this.projectSettings);
		projectSettings.statusLine = statusLine;
		this.markProjectModified("statusLine");
		this.saveProjectSettings(projectSettings);
	}
}
