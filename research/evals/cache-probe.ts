#!/usr/bin/env npx tsx
/**
 * cache-probe.ts — controlled paired test of the [system+tools] cache breakpoint (#42).
 *
 * Council (ab-critic) ruling: you CANNOT confirm "the explicit tools breakpoint is a
 * no-op" from aggregate cacheRead/cacheWrite on a live run — you need the SAME content
 * sent WITH vs WITHOUT the breakpoint. This does exactly that, synthetically + cheaply:
 *
 * Per (arm, repeat):
 *   - a UNIQUE nonce in the system prompt → cold cache start (no cross-run warm bleed).
 *   - Turn 1: send [system, tools, history]  → WARMS the cache (cacheWrite of the prefix).
 *   - Turn 2: append one new user msg, resend → READS the warm prefix; cacheWrite = only
 *     the genuinely-new tail. We measure Turn 2's cacheRead/cacheWrite.
 * Arm OFF: CAVE_TOOLS_CACHE_BREAKPOINT unset. Arm ON: =1 (tools breakpoint active).
 *
 * Hypothesis under test: the tools breakpoint reduces Turn-2 cacheWrite (or raises
 * cacheRead). If Turn-2 numbers are statistically identical across arms, the breakpoint
 * is a NO-OP — Anthropic's automatic prefix-matching already caches [system+tools].
 *
 * PAID but tiny: 2 arms x N repeats x 2 turns Anthropic calls. Use a cheap-ish model.
 */

import { getModel } from "../../packages/ai/src/models.js";
import { completeSimple } from "../../packages/ai/src/stream.js";
import type { Context, Message } from "../../packages/ai/src/types.js";
import { AuthStorage } from "../../packages/coding-agent/src/core/auth-storage.js";
import { ModelRegistry } from "../../packages/coding-agent/src/core/model-registry.js";

// Resolved once in main(): the OAuth-aware apiKey + headers (completeSimple does NOT
// resolve auth itself; the agent path uses modelRegistry.getApiKeyAndHeaders).
let AUTH: { apiKey?: string; headers?: Record<string, string> } = {};

// A chunky, fixed system prompt (~stable across turns within a run; nonce makes runs cold).
const SYSTEM_BASE = [
	"You are a coding agent. Follow instructions precisely.",
	"Read before you edit. Do not infer file contents from a name.",
	"Do not add features, refactors, or abstractions beyond what the task requires.",
	"Default to no comments; only add one when the WHY is non-obvious.",
	"Be careful not to introduce security vulnerabilities.",
	"Faithfully report outcomes; never claim tests pass when they do not.",
].join(" ");

// Pad the system prompt so it is large enough to matter for caching (~1k+ tokens).
function systemFor(nonce: string): string {
	const pad = Array.from({ length: 60 }, (_, i) => `Guideline ${i}: keep edits minimal and verified.`).join(" ");
	return `${SYSTEM_BASE}\n\n${pad}\n\nSession nonce: ${nonce}`;
}

// A few realistic tool definitions (enough schema to be ~1k+ tokens).
const TOOLS = [
	{
		name: "read",
		description: "Read a file from disk. Returns the file contents with line numbers.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "Absolute path to the file to read." },
				offset: { type: "number", description: "Line number to start reading from." },
				limit: { type: "number", description: "Number of lines to read." },
			},
			required: ["path"],
		},
	},
	{
		name: "bash",
		description: "Execute a bash command and return stdout/stderr. Working directory persists.",
		parameters: {
			type: "object",
			properties: {
				command: { type: "string", description: "The bash command to execute." },
				timeout: { type: "number", description: "Timeout in milliseconds." },
				description: { type: "string", description: "What the command does." },
			},
			required: ["command"],
		},
	},
	{
		name: "edit",
		description: "Replace an exact string in a file. old_string must match uniquely.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "Absolute path to the file to modify." },
				old_string: { type: "string", description: "Exact text to replace." },
				new_string: { type: "string", description: "Replacement text." },
				replace_all: { type: "boolean", description: "Replace every occurrence." },
			},
			required: ["path", "old_string", "new_string"],
		},
	},
	{
		name: "write",
		description: "Write a file to disk, overwriting if it exists.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "Absolute path to write." },
				content: { type: "string", description: "The full file contents." },
			},
			required: ["path", "content"],
		},
	},
	{
		name: "grep",
		description: "Search file contents with a regex. Returns matching lines.",
		parameters: {
			type: "object",
			properties: {
				pattern: { type: "string", description: "Regex to search for." },
				path: { type: "string", description: "Directory or file to search." },
				glob: { type: "string", description: "Glob filter for files." },
			},
			required: ["pattern"],
		},
	},
] as unknown as Context["tools"];

