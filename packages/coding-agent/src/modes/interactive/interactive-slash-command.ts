export type InteractiveSlashCommand =
	| { kind: "settings" }
	| { kind: "scoped-models" }
	| { kind: "model"; searchTerm?: string }
	| { kind: "export"; text: string }
	| { kind: "import"; text: string }
	| { kind: "share" }
	| { kind: "copy" }
	| { kind: "name"; text: string }
	| { kind: "session" }
	| { kind: "changelog" }
	| { kind: "hotkeys" }
	| { kind: "activity" }
	| { kind: "help" }
	| { kind: "skills"; mode?: "marketplace" }
	| { kind: "fork" }
	| { kind: "tree" }
	| { kind: "login"; text: string }
	| { kind: "logout" }
	| { kind: "clear" }
	| { kind: "compact"; instructions?: string }
	| { kind: "freeze"; label?: string }
	| { kind: "checkpoints" }
	| { kind: "cave-mode"; text: string }
	| { kind: "ponytail"; text: string }
	| { kind: "tokens" }
	| { kind: "cost" }
	| { kind: "savings"; arg: string }
	| { kind: "reload" }
	| { kind: "hooks"; args: string }
	| { kind: "debug" }
	| { kind: "arminsayshi" }
	| { kind: "resume"; target?: string }
	| { kind: "quit" }
	| { kind: "mcp"; text: string }
	| { kind: "memory"; text: string }
	| { kind: "repomap"; args: string }
	| { kind: "architect"; args: string }
	| { kind: "recipe"; text: string }
	| { kind: "checkpoint"; args: string }
	| { kind: "rollback"; args: string }
	| { kind: "goal"; args: string }
	| { kind: "plan"; args: string }
	| { kind: "act"; args: string }
	| { kind: "approval"; args: string }
	| { kind: "queue"; args: string }
	| { kind: "context-status" }
	| { kind: "context-learn" }
	| { kind: "context-setup"; args: string }
	| { kind: "btw"; question: string };

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

function arg(text: string, command: string): string | undefined {
	if (text === command) return undefined;
	const prefix = `${command} `;
	if (!text.startsWith(prefix)) return undefined;
	return text.slice(prefix.length).trim() || undefined;
}

function args(text: string, command: string): string {
	return arg(text, command) ?? "";
}

