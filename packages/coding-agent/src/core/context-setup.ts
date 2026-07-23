import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";

export interface ContextSetupState {
	hasSeenSetupPrompt: boolean;
	skippedAt?: string;
	mainDocsDir?: string;
}

export function expandHomePath(input: string): string {
	if (input === "~") return homedir();
	if (input.startsWith("~/")) return `${homedir()}${input.slice(1)}`;
	return input;
}

export function normalizeSetupDir(input: string, cwd = process.cwd()): string {
	const expanded = expandHomePath(input.trim());
	return expanded.startsWith("/") ? resolve(expanded) : resolve(cwd, expanded);
}

export function validateSetupDir(
	input: string,
	cwd = process.cwd(),
): { ok: true; path: string } | { ok: false; error: string } {
	const normalized = normalizeSetupDir(input, cwd);
	if (!existsSync(normalized)) return { ok: false, error: `Directory does not exist: ${normalized}` };
	if (!statSync(normalized).isDirectory()) return { ok: false, error: `Not a directory: ${normalized}` };
	return { ok: true, path: normalized };
}

export function shouldShowContextSetupNotice(state: ContextSetupState): boolean {
	return !state.hasSeenSetupPrompt && !state.mainDocsDir;
}

function displayPath(path: string | undefined): string {
	if (!path) return "<not set>";
	const home = homedir();
	return path === home ? "~" : path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

export function formatContextSetupNotice(): string {
	return [
		"Optional context setup: choose a docs folder for QMD.",
		"Run /context setup to configure, or /context setup skip to dismiss.",
		"Me Write works normally without this.",
	].join("\n");
}

export function formatContextSetupStatus(state: ContextSetupState): string[] {
	const lines = ["Context setup:", `Main docs dir: ${displayPath(state.mainDocsDir)}`, "", "Optional providers:"];
	if (state.mainDocsDir) {
		lines.push(`QMD: configure collection if needed`);
		lines.push(`  Next: qmd collection add ${displayPath(state.mainDocsDir)} --name docs && qmd embed`);
	} else {
		lines.push("QMD: not configured");
		lines.push("  Next: /context setup docs-dir <path>");
	}
	lines.push("Headroom: built-in integration; toggle with contextEngine.compression.headroom.enabled");
	return lines;
}

export function formatContextSetupHelp(cwd = process.cwd()): string {
	const cwdName = basename(cwd);
	return [
		"Context setup is optional. Me Write works normally without it.",
		"",
		"Commands:",
		"  /context setup docs-dir <path>",
		"  /context setup skip",
		"  /context status",
		"",
		`Current directory suggestion for docs: ${cwd} (${cwdName})`,
	].join("\n");
}
