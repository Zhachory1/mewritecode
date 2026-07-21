const statusEl = document.querySelector("#status");
const sessionEl = document.querySelector("#session");
const sessionSelectEl = document.querySelector("#sessions");
const newSessionEl = document.querySelector("#new-session");
const manageSessionsEl = document.querySelector("#manage-sessions");
const sessionsManagerEl = document.querySelector("#sessions-manager");
const sessionsManagerListEl = document.querySelector("#sessions-manager-list");
const sessionsManagerErrorEl = document.querySelector("#sessions-manager-error");
const sessionsManagerCloseEl = document.querySelector("#sessions-manager-close");
const cwdEl = document.querySelector("#cwd");
const bannerEl = document.querySelector("#banner");
const layoutEl = document.querySelector("#layout");
const fileTreeEl = document.querySelector("#file-tree");
const editorTitleEl = document.querySelector("#editor-title");
const editorEl = document.querySelector("#editor");
const editorStackEl = editorEl.parentElement;
const editorHighlightEl = document.querySelector("#editor-highlight");
const editorHighlightCodeEl = editorHighlightEl.querySelector("code");
const dirtyEl = document.querySelector("#dirty");
const saveEl = document.querySelector("#save");
const messagesEl = document.querySelector("#messages");
const thinkingEl = document.querySelector("#thinking");
const formEl = document.querySelector("#composer");
const promptEl = document.querySelector("#prompt");
const sendEl = document.querySelector("#send");
const toastsEl = document.querySelector("#toasts");
const pickerEl = document.querySelector("#folder-picker");
const pickerInputEl = document.querySelector("#folder-picker-input");
const pickerGoEl = document.querySelector("#folder-picker-go");
const pickerListEl = document.querySelector("#folder-picker-list");
const pickerErrorEl = document.querySelector("#folder-picker-error");
const pickerCancelEl = document.querySelector("#folder-picker-cancel");
const pickerSelectEl = document.querySelector("#folder-picker-select");

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

const TOAST_TIMEOUTS = { info: 4000, tool: 2000, error: 0 };

function showToast(text, variant = "info") {
	if (!text) return;
	const toast = document.createElement("div");
	toast.className = `toast ${variant}`;
	const body = document.createElement("span");
	body.className = "toast-body";
	body.textContent = text;
	const close = document.createElement("button");
	close.type = "button";
	close.className = "toast-close";
	close.setAttribute("aria-label", "Dismiss");
	close.textContent = "\u00d7";
	close.addEventListener("click", () => toast.remove());
	toast.append(body, close);
	toastsEl.append(toast);
	const timeout = TOAST_TIMEOUTS[variant] ?? 4000;
	if (timeout > 0) setTimeout(() => toast.remove(), timeout);
	return toast;
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
		showToast(error instanceof Error ? error.message : String(error), "error");
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
		option.dataset.title = session.title || "session";
		option.textContent = formatSessionOption(option.dataset.title, session.id, session.state);
		sessionSelectEl.append(option);
	}
}

function formatSessionOption(title, id, state) {
	return `${title || "session"} · ${id.slice(0, 8)} · ${state}`;
}

function updateSelectedSessionState(state) {
	const option = sessionSelectEl.selectedOptions[0];
	if (!option || option.value !== sessionId) return;
	option.textContent = formatSessionOption(option.dataset.title, sessionId, state);
}

async function createSession() {
	if (!canLeaveCurrentEditor()) return;
	const cwd = await pickFolder();
	if (!cwd) return;
	const session = await api("/v1/sessions", {
		method: "POST",
		body: JSON.stringify({ title: "Web UI", cwd }),
	});
	await loadSessions(session.id);
}

let pickerCurrentPath = "";
let pickerLoading = false;
let pickerResolve;

function pickFolder() {
	return new Promise((resolve) => {
		pickerResolve = resolve;
		pickerErrorEl.classList.add("hidden");
		pickerErrorEl.textContent = "";
		pickerEl.showModal();
		const initial = pickerCurrentPath || pickerInputEl.value || "";
		void loadPickerPath(initial);
	});
}

