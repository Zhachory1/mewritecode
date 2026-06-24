import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

// =============================================================================
// Package Detection
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_APP_NAME = "mewrite";
const DEFAULT_PACKAGE_NAME = "@zhachory1/mewrite-code";
const DEFAULT_REPO = "Zhachory1/mewritecode";
const DEFAULT_CONFIG_DIR_NAME = ".mewrite";
const DEFAULT_PACKAGE_DIR_ENV = `${DEFAULT_APP_NAME.toUpperCase()}_PACKAGE_DIR`;
const GENERIC_PACKAGE_DIR_ENV = "CODING_AGENT_PACKAGE_DIR";

export interface DistributionConfig {
	name?: string;
	appName?: string;
	displayName?: string;
	configDir?: string;
	configDirName?: string;
	packageDirEnv?: string;
	packageDir?: string;
	selfUpdate?: {
		enabled?: boolean;
		repo?: string;
		packageName?: string;
		installDirName?: string;
		productDirName?: string;
		disableEnv?: string;
	};
}

let resolvedAppConfig: DistributionConfig | undefined;

/**
 * Detect if we're running as a Bun compiled binary.
 * Bun binaries have import.meta.url containing "$bunfs", "~BUN", or "%7EBUN" (Bun's virtual filesystem path)
 */
export const isBunBinary =
	import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN");

/** Detect if Bun is the runtime (compiled binary or bun run) */
export const isBunRuntime = !!process.versions.bun;

function expandHome(path: string | undefined): string | undefined {
	if (!path) return undefined;
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return homedir() + path.slice(1);
	return path;
}

// =============================================================================
// Install Method Detection
// =============================================================================

export type InstallMethod = "bun-binary" | "npm" | "pnpm" | "yarn" | "bun" | "unknown";

export function detectInstallMethod(): InstallMethod {
	if (isBunBinary) {
		return "bun-binary";
	}

	const resolvedPath = `${__dirname}\0${process.execPath || ""}`.toLowerCase();

	if (resolvedPath.includes("/pnpm/") || resolvedPath.includes("/.pnpm/") || resolvedPath.includes("\\pnpm\\")) {
		return "pnpm";
	}
	if (resolvedPath.includes("/yarn/") || resolvedPath.includes("/.yarn/") || resolvedPath.includes("\\yarn\\")) {
		return "yarn";
	}
	if (isBunRuntime) {
		return "bun";
	}
	if (resolvedPath.includes("/npm/") || resolvedPath.includes("/node_modules/") || resolvedPath.includes("\\npm\\")) {
		return "npm";
	}

	return "unknown";
}

/**
 * Suggest how to update Me Write Code.
 */
export function getUpdateInstruction(packageName: string = PACKAGE_NAME): string {
	const method = detectInstallMethod();
	if (method === "bun-binary") {
		return `Run: \`${APP_NAME} self-update\``;
	}
	return `Run: \`npm install -g ${packageName}@latest\``;
}

// =============================================================================
// Package Asset Paths (shipped with executable)
// =============================================================================

/**
 * Get the base directory for resolving package assets (themes, package.json, README.md, CHANGELOG.md).
 * - For Bun binary: returns the directory containing the executable
 * - For Node.js (dist/): returns __dirname (the dist/ directory)
 * - For tsx (src/): returns parent directory (the package root)
 */
export function getPackageDir(): string {
	// Allow override via environment variable (useful for Nix/Guix where store paths tokenize poorly)
	const configuredEnvDir = resolvedAppConfig?.packageDirEnv ? process.env[resolvedAppConfig.packageDirEnv] : undefined;
	const envDir =
		configuredEnvDir ??
		resolvedAppConfig?.packageDir ??
		process.env[GENERIC_PACKAGE_DIR_ENV] ??
		process.env[DEFAULT_PACKAGE_DIR_ENV];
	const expandedEnvDir = expandHome(envDir);
	if (expandedEnvDir) return expandedEnvDir;

	if (isBunBinary) {
		// Bun binary: process.execPath points to the compiled executable
		return dirname(process.execPath);
	}
	// Node.js: walk up from __dirname until we find this package's package.json,
	// not an ancestor workspace package.json.
	let dir = __dirname;
	while (dir !== dirname(dir)) {
		const packageJsonPath = join(dir, "package.json");
		if (existsSync(packageJsonPath)) {
			try {
				const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
					name?: string;
					mewriteConfig?: DistributionConfig;
					piConfig?: DistributionConfig;
				};
				const config = pkg.mewriteConfig ?? pkg.piConfig;
				if (pkg.name === "@zhachory1/mewrite-code" || config) {
					const configuredEnvDir = config?.packageDirEnv ? process.env[config.packageDirEnv] : undefined;
					return expandHome(configuredEnvDir ?? config?.packageDir) ?? dir;
				}
			} catch {
				// Keep walking; a malformed ancestor package.json should not hide package assets.
			}
		}
		dir = dirname(dir);
	}
	// Fallback (shouldn't happen)
	return __dirname;
}

/**
 * Get path to built-in themes directory (shipped with package)
 * - For Bun binary: theme/ next to executable
 * - For Node.js (dist/): dist/modes/interactive/theme/
 * - For tsx (src/): src/modes/interactive/theme/
 */
export function getThemesDir(): string {
	if (isBunBinary) {
		return join(dirname(process.execPath), "theme");
	}
	// Theme is in modes/interactive/theme/ relative to src/ or dist/
	const packageDir = getPackageDir();
	const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
	return join(packageDir, srcOrDist, "modes", "interactive", "theme");
}

/**
 * Get path to HTML export template directory (shipped with package)
 * - For Bun binary: export-html/ next to executable
 * - For Node.js (dist/): dist/core/export-html/
 * - For tsx (src/): src/core/export-html/
 */
