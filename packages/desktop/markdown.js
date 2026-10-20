(function (root, factory) {
	const api = factory(root);
	if (typeof module === "object" && module.exports) module.exports = api;
	else root.mewriteMarkdown = api;
})(typeof globalThis !== "undefined" ? globalThis : window, (root) => {
	const MAX_MARKDOWN_CHARS = 256 * 1024;
	const MAX_DOM_NODES = 5000;
	const MAX_DOM_CHARS = 512 * 1024;
	const MAX_DEPTH = 32;
	const MAX_PENDING_REQUESTS = 2;
	const MAX_PENDING_CHARS = 512 * 1024;
	const PARSE_TIMEOUT_MS = 500;
	const renderVersions = new WeakMap();
	const pending = new Map();
	let worker;
	let pendingChars = 0;
	let nextRequestId = 0;

	function safeExternalUrl(href) {
		try {
			const url = new URL(href);
			return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password && url.href.length <= 2048 ? url.href : undefined;
		} catch {
			return undefined;
		}
	}

	function hasExcessiveNesting(source) {
		return source.split("\n").some((line) => ((line.match(/^(?:\s*>){33}/)?.[0].length ?? 0) > 0) || (line.match(/^[ \t]*/)?.[0].replaceAll("\t", "    ").length ?? 0) > 128);
	}

	function stopWorker(error) {
		worker?.terminate();
		worker = undefined;
		for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(error); }
		pending.clear();
		pendingChars = 0;
	}

	function parseMarkdown(source, options) {
		if (options.marked?.lexer) return Promise.resolve(options.marked.lexer(source, { gfm: true }));
		if (!root.Worker || !root.location?.href) return Promise.reject(new Error("Markdown worker unavailable"));
		if (!worker) {
			worker = new root.Worker(new URL("markdown-worker.js", root.location.href));
			worker.onmessage = ({ data }) => {
				const request = pending.get(data.id);
				if (!request) return;
				pending.delete(data.id);
				pendingChars -= request.size;
				clearTimeout(request.timeout);
				if (data.error) request.reject(new Error(data.error));
				else request.resolve(data.tokens);
			};
			worker.onerror = () => stopWorker(new Error("Markdown worker failed"));
		}
		if (pending.size >= MAX_PENDING_REQUESTS || pendingChars + source.length > MAX_PENDING_CHARS) return Promise.reject(new Error("Markdown queue limit exceeded"));
		const id = ++nextRequestId;
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => stopWorker(new Error("Markdown parse timed out")), PARSE_TIMEOUT_MS);
			pending.set(id, { resolve, reject, timeout, size: source.length });
			pendingChars += source.length;
			worker.postMessage({ id, source });
		});
	}

	async function renderMarkdown(target, source, options = {}) {
		const document = options.document ?? root.document;
		const openExternal = options.openExternal ?? root.mewrite?.openExternal;
		const version = (renderVersions.get(target) ?? 0) + 1;
		renderVersions.set(target, version);
		if (!document || source.length > MAX_MARKDOWN_CHARS || hasExcessiveNesting(source)) {
			target.textContent = source;
			return;
		}
		let tokens;
		try { tokens = await parseMarkdown(source, options); }
		catch { if (renderVersions.get(target) === version) target.textContent = source; return; }
		if (renderVersions.get(target) !== version) return;
		const env = { document, openExternal, nodes: 0, characters: 0 };
		try {
			const output = createElement(env, "div");
			output.className = "md-body";
			appendBlocks(output, tokens, env, 0);
			target.replaceChildren(output);
		} catch {
			target.textContent = source;
		}
	}

	function createElement(env, tag) {
		if (++env.nodes > MAX_DOM_NODES) throw new Error("Markdown node limit exceeded");
		return env.document.createElement(tag);
	}
	function createText(env, value) {
		if (++env.nodes > MAX_DOM_NODES) throw new Error("Markdown node limit exceeded");
		env.characters += value.length;
		if (env.characters > MAX_DOM_CHARS) throw new Error("Markdown text limit exceeded");
		return env.document.createTextNode(value);
	}
	function guardDepth(depth) {
		if (depth > MAX_DEPTH) throw new Error("Markdown nesting limit exceeded");
	}

	function appendBlocks(parent, tokens, env, depth) {
		guardDepth(depth);
		for (const token of tokens ?? []) {
			let node;
			switch (token.type) {
				case "space":
				case "def": break;
				case "heading":
					node = createElement(env, `h${Math.min(6, Math.max(1, token.depth))}`);
					appendInline(node, token.tokens, env, depth + 1);
					parent.append(node);
					break;
				case "paragraph":
				case "text":
					node = createElement(env, "p");
					if (token.tokens) appendInline(node, token.tokens, env, depth + 1);
					else node.append(createText(env, token.text ?? token.raw ?? ""));
					parent.append(node);
					break;
				case "code": {
					const pre = createElement(env, "pre");
					const code = createElement(env, "code");
					code.append(createText(env, token.text ?? ""));
					pre.append(code);
					parent.append(pre);
					break;
				}
				case "list": {
					const list = createElement(env, token.ordered ? "ol" : "ul");
					if (token.ordered && Number(token.start) !== 1) list.setAttribute("start", String(token.start));
					for (const item of token.items ?? []) {
						const li = createElement(env, "li");
						if (item.tokens) appendBlocks(li, item.tokens, env, depth + 1);
						else li.append(createText(env, item.text ?? ""));
						list.append(li);
					}
					parent.append(list);
					break;
				}
				case "blockquote":
					node = createElement(env, "blockquote");
					appendBlocks(node, token.tokens, env, depth + 1);
					parent.append(node);
					break;
				case "table": {
					const wrapper = createElement(env, "div");
					wrapper.className = "md-table-wrap";
					const table = createElement(env, "table");
					const head = createElement(env, "thead");
					const headRow = createElement(env, "tr");
					for (const [index, cell] of (token.header ?? []).entries()) {
						const th = createElement(env, "th");
						const align = cell.align ?? token.align?.[index];
						if (["left", "center", "right"].includes(align)) th.className = `md-align-${align}`;
						appendInline(th, cell.tokens, env, depth + 1);
						headRow.append(th);
					}
					head.append(headRow);
					table.append(head);
					const body = createElement(env, "tbody");
					for (const row of token.rows ?? []) {
						const tr = createElement(env, "tr");
						for (const [index, cell] of row.entries()) {
							const td = createElement(env, "td");
							const align = cell.align ?? token.align?.[index];
							if (["left", "center", "right"].includes(align)) td.className = `md-align-${align}`;
							appendInline(td, cell.tokens, env, depth + 1);
							tr.append(td);
						}
						body.append(tr);
					}
					table.append(body);
					wrapper.append(table);
					parent.append(wrapper);
					break;
				}
				case "hr": parent.append(createElement(env, "hr")); break;
				default:
					node = createElement(env, "p");
					node.append(createText(env, token.raw ?? token.text ?? ""));
					parent.append(node);
			}
		}
	}

	function appendInline(parent, tokens, env, depth) {
		guardDepth(depth);
		for (const token of tokens ?? []) {
			let node;
			switch (token.type) {
				case "text":
				case "escape":
					if (token.tokens) appendInline(parent, token.tokens, env, depth + 1);
					else parent.append(createText(env, token.text ?? ""));
					break;
				case "strong":
				case "em":
				case "del":
					node = createElement(env, token.type);
					appendInline(node, token.tokens, env, depth + 1);
					parent.append(node);
					break;
				case "codespan":
					node = createElement(env, "code");
					node.append(createText(env, token.text ?? ""));
					parent.append(node);
					break;
				case "br": parent.append(createElement(env, "br")); break;
				case "link": {
					const url = safeExternalUrl(token.href);
					if (!url || typeof env.openExternal !== "function") {
						parent.append(createText(env, token.raw ?? token.text ?? ""));
						break;
					}
					node = createElement(env, "a");
					node.setAttribute("role", "link");
					node.setAttribute("tabindex", "0");
					node.setAttribute("title", url);
					appendInline(node, token.tokens, env, depth + 1);
					node.append(createText(env, ` (${url})`));
					const activate = (event) => {
						event.preventDefault();
						return Promise.resolve(env.openExternal(url)).catch(() => undefined);
					};
					node.addEventListener("click", activate);
					node.addEventListener("keydown", (event) => event.key === "Enter" && !event.repeat && activate(event));
					parent.append(node);
					break;
				}
				case "image": parent.append(createText(env, `[image: ${token.text ?? ""}]`)); break;
				default: parent.append(createText(env, token.raw ?? token.text ?? ""));
			}
		}
	}

	return { renderMarkdown, safeExternalUrl };
});
