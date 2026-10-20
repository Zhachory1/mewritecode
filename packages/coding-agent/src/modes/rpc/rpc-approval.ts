/**
 * Fail-closed approval channel for RPC clients (approval mode only).
 *
 * The runtime emits `approval_request` only after a client negotiates the exact
 * capability. Every other path (no negotiation, malformed or late reply, abort,
 * timeout, session replacement, shutdown) resolves to "deny".
 */

import * as crypto from "node:crypto";
import type { ApprovalDecision, RequestApprovalFn } from "../../core/agent-session.js";
import type { RiskTier } from "../../core/approval-policy.js";

export const APPROVAL_POLICY_VERSION = "danger-policy-v1";
export const APPROVAL_DIALOG_CAPABILITY = Object.freeze({
	version: 1,
	dangerPolicyVersion: APPROVAL_POLICY_VERSION,
	maxPayloadBytes: 8192,
	decisions: Object.freeze(["once", "deny"] as const),
});
export const APPROVAL_TIMEOUT_MS = 120_000;

export type ApprovalDialogCapability = typeof APPROVAL_DIALOG_CAPABILITY;

// Characters a reviewer cannot see are escaped so the dialog shows exactly what runs.
const INVISIBLE = /[\u007f-\u009f]|\p{Default_Ignorable_Code_Point}|\p{Bidi_Control}|\p{White_Space}/gu;
const escapeInvisible = (text: string) =>
	text.replace(INVISIBLE, (ch) =>
		ch === " " ? ch : [...ch].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join(""),
	);

function canonical(value: unknown, ancestors: Set<object>): unknown {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return value;
	if (typeof value !== "object" || ancestors.has(value)) throw new Error("Unrepresentable approval arguments");
	ancestors.add(value);
	try {
		if (Array.isArray(value)) return Array.from(value, (item) => canonical(item, ancestors));
		const proto = Object.getPrototypeOf(value);
		if (proto !== Object.prototype && proto !== null) throw new Error("Unrepresentable approval arguments");
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort())
			out[key] = canonical((value as Record<string, unknown>)[key], ancestors);
		return out;
	} finally {
		ancestors.delete(value);
	}
}

/** Deterministic JSON with sorted keys and visibly escaped invisible characters. Throws if lossy. */
export function canonicalizeApprovalArguments(args: unknown): string {
	return escapeInvisible(JSON.stringify(canonical(args, new Set())));
}

export function approvalCapabilityMatches(value: unknown): boolean {
	const cap = value as Partial<ApprovalDialogCapability> | undefined;
	return (
		cap?.version === APPROVAL_DIALOG_CAPABILITY.version &&
		cap.dangerPolicyVersion === APPROVAL_POLICY_VERSION &&
		cap.maxPayloadBytes === APPROVAL_DIALOG_CAPABILITY.maxPayloadBytes &&
		Array.isArray(cap.decisions) &&
		cap.decisions.length === 2 &&
		cap.decisions[0] === "once" &&
		cap.decisions[1] === "deny"
	);
}

interface Pending {
	settle: (decision: ApprovalDecision, reason?: string) => void;
}

export class RpcApprovalChannel {
	private negotiated = false;
	private closed = false;
	private generation = 0;
	private readonly pending = new Map<string, Pending>();

	constructor(private readonly output: (record: object) => void) {}

	negotiate(capability: unknown): boolean {
		if (this.closed) return false;
		this.negotiated = approvalCapabilityMatches(capability);
		if (!this.negotiated) this.denyAll("capability_changed");
		return this.negotiated;
	}

	/** Returns the approval callback for a session; requests from an older binding deny. */
	bind(): RequestApprovalFn {
		this.denyAll("session_replaced");
		const generation = ++this.generation;
		return (toolName, args, tier, signal) => this.request(generation, toolName, args, tier, signal);
	}

	private request(
		generation: number,
		toolName: string,
		args: unknown,
		tier: RiskTier,
		signal?: AbortSignal,
	): Promise<ApprovalDecision> {
		if (!this.negotiated || this.closed || signal?.aborted || generation !== this.generation) {
			return Promise.resolve("deny");
		}
		let argumentsJson: string;
		try {
			argumentsJson = canonicalizeApprovalArguments(args);
		} catch {
			return Promise.resolve("deny");
		}
		if (Buffer.byteLength(argumentsJson, "utf8") > APPROVAL_DIALOG_CAPABILITY.maxPayloadBytes) {
			return Promise.resolve("deny");
		}
		const id = crypto.randomUUID();
		return new Promise((resolve) => {
			const onAbort = () => settle("deny", "aborted");
			const timeout = setTimeout(() => settle("deny", "timeout"), APPROVAL_TIMEOUT_MS);
			const settle = (decision: ApprovalDecision, reason?: string) => {
				if (!this.pending.delete(id)) return;
				clearTimeout(timeout);
				signal?.removeEventListener("abort", onAbort);
				if (reason) this.output({ type: "approval_closed", id, reason });
				resolve(decision);
			};
			this.pending.set(id, { settle });
			signal?.addEventListener("abort", onAbort, { once: true });
			this.output({
				type: "approval_request",
				id,
				version: APPROVAL_DIALOG_CAPABILITY.version,
				dangerPolicyVersion: APPROVAL_POLICY_VERSION,
				toolName: escapeInvisible(JSON.stringify(String(toolName)).slice(1, -1)),
				tier,
				argumentsJson,
				decisions: ["once", "deny"],
				timeoutMs: APPROVAL_TIMEOUT_MS,
			});
		});
	}

	handleResponse(response: {
		id?: unknown;
		version?: unknown;
		dangerPolicyVersion?: unknown;
		decision?: unknown;
	}): void {
		const entry = typeof response.id === "string" ? this.pending.get(response.id) : undefined;
		if (!entry) return;
		const valid =
			this.negotiated &&
			response.version === APPROVAL_DIALOG_CAPABILITY.version &&
			response.dangerPolicyVersion === APPROVAL_POLICY_VERSION &&
			response.decision === "once";
		entry.settle(valid ? "once" : "deny");
	}

	denyAll(reason: string): void {
		for (const entry of [...this.pending.values()]) entry.settle("deny", reason);
	}

	close(): void {
		this.closed = true;
		this.negotiated = false;
		this.generation++;
		this.denyAll("shutdown");
	}
}