// Fixed message history present in BOTH turns (stable prefix).
const HISTORY: Message[] = [
	{ role: "user", content: [{ type: "text", text: "Investigate the agent loop and summarize how a turn executes." }] },
	{
		role: "assistant",
		content: [
			{
				type: "text",
				text: "The loop builds context, calls the provider, executes tool calls, appends results, and repeats until no tool calls remain or maxTurns is hit.",
			},
		],
	},
	{
		role: "user",
		content: [{ type: "text", text: "Good. Now check whether temperature is plumbed through to the provider." }],
	},
] as unknown as Message[];

const TURN2_APPEND: Message[] = [
	{ role: "assistant", content: [{ type: "text", text: "Yes — temperature threads via createLoopConfig into the stream options." }] },
	{ role: "user", content: [{ type: "text", text: "Now confirm the cache breakpoint placement in the Anthropic provider." }] },
] as unknown as Message[];

async function oneRun(
	model: ReturnType<typeof getModel>,
	nonce: string,
): Promise<{ t2Read: number; t2Write: number; t2Input: number }> {
	if (!model) throw new Error("model not found");
	const systemPrompt = systemFor(nonce);
	const opts = { temperature: 0, apiKey: AUTH.apiKey, headers: AUTH.headers };
	// Turn 1 — warm the [system+tools+history] prefix.
	await completeSimple(model, { systemPrompt, tools: TOOLS, messages: HISTORY }, opts);
	// Brief settle so the cache write is registered before the read.
	await new Promise((r) => setTimeout(r, 1500));
	// Turn 2 — same prefix + appended tail; measure cache behavior.
	const t2 = await completeSimple(
		model,
		{ systemPrompt, tools: TOOLS, messages: [...HISTORY, ...TURN2_APPEND] },
		opts,
	);
	return { t2Read: t2.usage.cacheRead, t2Write: t2.usage.cacheWrite, t2Input: t2.usage.input };
}

function mean(xs: number[]): number {
	return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

async function main(): Promise<void> {
	const modelId = process.env.PROBE_MODEL || "claude-sonnet-4-6";
	const model = getModel("anthropic", modelId as never);
	if (!model) throw new Error(`model not found: ${modelId}`);
	// Resolve OAuth-aware auth the same way the agent does.
	const registry = ModelRegistry.create(AuthStorage.create());
	const auth = await registry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(`auth failed: ${auth.error}`);
	AUTH = { apiKey: auth.apiKey, headers: auth.headers };
	const repeats = Number(process.env.PROBE_REPEATS || "3");
	console.log(`# Cache-probe: [system+tools] breakpoint vs auto-prefix (#42)`);
	console.log(`model=anthropic/${modelId}  repeats=${repeats}/arm  (Turn-2 numbers)\n`);

	const arms: Array<{ name: string; flag: string | undefined }> = [
		{ name: "OFF (no tools breakpoint)", flag: undefined },
		{ name: "ON  (tools breakpoint)", flag: "1" },
	];
	const results: Record<string, { read: number[]; write: number[]; input: number[] }> = {};

	for (const arm of arms) {
		results[arm.name] = { read: [], write: [], input: [] };
		for (let i = 0; i < repeats; i++) {
			if (arm.flag) process.env.CAVE_TOOLS_CACHE_BREAKPOINT = arm.flag;
			else process.env.CAVE_TOOLS_CACHE_BREAKPOINT = undefined as unknown as string;
			// Unique nonce per (arm,repeat) → cold cache; arm+i keeps prefixes distinct.
			const nonce = `probe-${arm.flag ? "on" : "off"}-${i}-${process.pid}`;
			const r = await oneRun(model, nonce);
			results[arm.name].read.push(r.t2Read);
			results[arm.name].write.push(r.t2Write);
			results[arm.name].input.push(r.t2Input);
			console.log(`  ${arm.name} #${i}: t2 cacheRead=${r.t2Read} cacheWrite=${r.t2Write} input=${r.t2Input}`);
		}
	}

	console.log(`\n## Turn-2 means`);
	for (const arm of arms) {
		const r = results[arm.name];
		console.log(
			`  ${arm.name}: cacheRead=${mean(r.read).toFixed(0)} cacheWrite=${mean(r.write).toFixed(0)} input=${mean(r.input).toFixed(0)}`,
		);
	}
	const off = results[arms[0].name];
	const on = results[arms[1].name];
	const dWrite = mean(on.write) - mean(off.write);
	const dRead = mean(on.read) - mean(off.read);
	console.log(`\n## Verdict`);
	console.log(`  Δ cacheWrite (ON−OFF) = ${dWrite.toFixed(0)} tokens   Δ cacheRead (ON−OFF) = ${dRead.toFixed(0)} tokens`);
	console.log(
		`  ${Math.abs(dWrite) < 200 && Math.abs(dRead) < 200 ? "NO-OP: tools breakpoint does not move Turn-2 cache behavior beyond noise → Anthropic auto-prefix already caches [system+tools]." : "EFFECT: tools breakpoint moved cache behavior — investigate further (controlled, but check TTL noise across more repeats)."}`,
	);
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