function closePicker(result) {
	if (pickerEl.open) pickerEl.close();
	const resolve = pickerResolve;
	pickerResolve = undefined;
	if (resolve) resolve(result);
}

async function loadPickerPath(path) {
	if (pickerLoading) return;
	pickerLoading = true;
	pickerErrorEl.classList.add("hidden");
	pickerErrorEl.textContent = "";
	pickerListEl.textContent = "loading…";
	pickerSelectEl.disabled = true;
	try {
		const qs = new URLSearchParams();
		if (path) qs.set("path", path);
		const data = await api(`/v1/fs/list${qs.toString() ? `?${qs}` : ""}`);
		pickerCurrentPath = data.path;
		pickerInputEl.value = data.path;
		renderPicker(data);
		pickerSelectEl.disabled = false;
	} catch (error) {
		pickerErrorEl.textContent = error instanceof Error ? error.message : String(error);
		pickerErrorEl.classList.remove("hidden");
		pickerListEl.textContent = "";
	} finally {
		pickerLoading = false;
	}
}

function renderPicker(data) {
	pickerListEl.textContent = "";
	if (data.parent) {
		pickerListEl.append(pickerRow("← parent directory", data.parent, "parent"));
	}
	if (data.entries.length === 0) {
		const empty = document.createElement("div");
		empty.className = "placeholder";
		empty.textContent = "(no subdirectories)";
		pickerListEl.append(empty);
		return;
	}
	for (const entry of data.entries) {
		pickerListEl.append(pickerRow(entry.name, entry.path));
	}
}

function pickerRow(label, path, extra = "") {
	const row = document.createElement("button");
	row.type = "button";
	row.className = `row${extra ? ` ${extra}` : ""}`;
	row.textContent = label;
	row.addEventListener("click", () => {
		void loadPickerPath(path);
	});
	return row;
}

pickerGoEl.addEventListener("click", () => {
	void loadPickerPath(pickerInputEl.value.trim());
});

pickerInputEl.addEventListener("keydown", (event) => {
	if (event.key === "Enter") {
		event.preventDefault();
		void loadPickerPath(pickerInputEl.value.trim());
	}
});

pickerCancelEl.addEventListener("click", () => closePicker(undefined));
pickerEl.addEventListener("cancel", (event) => {
	event.preventDefault();
	closePicker(undefined);
});
pickerSelectEl.addEventListener("click", () => {
	if (!pickerCurrentPath) return;
	closePicker(pickerCurrentPath);
});

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
		for (const message of transcript.messages || []) {
			if (message.role === "system") continue;
			addMessage(message.role, message.text || "");
		}
		await expandDirectory("");
		if (switchId !== sessionSwitchId) return;
		connectSocket();
	} catch (error) {
		if (switchId !== sessionSwitchId) return;
		sessionSelectEl.value = previousSessionId;
		showToast(error instanceof Error ? error.message : String(error), "error");
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
	setEditorLanguage(undefined);
	renderHighlight("");
}

const HIGHLIGHT_MAX_BYTES = 200 * 1024;
const EXT_LANGUAGE = {
	ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
	js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
	py: "python", pyi: "python",
	rs: "rust",
	go: "go",
	java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", groovy: "groovy",
	c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp",
	cs: "csharp",
	swift: "swift", m: "objectivec", mm: "objectivec",
	rb: "ruby", php: "php", pl: "perl", lua: "lua", r: "r",
	sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
	ps1: "powershell",
	sql: "sql",
	json: "json", jsonc: "json", json5: "json",
	yaml: "yaml", yml: "yaml",
	toml: "ini", ini: "ini", cfg: "ini", conf: "ini",
	md: "markdown", markdown: "markdown", mdx: "markdown",
	html: "xml", htm: "xml", xml: "xml", svg: "xml", xhtml: "xml",
	css: "css", scss: "scss", sass: "scss", less: "less",
	dockerfile: "dockerfile",
	make: "makefile", makefile: "makefile", mk: "makefile",
	diff: "diff", patch: "diff",
	graphql: "graphql", gql: "graphql",
	tf: "terraform", hcl: "terraform",
};
const BASENAME_LANGUAGE = {
	dockerfile: "dockerfile",
	"containerfile": "dockerfile",
	makefile: "makefile",
	gnumakefile: "makefile",
	".bashrc": "bash",
	".zshrc": "bash",
	".profile": "bash",
};
let currentLanguage;
let highlightPending = false;

