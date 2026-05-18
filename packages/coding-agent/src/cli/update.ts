/**
 * `cave self-update` (WS11) — self-updater for the cave binary.
 *
 * Strategy:
 *   1. Determine the active install method (bun-binary, npm, pnpm, yarn, bun).
 *   2. Resolve the latest release for the configured channel from the GitHub
 *      releases API.
 *   3. If the binary install is in use:
 *        - Atomic: download tarball to a temp file, verify checksum, write to
 *          a fresh "<prefix>/lib/cave/<version>" dir, atomically swap the
 *          "<prefix>/bin/cave" symlink, prune older versions.
 *      For package-manager installs we just print the right command (so the
 *      user's package manager keeps owning the install).
 *   4. Persist last-checked timestamp so the once-per-24h auto-check can be
 *      throttled.
 *
 * The actual file-IO heavy lifting is delegated to `installers/install.sh`,
 * which is already idempotent and signs/verifies tarballs. We just shell out.
 *
 * Auto-check: `maybeNotifyUpdateAvailable()` is called once per `cave` boot.
 * It does at most one network round-trip per 24h (cached via settings) and
 * never blocks startup — it runs deferred and silently swallows errors.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { detectInstallMethod, getAgentDir, getUpdateInstruction, VERSION } from "../config.js";
import { SettingsManager } from "../core/settings-manager.js";

const REPO = "JuliusBrussee/caveman-cli";
const PACKAGE_NAME = "cave";

export interface RemoteRelease {
	tag: string;
	publishedAt?: string;
}

export interface UpdateOptions {
	channel?: "stable" | "beta" | "canary";
	dryRun?: boolean;
	force?: boolean;
	jsonOutput?: boolean;
	/** Override the GitHub API URL for tests. */
	githubApi?: string;
	/** Override the installer script path for tests. */
	installerScript?: string;
}

/**
 * Resolve the latest release tag for a channel. Stable picks /releases/latest,
 * beta and canary pick the newest pre-release tag whose name matches the
 * channel keyword.
 */
export async function resolveRemoteRelease(
	channel: "stable" | "beta" | "canary",
	apiBase = "https://api.github.com",
	fetchImpl: typeof fetch = fetch,
): Promise<RemoteRelease | undefined> {
	if (channel === "stable") {
		const r = await fetchImpl(`${apiBase}/repos/${REPO}/releases/latest`);
		if (!r.ok) return undefined;
		const j = (await r.json()) as { tag_name?: string; published_at?: string };
		if (!j.tag_name) return undefined;
		return { tag: j.tag_name, publishedAt: j.published_at };
	}
	const r = await fetchImpl(`${apiBase}/repos/${REPO}/releases?per_page=20`);
	if (!r.ok) return undefined;
	const list = (await r.json()) as Array<{ tag_name?: string; published_at?: string; prerelease?: boolean }>;
	const candidate = list.find((rel) => rel.tag_name && (rel.tag_name.includes(channel) || rel.prerelease));
	if (!candidate?.tag_name) return undefined;
	return { tag: candidate.tag_name, publishedAt: candidate.published_at };
}

/** Compare two semver-like tags. Returns 1, -1, 0 if a > b, a < b, equal. */
export function compareVersions(a: string, b: string): number {
	const norm = (s: string) =>
		s
			.replace(/^v/, "")
			.split(/[.-]/)
			.map((p) => (Number.isNaN(Number(p)) ? p : Number(p)));
	const aa = norm(a);
	const bb = norm(b);
	const len = Math.max(aa.length, bb.length);
	for (let i = 0; i < len; i++) {
		const xa = aa[i];
		const xb = bb[i];
		if (xa === xb) continue;
		if (xa === undefined) return -1;
		if (xb === undefined) return 1;
		if (typeof xa === "number" && typeof xb === "number") return xa > xb ? 1 : -1;
		return String(xa) > String(xb) ? 1 : -1;
	}
	return 0;
}

/**
 * Auto-check for updates. Throttled to once per 24h via settings. Never throws,
 * never blocks startup. Returns the available newer version if any.
 */
export async function maybeNotifyUpdateAvailable(
	settings: SettingsManager,
	opts: { fetchImpl?: typeof fetch; now?: () => Date; channel?: "stable" | "beta" | "canary" } = {},
): Promise<string | undefined> {
	if (!settings.getUpdateAutoCheck()) return undefined;
	if (process.env.CAVE_DISABLE_UPDATE_CHECK === "1") return undefined;
	const now = opts.now?.() ?? new Date();
	const last = settings.getUpdateLastCheckedAt();
	if (last) {
		const lastDate = new Date(last);
		const ageMs = now.getTime() - lastDate.getTime();
		if (ageMs < 24 * 60 * 60 * 1000) return undefined;
	}
	const channel = opts.channel ?? settings.getUpdateChannel();
	let release: RemoteRelease | undefined;
	try {
		release = await resolveRemoteRelease(channel, undefined, opts.fetchImpl ?? fetch);
	} catch {
		return undefined;
	}
	settings.setUpdateLastCheckedAt(now.toISOString());
	if (!release) return undefined;
	const cmp = compareVersions(release.tag, VERSION);
	if (cmp <= 0) return undefined;
	if (settings.getUpdateLastNotifiedVersion() === release.tag) return undefined;
	settings.setUpdateLastNotifiedVersion(release.tag);
	return release.tag;
}

