import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME, DISPLAY_NAME, VERSION } from "../config.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { DiagnosticsEvent } from "./events.js";
import { redactForDiagnostics } from "./redaction.js";
import { getDiagnosticsPaths, readDiagnosticsInputs, rotateDiagnostics } from "./store.js";
import { createTarGz, type TarEntry } from "./tar.js";

export interface DiagnosticsExportOptions {
	agentDir: string;
	settingsManager: SettingsManager;
	since?: string;
	until?: string;
	now?: Date;
}

export interface DiagnosticsExportResult {
	path: string;
	bundleName: string;
	sizeBytes: number;
	includedFiles: string[];
	dateRange: { since: string; until: string };
}

function parseDateBound(value: string | undefined, fallback: Date, now: Date): Date {
	if (!value) return fallback;
	const duration = value.match(/^(\d+)(d|h)$/);
	if (duration) {
		const amount = Number.parseInt(duration[1], 10);
		const unitMs = duration[2] === "d" ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
		return new Date(now.getTime() - amount * unitMs);
	}
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`Invalid date: ${value}`);
	}
	return parsed;
}

function parseEvent(line: string): DiagnosticsEvent | undefined {
	try {
		const value = JSON.parse(line) as unknown;
		if (typeof value !== "object" || value === null) return undefined;
		if (!("type" in value) || typeof value.type !== "string") return undefined;
		if (!("timestamp" in value) || typeof value.timestamp !== "string") return undefined;
		return value as DiagnosticsEvent;
	} catch {
		return undefined;
	}
}

function eventInRange(event: DiagnosticsEvent, since: Date, until: Date): boolean {
	const timestamp = new Date(event.timestamp).getTime();
	return timestamp >= since.getTime() && timestamp <= until.getTime();
}

function readFilteredEvents(
	options: DiagnosticsExportOptions,
	since: Date,
	until: Date,
): Map<string, DiagnosticsEvent[]> {
	const files = readDiagnosticsInputs(options.agentDir);
	const events = new Map<string, DiagnosticsEvent[]>();
	for (const file of files) {
		const filtered: DiagnosticsEvent[] = [];
		for (const line of file.content.split("\n")) {
			if (!line.trim()) continue;
			const event = parseEvent(line);
			if (!event || !eventInRange(event, since, until)) continue;
			filtered.push(redactForDiagnostics(event, options.settingsManager.getDiagnosticsRedactionConfig()).value);
		}
		if (filtered.length === 0) continue;
		const existing = events.get(file.name) ?? [];
		existing.push(...filtered);
		events.set(file.name, existing);
	}
	return events;
}

function countBy(
	events: DiagnosticsEvent[],
	selector: (event: DiagnosticsEvent) => string | undefined,
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const event of events) {
		const key = selector(event);
		if (!key) continue;
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return counts;
}

function percentile(values: number[], p: number): number | undefined {
	if (values.length === 0) return undefined;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
	return sorted[index];
}

function allEvents(eventsByFile: Map<string, DiagnosticsEvent[]>): DiagnosticsEvent[] {
	return [...eventsByFile.values()].flat();
}

function buildUsageSummary(events: DiagnosticsEvent[]): Record<string, unknown> {
	return {
		sessions: events.filter((event) => event.type === "session.started").length,
		commands: countBy(events, (event) =>
			event.type === "command.completed" ? String(event.attributes.commandName) : undefined,
		),
		tools: countBy(events, (event) =>
			event.type === "tool_call.completed" ? String(event.attributes.toolName) : undefined,
		),
		subagents: countBy(events, (event) =>
			event.type === "subagent.completed" ? String(event.attributes.agentName) : undefined,
		),
		models: countBy(events, (event) =>
			event.type === "model_request.completed"
				? `${String(event.attributes.provider)}/${String(event.attributes.model)}`
				: undefined,
		),
		validation: {
			success: events.filter((event) => event.type === "validation.completed" && event.attributes.success === true)
				.length,
			failure: events.filter((event) => event.type === "validation.completed" && event.attributes.success === false)
				.length,
		},
	};
}

function buildLatencySummary(events: DiagnosticsEvent[]): Record<string, unknown> {
	const byType: Record<string, number[]> = {};
	for (const event of events) {
		if (event.durationMs === undefined) continue;
		byType[event.type] = byType[event.type] ?? [];
		byType[event.type].push(event.durationMs);
	}
	const summary: Record<string, unknown> = {};
	for (const [type, values] of Object.entries(byType)) {
		summary[type] = {
			count: values.length,
			p50: percentile(values, 50),
			p95: percentile(values, 95),
			p99: percentile(values, 99),
			max: Math.max(...values),
		};
	}
	return summary;
}

