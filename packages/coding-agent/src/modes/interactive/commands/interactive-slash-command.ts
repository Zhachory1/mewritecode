/**
 * Base types for interactive slash-command routing.
 *
 * Each built-in interactive command lives in its own `*-command.ts` file. That
 * file owns both pieces of command behavior: `condition()` says when the command
 * handles input, and `handleCommand()` runs the command through the primitives
 * exposed by `InteractiveSlashCommandContext`.
 *
 * To add a new built-in command:
 * 1. Add it to `BUILTIN_SLASH_COMMANDS` in `core/slash-commands.ts`.
 * 2. Create `commands/<name>-command.ts` extending `InteractiveSlashCommand`.
 * 3. Use context primitives (`session`, `settingsManager`, `chatContainer`, etc.) for real command behavior.
 * 4. Register the class in `commands/index.ts` in the correct precedence order.
 * 5. Add a sample to `test/interactive-slash-command.test.ts` so registry and router stay in sync.
 */
import type { Container, MarkdownTheme, TUI } from "@zhachory1/mewrite-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { SessionManager } from "../../../core/session-manager.js";
import type { SettingsManager } from "../../../core/settings-manager.js";

type MaybePromise = void | Promise<void>;

export interface FreezeCheckpoint {
	label?: string;
	tokensBefore: number;
	tokensAfter: number;
	savedAt: string;
}

export interface InteractiveSlashCommandContext {
	editor: { setText(value: string): void; addToHistory?(value: string): void };
	ui: TUI;
	chatContainer: Container;
	statusContainer: Container;
	session: AgentSession;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	freezeCheckpoints: FreezeCheckpoint[];
	stopLoadingAndClearStatus(): void;
	buildHotkeysMarkdown(): string;
	getMarkdownTheme(): MarkdownTheme;
	showError(message: string): void;
	showStatus(message: string): void;
	showWarning(message: string): void;
	appendSlashOutput(text: string, isError: boolean): void;
	refreshChatModeFooter(): void;
	refreshApprovalFooter(): void;
	updateTerminalTitle(): void;
	legacy: {
		settings(): MaybePromise;
		scopedModels(): MaybePromise;
		model(searchTerm: string | undefined): MaybePromise;
		export(text: string): MaybePromise;
		import(text: string): MaybePromise;
		share(): MaybePromise;
		activity(): MaybePromise;
		skills(): MaybePromise;
		plugins(): MaybePromise;
		fork(): MaybePromise;
		tree(): MaybePromise;
		login(text: string): MaybePromise;
		logout(): MaybePromise;
		newSession(): MaybePromise;
		clear(): MaybePromise;
		savings(arg: string): MaybePromise;
		reload(): MaybePromise;
		hooks(args: string): MaybePromise;
		debug(): MaybePromise;
		resume(target: string | undefined): MaybePromise;
		quit(): MaybePromise;
		mcp(text: string): MaybePromise;
		memory(text: string): MaybePromise;
		repomap(args: string): MaybePromise;
		architect(args: string): MaybePromise;
		recipe(text: string): MaybePromise;
		checkpoint(args: string): MaybePromise;
		rollback(args: string): MaybePromise;
		goal(args: string): MaybePromise;
		queue(args: string): MaybePromise;
		btw(question: string): MaybePromise;
	};
}

export abstract class InteractiveSlashCommand {
	abstract readonly name: string;
	abstract condition(text: string): boolean;
	abstract handleCommand(text: string, context: InteractiveSlashCommandContext): MaybePromise;
}

export class InteractiveSlashCommandRouter {
	constructor(
		private readonly context: InteractiveSlashCommandContext,
		private readonly commands: readonly InteractiveSlashCommand[],
	) {}

	canHandle(text: string): boolean {
		const trimmed = text.trim();
		return this.commands.some((command) => command.condition(trimmed));
	}

	async handleCommand(text: string): Promise<boolean> {
		const trimmed = text.trim();
		for (const command of this.commands) {
			if (command.condition(trimmed)) {
				await command.handleCommand(trimmed, this.context);
				return true;
			}
		}
		return false;
	}
}

export function exact(command: string, text: string): boolean {
	return text === command;
}

export function exactOrArg(command: string, text: string): boolean {
	return text === command || text.startsWith(`${command} `);
}

export function broadPrefix(command: string, text: string): boolean {
	return text.startsWith(command);
}

export function arg(text: string, command: string): string | undefined {
	if (text === command) return undefined;
	const prefix = `${command} `;
	if (!text.startsWith(prefix)) return undefined;
	return text.slice(prefix.length).trim() || undefined;
}

export function args(text: string, command: string): string {
	return arg(text, command) ?? "";
}

export async function clearAnd(context: InteractiveSlashCommandContext, run: () => MaybePromise): Promise<void> {
	context.editor.setText("");
	await run();
}
