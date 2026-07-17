const statusEl = document.querySelector("#status");
const sessionEl = document.querySelector("#session");
const cwdEl = document.querySelector("#cwd");
const bannerEl = document.querySelector("#banner");
const layoutEl = document.querySelector("#layout");
const fileTreeEl = document.querySelector("#file-tree");
const editorTitleEl = document.querySelector("#editor-title");
const editorEl = document.querySelector("#editor");
const messagesEl = document.querySelector("#messages");
const thinkingEl = document.querySelector("#thinking");
const formEl = document.querySelector("#composer");
const promptEl = document.querySelector("#prompt");
const sendEl = document.querySelector("#send");

let token = "";
let sessionId = "";
let selectedFile = "";
let socket;
let rpcId = 1;
let assistantMessage;
let waitingForAssistant = false;
const treeNodes = new Map();

treeNodes.set("", { entries: [], expanded: true, loaded: false, loading: false });

function setStatus(text) {
	statusEl.textContent = text;
}

function setBanner(text) {
	bannerEl.textContent = text;
	bannerEl.classList.toggle("hidden", !text);
}

function setThinking(visible) {
	waitingForAssistant = visible;
	thinkingEl.classList.toggle("hidden", !visible);
	sendEl.disabled = visible;
}

function addMessage(role, text = "") {
	const item = document.createElement("div");
	item.className = `message ${role}`;
	const label = document.createElement("span");
	label.className = "role";
	label.textContent = role;
	const body = document.createElement("span");
	body.textContent = text;
	item.append(label, body);
	messagesEl.append(item);
	messagesEl.scrollTop = messagesEl.scrollHeight;
	return body;
}

async function api(path, options = {}) {
	const headers = { "content-type": "application/json", ...(options.headers || {}) };
	if (token) headers.authorization = `Bearer ${token}`;
	const response = await fetch(path, { ...options, headers });
	if (response.status === 401 && !token) {
		const entered = window.prompt("Bearer token required for this daemon:");
		if (!entered) throw new Error("Bearer token required");
		token = entered;
		return api(path, options);
	}
	const text = await response.text();
	if (!response.ok) throw new Error(text || `${response.status} ${response.statusText}`);
	return text ? JSON.parse(text) : undefined;
}

async function start() {
	try {
		const health = await api("/v1/health");
		setStatus(`v${health.version} · ${health.capabilities?.runnerKind || "unknown"}`);
		if (health.capabilities?.runnerKind === "echo") {
			setBanner("Experimental web-shell: chat is connected to the daemon echo runner, not the full coding agent yet.");
		} else if (!health.capabilities?.approvalSupported) {
			setBanner("Agent-backed chat is connected, but browser approval prompts are not available yet.");
		}
		const session = await api("/v1/sessions", {
			method: "POST",
			body: JSON.stringify({ title: "Web UI" }),
		});
		sessionId = session.id;
		sessionEl.textContent = sessionId.slice(0, 8);
		cwdEl.textContent = session.cwd || "cwd: unknown";
		cwdEl.title = session.cwd || "Current working directory";
		await expandDirectory("");
		connectSocket();
	} catch (error) {
		setStatus("error");
		addMessage("system", error instanceof Error ? error.message : String(error));
	}
}

async function expandDirectory(path) {
	const node = treeNode(path);
	if (node.loading) return;
	node.error = undefined;
	node.expanded = true;
	if (node.loaded) {
		renderTree();
		return;
	}
	node.loading = true;
	renderTree();
	try {
		const qs = new URLSearchParams();
		if (path) qs.set("path", path);
		const tree = await api(`/v1/sessions/${encodeURIComponent(sessionId)}/files/tree?${qs}`);
		node.entries = tree.entries || [];
		node.loaded = true;
	} catch (error) {
		node.error = error instanceof Error ? error.message : String(error);
	} finally {
		node.loading = false;
		renderTree();
	}
}

function collapseDirectory(path) {
	const node = treeNode(path);
	node.expanded = false;
	renderTree();
}

function treeNode(path) {
	if (!treeNodes.has(path)) treeNodes.set(path, { entries: [], expanded: false, loaded: false, loading: false });
	return treeNodes.get(path);
}

function renderTree() {
	fileTreeEl.textContent = "";
	renderTreeEntries("", 0);
	if (fileTreeEl.childElementCount === 0) fileTreeEl.textContent = "empty";
}

function renderTreeEntries(path, depth) {
	const node = treeNode(path);
	if (node.loading && depth === 0) {
		fileTreeEl.append(statusRow("loading…", depth));
		return;
	}
	if (node.error) {
		fileTreeEl.append(statusRow(node.error, depth));
		return;
	}
	for (const entry of node.entries) {
		fileTreeEl.append(fileButton(entry, depth));
		if (entry.type === "directory") {
			const child = treeNode(entry.path);
			if (child.loading) fileTreeEl.append(statusRow("loading…", depth + 1));
			else if (child.error) fileTreeEl.append(statusRow(child.error, depth + 1));
			else if (child.expanded) renderTreeEntries(entry.path, depth + 1);
		}
	}
}

