const statusEl = document.querySelector("#status");
const sessionEl = document.querySelector("#session");
const sessionSelectEl = document.querySelector("#sessions");
const newSessionEl = document.querySelector("#new-session");
const cwdEl = document.querySelector("#cwd");
const bannerEl = document.querySelector("#banner");
const layoutEl = document.querySelector("#layout");
const fileTreeEl = document.querySelector("#file-tree");
const editorTitleEl = document.querySelector("#editor-title");
const editorEl = document.querySelector("#editor");
const dirtyEl = document.querySelector("#dirty");
const saveEl = document.querySelector("#save");
const messagesEl = document.querySelector("#messages");
const thinkingEl = document.querySelector("#thinking");
const formEl = document.querySelector("#composer");
const promptEl = document.querySelector("#prompt");
const sendEl = document.querySelector("#send");

let token = "";
let sessionId = "";
let selectedFile = "";
let openFileState;
let openRequestId = 0;
let saveInFlight = false;
let socket;
let sessionSwitchId = 0;
let rpcId = 1;
let assistantMessage;
let waitingForAssistant = false;
let runInProgress = false;
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
	updateSendDisabled();
}

function setRunInProgress(visible) {
	runInProgress = visible;
	updateSendDisabled();
}

function updateSendDisabled() {
	sendEl.disabled = waitingForAssistant || runInProgress;
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
		await loadSessions();
	} catch (error) {
		setStatus("error");
		addMessage("system", error instanceof Error ? error.message : String(error));
	}
}

async function loadSessions(preferredId) {
	const list = await api("/v1/sessions?limit=25");
	const sessions = list.sessions || [];
	if (sessions.length === 0) {
		await createSession();
		return;
	}
	renderSessionOptions(sessions);
	const selected = sessions.find((session) => session.id === preferredId) || sessions[0];
	await useSession(selected.id);
}

function renderSessionOptions(sessions) {
	sessionSelectEl.textContent = "";
	for (const session of sessions) {
		const option = document.createElement("option");
		option.value = session.id;
		option.textContent = `${session.title || "session"} · ${session.id.slice(0, 8)} · ${session.state}`;
		sessionSelectEl.append(option);
	}
}

async function createSession() {
	if (!canLeaveCurrentEditor()) return;
	const session = await api("/v1/sessions", {
		method: "POST",
		body: JSON.stringify({ title: "Web UI" }),
	});
	await loadSessions(session.id);
}

async function useSession(nextSessionId) {
	if (nextSessionId === sessionId) return;
	if (!canLeaveCurrentEditor()) {
		sessionSelectEl.value = sessionId;
		return;
	}
	const previousSessionId = sessionId;
	const switchId = ++sessionSwitchId;
	try {
		const session = await api(`/v1/sessions/${encodeURIComponent(nextSessionId)}`);
		const transcript = await api(`/v1/sessions/${encodeURIComponent(nextSessionId)}/transcript`);
		if (switchId !== sessionSwitchId) return;
		closeSocket();
		resetEditor();
		resetTree();
		messagesEl.textContent = "";
		sessionId = session.id;
		sessionSelectEl.value = session.id;
		sessionEl.textContent = session.id.slice(0, 8);
		cwdEl.textContent = session.cwd || "cwd: unknown";
		cwdEl.title = session.cwd || "Current working directory";
		for (const message of transcript.messages || []) addMessage(message.role, message.text || "");
		await expandDirectory("");
		if (switchId !== sessionSwitchId) return;
		connectSocket();
	} catch (error) {
		if (switchId !== sessionSwitchId) return;
		sessionSelectEl.value = previousSessionId;
		addMessage("system", error instanceof Error ? error.message : String(error));
	}
}

function canLeaveCurrentEditor() {
	if (saveInFlight) {
		window.alert("Wait for the current save to finish before switching sessions.");
		return false;
	}
	return !openFileState?.dirty || window.confirm("Discard unsaved changes?");
}

function resetTree() {
	treeNodes.clear();
	treeNodes.set("", { entries: [], expanded: true, loaded: false, loading: false });
	fileTreeEl.textContent = "loading…";
}

function resetEditor() {
	selectedFile = "";
	openFileState = undefined;
	openRequestId++;
	editorTitleEl.textContent = "Editor";
	editorEl.value = "Select a file from the tree.";
	editorEl.disabled = true;
	setDirty(false);
}

function closeSocket() {
	if (!socket) return;
	socket.close();
	socket = undefined;
	assistantMessage = undefined;
	setThinking(false);
	setRunInProgress(false);
}

