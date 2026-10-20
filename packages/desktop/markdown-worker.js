importScripts("./assets/marked.min.js");

const MAX_TOKEN_CHARS = 512 * 1024;
const MAX_TOKEN_NODES = 10000;

function validateGraph(value, state, seen) {
	if (typeof value === "string") {
		state.characters += value.length;
		if (state.characters > MAX_TOKEN_CHARS) throw new Error("Markdown token text limit exceeded");
		return;
	}
	if (!value || typeof value !== "object" || seen.has(value)) return;
	seen.add(value);
	if (++state.nodes > MAX_TOKEN_NODES) throw new Error("Markdown token node limit exceeded");
	for (const child of Array.isArray(value) ? value : Object.values(value)) validateGraph(child, state, seen);
}

self.onmessage = ({ data }) => {
	try {
		const tokens = self.marked.lexer(data.source, { gfm: true });
		validateGraph(tokens, { characters: 0, nodes: 0 }, new WeakSet());
		self.postMessage({ id: data.id, tokens });
	} catch (error) {
		self.postMessage({ id: data.id, error: error instanceof Error ? error.message : "Markdown parse failed" });
	}
};
