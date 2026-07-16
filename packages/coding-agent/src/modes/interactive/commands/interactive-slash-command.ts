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
import type { Model, OAuthProviderId } from "@zhachory1/mewrite-ai";
import type { Component, Container, EditorComponent, Loader, MarkdownTheme, TUI } from "@zhachory1/mewrite-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { AgentSessionRuntime } from "../../../core/agent-session-runtime.js";
import type { ArchitectModeState } from "../../../core/chat-modes/architect.js";
import type { ExtensionUIContext, ExtensionUIDialogOptions } from "../../../core/extensions/index.js";
import type { FooterDataProvider } from "../../../core/footer-data-provider.js";
import type { KeybindingsManager } from "../../../core/keybindings.js";
import type { MissingSessionCwdError } from "../../../core/session-cwd.js";
import type { SessionManager } from "../../../core/session-manager.js";
import type { SettingsManager } from "../../../core/settings-manager.js";
import type { RepomapChatState } from "../../../core/slash-commands.js";
import type { SourceInfo } from "../../../core/source-info.js";

type MaybePromise = void | Promise<void>;

export interface FreezeCheckpoint {
	label?: string;
	tokensBefore: number;
	tokensAfter: number;
	savedAt: string;
}

export interface InteractiveSlashCommandContext {
	editor: EditorComponent;
	defaultEditor: EditorComponent & {
		onEscape?: (() => void) | undefined;
		onExtensionShortcut?: ((data: string) => boolean | undefined) | undefined;
	};
	clearEditor(): void;
	ui: TUI;
	chatContainer: Container;
	statusContainer: Container;
	editorContainer: Container;
	footer: Component & { invalidate(): void; setAutoCompactEnabled(enabled: boolean): void };
	footerDataProvider: FooterDataProvider;
	loadingAnimation: Loader | undefined;
	keybindings: KeybindingsManager;
	runtimeHost: AgentSessionRuntime;
	session: AgentSession;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	freezeCheckpoints: FreezeCheckpoint[];
	commandQueue: string[];
	repomapChatState: RepomapChatState;
	architectState: ArchitectModeState;
	renderCurrentSessionState(): void;
	handleRuntimeSessionChange(): Promise<void>;
	handleFatalRuntimeError(prefix: string, error: unknown): Promise<never>;
	updatePendingMessagesDisplay(): void;
	buildHotkeysMarkdown(): string;
	getMarkdownTheme(): MarkdownTheme;
	showError(message: string): void;
	showStatus(message: string): void;
	showWarning(message: string): void;
	showOAuthSelector(action: "login" | "logout"): MaybePromise;
	showLoginDialog(provider: OAuthProviderId): MaybePromise;
	showSelector(factory: (done: () => void) => { component: Component; focus: Component }): void;
	toggleActivityOverlay(): void;
	shutdown(): MaybePromise;
	appendSlashOutput(text: string, isError: boolean): void;
	refreshChatModeFooter(): void;
	refreshApprovalFooter(): void;
	updateTerminalTitle(): void;
	updateEditorBorderColor(): void;
	checkDaxnutsEasterEgg(model: Model<any>): void;
	disposeMountedToolRows(): void;
	renderInitialMessages(): void;
	extensionUi: ExtensionUIContext;
	showExtensionSelector(title: string, options: string[]): Promise<string | undefined>;
	showExtensionEditor(title: string): Promise<string | undefined>;
	showExtensionConfirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean>;
	promptForMissingSessionCwd(error: MissingSessionCwdError): Promise<string | undefined>;
	resetExtensionUI(): void;
	setupAutocomplete(): void;
	rebuildChatFromMessages(): void;
	showLoadedResources(options?: {
		extensions?: Array<{ path: string; sourceInfo?: SourceInfo }>;
		force?: boolean;
		showDiagnosticsWhenQuiet?: boolean;
	}): void;
}

export abstract class InteractiveSlashCommand {
	abstract readonly name: string;
	abstract condition(text: string): boolean;
	abstract handleCommand(text: string, context: InteractiveSlashCommandContext): MaybePromise;
}

export class InteractiveSlashCommandRouter {
	constructor(private readonly commands: readonly InteractiveSlashCommand[]) {}

	canHandle(text: string): boolean {
		const trimmed = text.trim();
		return this.commands.some((command) => command.condition(trimmed));
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<boolean> {
		const trimmed = text.trim();
		for (const command of this.commands) {
			if (command.condition(trimmed)) {
				await command.handleCommand(trimmed, context);
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
	context.clearEditor();
	await run();
}
