/**
 * Base types for interactive slash-command routing.
 *
 * Each built-in interactive command lives in its own `*-command.ts` file. That
 * file owns both pieces of command behavior: `condition()` says when the command
 * handles input, and `handleCommand()` runs the command through the UI/session
 * callbacks exposed by `InteractiveSlashCommandContext`.
 *
 * To add a new built-in command:
 * 1. Add it to `BUILTIN_SLASH_COMMANDS` in `core/slash-commands.ts`.
 * 2. Add a method to `InteractiveSlashCommandContext` only if existing callbacks are not enough.
 * 3. Create `commands/<name>-command.ts` extending `InteractiveSlashCommand`.
 * 4. Register the class in `commands/index.ts` in the correct precedence order.
 * 5. Add a sample to `test/interactive-slash-command.test.ts` so registry and router stay in sync.
 */
type MaybePromise = void | Promise<void>;

export interface InteractiveSlashCommandContext {
	editor: { setText(value: string): void };
	mode: {
		settings(): MaybePromise;
		scopedModels(): MaybePromise;
		model(searchTerm: string | undefined): MaybePromise;
		export(text: string): MaybePromise;
		import(text: string): MaybePromise;
		share(): MaybePromise;
		copy(): MaybePromise;
		name(text: string): MaybePromise;
		session(): MaybePromise;
		changelog(): MaybePromise;
		hotkeys(): MaybePromise;
		activity(): MaybePromise;
		help(): MaybePromise;
		skills(): MaybePromise;
		plugins(): MaybePromise;
		fork(): MaybePromise;
		tree(): MaybePromise;
		login(text: string): MaybePromise;
		logout(): MaybePromise;
		newSession(): MaybePromise;
		clear(): MaybePromise;
		compact(instructions: string | undefined): MaybePromise;
		freeze(label: string | undefined): MaybePromise;
		checkpoints(): MaybePromise;
		mode(text: string): MaybePromise;
		cave(text: string): MaybePromise;
		ponytail(text: string): MaybePromise;
		tokens(): MaybePromise;
		cost(): MaybePromise;
		savings(arg: string): MaybePromise;
		reload(): MaybePromise;
		hooks(args: string): MaybePromise;
		debug(): MaybePromise;
		arminSaysHi(): MaybePromise;
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
		plan(args: string): MaybePromise;
		act(args: string): MaybePromise;
		approval(args: string): MaybePromise;
		queue(args: string): MaybePromise;
		contextStatus(): MaybePromise;
		contextLearn(): MaybePromise;
		contextSetup(args: string): MaybePromise;
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
