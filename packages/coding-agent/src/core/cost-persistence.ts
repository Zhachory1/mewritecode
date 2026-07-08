/**
 * WS19: Cost Transparency Panel — persistence layer.
 *
 * Reads/writes `~/.cave/cost-totals.json` for legacy daily/weekly aggregates
 * and `~/.cave/cost-ledger.jsonl` for live per-assistant-message records.
 * Totals use rename-on-write; ledger writes use append-only newline framing.
 *
 * Schema:
 * {
 *   daily: {
 *     "2026-04-28": { input, output, cacheCreate, cacheRead, dollars }
 *   },
 *   weekly: {
 *     "2026-W17": { input, output, cacheCreate, cacheRead, dollars }
 *   }
 * }
 *
 * Older daily entries are pruned after 90 days; weekly entries after 52 weeks.
 * Ledger records are deduped by id on read.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { todayDateString, weekKeyForDate } from "./cost-formatter.js";

export interface PeriodTotal {
	input: number;
	output: number;
	cacheCreate: number;
	cacheRead: number;
	dollars: number;
}

export interface CostLedgerRecord extends PeriodTotal {
	id: string;
	sessionId: string;
	timestamp: string;
}

/** Savings Meter (DD §10.7): cumulative caveman BYTES eliminated. */
export interface SavingsPeriodTotal {
	bytes: number;
}

export interface SavingsAggregate {
	daily: Record<string, SavingsPeriodTotal>;
	weekly: Record<string, SavingsPeriodTotal>;
	allTime: SavingsPeriodTotal;
	/**
	 * Ring of recently-applied session ids (DD §10.7 idempotency). An add is
	 * applied at most once per session id, so resume/replay never double-counts.
	 */
	appliedSessionIds: string[];
}

export interface CostTotalsFile {
	daily: Record<string, PeriodTotal>;
	weekly: Record<string, PeriodTotal>;
	/** Optional — absent in pre-savings files; created on first savings persist. */
	savings?: SavingsAggregate;
}

export interface SessionSavingsDelta {
	/** Stable session id (idempotency key). */
	sessionId: string;
	/** Caveman bytes eliminated this session (exact, durable figure). */
	bytes: number;
}

/** Max session ids retained in the idempotency ring. */
const APPLIED_SESSION_ID_RING = 256;

export interface SessionCostDelta {
	inputTokens: number;
	outputTokens: number;
	cacheCreateTokens: number;
	cacheReadTokens: number;
	dollars: number;
}

export interface AssistantMessageCostDelta extends SessionCostDelta {
	id: string;
	sessionId: string;
	timestampMs: number;
}

const COST_TOTALS_FILENAME = "cost-totals.json";
const COST_LEDGER_FILENAME = "cost-ledger.jsonl";
const DAILY_RETENTION_DAYS = 90;
const WEEKLY_RETENTION_WEEKS = 52;

/**
 * Return the path to ~/.cave/cost-totals.json.
 * Accepts an optional override dir for testing.
 */
export function getCostTotalsPath(caveDir?: string): string {
	const dir = caveDir ?? path.join(os.homedir(), ".cave");
	return path.join(dir, COST_TOTALS_FILENAME);
}

/**
 * Return the path to ~/.cave/cost-ledger.jsonl.
 * Accepts an optional override dir for testing.
 */
export function getCostLedgerPath(caveDir?: string): string {
	const dir = caveDir ?? path.join(os.homedir(), ".cave");
	return path.join(dir, COST_LEDGER_FILENAME);
}

/**
 * Read the cost totals file. Returns an empty structure if the file does not
 * exist or cannot be parsed.
 */
export function readCostTotals(filePath?: string): CostTotalsFile {
	const p = filePath ?? getCostTotalsPath();
	try {
		const raw = fs.readFileSync(p, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (isValidCostTotalsFile(parsed)) {
			return parsed;
		}
	} catch {
		// File not found or parse error — start fresh
	}
	return { daily: {}, weekly: {} };
}

export function readCostLedgerRecords(filePath?: string): CostLedgerRecord[] {
	const p = filePath ?? getCostLedgerPath();
	const byId = new Map<string, CostLedgerRecord>();
	try {
		const raw = fs.readFileSync(p, "utf8");
		for (const line of raw.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const parsed = JSON.parse(trimmed) as unknown;
				if (isValidCostLedgerRecord(parsed) && !byId.has(parsed.id)) {
					byId.set(parsed.id, parsed);
				}
			} catch {
				// Ignore malformed or torn ledger lines; later complete rows remain usable.
			}
		}
	} catch {
		// File not found or unreadable — no ledger records yet.
	}
	return [...byId.values()];
}