function detectLanguage(path) {
	if (!path) return undefined;
	const base = (path.split("/").pop() || "").toLowerCase();
	if (BASENAME_LANGUAGE[base]) return BASENAME_LANGUAGE[base];
	const dot = base.lastIndexOf(".");
	if (dot < 0 || dot === base.length - 1) return undefined;
	return EXT_LANGUAGE[base.slice(dot + 1)] || undefined;
}

function setEditorLanguage(language) {
	const hljsAvailable = typeof window.hljs !== "undefined";
	const plain = !language || !hljsAvailable;
	editorStackEl.classList.toggle("plain", plain);
	currentLanguage = plain ? undefined : language;
}

function renderHighlight(text) {
	if (!currentLanguage) {
		editorHighlightCodeEl.textContent = text;
		return;
	}
	const hljs = window.hljs;
	const content = text.endsWith("\n") ? text : `${text}\n`;
	try {
		const result = hljs.getLanguage(currentLanguage)
			? hljs.highlight(content, { language: currentLanguage, ignoreIllegals: true })
			: hljs.highlightAuto(content);
		editorHighlightCodeEl.innerHTML = result.value;
	} catch {
		editorHighlightCodeEl.textContent = content;
	}
}

function scheduleHighlight() {
	if (highlightPending) return;
	highlightPending = true;
	requestAnimationFrame(() => {
		highlightPending = false;
		renderHighlight(editorEl.value);
		syncHighlightScroll();
	});
}

