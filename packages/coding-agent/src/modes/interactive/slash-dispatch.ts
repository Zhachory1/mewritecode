export type SafeInteractiveSlashCommand =
	| { kind: "logout" }
	| { kind: "clear" }
	| { kind: "compact"; instructions?: string }
	| { kind: "freeze"; label?: string };

function optionalArgument(text: string, command: string): string | undefined {
	if (text === command) return undefined;
	const prefix = `${command} `;
	if (!text.startsWith(prefix)) return undefined;
	return text.slice(prefix.length).trim() || undefined;
}

export function classifySafeInteractiveSlashCommand(text: string): SafeInteractiveSlashCommand | null {
	const trimmed = text.trim();
	if (trimmed === "/logout") return { kind: "logout" };
	if (trimmed === "/new" || trimmed === "/clear") return { kind: "clear" };
	if (trimmed === "/compact" || trimmed.startsWith("/compact ")) {
		return { kind: "compact", instructions: optionalArgument(trimmed, "/compact") };
	}
	if (trimmed === "/freeze" || trimmed.startsWith("/freeze ")) {
		return { kind: "freeze", label: optionalArgument(trimmed, "/freeze") };
	}
	return null;
}