export function classifyInteractiveSlashCommand(text: string): InteractiveSlashCommand | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith("/")) return null;

	if (trimmed === "/settings") return { kind: "settings" };
	if (trimmed === "/scoped-models") return { kind: "scoped-models" };
	if (trimmed === "/model" || trimmed.startsWith("/model "))
		return { kind: "model", searchTerm: arg(trimmed, "/model") };
	if (trimmed.startsWith("/export")) return { kind: "export", text: trimmed };
	if (trimmed.startsWith("/import")) return { kind: "import", text: trimmed };
	if (trimmed === "/share") return { kind: "share" };
	if (trimmed === "/copy") return { kind: "copy" };
	if (trimmed === "/name" || trimmed.startsWith("/name ")) return { kind: "name", text: trimmed };
	if (trimmed === "/session") return { kind: "session" };
	if (trimmed === "/changelog") return { kind: "changelog" };
	if (trimmed === "/hotkeys") return { kind: "hotkeys" };
	if (trimmed === "/activity") return { kind: "activity" };
	if (trimmed === "/help") return { kind: "help" };
	if (trimmed === "/skills" || trimmed === "/plugins") {
		return { kind: "skills", mode: trimmed === "/plugins" ? "marketplace" : undefined };
	}
	if (trimmed === "/fork") return { kind: "fork" };
	if (trimmed === "/tree") return { kind: "tree" };
	if (trimmed === "/login" || trimmed.startsWith("/login ")) return { kind: "login", text: trimmed };
	if (trimmed === "/logout") return { kind: "logout" };
	if (trimmed === "/new" || trimmed === "/clear") return { kind: "clear" };
	if (trimmed === "/compact" || trimmed.startsWith("/compact "))
		return { kind: "compact", instructions: arg(trimmed, "/compact") };
	if (trimmed === "/freeze" || trimmed.startsWith("/freeze "))
		return { kind: "freeze", label: arg(trimmed, "/freeze") };
	if (trimmed === "/checkpoints") return { kind: "checkpoints" };
	if (trimmed === "/mode" || trimmed.startsWith("/mode ") || trimmed === "/cave" || trimmed.startsWith("/cave "))
		return { kind: "cave-mode", text: trimmed };
	if (trimmed === "/ponytail" || trimmed.startsWith("/ponytail ")) return { kind: "ponytail", text: trimmed };
	if (trimmed === "/tokens") return { kind: "tokens" };
	if (trimmed === "/cost") return { kind: "cost" };
	if (trimmed === "/savings" || trimmed.startsWith("/savings "))
		return { kind: "savings", arg: args(trimmed, "/savings") };
	if (trimmed === "/reload") return { kind: "reload" };
	if (trimmed === "/hooks" || trimmed.startsWith("/hooks ")) return { kind: "hooks", args: args(trimmed, "/hooks") };
	if (trimmed === "/debug") return { kind: "debug" };
	if (trimmed === "/arminsayshi") return { kind: "arminsayshi" };
	if (trimmed === "/resume" || trimmed.startsWith("/resume "))
		return { kind: "resume", target: arg(trimmed, "/resume") };
	if (trimmed === "/quit") return { kind: "quit" };
	if (trimmed === "/mcp" || trimmed.startsWith("/mcp ")) return { kind: "mcp", text: trimmed };
	if (trimmed === "/memory" || trimmed.startsWith("/memory ")) return { kind: "memory", text: trimmed };
	if (trimmed === "/repomap" || trimmed.startsWith("/repomap "))
		return { kind: "repomap", args: args(trimmed, "/repomap") };
	if (trimmed === "/architect" || trimmed.startsWith("/architect "))
		return { kind: "architect", args: args(trimmed, "/architect") };
	if (trimmed === "/recipe" || trimmed.startsWith("/recipe ")) return { kind: "recipe", text: trimmed };
	if (trimmed === "/checkpoint" || trimmed.startsWith("/checkpoint "))
		return { kind: "checkpoint", args: args(trimmed, "/checkpoint") };
	if (trimmed === "/rollback" || trimmed.startsWith("/rollback "))
		return { kind: "rollback", args: args(trimmed, "/rollback") };
	if (trimmed === "/goal" || trimmed.startsWith("/goal ")) return { kind: "goal", args: args(trimmed, "/goal") };
	if (trimmed === "/plan" || trimmed.startsWith("/plan ")) return { kind: "plan", args: args(trimmed, "/plan") };
	if (trimmed === "/act" || trimmed.startsWith("/act ")) return { kind: "act", args: args(trimmed, "/act") };
	if (trimmed === "/approval" || trimmed.startsWith("/approval "))
		return { kind: "approval", args: args(trimmed, "/approval") };
	if (trimmed === "/queue" || trimmed.startsWith("/queue ")) return { kind: "queue", args: args(trimmed, "/queue") };
	if (
		trimmed === "/context" ||
		trimmed === "/context status" ||
		trimmed === "/context memory status" ||
		trimmed === "/context doctor"
	)
		return { kind: "context-status" };
	if (trimmed === "/context learn" || trimmed === "/context learn --preview") return { kind: "context-learn" };
	if (trimmed === "/context setup" || trimmed.startsWith("/context setup "))
		return { kind: "context-setup", args: args(trimmed, "/context setup") };
	if (trimmed === "/btw" || trimmed.startsWith("/btw ")) return { kind: "btw", question: args(trimmed, "/btw") };

	return null;
}