function syncHighlightScroll() {
	editorHighlightCodeEl.style.transform = `translate(${-editorEl.scrollLeft}px, ${-editorEl.scrollTop}px)`;
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
		const language = file.size <= HIGHLIGHT_MAX_BYTES ? detectLanguage(path) : undefined;
		setEditorLanguage(language);
		renderHighlight(file.text);
		syncHighlightScroll();
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
		showToast(`saved ${snapshot.path}`, "info");
	} catch (error) {
		if (openFileState?.path === snapshot.path) setDirty(true);
		showToast(error instanceof Error ? error.message : String(error), "error");
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
		const status = envelope.params?.status;
		showToast(`tool ${envelope.params?.name}: ${status}`, status === "err" ? "error" : "tool");
		return;
	}
	if (envelope.method === "state") {
		const state = envelope.params?.state || "connected";
		setStatus(state);
		updateSelectedSessionState(state);
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
		showToast(envelope.error.message || "request failed", "error");
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

manageSessionsEl.addEventListener("click", () => {
	openSessionsManager();
});

sessionsManagerCloseEl.addEventListener("click", () => {
	if (sessionsManagerEl.open) sessionsManagerEl.close();
});

sessionsManagerEl.addEventListener("cancel", (event) => {
	event.preventDefault();
	sessionsManagerEl.close();
});

function openSessionsManager() {
	sessionsManagerErrorEl.classList.add("hidden");
	sessionsManagerErrorEl.textContent = "";
	sessionsManagerListEl.textContent = "loading…";
	sessionsManagerListEl.classList.add("placeholder");
	sessionsManagerEl.showModal();
	void reloadSessionsManager();
}

async function reloadSessionsManager() {
	try {
		const data = await api("/v1/sessions?limit=100");
		renderSessionsManager(data.sessions || []);
	} catch (error) {
		sessionsManagerListEl.textContent = "";
		sessionsManagerErrorEl.textContent = error instanceof Error ? error.message : String(error);
		sessionsManagerErrorEl.classList.remove("hidden");
	}
}

function renderSessionsManager(sessions) {
	sessionsManagerListEl.classList.remove("placeholder");
	sessionsManagerListEl.textContent = "";
	if (sessions.length === 0) {
		const empty = document.createElement("div");
		empty.className = "placeholder";
		empty.textContent = "No sessions.";
		sessionsManagerListEl.append(empty);
		return;
	}
	const sorted = [...sessions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
	for (const session of sorted) sessionsManagerListEl.append(sessionRow(session));
}

function sessionRow(session) {
	const row = document.createElement("div");
	const isCurrent = session.id === sessionId;
	row.className = `sessions-manager-row${isCurrent ? " current" : ""}`;
	row.setAttribute("role", "listitem");

	const meta = document.createElement("div");
	meta.className = "sessions-manager-meta";

	const titleRow = document.createElement("div");
	titleRow.className = "sessions-manager-title-row";
	const title = document.createElement("span");
	title.className = "sessions-manager-title";
	title.textContent = session.title || "session";
	titleRow.append(title);
	titleRow.append(badge(session.state, `state-${session.state}`));
	if (isCurrent) titleRow.append(badge("current", "current"));
	meta.append(titleRow);

	const sub = document.createElement("span");
	sub.className = "sessions-manager-sub";
	sub.textContent = `${session.id.slice(0, 8)} · ${session.cwd || "(unknown cwd)"} · ${formatCreatedAt(session.createdAt)}`;
	sub.title = `${session.id} — ${session.cwd || "unknown cwd"} — created ${session.createdAt}`;
	meta.append(sub);

	row.append(meta);

	const deleteBtn = document.createElement("button");
	deleteBtn.type = "button";
	deleteBtn.className = "sessions-manager-delete";
	deleteBtn.textContent = "Delete";
	if (isCurrent) {
		deleteBtn.disabled = true;
		deleteBtn.title = "Switch to a different session before deleting this one";
	} else {
		deleteBtn.addEventListener("click", () => {
			void deleteSessionFromManager(session, deleteBtn);
		});
	}
	row.append(deleteBtn);
	return row;
}

function badge(text, extra = "") {
	const el = document.createElement("span");
	el.className = `sessions-manager-badge${extra ? ` ${extra}` : ""}`;
	el.textContent = text;
	return el;
}

function formatCreatedAt(iso) {
	if (!iso) return "";
	try {
		return new Date(iso).toLocaleString();
	} catch {
		return iso;
	}
}

async function deleteSessionFromManager(session, button) {
	const label = session.title ? `"${session.title}"` : session.id.slice(0, 8);
	if (!window.confirm(`Delete session ${label}? Any running work is stopped and its transcript is removed.`)) return;
	button.disabled = true;
	sessionsManagerErrorEl.classList.add("hidden");
	try {
		await api(`/v1/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
		await reloadSessionsManager();
		await refreshHeaderSessions();
	} catch (error) {
		sessionsManagerErrorEl.textContent = error instanceof Error ? error.message : String(error);
		sessionsManagerErrorEl.classList.remove("hidden");
		button.disabled = false;
	}
}

async function refreshHeaderSessions() {
	try {
		const data = await api("/v1/sessions?limit=25");
		renderSessionOptions(data.sessions || []);
		if (sessionId && [...sessionSelectEl.options].some((option) => option.value === sessionId)) {
			sessionSelectEl.value = sessionId;
		}
	} catch {
		// ignore — the manager still displays its own error state.
	}
}

editorEl.addEventListener("input", () => {
	if (!openFileState) return;
	setDirty(editorEl.value !== openFileState.text);
	scheduleHighlight();
});

editorEl.addEventListener("scroll", syncHighlightScroll);

saveEl.addEventListener("click", () => {
	void saveOpenFile();
});

window.addEventListener("keydown", (event) => {
	const mod = event.metaKey || event.ctrlKey;
	if (!mod || event.altKey) return;
	if (event.key !== "s" && event.key !== "S") return;
	event.preventDefault();
	if (!openFileState || !openFileState.dirty || saveInFlight) return;
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

promptEl.addEventListener("keydown", (event) => {
	if (event.key !== "Enter") return;
	if (!(event.metaKey || event.ctrlKey)) return;
	if (event.altKey || event.shiftKey) return;
	event.preventDefault();
	if (sendEl.disabled) return;
	formEl.requestSubmit();
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

const PANE_MIN = 160;
const PANE_MAX = 720;
const EDITOR_MIN = 360;
const PANE_STORAGE_KEYS = { files: "web-ui.pane-width.files", chat: "web-ui.pane-width.chat" };
const PANE_CSS_VARS = { files: "--files-width", chat: "--chat-width" };

function clampPaneWidth(side, next) {
	const layoutWidth = layoutEl.getBoundingClientRect().width;
	const otherSide = side === "files" ? "chat" : "files";
	const otherWidth = readPaneWidth(otherSide);
	const max = Math.min(PANE_MAX, Math.max(PANE_MIN, layoutWidth - otherWidth - EDITOR_MIN - 12));
	return Math.min(max, Math.max(PANE_MIN, Math.round(next)));
}

function readPaneWidth(side) {
	const raw = getComputedStyle(layoutEl).getPropertyValue(PANE_CSS_VARS[side]).trim();
	const parsed = Number.parseFloat(raw);
	if (Number.isFinite(parsed)) return parsed;
	return side === "files" ? 280 : 380;
}

function applyPaneWidth(side, next) {
	const clamped = clampPaneWidth(side, next);
	layoutEl.style.setProperty(PANE_CSS_VARS[side], `${clamped}px`);
	try {
		localStorage.setItem(PANE_STORAGE_KEYS[side], String(clamped));
	} catch {
		// storage may be blocked (private mode, quota); resize still works for the session.
	}
	return clamped;
}

function restorePaneWidths() {
	for (const side of ["files", "chat"]) {
		try {
			const raw = localStorage.getItem(PANE_STORAGE_KEYS[side]);
			if (!raw) continue;
			const parsed = Number.parseFloat(raw);
			if (Number.isFinite(parsed)) applyPaneWidth(side, parsed);
		} catch {
			// ignore
		}
	}
}

for (const resizer of document.querySelectorAll(".resizer")) {
	const side = resizer.dataset.side;
	if (side !== "files" && side !== "chat") continue;
	let startX = 0;
	let startWidth = 0;
	let pointerId;
	resizer.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) return;
		if (layoutEl.classList.contains(`${side}-collapsed`)) return;
		event.preventDefault();
		pointerId = event.pointerId;
		resizer.setPointerCapture(pointerId);
		resizer.classList.add("dragging");
		startX = event.clientX;
		startWidth = readPaneWidth(side);
	});
	resizer.addEventListener("pointermove", (event) => {
		if (pointerId === undefined || event.pointerId !== pointerId) return;
		const delta = event.clientX - startX;
		const next = side === "files" ? startWidth + delta : startWidth - delta;
		applyPaneWidth(side, next);
	});
	const end = (event) => {
		if (pointerId === undefined || event.pointerId !== pointerId) return;
		try {
			resizer.releasePointerCapture(pointerId);
		} catch {
			// pointer may already be released
		}
		pointerId = undefined;
		resizer.classList.remove("dragging");
	};
	resizer.addEventListener("pointerup", end);
	resizer.addEventListener("pointercancel", end);
	resizer.addEventListener("dblclick", () => {
		applyPaneWidth(side, side === "files" ? 280 : 380);
	});
	resizer.addEventListener("keydown", (event) => {
		const step = event.shiftKey ? 40 : 16;
		const current = readPaneWidth(side);
		const grow = side === "files" ? "ArrowRight" : "ArrowLeft";
		const shrink = side === "files" ? "ArrowLeft" : "ArrowRight";
		if (event.key === grow) {
			event.preventDefault();
			applyPaneWidth(side, current + step);
		} else if (event.key === shrink) {
			event.preventDefault();
			applyPaneWidth(side, current - step);
		}
	});
}

restorePaneWidths();
window.addEventListener("resize", () => {
	// Re-clamp so a narrower viewport doesn't leave panes larger than the editor allows.
	applyPaneWidth("files", readPaneWidth("files"));
	applyPaneWidth("chat", readPaneWidth("chat"));
});

function base64Url(value) {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

start();
