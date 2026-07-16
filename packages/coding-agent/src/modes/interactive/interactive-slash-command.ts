/**
 * Interactive slash-command router.
 *
 * This module owns the ordered condition+callback table for built-in slash
 * commands in the TUI. `InteractiveMode` still owns UI/session methods, but it
 * passes those methods in as callbacks so command matching, argument parsing,
 * and editor-clearing order live in one place.
 *
 * To add a built-in interactive command:
 * 1. Add it to `BUILTIN_SLASH_COMMANDS` in `core/slash-commands.ts`.
 * 2. Add a callback to `InteractiveSlashCommandHandlers` when new behavior is needed.
 * 3. Register one ordered entry in `registerDefaults()` with its match predicate and callback.
 * 4. Add a sample in `test/interactive-slash-command.test.ts`; that keeps the registry and router in sync.
 */
type MaybePromise = void | Promise<void>;

export interface InteractiveSlashCommandHandlers {
	setEditorText(value: string): void;
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
	skills(mode: "marketplace" | undefined): MaybePromise;
	fork(): MaybePromise;
	tree(): MaybePromise;
	login(text: string): MaybePromise;
	logout(): MaybePromise;
	clear(): MaybePromise;
	compact(instructions: string | undefined): MaybePromise;
	freeze(label: string | undefined): MaybePromise;
	checkpoints(): MaybePromise;
	caveMode(text: string): MaybePromise;
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
}

interface InteractiveSlashCommandRegistration {
	name: string;
	matches(text: string): boolean;
	run(text: string): MaybePromise;
}

function arg(text: string, command: string): string | undefined {
	if (text === command) return undefined;
	const prefix = `${command} `;
	if (!text.startsWith(prefix)) return undefined;
	return text.slice(prefix.length).trim() || undefined;
}

function args(text: string, command: string): string {
	return arg(text, command) ?? "";
}

function exact(command: string): (text: string) => boolean {
	return (text) => text === command;
}

function exactOrArg(command: string): (text: string) => boolean {
	return (text) => text === command || text.startsWith(`${command} `);
}

function broadPrefix(command: string): (text: string) => boolean {
	return (text) => text.startsWith(command);
}

export class InteractiveSlashCommandRouter {
	private readonly commands: InteractiveSlashCommandRegistration[] = [];

	constructor(private readonly handlers: InteractiveSlashCommandHandlers) {
		this.registerDefaults();
	}

	private add(command: InteractiveSlashCommandRegistration): void {
		this.commands.push(command);
	}

	private clearAnd(run: () => MaybePromise): MaybePromise {
		this.handlers.setEditorText("");
		return run();
	}