/**
 * Locate the canonical installer script. Used by self-update on bun-binary
 * installs.
 */
function locateInstallerScript(): string | undefined {
	const candidates: string[] = [];
	const execPath = process.execPath;
	if (execPath) {
		candidates.push(join(dirname(execPath), "installers", "install.sh"));
		candidates.push(join(dirname(execPath), "..", "installers", "install.sh"));
	}
	const home = process.env.HOME;
	if (home) {
		candidates.push(join(home, ".cave", "lib", "cave", "installers", "install.sh"));
	}
	// Also try the temp clone path used by `cave self-update --bootstrap`
	candidates.push("/tmp/cave-installers/install.sh");
	for (const c of candidates) {
		if (existsSync(c)) return c;
	}
	return undefined;
}

/**
 * Run the canonical installer for the given version. Throws on failure.
 * Used by self-update on the bun-binary path. The installer is itself
 * idempotent and atomic — we simply re-invoke it with --version.
 */
export function runInstaller(
	version: string,
	opts: { script?: string; channel?: "stable" | "beta" | "canary"; dryRun?: boolean } = {},
): { code: number; stdout: string; stderr: string } {
	const script = opts.script ?? locateInstallerScript();
	if (!script) {
		throw new Error(
			"install.sh not found locally; run `npm install -g @juliusbrussee/caveman-code@latest` to refresh",
		);
	}
	const args = ["--version", version];
	if (opts.channel) args.push("--channel", opts.channel);
	if (opts.dryRun) args.push("--dry-run");
	const result = spawnSync("bash", [script, ...args], { encoding: "utf8" });
	return {
		code: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

/**
 * Re-exec the freshly installed binary so the user sees the new version
 * without restarting their shell. Best-effort.
 */
export function reExecAfterUpdate(): void {
	const newBin = process.execPath;
	if (!newBin) return;
	try {
		spawn(newBin, ["--version"], { stdio: "inherit" });
	} catch {
		// best-effort
	}
}

/**
 * `cave self-update` entrypoint. Returns exit code.
 */
export async function runSelfUpdate(args: string[]): Promise<number> {
	const json = args.includes("--json");
	const dryRun = args.includes("--dry-run");
	const force = args.includes("--force");
	const channelArgIdx = args.indexOf("--channel");
	const overrideChannel =
		channelArgIdx >= 0 && channelArgIdx + 1 < args.length
			? (args[channelArgIdx + 1] as "stable" | "beta" | "canary")
			: undefined;

	const settings = SettingsManager.create(process.cwd(), getAgentDir());
	const channel = overrideChannel ?? settings.getUpdateChannel();
	const method = detectInstallMethod();
	const release = await resolveRemoteRelease(channel).catch(() => undefined);
	if (!release) {
		const msg = `could not reach GitHub releases API for channel '${channel}'`;
		emit({ ok: false, msg }, json);
		return 1;
	}
	const newer = compareVersions(release.tag, VERSION) > 0;
	if (!newer && !force) {
		emit(
			{
				ok: true,
				msg: `cave is up to date (current ${VERSION}, latest ${release.tag} on ${channel})`,
				current: VERSION,
				latest: release.tag,
				channel,
				method,
			},
			json,
		);
		return 0;
	}

	if (dryRun) {
		emit(
			{
				ok: true,
				msg: `would update from ${VERSION} → ${release.tag} via ${method}`,
				current: VERSION,
				latest: release.tag,
				channel,
				method,
				dryRun: true,
			},
			json,
		);
		return 0;
	}

	if (method !== "bun-binary") {
		// cave isn't on npm (the `cave` name there is an unrelated package),
		// so we cannot drive a package-manager update. Tell the user to
		// reinstall via the canonical install script.
		const instr = getUpdateInstruction(PACKAGE_NAME);
		emit(
			{
				ok: true,
				msg: `cave was installed via ${method}; reinstall to upgrade — ${instr}`,
				current: VERSION,
				latest: release.tag,
				channel,
				method,
				instruction: instr,
			},
			json,
		);
		return 0;
	}

	process.stdout.write(chalk.bold(`Updating cave ${VERSION} → ${release.tag} (${channel})\n`));
	const result = runInstaller(release.tag, { channel });
	process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	if (result.code !== 0) {
		emit({ ok: false, msg: "installer failed", code: result.code }, json);
		return result.code || 1;
	}
	settings.setUpdateLastNotifiedVersion(release.tag);
	settings.setUpdateLastCheckedAt(new Date().toISOString());
	emit({ ok: true, msg: `updated to ${release.tag}`, latest: release.tag }, json);
	return 0;
}

function emit(obj: Record<string, unknown>, json: boolean): void {
	if (json) {
		process.stdout.write(`${JSON.stringify(obj)}\n`);
	} else if (obj.ok) {
		process.stdout.write(`${obj.msg}\n`);
	} else {
		process.stderr.write(`${chalk.red("error:")} ${obj.msg}\n`);
	}
}