function statusRow(text, depth) {
	const row = document.createElement("div");
	row.className = "placeholder";
	row.style.paddingLeft = `${depth * 16 + 8}px`;
	row.textContent = text;
	return row;
}

function fileButton(entry, depth) {
	const button = document.createElement("button");
	button.type = "button";
	button.dataset.path = entry.path;
	button.className = `file-row ${entry.type}${entry.path === selectedFile ? " selected" : ""}`;
	button.style.paddingLeft = `${depth * 16 + 8}px`;
	const twisty = document.createElement("span");
	twisty.className = "twisty";
	if (entry.type === "directory") twisty.textContent = treeNode(entry.path).expanded ? "▾" : "▸";
	else twisty.textContent = "•";
	const name = document.createElement("span");
	name.className = "name";
	name.textContent = entry.name;
	button.append(twisty, name);
	button.addEventListener("click", () => {
		if (entry.type === "directory") {
			const node = treeNode(entry.path);
			if (node.expanded) collapseDirectory(entry.path);
			else void expandDirectory(entry.path);
		} else {
			void openFile(entry.path);
		}
	});
	return button;
}

async function openFile(path) {
	selectedFile = path;
	editorTitleEl.textContent = path;
	editorEl.textContent = "loading…";
	renderTreeButtonsSelected();
	try {
		const qs = new URLSearchParams({ path });
		const file = await api(`/v1/sessions/${encodeURIComponent(sessionId)}/files/read?${qs}`);
		editorEl.textContent = file.text;
	} catch (error) {
		editorEl.textContent = error instanceof Error ? error.message : String(error);
	}
}

function renderTreeButtonsSelected() {
	for (const button of fileTreeEl.querySelectorAll(".file-row")) {
		button.classList.toggle("selected", button.dataset.path === selectedFile);
	}
}

function connectSocket() {
	const protocol = location.protocol === "https:" ? "wss:" : "ws:";
	const url = `${protocol}//${location.host}/v1/sessions/${encodeURIComponent(sessionId)}/stream`;
	const protocols = token ? ["mewrite-auth", `mewrite-bearer.${base64Url(token)}`] : [];
	socket = new WebSocket(url, protocols);
	socket.addEventListener("open", () => {
		setStatus("connected");
		socket.send(JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method: "client_capabilities", params: { approval: true } }));
	});
	socket.addEventListener("close", () => {
		setStatus("disconnected");
		setThinking(false);
	});
	socket.addEventListener("error", () => {
		setStatus("socket error");
		setThinking(false);
	});
	socket.addEventListener("message", (event) => onSocketMessage(event.data));
}

function onSocketMessage(raw) {
	const envelope = JSON.parse(raw);
	if (envelope.method === "token") {
		if (waitingForAssistant) setThinking(false);
		if (!assistantMessage) assistantMessage = addMessage(envelope.params?.role || "assistant");
		assistantMessage.textContent += envelope.params?.text || "";
		messagesEl.scrollTop = messagesEl.scrollHeight;
		return;
	}
	if (envelope.method === "tool") {
		addMessage("system", `tool ${envelope.params?.name}: ${envelope.params?.status}`);
		return;
	}
	if (envelope.method === "state") {
		setStatus(envelope.params?.state || "connected");
		return;
	}
	if (envelope.method === "approval") {
		handleApproval(envelope.params);
		return;
	}
	if (envelope.method === "done") {
		assistantMessage = undefined;
		setThinking(false);
		return;
	}
	if (envelope.error) {
		setThinking(false);
		addMessage("system", envelope.error.message || "request failed");
	}
}

function handleApproval(params) {
	const summary = JSON.stringify(params?.args ?? {}, null, 2);
	const approved = window.confirm(`Approve ${params?.toolName || "tool"} (${params?.tier || "risk"})?\n\n${summary}`);
	const decision = approved ? "once" : "deny";
	if (!socket || socket.readyState !== WebSocket.OPEN) return;
	socket.send(
		JSON.stringify({
			jsonrpc: "2.0",
			id: rpcId++,
			method: "approval_decision",
			params: { approvalId: params?.approvalId, decision },
		}),
	);
}

formEl.addEventListener("submit", (event) => {
	event.preventDefault();
	const text = promptEl.value.trim();
	if (!text || !socket || socket.readyState !== WebSocket.OPEN || waitingForAssistant) return;
	promptEl.value = "";
	addMessage("user", text);
	setThinking(true);
	socket.send(JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method: "send", params: { text } }));
});

for (const button of document.querySelectorAll(".pane-toggle")) {
	button.addEventListener("click", () => togglePane(button.dataset.pane));
}

function togglePane(pane) {
	if (pane !== "files" && pane !== "chat") return;
	layoutEl.classList.toggle(`${pane}-collapsed`);
	const collapsed = layoutEl.classList.contains(`${pane}-collapsed`);
	const button = document.querySelector(`.pane-toggle[data-pane="${pane}"]`);
	if (button) button.textContent = pane === "files" ? (collapsed ? "›" : "‹") : collapsed ? "‹" : "›";
}

function base64Url(value) {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

start();
