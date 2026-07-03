export interface ContextLearnPreviewInput {
	lastAssistantText?: string;
	sessionId: string;
	cwd: string;
}

function redactObviousSecrets(text: string): string {
	return text
		.replace(/sk-[a-zA-Z0-9_-]{12,}/g, "[REDACTED_SECRET]")
		.replace(/gh[oprsu]_[a-zA-Z0-9_]{20,}/g, "[REDACTED_TOKEN]")
		.replace(/(api[_-]?key|token|secret)\s*[:=]\s*[^\s`]+/gi, (match) => {
			const key = match.split(/[:=]/, 1)[0]?.trim() ?? "secret";
			return `${key}: [REDACTED]`;
		});
}

export function buildContextLearnPreview(input: ContextLearnPreviewInput): string {
	const text = input.lastAssistantText?.trim();
	if (!text) {
		return [
			"No assistant summary available to preview.",
			"Use /memory save <fact> after writing the exact fact you want to remember.",
		].join("\n");
	}
	const redacted = redactObviousSecrets(text);
	const excerpt = redacted.length > 1200 ? `${redacted.slice(0, 1200)}…` : redacted;
	return [
		"# Context learn preview",
		"",
		`Session: ${input.sessionId}`,
		`Working directory: ${input.cwd}`,
		"",
		"Review before saving. Nothing has been written.",
		"To save a durable memory, copy the final fact into:",
		"",
		"```text",
		"/memory save <fact>",
		"```",
		"",
		"## Candidate source excerpt",
		"",
		excerpt,
	].join("\n");
}