/**
 * Merge a session delta into the totals file atomically.
 * Uses rename-on-write so concurrent caveman sessions don't corrupt the file.
 *
 * Steps:
 *   1. Read current file (or empty).
 *   2. Add delta to today's daily bucket and this-week's weekly bucket.
 *   3. Prune old entries.
 *   4. Write to a temp file in the same directory.
 *   5. Atomically rename temp file to destination.
 */
export function persistSessionCost(delta: SessionCostDelta, filePath?: string): void {
	if (isEmptyCostDelta(delta)) {
		return; // Nothing meaningful to persist
	}

	const p = filePath ?? getCostTotalsPath();
	const dir = path.dirname(p);

	// Ensure ~/.cave/ exists
	try {
		fs.mkdirSync(dir, { recursive: true });
	} catch {
		// Already exists or can't create — best effort
	}

	const totals = readCostTotals(p);
	const today = todayDateString();
	const week = weekKeyForDate(today);

	// Update daily
	totals.daily[today] = addPeriodTotal(totals.daily[today], delta);

	// Update weekly
	totals.weekly[week] = addPeriodTotal(totals.weekly[week], delta);

	// Prune
	pruneDailyEntries(totals);
	pruneWeeklyEntries(totals);

	// Atomic write
	const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
	try {
		fs.writeFileSync(tmp, JSON.stringify(totals, null, 2), "utf8");
		fs.renameSync(tmp, p);
	} catch (err) {
		// Clean up temp file on error
		try {
			fs.unlinkSync(tmp);
		} catch {
			/* ignore */
		}
		throw err;
	}
}

