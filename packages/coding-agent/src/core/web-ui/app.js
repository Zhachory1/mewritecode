const statusEl = document.querySelector("#status");
const sessionEl = document.querySelector("#session");
const bannerEl = document.querySelector("#banner");
const messagesEl = document.querySelector("#messages");
const formEl = document.querySelector("#composer");
const promptEl = document.querySelector("#prompt");
const sendEl = document.querySelector("#send");

let token = "";
let sessionId = "";
let socket;
let rpcId = 1;
let assistantMessage;

function setStatus(text) {
	statusEl.textContent = text;
}

function setBanner(text) {
	bannerEl.textContent = text;
	bannerEl.classList.toggle("hidden", !text);
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
		connectSocket();
	} catch (error) {
		setStatus("error");
		addMessage("system", error instanceof Error ? error.message : String(error));
	}
}

function connectSocket() {
	const protocol = location.protocol === "https:" ? "wss:" : "ws:";
	const url = `${protocol}//${location.host}/v1/sessions/${encodeURIComponent(sessionId)}/stream`;
	const protocols = token ? ["mewrite-auth", `mewrite-bearer.${base64Url(token)}`] : [];
	socket = new WebSocket(url, protocols);
	socket.addEventListener("open", () => setStatus("connected"));
	socket.addEventListener("close", () => setStatus("disconnected"));
	socket.addEventListener("error", () => setStatus("socket error"));
	socket.addEventListener("message", (event) => onSocketMessage(event.data));
}

function onSocketMessage(raw) {
	const envelope = JSON.parse(raw);
	if (envelope.method === "token") {
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
	if (envelope.method === "done") {
		assistantMessage = undefined;
		return;
	}
	if (envelope.error) addMessage("system", envelope.error.message || "request failed");
}

formEl.addEventListener("submit", (event) => {
	event.preventDefault();
	const text = promptEl.value.trim();
	if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;
	promptEl.value = "";
	addMessage("user", text);
	sendEl.disabled = true;
	socket.send(JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method: "send", params: { text } }));
	setTimeout(() => {
		sendEl.disabled = false;
		promptEl.focus();
	}, 100);
});

function base64Url(value) {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

start();
