/**
 * `send_message` and `task_status` — built-in tools for steering and
 * observing background subagents.
 *
 * Wire-up: cave spawns a subagent with `background: true` via the `task` tool
 * and registers it in `background-task-registry.ts`. The parent later calls:
 *
 *   - `send_message({to, message})` — append a steering message to the child's
 *     inbox file and registry mailbox.
 *   - `task_status({})` — list all background subagents (id, name, status,
 *     exit code, output file).
 *
 * Reference: claude-code SendMessageTool.ts:67-80 and Task.ts:108-125.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import { Text } from "@zhachory1/mewrite-tui";
import { getBackground, listBackground, postMessage } from "../background-task-registry.js";
import type { ToolDefinition } from "../extensions/types.js";

// ─── send_message ────────────────────────────────────────────────────────

const SendMessageSchema = Type.Object({
	to: Type.String({ description: "Background subagent id (or addressable name)" }),
	message: Type.String({ description: "Free-form steering text to deliver" }),
});

export type SendMessageInput = Static<typeof SendMessageSchema>;

export interface SendMessageDetails {
	to: string;
	delivered: boolean;
	inboxPath: string;
}

export const sendMessageToolDefinition: ToolDefinition<typeof SendMessageSchema, SendMessageDetails> = {
	name: "send_message",
	label: "SendMessage",
	description: [
		"Deliver a steering message to a background subagent that was launched via `task` with `background: true`.",
		"Useful for: course-correction mid-flight, escalating priority, requesting a status update, asking the child to abort.",
		"The message is appended to the child's `inbox.jsonl` and to its in-process mailbox so the next steering poll picks it up.",
	].join(" "),
	promptSnippet: "Steer a background subagent (must have been launched via task background:true)",
	parameters: SendMessageSchema,
	async execute(_id, params) {
		const entry = getBackground(params.to);
		const delivered = postMessage(params.to, params.message);
		// Always write to disk — survives process restart and is readable by the
		// child via the same path ($HOME/.cave/tasks/<agentId>/inbox.jsonl).
		const dir = entry?.outputFile ? dirname(entry.outputFile) : "";
		const inboxPath = dir ? join(dir, "inbox.jsonl") : "";
		if (inboxPath) {
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			appendFileSync(inboxPath, `${JSON.stringify({ ts: Date.now(), message: params.message })}\n`, {
				encoding: "utf-8",
				mode: 0o600,
			});
		}
		const text = entry
			? delivered
				? `Message queued for ${params.to} (mailbox + ${inboxPath})`
				: `Subagent ${params.to} is no longer running. Message persisted to ${inboxPath}.`
			: `No subagent registered as "${params.to}". Cannot deliver.`;
		return {
			content: [{ type: "text" as const, text }],
			details: { to: params.to, delivered, inboxPath },
		};
	},
	renderCall(args, theme) {
		const head = theme.fg("toolTitle", theme.bold("send_message "));
		const target = theme.fg("accent", args.to);
		const preview = theme.fg("dim", ` ${(args.message ?? "").slice(0, 60)}`);
		return new Text(head + target + preview, 0, 0);
	},
};

// ─── task_status ─────────────────────────────────────────────────────────

const TaskStatusSchema = Type.Object({});

export type TaskStatusInput = Static<typeof TaskStatusSchema>;

export const taskStatusToolDefinition: ToolDefinition<typeof TaskStatusSchema, undefined> = {
	name: "task_status",
	label: "TaskStatus",
	description:
		"List all background subagents launched in this parent session: id, name, status, exit code, output file.",
	promptSnippet: "List in-flight background subagents (their agentIds, output files, statuses)",
	parameters: TaskStatusSchema,
	async execute() {
		const all = listBackground();
		if (all.length === 0) {
			return {
				content: [{ type: "text" as const, text: "No background subagents have been launched in this session." }],
				details: undefined,
			};
		}
		const rows = all.map((e) => {
			const ms = (e.finishedAt ?? Date.now()) - e.startedAt;
			return `[${e.status}] ${e.agentId} (${e.subagentName}) — exit=${e.exitCode ?? "-"} dur=${ms}ms — ${e.outputFile}`;
		});
		return {
			content: [{ type: "text" as const, text: rows.join("\n") }],
			details: undefined,
		};
	},
	renderCall(_args, theme) {
		return new Text(theme.fg("toolTitle", theme.bold("task_status")), 0, 0);
	},
};
