import { SessionManager } from "../../core/session-manager.js";

export type ResolvedSessionReference =
	| { type: "path"; path: string }
	| { type: "local"; path: string }
	| { type: "global"; path: string; cwd: string }
	| { type: "not_found"; arg: string };

export async function resolveSessionReference(
	sessionArg: string,
	cwd: string,
	sessionDir?: string,
): Promise<ResolvedSessionReference> {
	if (sessionArg.includes("/") || sessionArg.includes("\\") || sessionArg.endsWith(".jsonl")) {
		return { type: "path", path: sessionArg };
	}

	const localSessions = await SessionManager.list(cwd, sessionDir);
	const localMatch = localSessions.find((session) => session.id.startsWith(sessionArg));
	if (localMatch) {
		return { type: "local", path: localMatch.path };
	}

	const allSessions = await SessionManager.listAll();
	const globalMatch = allSessions.find((session) => session.id.startsWith(sessionArg));
	if (globalMatch) {
		return { type: "global", path: globalMatch.path, cwd: globalMatch.cwd };
	}

	return { type: "not_found", arg: sessionArg };
}