export async function handleInteractiveSlashCommand(
	text: string,
	handlers: InteractiveSlashCommandHandlers,
): Promise<boolean> {
	const command = classifyInteractiveSlashCommand(text);
	if (!command) return false;

	switch (command.kind) {
		case "settings":
			handlers.settings();
			handlers.setEditorText("");
			return true;
		case "scoped-models":
			handlers.setEditorText("");
			await handlers.scopedModels();
			return true;
		case "model":
			handlers.setEditorText("");
			await handlers.model(command.searchTerm);
			return true;
		case "export":
			await handlers.export(command.text);
			handlers.setEditorText("");
			return true;
		case "import":
			await handlers.import(command.text);
			handlers.setEditorText("");
			return true;
		case "share":
			await handlers.share();
			handlers.setEditorText("");
			return true;
		case "copy":
			await handlers.copy();
			handlers.setEditorText("");
			return true;
		case "name":
			handlers.name(command.text);
			handlers.setEditorText("");
			return true;
		case "session":
			handlers.session();
			handlers.setEditorText("");
			return true;
		case "changelog":
			handlers.changelog();
			handlers.setEditorText("");
			return true;
		case "hotkeys":
			handlers.hotkeys();
			handlers.setEditorText("");
			return true;
		case "activity":
			handlers.setEditorText("");
			handlers.activity();
			return true;
		case "help":
			handlers.setEditorText("");
			handlers.help();
			return true;
		case "skills":
			handlers.setEditorText("");
			handlers.skills(command.mode);
			return true;
		case "fork":
			handlers.fork();
			handlers.setEditorText("");
			return true;
		case "tree":
			handlers.tree();
			handlers.setEditorText("");
			return true;
		case "login":
			handlers.setEditorText("");
			await handlers.login(command.text);
			return true;
		case "logout":
			handlers.logout();
			handlers.setEditorText("");
			return true;
		case "clear":
			handlers.setEditorText("");
			await handlers.clear();
			return true;
		case "compact":
			handlers.setEditorText("");
			await handlers.compact(command.instructions);
			return true;
		case "freeze":
			handlers.setEditorText("");
			await handlers.freeze(command.label);
			return true;
		case "checkpoints":
			handlers.setEditorText("");
			handlers.checkpoints();
			return true;
		case "cave-mode":
			handlers.setEditorText("");
			handlers.caveMode(command.text);
			return true;
		case "ponytail":
			handlers.setEditorText("");
			handlers.ponytail(command.text);
			return true;
		case "tokens":
			handlers.setEditorText("");
			handlers.tokens();
			return true;
		case "cost":
			handlers.setEditorText("");
			handlers.cost();
			return true;
		case "savings":
			handlers.setEditorText("");
			await handlers.savings(command.arg);
			return true;
		case "reload":
			handlers.setEditorText("");
			await handlers.reload();
			return true;
		case "hooks":
			handlers.setEditorText("");
			await handlers.hooks(command.args);
			return true;
		case "debug":
			handlers.debug();
			handlers.setEditorText("");
			return true;
		case "arminsayshi":
			handlers.arminSaysHi();
			handlers.setEditorText("");
			return true;
		case "resume":
			handlers.setEditorText("");
			await handlers.resume(command.target);
			return true;
		case "quit":
			handlers.setEditorText("");
			await handlers.quit();
			return true;
		case "mcp":
			handlers.setEditorText("");
			await handlers.mcp(command.text);
			return true;
		case "memory":
			handlers.setEditorText("");
			await handlers.memory(command.text);
			return true;
		case "repomap":
			handlers.setEditorText("");
			await handlers.repomap(command.args);
			return true;
		case "architect":
			handlers.setEditorText("");
			await handlers.architect(command.args);
			return true;
		case "recipe":
			handlers.setEditorText("");
			await handlers.recipe(command.text);
			return true;
		case "checkpoint":
			handlers.setEditorText("");
			await handlers.checkpoint(command.args);
			return true;
		case "rollback":
			handlers.setEditorText("");
			await handlers.rollback(command.args);
			return true;
		case "goal":
			handlers.setEditorText("");
			await handlers.goal(command.args);
			return true;
		case "plan":
			handlers.setEditorText("");
			handlers.plan(command.args);
			return true;
		case "act":
			handlers.setEditorText("");
			handlers.act(command.args);
			return true;
		case "approval":
			handlers.setEditorText("");
			handlers.approval(command.args);
			return true;
		case "queue":
			handlers.setEditorText("");
			handlers.queue(command.args);
			return true;
		case "context-status":
			handlers.setEditorText("");
			handlers.contextStatus();
			return true;
		case "context-learn":
			handlers.setEditorText("");
			handlers.contextLearn();
			return true;
		case "context-setup":
			handlers.setEditorText("");
			handlers.contextSetup(command.args);
			return true;
		case "btw":
			handlers.setEditorText("");
			handlers.btw(command.question);
			return true;
		default: {
			const _exhaustive: never = command;
			return _exhaustive;
		}
	}
}