export function persistAssistantMessageCost(delta: AssistantMessageCostDelta, filePath?: string): void {
	if (!delta.id || !delta.sessionId || isEmptyCostDelta(delta)) {
		return;
	}

	const p = filePath ?? getCostLedgerPath();
	const dir = path.dirname(p);
	try {
		fs.mkdirSync(dir, { recursive: true });
	} catch {
		// Already exists or can't create — best effort
	}

	const timestampMs = Number.isFinite(delta.timestampMs) ? delta.timestampMs : Date.now();
	const record: CostLedgerRecord = {
		id: delta.id,
		sessionId: delta.sessionId,
		timestamp: new Date(timestampMs).toISOString(),
		input: delta.inputTokens,
		output: delta.outputTokens,
		cacheCreate: delta.cacheCreateTokens,
		cacheRead: delta.cacheReadTokens,
		dollars: delta.dollars,
	};

	fs.appendFileSync(p, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
}

/**
 * Savings Meter (DD §10.7): merge a session's savings BYTES into the totals file
 * atomically, IDEMPOTENT by session id. Persisting the same session id twice
 * (resume/replay) does NOT double-add. Guards the read-modify-write with the
 * same atomic rename-on-write as cost. Persists BYTES (exact) as the durable
 * figure; $ is derived on read elsewhere.
 *
 * NOTE: savings-only sessions (no cost) MUST still persist — this function is
 * NOT gated by the `cost === 0` early-return that `persistSessionCost` applies.
 */
export function persistSessionSavings(delta: SessionSavingsDelta, filePath?: string): void {
	if (!delta.sessionId || delta.bytes <= 0) {
		return; // Nothing meaningful / no key to dedupe on.
	}

	const p = filePath ?? getCostTotalsPath();
	const dir = path.dirname(p);

	try {
		fs.mkdirSync(dir, { recursive: true });
	} catch {
		// Already exists or can't create — best effort
	}

	const totals = readCostTotals(p);
	const savings = ensureSavings(totals);

	// Idempotency: compare-and-set against the applied-session-id ring.
	if (savings.appliedSessionIds.includes(delta.sessionId)) {
		return; // Already applied for this session id — do not double-count.
	}

	const today = todayDateString();
	const week = weekKeyForDate(today);

	savings.daily[today] = { bytes: (savings.daily[today]?.bytes ?? 0) + delta.bytes };
	savings.weekly[week] = { bytes: (savings.weekly[week]?.bytes ?? 0) + delta.bytes };
	savings.allTime = { bytes: savings.allTime.bytes + delta.bytes };

	// Record the session id, capping the ring (FIFO).
	savings.appliedSessionIds.push(delta.sessionId);
	if (savings.appliedSessionIds.length > APPLIED_SESSION_ID_RING) {
		savings.appliedSessionIds.splice(0, savings.appliedSessionIds.length - APPLIED_SESSION_ID_RING);
	}

	pruneDailyEntries(totals);
	pruneWeeklyEntries(totals);
	pruneSavingsEntries(savings);

	// Atomic write (rename-on-write).
	const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
	try {
		fs.writeFileSync(tmp, JSON.stringify(totals, null, 2), "utf8");
		fs.renameSync(tmp, p);
	} catch (err) {
		try {
			fs.unlinkSync(tmp);
		} catch {
			/* ignore */
		}
		throw err;
	}
}

/** All-time cumulative savings bytes (read-only). */
export function getAllTimeSavingsBytes(filePath?: string): number {
	return readCostTotals(filePath).savings?.allTime.bytes ?? 0;
}

/** This-week cumulative savings bytes (read-only). */
export function getThisWeekSavingsBytes(filePath?: string): number {
	const totals = readCostTotals(filePath);
	const week = weekKeyForDate(todayDateString());
	return totals.savings?.weekly[week]?.bytes ?? 0;
}

/**
 * Return today's aggregate from the file (read-only).
 */
export function getTodayTotal(filePath?: string): PeriodTotal | undefined {
	const totals = readCostTotals(filePath);
	const today = todayDateString();
	const ledger = sumLedgerRecords(
		ledgerPathForTotalsPath(filePath),
		(record) => dateStringForTimestamp(record.timestamp) === today,
	);
	return combinePeriodTotals(totals.daily[today], ledger);
}

/**
 * Return this week's aggregate from the file (read-only).
 */
export function getThisWeekTotal(filePath?: string): PeriodTotal | undefined {
	const totals = readCostTotals(filePath);
	const today = todayDateString();
	const week = weekKeyForDate(today);
	const ledger = sumLedgerRecords(ledgerPathForTotalsPath(filePath), (record) => {
		const date = dateStringForTimestamp(record.timestamp);
		return date !== undefined && weekKeyForDate(date) === week;
	});
	return combinePeriodTotals(totals.weekly[week], ledger);
}

// =============================================================================
// Internal helpers
// =============================================================================

function isEmptyCostDelta(delta: SessionCostDelta): boolean {
	return delta.dollars === 0 && delta.inputTokens === 0 && delta.outputTokens === 0;
}

function addPeriodTotal(existing: PeriodTotal | undefined, delta: SessionCostDelta): PeriodTotal {
	const base: PeriodTotal = existing ?? { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, dollars: 0 };
	return {
		input: base.input + delta.inputTokens,
		output: base.output + delta.outputTokens,
		cacheCreate: base.cacheCreate + delta.cacheCreateTokens,
		cacheRead: base.cacheRead + delta.cacheReadTokens,
		dollars: base.dollars + delta.dollars,
	};
}

function combinePeriodTotals(a: PeriodTotal | undefined, b: PeriodTotal): PeriodTotal | undefined {
	const combined = {
		input: (a?.input ?? 0) + b.input,
		output: (a?.output ?? 0) + b.output,
		cacheCreate: (a?.cacheCreate ?? 0) + b.cacheCreate,
		cacheRead: (a?.cacheRead ?? 0) + b.cacheRead,
		dollars: (a?.dollars ?? 0) + b.dollars,
	};
	return hasPeriodTotalValue(combined) ? combined : undefined;
}

function sumLedgerRecords(filePath: string, include: (record: CostLedgerRecord) => boolean): PeriodTotal {
	const total: PeriodTotal = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, dollars: 0 };
	for (const record of readCostLedgerRecords(filePath)) {
		if (!include(record)) continue;
		total.input += record.input;
		total.output += record.output;
		total.cacheCreate += record.cacheCreate;
		total.cacheRead += record.cacheRead;
		total.dollars += record.dollars;
	}
	return total;
}