	/**
	 * Registration order is command precedence. Keep broad-prefix commands
	 * (`/export*`, `/import*`) in their legacy positions and put narrower nested
	 * commands (`/context learn`, `/context setup`) before any future broad
	 * `/context` catch-all.
	 */
	private registerDefaults(): void {
		this.add({
			name: "settings",
			matches: exact("/settings"),
			run: () => {
				this.handlers.settings();
				this.handlers.setEditorText("");
			},
		});
		this.add({
			name: "scoped-models",
			matches: exact("/scoped-models"),
			run: () => this.clearAnd(() => this.handlers.scopedModels()),
		});
		this.add({
			name: "model",
			matches: exactOrArg("/model"),
			run: (text) => this.clearAnd(() => this.handlers.model(arg(text, "/model"))),
		});
		this.add({
			name: "export",
			matches: broadPrefix("/export"),
			run: async (text) => {
				await this.handlers.export(text);
				this.handlers.setEditorText("");
			},
		});
		this.add({
			name: "import",
			matches: broadPrefix("/import"),
			run: async (text) => {
				await this.handlers.import(text);
				this.handlers.setEditorText("");
			},
		});
		this.add({
			name: "share",
			matches: exact("/share"),
			run: async () => {
				await this.handlers.share();
				this.handlers.setEditorText("");
			},
		});
		this.add({
			name: "copy",
			matches: exact("/copy"),
			run: async () => {
				await this.handlers.copy();
				this.handlers.setEditorText("");
			},
		});
		this.add({
			name: "name",
			matches: exactOrArg("/name"),
			run: (text) => {
				this.handlers.name(text);
				this.handlers.setEditorText("");
			},
		});
		this.add({
			name: "session",
			matches: exact("/session"),
			run: () => {
				this.handlers.session();
				this.handlers.setEditorText("");
			},
		});
		this.add({
			name: "changelog",
			matches: exact("/changelog"),
			run: () => {
				this.handlers.changelog();
				this.handlers.setEditorText("");
			},
		});
		this.add({
			name: "hotkeys",
			matches: exact("/hotkeys"),
			run: () => {
				this.handlers.hotkeys();
				this.handlers.setEditorText("");
			},
		});
		this.add({
			name: "activity",
			matches: exact("/activity"),
			run: () => this.clearAnd(() => this.handlers.activity()),
		});
		this.add({ name: "help", matches: exact("/help"), run: () => this.clearAnd(() => this.handlers.help()) });
		this.add({
			name: "skills",
			matches: (text) => text === "/skills" || text === "/plugins",
			run: (text) => this.clearAnd(() => this.handlers.skills(text === "/plugins" ? "marketplace" : undefined)),
		});
		this.add({
			name: "fork",
			matches: exact("/fork"),
			run: () => {
				this.handlers.fork();
				this.handlers.setEditorText("");
			},
		});
		this.add({
			name: "tree",
			matches: exact("/tree"),
			run: () => {
				this.handlers.tree();
				this.handlers.setEditorText("");
			},
		});
		this.add({
			name: "login",
			matches: exactOrArg("/login"),
			run: (text) => this.clearAnd(() => this.handlers.login(text)),
		});
		this.add({
			name: "logout",
			matches: exact("/logout"),
			run: () => {
				this.handlers.logout();
				this.handlers.setEditorText("");
			},
		});
		this.add({
			name: "clear",
			matches: (text) => text === "/new" || text === "/clear",
			run: () => this.clearAnd(() => this.handlers.clear()),
		});
		this.add({
			name: "compact",
			matches: exactOrArg("/compact"),
			run: (text) => this.clearAnd(() => this.handlers.compact(arg(text, "/compact"))),
		});
		this.add({
			name: "freeze",
			matches: exactOrArg("/freeze"),
			run: (text) => this.clearAnd(() => this.handlers.freeze(arg(text, "/freeze"))),
		});
		this.add({
			name: "checkpoints",
			matches: exact("/checkpoints"),
			run: () => this.clearAnd(() => this.handlers.checkpoints()),
		});
		this.add({
			name: "mode",
			matches: (text) => exactOrArg("/mode")(text) || exactOrArg("/cave")(text),
			run: (text) => this.clearAnd(() => this.handlers.caveMode(text)),
		});
		this.add({
			name: "ponytail",
			matches: exactOrArg("/ponytail"),
			run: (text) => this.clearAnd(() => this.handlers.ponytail(text)),
		});
		this.add({ name: "tokens", matches: exact("/tokens"), run: () => this.clearAnd(() => this.handlers.tokens()) });
		this.add({ name: "cost", matches: exact("/cost"), run: () => this.clearAnd(() => this.handlers.cost()) });
		this.add({
			name: "savings",
			matches: exactOrArg("/savings"),
			run: (text) => this.clearAnd(() => this.handlers.savings(args(text, "/savings"))),
		});
		this.add({ name: "reload", matches: exact("/reload"), run: () => this.clearAnd(() => this.handlers.reload()) });
		this.add({
			name: "hooks",
			matches: exactOrArg("/hooks"),
			run: (text) => this.clearAnd(() => this.handlers.hooks(args(text, "/hooks"))),
		});
		this.add({
			name: "debug",
			matches: exact("/debug"),
			run: () => {
				this.handlers.debug();
				this.handlers.setEditorText("");
			},
		});
		this.add({
			name: "arminsayshi",
			matches: exact("/arminsayshi"),
			run: () => {
				this.handlers.arminSaysHi();
				this.handlers.setEditorText("");
			},
		});
		this.add({
			name: "resume",
			matches: exactOrArg("/resume"),
			run: (text) => this.clearAnd(() => this.handlers.resume(arg(text, "/resume"))),
		});
		this.add({ name: "quit", matches: exact("/quit"), run: () => this.clearAnd(() => this.handlers.quit()) });
		this.add({
			name: "mcp",
			matches: exactOrArg("/mcp"),
			run: (text) => this.clearAnd(() => this.handlers.mcp(text)),
		});
		this.add({
			name: "memory",
			matches: exactOrArg("/memory"),
			run: (text) => this.clearAnd(() => this.handlers.memory(text)),
		});
		this.add({
			name: "repomap",
			matches: exactOrArg("/repomap"),
			run: (text) => this.clearAnd(() => this.handlers.repomap(args(text, "/repomap"))),
		});
		this.add({
			name: "architect",
			matches: exactOrArg("/architect"),
			run: (text) => this.clearAnd(() => this.handlers.architect(args(text, "/architect"))),
		});
		this.add({
			name: "recipe",
			matches: exactOrArg("/recipe"),
			run: (text) => this.clearAnd(() => this.handlers.recipe(text)),
		});
		this.add({
			name: "checkpoint",
			matches: exactOrArg("/checkpoint"),
			run: (text) => this.clearAnd(() => this.handlers.checkpoint(args(text, "/checkpoint"))),
		});
		this.add({
			name: "rollback",
			matches: exactOrArg("/rollback"),
			run: (text) => this.clearAnd(() => this.handlers.rollback(args(text, "/rollback"))),
		});
		this.add({
			name: "goal",
			matches: exactOrArg("/goal"),
			run: (text) => this.clearAnd(() => this.handlers.goal(args(text, "/goal"))),
		});
		this.add({
			name: "plan",
			matches: exactOrArg("/plan"),
			run: (text) => this.clearAnd(() => this.handlers.plan(args(text, "/plan"))),
		});
		this.add({
			name: "act",
			matches: exactOrArg("/act"),
			run: (text) => this.clearAnd(() => this.handlers.act(args(text, "/act"))),
		});
		this.add({
			name: "approval",
			matches: exactOrArg("/approval"),
			run: (text) => this.clearAnd(() => this.handlers.approval(args(text, "/approval"))),
		});
		this.add({
			name: "queue",
			matches: exactOrArg("/queue"),
			run: (text) => this.clearAnd(() => this.handlers.queue(args(text, "/queue"))),
		});
		this.add({
			name: "context",
			matches: (text) =>
				text === "/context" ||
				text === "/context status" ||
				text === "/context memory status" ||
				text === "/context doctor",
			run: () => this.clearAnd(() => this.handlers.contextStatus()),
		});
		this.add({
			name: "context-learn",
			matches: (text) => text === "/context learn" || text === "/context learn --preview",
			run: () => this.clearAnd(() => this.handlers.contextLearn()),
		});
		this.add({
			name: "context-setup",
			matches: exactOrArg("/context setup"),
			run: (text) => this.clearAnd(() => this.handlers.contextSetup(args(text, "/context setup"))),
		});
		this.add({
			name: "btw",
			matches: exactOrArg("/btw"),
			run: (text) => this.clearAnd(() => this.handlers.btw(args(text, "/btw"))),
		});
	}

	/** Return whether this router owns the input without running callbacks. Used by tests and wiring guards. */
	canHandle(text: string): boolean {
		const trimmed = text.trim();
		return this.commands.some((command) => command.matches(trimmed));
	}

	/** Run the first matching command. Returns false so unknown slash text can fall through to extension/prompt handling. */
	async handleCommand(text: string): Promise<boolean> {
		const trimmed = text.trim();
		for (const command of this.commands) {
			if (command.matches(trimmed)) {
				await command.run(trimmed);
				return true;
			}
		}
		return false;
	}
}
