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
	if (trimmed === "/compact" || trimmed.startsWith("/compact ")) {
		return { kind: "compact", instructions: arg(trimmed, "/compact") };
	}
	if (trimmed === "/freeze" || trimmed.startsWith("/freeze "))
		return { kind: "freeze", label: arg(trimmed, "/freeze") };
	if (trimmed === "/checkpoints") return { kind: "checkpoints" };
	if (trimmed === "/mode" || trimmed.startsWith("/mode ") || trimmed === "/cave" || trimmed.startsWith("/cave ")) {
		return { kind: "cave-mode", text: trimmed };
	}
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
	if (trimmed === "/architect" || trimmed.startsWith("/architect ")) {
		return { kind: "architect", args: args(trimmed, "/architect") };
	}
	if (trimmed === "/recipe" || trimmed.startsWith("/recipe ")) return { kind: "recipe", text: trimmed };
	if (trimmed === "/checkpoint" || trimmed.startsWith("/checkpoint ")) {
		return { kind: "checkpoint", args: args(trimmed, "/checkpoint") };
	}
	if (trimmed === "/rollback" || trimmed.startsWith("/rollback ")) {
		return { kind: "rollback", args: args(trimmed, "/rollback") };
	}
	if (trimmed === "/goal" || trimmed.startsWith("/goal ")) return { kind: "goal", args: args(trimmed, "/goal") };
	if (trimmed === "/plan" || trimmed.startsWith("/plan ")) return { kind: "plan", args: args(trimmed, "/plan") };
	if (trimmed === "/act" || trimmed.startsWith("/act ")) return { kind: "act", args: args(trimmed, "/act") };
	if (trimmed === "/approval" || trimmed.startsWith("/approval ")) {
		return { kind: "approval", args: args(trimmed, "/approval") };
	}
	if (trimmed === "/queue" || trimmed.startsWith("/queue ")) return { kind: "queue", args: args(trimmed, "/queue") };
	if (
		trimmed === "/context" ||
		trimmed === "/context status" ||
		trimmed === "/context memory status" ||
		trimmed === "/context doctor"
	) {
		return { kind: "context-status" };
	}
	if (trimmed === "/context learn" || trimmed === "/context learn --preview") return { kind: "context-learn" };
	if (trimmed === "/context setup" || trimmed.startsWith("/context setup ")) {
		return { kind: "context-setup", args: args(trimmed, "/context setup") };
	}
	if (trimmed === "/btw" || trimmed.startsWith("/btw ")) return { kind: "btw", question: args(trimmed, "/btw") };

	return null;
}