export function getExportTemplateDir(): string {
	if (isBunBinary) {
		return join(dirname(process.execPath), "export-html");
	}
	const packageDir = getPackageDir();
	const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
	return join(packageDir, srcOrDist, "core", "export-html");
}

/** Get path to package.json */
export function getPackageJsonPath(): string {
	return join(getPackageDir(), "package.json");
}

/** Get path to README.md */
export function getReadmePath(): string {
	return resolve(join(getPackageDir(), "README.md"));
}

/** Get path to docs directory */
export function getDocsPath(): string {
	return resolve(join(getPackageDir(), "docs"));
}

/** Get path to examples directory */
export function getExamplesPath(): string {
	return resolve(join(getPackageDir(), "examples"));
}

/** Get path to CHANGELOG.md */
export function getChangelogPath(): string {
	return resolve(join(getPackageDir(), "CHANGELOG.md"));
}

/**
 * Get path to built-in interactive assets directory.
 * - For Bun binary: assets/ next to executable
 * - For Node.js (dist/): dist/modes/interactive/assets/
 * - For tsx (src/): src/modes/interactive/assets/
 */
export function getInteractiveAssetsDir(): string {
	if (isBunBinary) {
		return join(dirname(process.execPath), "assets");
	}
	const packageDir = getPackageDir();
	const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
	return join(packageDir, srcOrDist, "modes", "interactive", "assets");
}

/** Get path to a bundled interactive asset */
export function getBundledInteractiveAssetPath(name: string): string {
	return join(getInteractiveAssetsDir(), name);
}

/** Resolve the bundled prompt-templates dir shipped with the package. */
export function getBundledPromptsDir(): string {
	return join(getPackageDir(), "prompts");
}

// =============================================================================
// App Config (from package.json mewriteConfig)
// =============================================================================

const pkg = JSON.parse(readFileSync(getPackageJsonPath(), "utf-8"));
const appConfig = (pkg.mewriteConfig ?? pkg.piConfig ?? {}) as DistributionConfig;
resolvedAppConfig = appConfig;
const selfUpdateConfig = appConfig.selfUpdate ?? {};

export const APP_NAME: string = appConfig.appName || appConfig.name || DEFAULT_APP_NAME;
export const DISPLAY_NAME: string = appConfig.displayName || APP_NAME;
export const CONFIG_DIR_NAME: string = appConfig.configDirName || appConfig.configDir || DEFAULT_CONFIG_DIR_NAME;
export const VERSION: string = pkg.version;
export const SELF_UPDATE_ENABLED: boolean = selfUpdateConfig.enabled ?? pkg.name === DEFAULT_PACKAGE_NAME;
export const PACKAGE_NAME: string = selfUpdateConfig.packageName || DEFAULT_PACKAGE_NAME;
export const RELEASE_REPO: string = selfUpdateConfig.repo || DEFAULT_REPO;
export const INSTALL_DIR_NAME: string = selfUpdateConfig.installDirName || APP_NAME;
export const INSTALL_PRODUCT_DIR_NAME: string = selfUpdateConfig.productDirName || APP_NAME;
export const LEGACY_CONFIG_DIR_NAMES: readonly string[] = [".cave"];

// e.g., MEWRITE_CODING_AGENT_DIR
export const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;
export const ENV_PACKAGE_DIR = appConfig.packageDirEnv || `${APP_NAME.toUpperCase()}_PACKAGE_DIR`;
export const ENV_SHARE_VIEWER_URL = `${APP_NAME.toUpperCase()}_SHARE_VIEWER_URL`;
export const ENV_DISABLE_UPDATE_CHECK = selfUpdateConfig.disableEnv || `${APP_NAME.toUpperCase()}_DISABLE_UPDATE_CHECK`;

const DEFAULT_SHARE_VIEWER_URL = "";

/** Get the share viewer URL for a gist ID */
export function getShareViewerUrl(gistId: string): string {
	const baseUrl = process.env[ENV_SHARE_VIEWER_URL] || DEFAULT_SHARE_VIEWER_URL;
	return `${baseUrl}#${gistId}`;
}

// =============================================================================
// User Config Paths (for example ~/.mewrite/agent/*)
// =============================================================================

/** Get the agent config directory (e.g., ~/.pi/agent/) */
export function getDistributionConfig(): DistributionConfig {
	return structuredClone(appConfig);
}

export function getAgentDir(): string {
	const envDir = process.env[ENV_AGENT_DIR];
	if (envDir) {
		return expandHome(envDir) ?? envDir;
	}
	return join(homedir(), CONFIG_DIR_NAME, "agent");
}

/** Get path to user's custom themes directory */
export function getCustomThemesDir(): string {
	return join(getAgentDir(), "themes");
}

/** Get path to models.json */
export function getModelsPath(): string {
	return join(getAgentDir(), "models.json");
}

/** Get path to auth.json */
export function getAuthPath(): string {
	return join(getAgentDir(), "auth.json");
}

/** Get path to settings.json */
export function getSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

/** Get path to tools directory */
export function getToolsDir(): string {
	return join(getAgentDir(), "tools");
}

/** Get path to managed binaries directory (fd, rg) */
export function getBinDir(): string {
	return join(getAgentDir(), "bin");
}

/** Get path to prompt templates directory */
export function getPromptsDir(): string {
	return join(getAgentDir(), "prompts");
}

/** Get path to sessions directory */
export function getSessionsDir(): string {
	return join(getAgentDir(), "sessions");
}

/** Get path to debug log file */
export function getDebugLogPath(): string {
	return join(getAgentDir(), `${APP_NAME}-debug.log`);
}