async function expandDirectory(path) {
	const targetSessionId = sessionId;
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
		const tree = await api(`/v1/sessions/${encodeURIComponent(targetSessionId)}/files/tree?${qs}`);
		if (targetSessionId !== sessionId) return;
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
	if (saveInFlight) {
		window.alert("Wait for the current save to finish before switching files.");
		return;
	}
	if (openFileState?.dirty && !window.confirm("Discard unsaved changes?")) return;
	const requestId = ++openRequestId;
	openFileState = undefined;
	selectedFile = path;
	editorTitleEl.textContent = path;
	editorEl.value = "loading…";
	editorEl.disabled = true;
	setDirty(false);
	renderTreeButtonsSelected();
	try {
		const qs = new URLSearchParams({ path });
		const file = await api(`/v1/sessions/${encodeURIComponent(sessionId)}/files/read?${qs}`);
		if (requestId !== openRequestId) return;
		openFileState = {
			path,
			text: file.text,
			size: file.size,
			mtimeMs: file.mtimeMs,
			dirty: false,
		};
		editorEl.value = file.text;
		editorEl.disabled = false;
		setDirty(false);
	} catch (error) {
		if (requestId !== openRequestId) return;
		openFileState = undefined;
		editorEl.value = error instanceof Error ? error.message : String(error);
	}
}

function renderTreeButtonsSelected() {
	for (const button of fileTreeEl.querySelectorAll(".file-row")) {
		button.classList.toggle("selected", button.dataset.path === selectedFile);
	}
}

function setDirty(dirty) {
	if (openFileState) openFileState.dirty = dirty;
	dirtyEl.classList.toggle("hidden", !dirty);
	saveEl.disabled = saveInFlight || !dirty || !openFileState;
}

async function saveOpenFile() {
	if (!openFileState || !openFileState.dirty || saveInFlight) return;
	const snapshot = {
		path: openFileState.path,
		text: editorEl.value,
		mtimeMs: openFileState.mtimeMs,
		size: openFileState.size,
	};
	saveInFlight = true;
	saveEl.disabled = true;
	try {
		const saved = await api(`/v1/sessions/${encodeURIComponent(sessionId)}/files/write`, {
			method: "PUT",
			body: JSON.stringify({
				path: snapshot.path,
				text: snapshot.text,
				expectedMtimeMs: snapshot.mtimeMs,
				expectedSize: snapshot.size,
			}),
		});
		if (openFileState?.path === snapshot.path) {
			openFileState.text = snapshot.text;
			openFileState.size = saved.size;
			openFileState.mtimeMs = saved.mtimeMs;
			setDirty(editorEl.value !== snapshot.text);
		}
		addMessage("system", `saved ${snapshot.path}`);
	} catch (error) {
		if (openFileState?.path === snapshot.path) setDirty(true);
		addMessage("system", error instanceof Error ? error.message : String(error));
	} finally {
		saveInFlight = false;
		if (openFileState?.path === snapshot.path) setDirty(openFileState.dirty);
	}
}

function connectSocket() {
	closeSocket();
	const protocol = location.protocol === "https:" ? "wss:" : "ws:";
	const url = `${protocol}//${location.host}/v1/sessions/${encodeURIComponent(sessionId)}/stream`;
	const protocols = token ? ["mewrite-auth", `mewrite-bearer.${base64Url(token)}`] : [];
	const nextSocket = new WebSocket(url, protocols);
	socket = nextSocket;
	nextSocket.addEventListener("open", () => {
		if (socket !== nextSocket) return;
		setStatus("connected");
		nextSocket.send(JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method: "client_capabilities", params: { approval: true } }));
	});
	nextSocket.addEventListener("close", () => {
		if (socket !== nextSocket) return;
		setStatus("disconnected");
		setThinking(false);
		setRunInProgress(false);
	});
	nextSocket.addEventListener("error", () => {
		if (socket !== nextSocket) return;
		setStatus("socket error");
		setThinking(false);
		setRunInProgress(false);
	});
	nextSocket.addEventListener("message", (event) => {
		if (socket !== nextSocket) return;
		onSocketMessage(event.data);
	});
}

function onSocketMessage(raw) {
	const envelope = JSON.parse(raw);
	if (envelope.method === "token") {
		setRunInProgress(true);
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
		const state = envelope.params?.state || "connected";
		setStatus(state);
		if (state === "running") {
			setRunInProgress(true);
			if (!assistantMessage) setThinking(true);
		} else if (state === "idle" || state === "error" || state === "stopped") {
			setThinking(false);
			setRunInProgress(false);
		}
		return;
	}
	if (envelope.method === "approval") {
		handleApproval(envelope.params);
		return;
	}
	if (envelope.method === "done") {
		assistantMessage = undefined;
		setThinking(false);
		setRunInProgress(false);
		return;
	}
	if (envelope.error) {
		setThinking(false);
		setRunInProgress(false);
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

sessionSelectEl.addEventListener("change", () => {
	void useSession(sessionSelectEl.value);
});

newSessionEl.addEventListener("click", () => {
	void createSession();
});

editorEl.addEventListener("input", () => {
	if (!openFileState) return;
	setDirty(editorEl.value !== openFileState.text);
});

saveEl.addEventListener("click", () => {
	void saveOpenFile();
});

window.addEventListener("beforeunload", (event) => {
	if (!openFileState?.dirty && !saveInFlight) return;
	event.preventDefault();
	event.returnValue = "";
});

formEl.addEventListener("submit", (event) => {
	event.preventDefault();
	const text = promptEl.value.trim();
	if (!text || !socket || socket.readyState !== WebSocket.OPEN || waitingForAssistant) return;
	promptEl.value = "";
	addMessage("user", text);
	setRunInProgress(true);
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