function buildErrorSummary(events: DiagnosticsEvent[]): Record<string, unknown> {
	const errors = events.filter((event) => event.type === "error.reported" || event.outcome === "error");
	return {
		count: errors.length,
		byClass: countBy(errors, (event) =>
			"errorClass" in event.attributes ? String(event.attributes.errorClass) : event.type,
		),
		byComponent: countBy(errors, (event) =>
			"component" in event.attributes ? String(event.attributes.component) : undefined,
		),
	};
}

function buildEnvironmentSummary(events: DiagnosticsEvent[]): Record<string, unknown> {
	const latest = events
		.filter((event) => event.type === "environment.reported")
		.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
		.at(-1);
	return latest?.attributes ?? {};
}

function jsonBuffer(value: unknown): Buffer {
	return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function textBuffer(value: string): Buffer {
	return Buffer.from(value, "utf-8");
}

function bundleTimestamp(date: Date): string {
	return date
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}Z$/, "Z")
		.replace("T", "-");
}

function buildReadme(manifest: Record<string, unknown>): string {
	return `# ${DISPLAY_NAME} diagnostics bundle\n\nGenerated by \`${APP_NAME} diagnostics export\`.\n\nThis bundle was created locally. ${DISPLAY_NAME} did not upload it. Share it only if you choose to.\n\n## Included\n\n- Local usage event metadata\n- Latency summaries\n- Error summaries\n- Environment summary\n- Manifest\n\n## Never included in V1\n\n- User prompts\n- Assistant responses\n- Transcripts\n- File contents\n- Tool arguments\n- Shell command text\n- Environment variable values\n- API keys\n- Config files\n- Log tails\n- Workspace files\n\n## Review before sharing\n\nExtract the tarball and inspect \`manifest.json\`, \`summaries/\`, and \`events/\`.\n\nDiagnostics can be disabled with \`${APP_NAME} diagnostics disable\`.\n\n## Manifest\n\n\`\`\`json\n${JSON.stringify(manifest, null, 2)}\n\`\`\`\n`;
}

export async function exportDiagnostics(options: DiagnosticsExportOptions): Promise<DiagnosticsExportResult> {
	const now = options.now ?? new Date();
	rotateDiagnostics(options.agentDir, now);
	const until = parseDateBound(options.until, now, now);
	const since = parseDateBound(options.since, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), now);
	const eventsByFile = readFilteredEvents(options, since, until);
	const events = allEvents(eventsByFile);
	const paths = getDiagnosticsPaths(options.agentDir);
	mkdirSync(paths.exportsDir, { recursive: true, mode: 0o700 });
	const bundleName = `${APP_NAME}-diagnostics-${bundleTimestamp(now)}`;
	const manifest = {
		schemaVersion: 1,
		generatedAt: now.toISOString(),
		productName: DISPLAY_NAME,
		appId: APP_NAME,
		appVersion: VERSION,
		source: "offline-diagnostics-export",
		dateRange: { since: since.toISOString(), until: until.toISOString() },
		collectors: {
			sessions: true,
			commands: true,
			modelRequests: true,
			toolCalls: true,
			subagents: true,
			validation: true,
			errors: true,
			environment: true,
		},
		optionalIncludes: [],
		redaction: { writeTime: true, exportTime: true },
		wrapperMetadata: options.settingsManager.getDiagnosticsWrapperMetadata(),
		complete: true,
	};
	const entries: TarEntry[] = [
		{ name: `${bundleName}/README.md`, data: textBuffer(buildReadme(manifest)) },
		{ name: `${bundleName}/manifest.json`, data: jsonBuffer(manifest) },
		{ name: `${bundleName}/summaries/usage-summary.json`, data: jsonBuffer(buildUsageSummary(events)) },
		{ name: `${bundleName}/summaries/latency-summary.json`, data: jsonBuffer(buildLatencySummary(events)) },
		{ name: `${bundleName}/summaries/error-summary.json`, data: jsonBuffer(buildErrorSummary(events)) },
		{ name: `${bundleName}/summaries/environment-summary.json`, data: jsonBuffer(buildEnvironmentSummary(events)) },
	];
	for (const [fileName, fileEvents] of [...eventsByFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		entries.push({
			name: `${bundleName}/events/${fileName}`,
			data: textBuffer(`${fileEvents.map((event) => JSON.stringify(event)).join("\n")}\n`),
		});
	}
	const tarball = createTarGz(entries);
	const outputPath = join(paths.exportsDir, `${bundleName}.tar.gz`);
	writeFileSync(outputPath, tarball, { mode: 0o600 });
	options.settingsManager.setDiagnosticsLastExport(outputPath, now.toISOString());
	await options.settingsManager.flush();
	return {
		path: outputPath,
		bundleName,
		sizeBytes: existsSync(outputPath) ? readFileSync(outputPath).byteLength : tarball.byteLength,
		includedFiles: entries.map((entry) => entry.name.replace(`${bundleName}/`, "")),
		dateRange: { since: since.toISOString(), until: until.toISOString() },
	};
}