function hasPeriodTotalValue(total: PeriodTotal): boolean {
	return (
		total.input !== 0 || total.output !== 0 || total.cacheCreate !== 0 || total.cacheRead !== 0 || total.dollars !== 0
	);
}

function ledgerPathForTotalsPath(filePath?: string): string {
	return filePath ? path.join(path.dirname(filePath), COST_LEDGER_FILENAME) : getCostLedgerPath();
}

function dateStringForTimestamp(timestamp: string): string | undefined {
	const d = new Date(timestamp);
	if (Number.isNaN(d.getTime())) return undefined;
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/**
 * Ensure the savings aggregate exists and is well-formed (back-fills a missing
 * or malformed `savings` block on pre-savings files).
 */
function ensureSavings(totals: CostTotalsFile): SavingsAggregate {
	const s = totals.savings;
	if (
		s &&
		typeof s === "object" &&
		typeof s.daily === "object" &&
		typeof s.weekly === "object" &&
		typeof s.allTime === "object" &&
		Array.isArray(s.appliedSessionIds)
	) {
		return s;
	}
	const fresh: SavingsAggregate = { daily: {}, weekly: {}, allTime: { bytes: 0 }, appliedSessionIds: [] };
	totals.savings = fresh;
	return fresh;
}

function pruneSavingsEntries(savings: SavingsAggregate): void {
	const dailyCutoff = new Date();
	dailyCutoff.setDate(dailyCutoff.getDate() - DAILY_RETENTION_DAYS);
	const dailyCutoffStr = dailyCutoff.toISOString().slice(0, 10);
	for (const key of Object.keys(savings.daily)) {
		if (key < dailyCutoffStr) delete savings.daily[key];
	}

	const currentWeek = weekKeyForDate(todayDateString());
	const [yearStr, weekStr] = currentWeek.split("-W");
	const currentYear = Number(yearStr);
	const currentWeekNo = Number(weekStr);
	for (const key of Object.keys(savings.weekly)) {
		const match = /^(\d{4})-W(\d{2})$/.exec(key);
		if (!match) {
			delete savings.weekly[key];
			continue;
		}
		const weeksAgo = (currentYear - Number(match[1])) * 52 + (currentWeekNo - Number(match[2]));
		if (weeksAgo > WEEKLY_RETENTION_WEEKS) delete savings.weekly[key];
	}
}

function pruneDailyEntries(totals: CostTotalsFile): void {
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - DAILY_RETENTION_DAYS);
	const cutoffStr = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD
	for (const key of Object.keys(totals.daily)) {
		if (key < cutoffStr) {
			delete totals.daily[key];
		}
	}
}

function pruneWeeklyEntries(totals: CostTotalsFile): void {
	const today = todayDateString();
	const currentWeek = weekKeyForDate(today);
	const [yearStr, weekStr] = currentWeek.split("-W");
	const currentYear = Number(yearStr);
	const currentWeekNo = Number(weekStr);

	for (const key of Object.keys(totals.weekly)) {
		// Parse "YYYY-Www"
		const match = /^(\d{4})-W(\d{2})$/.exec(key);
		if (!match) {
			delete totals.weekly[key];
			continue;
		}
		const entryYear = Number(match[1]);
		const entryWeek = Number(match[2]);
		const weeksAgo = (currentYear - entryYear) * 52 + (currentWeekNo - entryWeek);
		if (weeksAgo > WEEKLY_RETENTION_WEEKS) {
			delete totals.weekly[key];
		}
	}
}

function isValidCostTotalsFile(v: unknown): v is CostTotalsFile {
	if (typeof v !== "object" || v === null) return false;
	const o = v as Record<string, unknown>;
	return typeof o.daily === "object" && o.daily !== null && typeof o.weekly === "object" && o.weekly !== null;
}

function isValidCostLedgerRecord(v: unknown): v is CostLedgerRecord {
	if (typeof v !== "object" || v === null) return false;
	const o = v as Record<string, unknown>;
	return (
		typeof o.id === "string" &&
		o.id.length > 0 &&
		typeof o.sessionId === "string" &&
		o.sessionId.length > 0 &&
		typeof o.timestamp === "string" &&
		typeof o.input === "number" &&
		typeof o.output === "number" &&
		typeof o.cacheCreate === "number" &&
		typeof o.cacheRead === "number" &&
		typeof o.dollars === "number"
	);
}
