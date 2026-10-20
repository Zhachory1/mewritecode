const api = window.mewrite;
const conversation = document.querySelector("#conversation");
const toolActivityStatus = document.querySelector("#tool-activity-status");
const workspace = document.querySelector("#workspace");
const settingsView = document.querySelector("#settings-view");
const settingsBack = document.querySelector("#settings-back");
const contextPanel = document.querySelector("#context-panel");
const recentSidebar = document.querySelector("#recent-sidebar");
const recentToggle = document.querySelector("#recent-toggle");
const panelToggle = document.querySelector("#panel-toggle");
const panelClose = document.querySelector("#panel-close");
const panelResizer = document.querySelector("#panel-resizer");
const panelTabs = {
	progress: document.querySelector("#panel-tab-progress"),
	context: document.querySelector("#panel-tab-context"),
	tools: document.querySelector("#panel-tab-tools"),
	docs: document.querySelector("#panel-tab-docs"),
	files: document.querySelector("#panel-tab-files"),
};
const panelViews = {
	progress: document.querySelector("#panel-view-progress"),
	context: document.querySelector("#panel-view-context"),
	tools: document.querySelector("#panel-view-tools"),
	docs: document.querySelector("#panel-view-docs"),
	files: document.querySelector("#panel-view-files"),
};
const panelLists = {
	progress: document.querySelector("#panel-progress-list"),
	context: document.querySelector("#panel-context-list"),
	tools: document.querySelector("#panel-tools-list"),
	docs: document.querySelector("#panel-docs-list"),
};
const panelEmpty = {
	progress: document.querySelector("#panel-progress-empty"),
	context: document.querySelector("#panel-context-empty"),
	tools: document.querySelector("#panel-tools-empty"),
	docs: document.querySelector("#panel-docs-empty"),
};
const prompt = document.querySelector("#prompt");
const composerWarning = document.querySelector("#composer-warning");
const status = document.querySelector("#status");
const send = document.querySelector("#send");
const stop = document.querySelector("#stop");
const sessionsButton = document.querySelector("#sessions");
const sessionsDialog = document.querySelector("#sessions-dialog");
const sessionsList = document.querySelector("#sessions-list");
const sessionsError = document.querySelector("#sessions-error");
const recentList = document.querySelector("#recent-list");
const recentStatus = document.querySelector("#recent-status");
const sidebarNew = document.querySelector("#sidebar-new");
const modal = document.querySelector("#extension-dialog");
const commandMenu = document.querySelector("#command-menu");
const modelSelect = document.querySelector("#model-select");
const themeInputs = {
	system: document.querySelector("#theme-system"),
	light: document.querySelector("#theme-light"),
	dark: document.querySelector("#theme-dark"),
};
const defaultModelSelect = document.querySelector("#default-model-select");
const defaultModelNote = document.querySelector("#default-model-note");
const approvalModeToggle = document.querySelector("#approval-mode-toggle");
const approvalModeNote = document.querySelector("#approval-mode-note");
const skillsNote = document.querySelector("#skills-note");
const skillsList = document.querySelector("#skills-list");
const mcpNote = document.querySelector("#mcp-note");
const mcpList = document.querySelector("#mcp-list");
const mcpAdd = document.querySelector("#mcp-add");
const mcpEditor = document.querySelector("#mcp-editor");
const mcpScope = document.querySelector("#mcp-scope");
const mcpName = document.querySelector("#mcp-name");
const mcpCommand = document.querySelector("#mcp-command");
const mcpArgs = document.querySelector("#mcp-args");
const fileOpen = document.querySelector("#file-open");
const fileSave = document.querySelector("#file-save");
const fileName = document.querySelector("#file-name");
const fileStatus = document.querySelector("#file-status");
const fileHost = document.querySelector("#file-host");
let fileView, fileToken, filePath, savedContent;
let fileDirty = false;
let reportedDirty = false;
let fileBusy = false;
let fileSaving = false;
let editorSync = Promise.resolve();
let editorContext = 0;
let availableModels = [];
let availableDefaultModels = [];
let currentModel;
let modelSwitchCapable = false;
let defaultModelControlCapable = false;
let defaultModelSwitching = false;
let currentDefaultModel;
let currentDefaultModelScope;
let approvalModeControlCapable = false;
let approvalModeSwitching = false;
let skillsSettingsControlCapable = false;
let skillsInventory;
let skillsSwitching = false;
let skillsLoading = false;
let skillsRequestGeneration = 0;
let mcpSettingsControlCapable = false;
let mcpSettingsSwitching = false;
let mcpInventory;
let mcpPreviousName;
let modelSwitching = false;
let commands = [];
let slashCapable = false;
let sessionListCapable = false;
let sessionSwitching = false;
let pickerGeneration = 0;
let recentGeneration = 0;
let viewGeneration = 0;
let currentProjectCwd;
let activeAgentId;
let agentSummaries = [];
let summaryEpoch = 0;
const drafts = new Map();
const agentViews = new Map();
let tabSwitching = false;
let panelOpen = (window.innerWidth ?? 1200) > 900;
const panelToolRows = new Map();
const panelReferences = new Map();
// Renderer tracks slash notifications; the main process owns completion gating across RPC.
let slashTurn = false;
let running = false;
let submitting = false;
let connected = false;
let stream;
let thinkingNode;
let thinkingSummary;
let thinkingBody;
let thinkingIndex;
let toolActivityNode;
let toolActivityFailed = false;
let turnRendered = false;
let lastPrompt;
const dialogQueue = [];
let activeDialog;
let dismissDialog;

function clearDialogs(id) {
	const requests = [...dialogQueue, activeDialog].filter((request) => request && (!id || request.desktopAgentId === id));
	for (const request of requests) {
		const index = dialogQueue.indexOf(request);
		if (index !== -1) dialogQueue.splice(index, 1);
	}
	if (requests.includes(activeDialog)) {
		dismissDialog?.();
		dismissDialog = undefined;
		activeDialog = undefined;
		if (modal.open) modal.close();
		openDialog();
	}
	for (const request of requests) {
		if (request.type === "desktop_approval_request") api.approvalReply(request.desktopAgentId, request.token, "deny").catch(showError);
		else api.reply({ desktopAgentId: request.desktopAgentId, id: request.id, cancelled: true }).catch(showError);
	}
}

function content(message) {
	return typeof message.content === "string" ? message.content : (message.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

function thinkingContent(message) {
	if (!Array.isArray(message?.content)) return "";
	return message.content.filter((part) => part.type === "thinking" && !part.redacted && part.thinking).map((part) => part.thinking).join("\n\n");
}

function createThinkingNode(text = "", loading = false) {
	const details = document.createElement("details");
	details.className = `thinking-details${loading ? " thinking-loading" : ""}`;
	details.open = true;
	const summary = document.createElement("summary");
	summary.textContent = loading ? "Thinking…" : "Thinking";
	const body = document.createElement("div");
	body.className = "thinking-content";
	body.setAttribute("aria-live", "off");
	body.textContent = text;
	if (loading) details.setAttribute("aria-busy", "true");
	details.append(summary, body);
	return { details, summary, body };
}

function beginThinking() {
	if (thinkingNode) return;
	const created = createThinkingNode("", true);
	thinkingNode = created.details;
	thinkingSummary = created.summary;
	thinkingBody = created.body;
	conversation.append(thinkingNode);
	conversation.scrollTop = conversation.scrollHeight;
}

function showThinking(contentIndex) {
	beginThinking();
	if (thinkingIndex !== undefined && thinkingIndex !== contentIndex && thinkingBody.textContent) thinkingBody.textContent += "\n\n";
	thinkingIndex = contentIndex;
	thinkingNode.hidden = false;
	thinkingNode.className = "thinking-details";
	thinkingSummary.textContent = "Thinking";
}

function settleThinking(final = false) {
	if (!thinkingNode) return;
	thinkingNode.removeAttribute("aria-busy");
	if (!thinkingBody.textContent) {
		if (typeof thinkingNode.remove === "function") thinkingNode.remove();
		else thinkingNode.hidden = true;
		final = true;
	} else {
		thinkingNode.className = "thinking-details";
		thinkingSummary.textContent = "Thinking";
	}
	if (!final) return;
	thinkingNode = undefined;
	thinkingSummary = undefined;
	thinkingBody = undefined;
	thinkingIndex = undefined;
}

function bubble(role, text) {
	const node = document.createElement("div");
	node.className = `message ${role}`;
	if (role === "assistant" && text) window.mewriteMarkdown.renderMarkdown(node, text);
	else node.textContent = text;
	conversation.append(node);
	conversation.scrollTop = conversation.scrollHeight;
	return node;
}

async function render(messages) {
	const generation = viewGeneration;
	thinkingNode = undefined;
	thinkingSummary = undefined;
	thinkingBody = undefined;
	thinkingIndex = undefined;
	clearToolActivity();
	toolActivityStatus.textContent = "";
	conversation.replaceChildren();
	let markdownBudget = 1024 * 1024;
	for (const message of messages) {
		if (generation !== viewGeneration) return;
		if (message.role === "user") {
			const text = content(message);
			if (text) bubble("user", text);
		} else if (message.role === "assistant") {
			const thinking = thinkingContent(message);
			if (thinking) conversation.append(createThinkingNode(thinking).details);
			const text = content(message);
			if (!text) continue;
			const node = bubble("assistant", "");
			if (text.length <= markdownBudget) await window.mewriteMarkdown.renderMarkdown(node, text);
			else node.textContent = text;
			markdownBudget -= Math.min(markdownBudget, text.length);
		}
	}
	if (generation !== viewGeneration) return;
	if (!conversation.childElementCount) {
		const empty = document.createElement("div");
		empty.id = "welcome";
		empty.innerHTML = "<h1>Your code, in conversation.</h1><p>Send a message to begin.</p>";
		conversation.append(empty);
	}
}

const PANEL_ROW_LIMIT = 100;
const FILE_TOOLS = new Set(["read", "grep", "find", "ls", "edit", "write"]);

function updatePanelEmpty(view) {
	panelEmpty[view].hidden = panelLists[view].childElementCount > 0;
}

function panelRow(title, meta, error = false) {
	const row = document.createElement("div");
	row.className = `panel-row${error ? " panel-row-error" : ""}`;
	const heading = document.createElement("div");
	heading.className = "panel-row-title";
	heading.textContent = title;
	const detail = document.createElement("div");
	detail.className = "panel-row-meta";
	detail.textContent = meta;
	row.append(heading, detail);
	return row;
}

function appendPanelRow(view, row) {
	panelLists[view].append(row);
	while (panelLists[view].childElementCount > PANEL_ROW_LIMIT) panelLists[view].children[0].remove();
	updatePanelEmpty(view);
	panelLists[view].scrollTop = panelLists[view].scrollHeight;
}

function addProgress(title, meta = "Live RPC event", error = false) {
	appendPanelRow("progress", panelRow(title, meta, error));
}

function addReference(value, provenance) {
	if (typeof value !== "string" || !value || value.length > 2048) return;
	while (panelReferences.size >= PANEL_ROW_LIMIT * 2) panelReferences.delete(panelReferences.keys().next().value);
	const contextKey = `context:${value}`;
	if (!panelReferences.has(contextKey)) {
		panelReferences.set(contextKey, true);
		appendPanelRow("context", panelRow(value, provenance));
	}
	if (/\.(md|mdx)$/i.test(value) || /(^|[\\/])docs?[\\/]/i.test(value)) {
		const docsKey = `docs:${value}`;
		if (!panelReferences.has(docsKey)) {
			panelReferences.set(docsKey, true);
			appendPanelRow("docs", panelRow(value, provenance));
		}
	}
}

function observeToolReference(toolName, args, source = "Live") {
	if (!FILE_TOOLS.has(toolName) || !args || typeof args !== "object") return;
	addReference(args.path ?? args.file_path, `${source} ${toolName} tool arguments`);
}

function hydratePanelReferences(messages) {
	for (const message of messages ?? []) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (part.type === "toolCall") observeToolReference(part.name, part.arguments, "Saved");
		}
	}
}

function toolCategory(name) {
	return name === "bash" ? "Bash tool" : name === "mcp_tool_call" || name === "mcp_tool_search" || name?.startsWith("mcp__") ? "MCP tool" : "Tool";
}

function clearToolActivity(announcement) {
	toolActivityNode?.remove();
	toolActivityNode = undefined;
	toolActivityFailed = false;
	if (announcement) toolActivityStatus.textContent = announcement;
}

function updateToolActivity(name, failed = false) {
	toolActivityFailed ||= failed;
	const count = panelToolRows.size;
	if (!count) {
		if (toolActivityNode) {
			toolActivityNode.textContent = toolActivityFailed ? "Tool failed" : "Tool finished";
			toolActivityStatus.textContent = toolActivityNode.textContent;
		} else clearToolActivity();
		return;
	}
	if (!toolActivityNode) {
		toolActivityNode = document.createElement("div");
		toolActivityNode.className = "tool-activity";
		toolActivityNode.setAttribute("aria-hidden", "true");
		conversation.append(toolActivityNode);
	}
	const label = name ? toolCategory(name) : panelToolRows.values().next().value?.toolCategory ?? "Tool";
	toolActivityNode.textContent = count === 1 ? `${label} running…` : `${count} tools running…`;
	if (toolActivityFailed) toolActivityNode.textContent += " · Tool failed";
	toolActivityStatus.textContent = toolActivityNode.textContent;
	conversation.scrollTop = conversation.scrollHeight;
}

function startPanelTool(event) {
	if (!panelToolRows.has(event.toolCallId)) {
		while (panelToolRows.size >= PANEL_ROW_LIMIT) panelToolRows.delete(panelToolRows.keys().next().value);
	}
	const row = panelRow(`${event.toolName} · Running`, "Live tool event");
	row.toolCategory = toolCategory(event.toolName);
	panelToolRows.set(event.toolCallId, row);
	appendPanelRow("tools", row);
	updateToolActivity(event.toolName);
	addProgress(`${event.toolName} started`);
	observeToolReference(event.toolName, event.args);
}

function endPanelTool(event) {
	let row = panelToolRows.get(event.toolCallId);
	if (!row) {
		row = panelRow(`${event.toolName} · ${event.isError ? "Failed" : "Done"}`, "Live tool event", event.isError);
		panelToolRows.set(event.toolCallId, row);
		appendPanelRow("tools", row);
	} else {
		row.children[0].textContent = `${event.toolName} · ${event.isError ? "Failed" : "Done"}`;
		row.className = `panel-row${event.isError ? " panel-row-error" : ""}`;
	}
	panelToolRows.delete(event.toolCallId);
	updateToolActivity(undefined, event.isError);
	addProgress(`${event.toolName} ${event.isError ? "failed" : "completed"}`, "Live tool event", event.isError);
}

function finishRunningTools(status, error = false) {
	const pending = panelToolRows.size > 0;
	for (const row of panelToolRows.values()) {
		row.children[0].textContent = row.children[0].textContent.replace(" · Running", ` · ${status}`);
		row.className = `panel-row${error ? " panel-row-error" : ""}`;
	}
	panelToolRows.clear();
	clearToolActivity(pending ? `Tool ${status.toLowerCase()}` : undefined);
}

function resetPanel(session, cwd) {
	clearToolActivity();
	toolActivityStatus.textContent = "";
	for (const view of Object.keys(panelLists)) {
		panelLists[view].replaceChildren();
		updatePanelEmpty(view);
	}
	panelToolRows.clear();
	panelReferences.clear();
	if (cwd) addReference(cwd, "Selected desktop project");
	if (session?.sessionName || session?.sessionId) addReference(session.sessionName || session.sessionId, "Current RPC conversation");
}

function selectPanelView(view) {
	for (const name of Object.keys(panelViews)) {
		panelViews[name].hidden = name !== view;
		panelTabs[name].setAttribute("aria-pressed", name === view ? "true" : "false");
	}
}

function showFileStatus(message) {
	fileName.textContent = filePath ? `${filePath}${fileDirty ? " · Unsaved" : ""}` : "No file open";
	fileName.title = filePath ?? "";
	fileStatus.textContent = message;
	state();
}

function fileError(error) { showFileStatus(error instanceof Error ? error.message : String(error)); }

function queueEditorDirty() {
	if (!fileToken || fileDirty === reportedDirty) return;
	const token = fileToken, dirty = fileDirty, context = editorContext;
	try {
		const acknowledged = api.setEditorDirty(token, dirty);
		reportedDirty = dirty;
		editorSync = Promise.resolve(acknowledged).then((accepted) => { if (accepted !== true) throw new Error("File edit state could not be synchronized."); });
	} catch (error) { editorSync = Promise.reject(error); }
	editorSync.catch((error) => { if (context === editorContext) fileError(error); });
}

async function flushEditorDirty() {
	await editorSync;
	while (fileToken && fileDirty !== reportedDirty) {
		queueEditorDirty();
		await editorSync;
	}
}

function resetFile() {
	fileView?.destroy();
	fileView = fileToken = filePath = savedContent = undefined;
	fileDirty = reportedDirty = false;
	editorSync = Promise.resolve();
	fileHost.replaceChildren();
	showFileStatus("Open a project text file to edit it.");
}

fileOpen.addEventListener("click", async () => {
	if (fileOpen.disabled) return;
	const context = editorContext;
	fileBusy = true;
	state();
	try {
		await flushEditorDirty();
		const result = await api.openProjectFile();
		if (context !== editorContext || !result) return;
		fileView?.destroy();
		fileHost.replaceChildren();
		const editorElement = document.createElement("div");
		editorElement.className = "file-editor";
		fileHost.append(editorElement);
		fileToken = result.token;
		filePath = result.relativePath;
		savedContent = result.content;
		fileDirty = reportedDirty = false;
		fileView = window.mewriteEditor.create(editorElement, result.content, result.relativePath, (text) => {
			fileDirty = text !== savedContent;
			showFileStatus(fileDirty ? "Unsaved changes" : "Saved");
			if (!fileBusy) queueEditorDirty();
		});
		selectPanelView("files");
		setPanelOpen(true);
		showFileStatus("Saved");
		fileHost.inert = false;
		fileView.focus();
	} catch (error) { if (context === editorContext) fileError(error); }
	finally {
		fileBusy = false;
		state();
		if (context === editorContext) queueEditorDirty();
	}
});

fileSave.addEventListener("click", async () => {
	if (fileSave.disabled) return;
	const context = editorContext;
	fileBusy = true;
	state();
	try {
		await flushEditorDirty();
		const content = fileView.getContent();
		fileSaving = true;
		state();
		const result = await api.saveProjectFile(fileToken, content);
		if (context !== editorContext) return;
		fileToken = result.token;
		savedContent = content;
		fileDirty = fileView.getContent() !== savedContent;
		reportedDirty = !fileDirty;
		showFileStatus(fileDirty ? "Saved earlier changes; newer edits remain unsaved." : "Saved");
	} catch (error) {
		if (context === editorContext) {
			const message = error instanceof Error ? error.message : String(error);
			fileError(/changed|replaced/i.test(message) ? "Save blocked: the file changed on disk. Your draft is still here; copy it before reopening the file to inspect the new version." : `Save failed: ${message.replace(/\.$/, "")}. Your draft is still here.`);
		}
	} finally {
		fileSaving = fileBusy = false;
		state();
		if (context === editorContext) queueEditorDirty();
	}
});

function setPanelOpen(open) {
	panelOpen = open;
	contextPanel.hidden = !open;
	panelResizer.hidden = !open;
	workspace.setAttribute("data-panel-open", open ? "true" : "false");
	panelToggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function setPanelWidth(width) {
	const bounded = Math.max(220, Math.min(420, width));
	contextPanel.style.width = `${bounded}px`;
	panelResizer.setAttribute("aria-valuenow", String(bounded));
}

for (const [name, button] of Object.entries(panelTabs)) button.addEventListener("click", () => selectPanelView(name));
let narrowRecent = (window.innerWidth ?? 1200) <= 800;
let recentOpen = !narrowRecent;
function setRecentOpen(open) {
	recentOpen = open;
	recentSidebar.hidden = !open;
	recentToggle.setAttribute("aria-expanded", String(open));
}
recentToggle.addEventListener("click", () => setRecentOpen(!recentOpen));
window.onresize = () => {
	const narrow = (window.innerWidth ?? 1200) <= 800;
	if (narrow !== narrowRecent) { narrowRecent = narrow; setRecentOpen(!narrow); }
};
setRecentOpen(recentOpen);
panelToggle.addEventListener("click", () => setPanelOpen(!panelOpen));
panelClose.addEventListener("click", () => setPanelOpen(false));
panelResizer.addEventListener("keydown", (event) => {
	const width = Number.parseInt(contextPanel.style.width, 10) || 320;
	if (event.key === "ArrowLeft") setPanelWidth(width + 20);
	else if (event.key === "ArrowRight") setPanelWidth(width - 20);
	else if (event.key === "Home") setPanelWidth(220);
	else if (event.key === "End") setPanelWidth(420);
	else return;
	event.preventDefault();
});
panelResizer.addEventListener("pointerdown", (event) => {
	const startX = event.clientX;
	const startWidth = Number.parseInt(contextPanel.style.width, 10) || contextPanel.getBoundingClientRect().width;
	const move = (moveEvent) => setPanelWidth(startWidth + startX - moveEvent.clientX);
	const cleanup = () => {
		panelResizer.removeEventListener("pointermove", move);
		panelResizer.removeEventListener("pointerup", cleanup);
		panelResizer.removeEventListener("pointercancel", cleanup);
		panelResizer.removeEventListener("lostpointercapture", cleanup);
	};
	panelResizer.setPointerCapture?.(event.pointerId);
	panelResizer.addEventListener("pointermove", move);
	panelResizer.addEventListener("pointerup", cleanup, { once: true });
	panelResizer.addEventListener("pointercancel", cleanup, { once: true });
	panelResizer.addEventListener("lostpointercapture", cleanup, { once: true });
});
selectPanelView("progress");
setPanelOpen(panelOpen);

function setAppView(view) {
	const chat = view === "chat";
	workspace.hidden = !chat;
	settingsView.hidden = chat;
	panelToggle.hidden = !chat;
	recentToggle.hidden = !chat;
}
settingsBack.addEventListener("click", () => {
	setAppView("chat");
	(connected ? prompt : document.querySelector("#project")).focus();
});
async function openSettings() {
	setAppView("settings");
	settingsBack.focus();
	if (connected && skillsSettingsControlCapable) await refreshSkills();
	if (!connected || !mcpSettingsControlCapable) return;
	try { renderMcpServers(await api.getMcpServers()); }
	catch (error) { showError(error); }
}
const settingsToc = document.querySelector(".settings-toc");
const settingsSticky = document.querySelector(".settings-sticky");
settingsToc.addEventListener("click", (event) => {
	const link = event.target.closest("a[href^='#settings-']");
	if (!link) return;
	event.preventDefault();
	const section = document.querySelector(link.getAttribute("href"));
	section.style.scrollMarginTop = `${settingsSticky.offsetHeight + 16}px`;
	section.scrollIntoView({ block: "start" });
	section.focus({ preventScroll: true });
});
setAppView("chat");

const THEME_STORAGE_KEY = "mewrite.desktop.theme";
function applyTheme(theme, persist = true) {
	const selected = Object.hasOwn(themeInputs, theme) ? theme : "system";
	if (selected === "system") document.documentElement?.removeAttribute("data-theme");
	else document.documentElement?.setAttribute("data-theme", selected);
	for (const [name, input] of Object.entries(themeInputs)) input.checked = name === selected;
	if (persist) {
		try { window.localStorage?.setItem(THEME_STORAGE_KEY, selected); } catch { /* Appearance persistence is best-effort. */ }
	}
}
let savedTheme = "system";
try { savedTheme = window.localStorage?.getItem(THEME_STORAGE_KEY) ?? "system"; } catch { /* Use system appearance. */ }
for (const input of Object.values(themeInputs)) input.addEventListener("change", () => input.checked && applyTheme(input.value));
applyTheme(savedTheme, false);

function updateApprovalMode(session) {
	approvalModeControlCapable = session?.rpcCapabilities?.approvalModeControl === true;
	approvalModeToggle.checked = session?.approvalMode === true;
	approvalModeNote.textContent = approvalModeControlCapable
		? `Approval mode is ${approvalModeToggle.checked ? "on" : "off"}. It helps prevent accidents; it is not a sandbox.`
		: connected ? "Update installed Me Write Code to change approval mode here." : "Choose a project to view the effective setting. Approval mode is not a sandbox.";
}
approvalModeToggle.addEventListener("change", async () => {
	const previous = !approvalModeToggle.checked;
	approvalModeSwitching = true;
	state();
	try {
		const result = await api.setApprovalMode(approvalModeToggle.checked);
		updateApprovalMode({ approvalMode: result.enabled, rpcCapabilities: { approvalModeControl: true } });
		setStatus(`Ready · Approval mode ${result.enabled ? "on" : "off"}`);
	} catch (error) {
		try { updateApprovalMode(await api.command("get_state")); }
		catch { approvalModeToggle.checked = previous; }
		showError(error);
	} finally {
		approvalModeSwitching = false;
		state();
	}
});

function renderSkills(inventory) {
	skillsRequestGeneration++;
	skillsLoading = false;
	skillsInventory = inventory;
	skillsList.replaceChildren();
	for (const skill of inventory?.skills ?? []) {
		const row = document.createElement("div");
		row.className = "skill-row";
		const summary = document.createElement("span");
		summary.textContent = `${skill.name} · ${skill.source} · ${skill.scope} · ${skill.status}`;
		row.append(summary);
		if (skill.editable) {
			const button = document.createElement("button");
			button.type = "button";
			button.textContent = skill.enabled ? "Disable" : "Enable";
			button.addEventListener("click", async () => {
				if (button.disabled) return;
				const generation = viewGeneration, agentId = activeAgentId;
				skillsSwitching = true;
				state();
				try {
					const response = await api.setSkillEnabled({ skillId: skill.id, revision: skillsInventory.revision, scope: skill.scope, enabled: !skill.enabled });
					if (response.cancelled || generation !== viewGeneration || agentId !== activeAgentId) return;
					renderSkills(response.inventory);
					skillsNote.textContent = response.warning ?? "Used by new chats; current chat unchanged.";
				} catch (error) {
					if (generation !== viewGeneration || agentId !== activeAgentId) return;
					const message = error instanceof Error ? error.message : String(error);
					await refreshSkills();
					if (generation === viewGeneration && agentId === activeAgentId) skillsNote.textContent = message.includes("start a new chat") ? message : `${message.replace(/\.$/, "")}. Reopen Settings to refresh and retry.`;
				} finally { skillsSwitching = false; state(); }
			});
			row.append(button);
		}
		skillsList.append(row);
	}
	skillsNote.textContent = !connected ? "Choose a project to view skills." : !skillsSettingsControlCapable ? "Update installed Me Write Code to manage skills here." : !inventory ? "Open Settings to load skills." : inventory.skills.length ? "Enable or disable local skills for new chats." : "No skills found.";
	state();
}

async function refreshSkills() {
	const generation = viewGeneration, agentId = activeAgentId;
	const request = ++skillsRequestGeneration;
	skillsInventory = undefined;
	skillsList.replaceChildren();
	skillsNote.textContent = "Loading skills…";
	skillsLoading = true;
	state();
	try {
		const inventory = await api.getSkills();
		if (generation === viewGeneration && agentId === activeAgentId && request === skillsRequestGeneration) renderSkills(inventory);
	} catch (error) {
		if (generation === viewGeneration && agentId === activeAgentId && request === skillsRequestGeneration) {
			const message = error instanceof Error ? error.message : String(error);
			skillsNote.textContent = `Unable to load skills: ${message.replace(/\.$/, "")}${message.includes("start a new chat") ? "." : ". Reopen Settings to retry."}`;
		}
	} finally {
		if (request === skillsRequestGeneration) skillsLoading = false;
		state();
	}
}

function editMcpServer(server) {
	mcpPreviousName = server?.name;
	mcpScope.value = server?.owner === "user" ? "user" : "project";
	mcpScope.disabled = Boolean(server);
	mcpName.value = server?.name ?? "";
	mcpCommand.value = "";
	mcpArgs.value = "";
	mcpEditor.hidden = false;
	mcpNote.textContent = server ? "Enter replacement command and arguments; stored secrets and custom fields stay hidden." : "Add a stdio server. Changes apply to new chats.";
	mcpName.focus();
}

function renderMcpServers(inventory) {
	mcpInventory = inventory;
	mcpSettingsControlCapable = inventory !== undefined;
	mcpEditor.hidden = true;
	mcpScope.disabled = false;
	mcpPreviousName = undefined;
	mcpCommand.value = "";
	mcpArgs.value = "";
	mcpList.replaceChildren();
	for (const server of inventory?.servers ?? []) {
		const row = document.createElement("div");
		row.className = "mcp-row";
		const summary = document.createElement("span");
		summary.textContent = `${server.name} · ${server.transport} · ${server.status} · ${server.owner}`;
		row.append(summary);
		if (server.editable) {
			const edit = document.createElement("button");
			edit.type = "button";
			edit.textContent = "Edit";
			edit.addEventListener("click", () => editMcpServer(server));
			row.append(edit);
		}
		if (server.removable) {
			const remove = document.createElement("button");
			remove.type = "button";
			remove.textContent = "Remove";
			remove.addEventListener("click", async () => {
				mcpSettingsSwitching = true;
				state();
				try {
					const response = await api.removeMcpServer({ scope: server.owner, revision: mcpInventory.revisions[server.owner], name: server.name });
					if (response.cancelled) return;
					renderMcpServers(response.inventory);
					mcpNote.textContent = "Server removed. Start a new chat to apply the change.";
				} catch (error) { showError(error); }
				finally { mcpSettingsSwitching = false; state(); }
			});
			row.append(remove);
		}
		mcpList.append(row);
	}
	const errors = inventory?.errors?.length ?? 0;
	mcpNote.textContent = !connected ? "Choose a project to view configured servers." : !mcpSettingsControlCapable ? "Update installed Me Write Code to manage MCP servers here." : errors ? `${errors} MCP config error${errors === 1 ? "" : "s"}. Fix malformed config before saving.` : inventory.servers.length ? "Commands, arguments, and secrets stay hidden." : "No MCP servers configured.";
	state();
}

mcpAdd.addEventListener("click", () => editMcpServer());
document.querySelector("#mcp-cancel").addEventListener("click", () => { mcpEditor.hidden = true; mcpScope.disabled = false; mcpPreviousName = undefined; });
document.querySelector("#mcp-save").addEventListener("click", async () => {
	const scope = mcpScope.value;
	mcpSettingsSwitching = true;
	state();
	try {
		const response = await api.saveMcpServer({ scope, revision: mcpInventory.revisions[scope], ...(mcpPreviousName ? { previousName: mcpPreviousName } : {}), name: mcpName.value, transport: "stdio", command: mcpCommand.value, args: mcpArgs.value.split("\n").filter(Boolean) });
		if (response.cancelled) return;
		renderMcpServers(response.inventory);
		mcpEditor.hidden = true;
		mcpScope.disabled = false;
		mcpPreviousName = undefined;
		mcpNote.textContent = "Server saved. Start a new chat to use it.";
	} catch (error) { showError(error); }
	finally { mcpSettingsSwitching = false; state(); }
});

function transferReplacedChat(result) {
	const previous = result.replacesDesktopAgentId;
	if (!previous) return;
	if (drafts.has(previous)) { drafts.set(result.desktopAgentId, drafts.get(previous)); drafts.delete(previous); }
	if (agentViews.has(previous)) { agentViews.set(result.desktopAgentId, agentViews.get(previous)); agentViews.delete(previous); }
}

function stashActiveView() {
	if (!activeAgentId) return;
	const view = agentViews.get(activeAgentId) ?? { pending: [] };
	Object.assign(view, { nodes: [...conversation.children].filter((node) => node !== toolActivityNode), stream, thinkingNode, thinkingSummary, thinkingBody, thinkingIndex, turnRendered, lastPrompt, slashTurn });
	agentViews.set(activeAgentId, view);
	drafts.set(activeAgentId, prompt.value);
}

function state() {
	const activeSummary = agentSummaries.find((agent) => agent.desktopAgentId === activeAgentId);
	fileOpen.disabled = fileBusy || tabSwitching || sessionSwitching || !activeAgentId || !currentProjectCwd;
	fileSave.disabled = fileBusy || tabSwitching || sessionSwitching || agentSummaries.some((agent) => agent.busy) || !fileView || !fileDirty;
	fileHost.inert = tabSwitching || (fileBusy && !fileSaving);
	stop.disabled = tabSwitching;
	prompt.disabled = tabSwitching || !connected || sessionSwitching || approvalModeSwitching || defaultModelSwitching || mcpSettingsSwitching || skillsSwitching;
	send.disabled = tabSwitching || !connected || running || submitting || modelSwitching || sessionSwitching || approvalModeSwitching || defaultModelSwitching || mcpSettingsSwitching || skillsSwitching;
	stop.hidden = !running;
	sidebarNew.disabled = tabSwitching || !connected || submitting || modelSwitching || sessionSwitching || approvalModeSwitching || defaultModelSwitching || mcpSettingsSwitching || skillsSwitching;
	modelSelect.disabled = tabSwitching || !connected || running || submitting || modelSwitching || sessionSwitching || approvalModeSwitching || defaultModelSwitching || skillsSwitching || !modelSwitchCapable || availableModels.length === 0;
	defaultModelSelect.disabled = tabSwitching || !connected || running || submitting || defaultModelSwitching || sessionSwitching || approvalModeSwitching || skillsSwitching || !defaultModelControlCapable || availableDefaultModels.length === 0;
	approvalModeToggle.disabled = tabSwitching || !connected || running || submitting || modelSwitching || sessionSwitching || approvalModeSwitching || defaultModelSwitching || mcpSettingsSwitching || skillsSwitching || !approvalModeControlCapable;
	mcpAdd.disabled = tabSwitching || !connected || running || submitting || sessionSwitching || mcpSettingsSwitching || skillsSwitching || !mcpSettingsControlCapable;
	for (const row of skillsList.children) if (row.children[1]) row.children[1].disabled = tabSwitching || !connected || running || submitting || sessionSwitching || modelSwitching || defaultModelSwitching || approvalModeSwitching || mcpSettingsSwitching || skillsSwitching || skillsLoading || !skillsSettingsControlCapable || activeSummary?.status === "Needs approval";
	sessionsButton.disabled = tabSwitching || !connected || !sessionListCapable || submitting || modelSwitching || sessionSwitching || approvalModeSwitching || defaultModelSwitching || skillsSwitching;
	for (const button of recentList.children) button.disabled = button.current || submitting || sessionSwitching || modelSwitching || fileBusy;
	document.querySelector("#project").disabled = fileBusy || tabSwitching || submitting || modelSwitching || sessionSwitching || approvalModeSwitching || defaultModelSwitching || mcpSettingsSwitching || skillsSwitching;
}

function setStatus(text) {
	status.textContent = text;
	status.title = text;
	status.className = text === "Ready" || text === "Choose a project" || text.startsWith("Ready ·") ? "sr-only" : "";
}

function showError(error) {
	setStatus(error instanceof Error ? error.message : String(error));
}

function renderModelSelection() {
	modelSelect.replaceChildren();
	const selected = availableModels.findIndex((model) => model.provider === currentModel?.provider && model.id === currentModel?.id);
	if (selected === -1) {
		const placeholder = document.createElement("option");
		placeholder.value = "";
		placeholder.disabled = true;
		placeholder.textContent = currentModel ? `${currentModel.provider}/${currentModel.id} (unavailable)` : "No model selected";
		modelSelect.append(placeholder);
	}
	for (const [index, model] of availableModels.entries()) {
		const option = document.createElement("option");
		option.value = String(index);
		option.textContent = model.name ? `${model.name} (${model.provider}/${model.id})` : `${model.provider}/${model.id}`;
		modelSelect.append(option);
	}
	modelSelect.value = selected < 0 ? "" : String(selected);
	state();
}

function renderDefaultModelSelection() {
	defaultModelSelect.replaceChildren();
	const selected = availableDefaultModels.findIndex((model) => model.provider === currentDefaultModel?.provider && model.id === currentDefaultModel?.id);
	if (selected === -1) {
		const placeholder = document.createElement("option");
		placeholder.value = "";
		placeholder.disabled = true;
		placeholder.textContent = currentDefaultModel ? `${currentDefaultModel.provider}/${currentDefaultModel.id} (unavailable)` : "No default configured";
		defaultModelSelect.append(placeholder);
	}
	for (const [index, model] of availableDefaultModels.entries()) {
		const option = document.createElement("option");
		option.value = String(index);
		option.textContent = model.name ? `${model.name} (${model.provider}/${model.id})` : `${model.provider}/${model.id}`;
		defaultModelSelect.append(option);
	}
	defaultModelSelect.value = selected < 0 ? "" : String(selected);
	defaultModelNote.textContent = !defaultModelControlCapable ? (connected ? "Update installed Me Write Code to change the default model here." : "Choose a project to view available models.") : !availableDefaultModels.length ? "No authenticated models are available. Sign in or configure a provider in Me Write Code." : selected === -1 && currentDefaultModel ? `${currentDefaultModel.provider}/${currentDefaultModel.id} is unavailable. Sign in or choose another model.` : `Used by new conversations for ${currentDefaultModelScope === "project" ? "this project" : "all projects"}; the current chat is unchanged.`;
	state();
}

function updateDefaultModel(session) {
	defaultModelControlCapable = session?.rpcCapabilities?.defaultModelControl === true;
	currentDefaultModel = session?.defaultModel;
	currentDefaultModelScope = session?.defaultModelScope;
	renderDefaultModelSelection();
}

function renderCommandMenu() {
	commandMenu.replaceChildren();
	const value = prompt.value;
	if (connected && slashCapable && value.startsWith("/") && !/\s/.test(value)) {
		for (const command of commands.filter((item) => item.name.startsWith(value.slice(1))).slice(0, 8)) {
			const option = document.createElement("button");
			option.type = "button";
			option.textContent = `/${command.name} — ${command.description ?? ""}`;
			option.addEventListener("click", () => {
				prompt.value = `/${command.name} `;
				api.setComposerDirty(true, activeAgentId);
				commandMenu.hidden = true;
				prompt.focus();
			});
			commandMenu.append(option);
		}
	}
	commandMenu.hidden = commandMenu.childElementCount === 0;
}

async function refresh() {
	const generation = viewGeneration, owner = activeAgentId;
	const [{ messages }, session] = await Promise.all([api.command("get_messages", {}, owner), api.command("get_state", {}, owner)]);
	if (generation !== viewGeneration || owner !== activeAgentId || !connected) return;
	const priorScroll = conversation.scrollTop;
	const scrolledUp = conversation.scrollHeight - priorScroll - conversation.clientHeight > 24;
	await render(messages);
	if (generation !== viewGeneration || owner !== activeAgentId || !connected) return;
	conversation.scrollTop = scrolledUp ? priorScroll : conversation.scrollHeight;
	currentModel = session.model;
	renderModelSelection();
	stream = undefined;
	return session;
}

async function loadAgent(result, epoch) {
	const savedView = agentViews.get(result.desktopAgentId);
	const openingChat = !currentProjectCwd || activeAgentId !== result.desktopAgentId;
	clearRecentSessions();
	pickerGeneration++;
	const generation = ++viewGeneration;
	if (sessionsDialog.open) sessionsDialog.close();
	if (currentProjectCwd && currentProjectCwd !== result.cwd) { editorContext++; resetFile(); }
	activeAgentId = result.desktopAgentId;
	if (epoch === summaryEpoch) agentSummaries = result.agents ?? agentSummaries;
	connected = result.connected !== false;
	running = connected && ((epoch !== summaryEpoch ? agentSummaries.find((agent) => agent.desktopAgentId === activeAgentId)?.busy : undefined) ?? result.busy ?? result.state.isStreaming);
	submitting = false;
	slashTurn = false;
	turnRendered = false;
	stream = undefined;
	slashCapable = result.state.rpcCapabilities?.promptCompletion === true;
	modelSwitchCapable = result.state.rpcCapabilities?.sessionModelSwitch === true;
	availableModels = result.models;
	availableDefaultModels = result.defaultModels ?? [];
	currentModel = result.state.model;
	sessionListCapable = result.state.rpcCapabilities?.projectSessions === true;
	updateDefaultModel(result.state);
	updateApprovalMode(result.state);
	skillsSettingsControlCapable = result.state.rpcCapabilities?.skillsSettingsControl === true;
	renderSkills(undefined);
	renderMcpServers(result.mcp);
	commands = result.commands;
	document.querySelector("#slash-note").textContent = slashCapable ? "Type / to see available commands." : "Update installed Me Write Code to enable slash commands.";
	document.querySelector("#model-note").textContent = modelSwitchCapable ? "Model changes here affect only this chat." : "Update installed Me Write Code to switch models here.";
	renderModelSelection();
	renderCommandMenu();
	currentProjectCwd = result.cwd;
	resetPanel(result.state, currentProjectCwd);
	const restoreView = savedView?.nodes && !savedView.invalidated && (result.busy || result.preserveView);
	if (restoreView) {
		conversation.replaceChildren(...savedView.nodes);
		stream = savedView.stream;
		thinkingNode = savedView.thinkingNode;
		thinkingSummary = savedView.thinkingSummary;
		thinkingBody = savedView.thinkingBody;
		thinkingIndex = savedView.thinkingIndex;
		turnRendered = savedView.turnRendered;
		lastPrompt = savedView.lastPrompt;
		slashTurn = savedView.slashTurn;
	} else {
		await render(result.messages);
	}
	if (generation !== viewGeneration || activeAgentId !== result.desktopAgentId) return;
	hydratePanelReferences(result.messages);
	if (!restoreView && epoch !== summaryEpoch && api.command) {
		try { await refresh(); } catch { /* Agent may have exited during activation. */ }
		if (generation !== viewGeneration || activeAgentId !== result.desktopAgentId) return;
		running = agentSummaries.find((agent) => agent.desktopAgentId === activeAgentId)?.busy ?? running;
	}
	const cwd = document.querySelector("#cwd");
	cwd.textContent = result.cwd;
	cwd.title = result.cwd;
	const summary = agentSummaries.find((agent) => agent.desktopAgentId === activeAgentId);
	setStatus(result.startupWarning ?? (summary?.status === "Failed" || summary?.status === "Needs approval" ? summary.status : running ? "Working…" : result.state.model ? `Ready · ${result.state.model.provider}/${result.state.model.id}` : "Ready · No model configured"));
	lastPrompt = savedView?.lastPrompt ?? lastPrompt;
	prompt.value = drafts.get(activeAgentId) ?? "";
	if (drafts.has(activeAgentId)) api.setComposerDirty(prompt.value.length > 0, activeAgentId);
	renderCommandMenu();
	state();
	const pending = restoreView ? savedView.pending?.splice(0) ?? [] : (savedView?.pending ?? []).filter((event) => event.type === "rpc_error" || (event.type === "response" && !event.success && event.command === "prompt"));
	if (savedView) { savedView.pending = []; savedView.pendingBytes = 0; savedView.invalidated = false; }
	for (const event of pending) {
		await handleEvent(event);
		if (generation !== viewGeneration || activeAgentId !== result.desktopAgentId) return;
	}
	if (openingChat) conversation.scrollTop = conversation.scrollHeight;
	refreshRecentSessions();
	prompt.focus();
	if (!settingsView.hidden && connected && skillsSettingsControlCapable) void refreshSkills();
}

document.querySelector("#project").addEventListener("click", async () => {
	if (tabSwitching || fileBusy) return;
	stashActiveView();
	tabSwitching = true;
	state();
	try {
		const epoch = summaryEpoch;
		if (fileToken) await flushEditorDirty();
		const result = await api.pickProject();
		if (!result) return;
		if (result.openingNewWindow === true) {
			setStatus("Starting another window… If it doesn't appear, try Project again.");
			return;
		}
		stashActiveView();
		await loadAgent(result, epoch);
	} catch (error) { showError(error); }
	finally { tabSwitching = false; state(); }
});

function clearRecentSessions(message = "Loading conversations…") {
	recentGeneration++;
	recentList.replaceChildren();
	recentStatus.textContent = message;
}

function renderRecentSessions(sessions) {
	recentList.replaceChildren();
	recentStatus.textContent = sessions.length ? "" : "No saved conversations yet.";
	const visible = sessions.slice(0, 8);
	const active = sessions.find((entry) => entry.active);
	if (active && !visible.includes(active)) visible[visible.length < 8 ? visible.length : 7] = active;
	for (const entry of visible) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `recent-conversation${entry.busy ? " chat-running" : ""}`;
		button.desktopAgentId = entry.desktopAgentId;
		button.sessionLabel = entry.name || entry.firstMessage || "Untitled conversation";
		button.current = entry.active;
		button.disabled = entry.active || submitting || sessionSwitching || modelSwitching || fileBusy;
		button.setAttribute("aria-current", entry.active ? "true" : "false");
		button.textContent = `${button.sessionLabel}${entry.busy ? " · Running" : ""}${entry.active ? " · Current" : ""}`;
		button.title = entry.firstMessage || entry.name || "Untitled conversation";
		button.addEventListener("click", () => {
			if (narrowRecent) { setRecentOpen(false); recentToggle.focus(); }
			return switchConversation(entry.token);
		});
		recentList.append(button);
	}
}

async function refreshRecentSessions() {
	if (!connected || !sessionListCapable) {
		clearRecentSessions(connected ? "Update installed Me Write Code to browse conversations." : "Choose a project to see conversations.");
		return;
	}
	const generation = ++recentGeneration;
	try {
		const sessions = await api.listSessions();
		if (generation === recentGeneration && connected) renderRecentSessions(sessions);
	} catch (error) {
		if (generation !== recentGeneration) return;
		const message = error instanceof Error ? error.message : String(error);
		if (!message.includes("timed out: list_project_sessions")) recentList.replaceChildren();
		recentStatus.textContent = message.includes("timed out: list_project_sessions") ? "Chats took too long to load. Open All chats to retry." : message;
	}
}

sessionsButton.addEventListener("click", async () => {
	const generation = ++pickerGeneration;
	sessionsError.textContent = "Loading conversations…";
	sessionsList.replaceChildren();
	sessionsDialog.showModal();
	try {
		recentGeneration++;
		const sessions = await api.listSessions();
		if (generation !== pickerGeneration || !sessionsDialog.open) return;
		renderRecentSessions(sessions);
		sessionsError.textContent = sessions.length ? "" : "No saved conversations yet.";
		for (const entry of sessions) {
			const date = entry.modified ? new Date(entry.modified) : null;
			const button = document.createElement("button");
			button.type = "button";
			button.disabled = entry.active || submitting || sessionSwitching || modelSwitching || fileBusy;
			button.textContent = `${entry.name || entry.firstMessage || "Untitled conversation"} · ${date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "Unknown date"}${entry.busy ? " · Running" : ""}${entry.active ? " · Current" : ""}`;
			button.addEventListener("click", () => switchConversation(entry.token));
			sessionsList.append(button);
		}
	} catch (error) {
		if (generation === pickerGeneration && sessionsDialog.open) {
			const message = error instanceof Error ? error.message : String(error);
			sessionsError.textContent = message.includes("timed out: list_project_sessions") ? "Chats took too long to load. Close and reopen All chats to retry." : message;
		}
	} finally {
		if (generation !== pickerGeneration && !sessionsDialog.open) void refreshRecentSessions();
	}
});
document.querySelector("#sessions-close").addEventListener("click", () => {
	pickerGeneration++;
	sessionsDialog.close();
	if (recentStatus.textContent === "Loading conversations…") void refreshRecentSessions();
});
sessionsDialog.addEventListener("cancel", () => {
	pickerGeneration++;
	if (recentStatus.textContent === "Loading conversations…") void refreshRecentSessions();
});

async function switchConversation(token) {
	if (sessionSwitching || modelSwitching || defaultModelSwitching || approvalModeSwitching || mcpSettingsSwitching || skillsSwitching || fileBusy || submitting) return;
	stashActiveView();
	sessionSwitching = true;
	state();
	try {
		const result = await api.switchSession(token);
		if (result.cancelled) {
			renderSkills(undefined);
			if (!settingsView.hidden && skillsSettingsControlCapable) void refreshSkills();
			sessionsError.textContent = "Conversation switch cancelled.";
			return;
		}
		if (result.reloadRequired) {
			clearRecentSessions("Choose project again.");
			viewGeneration++;
			connected = false;
			running = false;
			skillsSettingsControlCapable = false;
			renderSkills(undefined);
			slashTurn = false;
			sessionListCapable = false;
			render([]);
			resetPanel();
			stream = undefined;
			sessionsDialog.close();
			setStatus(result.error);
			await refreshRecentSessions();
			return;
		}
		transferReplacedChat(result);
		await loadAgent(result, summaryEpoch);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("timed out: list_project_sessions")) {
			sessionsError.textContent = "Chats took too long to load. Try again.";
			recentStatus.textContent = "Chats took too long to load. Try another chat again.";
		} else {
			sessionsError.textContent = message;
			clearRecentSessions(message);
			await refreshRecentSessions();
		}
	}
	finally { sessionSwitching = false; state(); }
}

document.querySelector("#composer").addEventListener("submit", async (event) => {
	event.preventDefault();
	const message = prompt.value.trim(), owner = activeAgentId;
	if (!message || tabSwitching || running || submitting || modelSwitching || sessionSwitching || !connected) return;
	if (message.startsWith("/")) {
		if (!slashCapable) {
			setStatus("Update installed Me Write Code to use slash commands in desktop.");
			return;
		}
		const name = message.slice(1).split(" ", 1)[0];
		if (/\s/.test(name)) {
			setStatus("Use a space after the slash command name.");
			return;
		}
		if (!commands.some((command) => command.name === name)) {
			setStatus(`/${name} isn't available in the desktop app. Type / to see available commands.`);
			return;
		}
	}
	slashTurn = message.startsWith("/");
	submitting = true;
	running = true;
	state();
	prompt.value = "";
	api.setComposerDirty(false, activeAgentId);
	renderCommandMenu();
	lastPrompt = message;
	if (document.querySelector("#welcome")) conversation.replaceChildren();
	bubble("user", message);
	beginThinking();
	setStatus("Working…");
	try {
		await api.command("prompt", { message }, owner);
		if (activeAgentId !== owner) return;
		submitting = false;
		state();
	} catch (error) {
		if (activeAgentId !== owner) {
			drafts.set(owner, message);
			api.setComposerDirty(true, owner);
			queueBackgroundEvent({ type: "rpc_error", desktopAgentId: owner, error: error.message });
			return;
		}
		running = false;
		submitting = false;
		slashTurn = false;
		prompt.value = message;
		api.setComposerDirty(true, activeAgentId);
		settleThinking(true);
		try { await refresh(); } catch { /* Agent may have exited. */ }
		showError(error);
		state();
	}
});

prompt.addEventListener("input", () => {
	renderCommandMenu();
	composerWarning.hidden = true;
	composerWarning.textContent = "";
	api.setComposerDirty(prompt.value.length > 0, activeAgentId);
});
prompt.addEventListener("keydown", (event) => {
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		document.querySelector("#composer").requestSubmit();
	}
});
defaultModelSelect.addEventListener("change", async () => {
	const nextModel = availableDefaultModels[Number(defaultModelSelect.value)];
	if (!nextModel || !defaultModelControlCapable || defaultModelSwitching) {
		renderDefaultModelSelection();
		return;
	}
	const previous = currentDefaultModel;
	defaultModelSwitching = true;
	state();
	try {
		currentDefaultModel = await api.setDefaultModel(nextModel.provider, nextModel.id);
		defaultModelNote.textContent = "Saved for new conversations; the current chat is unchanged.";
		setStatus(`Ready · Default ${currentDefaultModel.provider}/${currentDefaultModel.id}`);
	} catch (error) {
		currentDefaultModel = previous;
		showError(error);
	} finally {
		defaultModelSwitching = false;
		renderDefaultModelSelection();
	}
});
modelSelect.addEventListener("change", async () => {
	const nextModel = availableModels[Number(modelSelect.value)];
	if (!nextModel || !modelSwitchCapable || running || submitting || modelSwitching) {
		renderModelSelection();
		return;
	}
	const previous = currentModel, owner = activeAgentId;
	modelSwitching = true;
	state();
	try {
		const changed = await api.command("set_session_model", { provider: nextModel.provider, modelId: nextModel.id }, owner);
		if (activeAgentId !== owner) return;
		currentModel = changed;
		setStatus(`Ready · ${currentModel.provider}/${currentModel.id}`);
	} catch (error) {
		if (activeAgentId !== owner) return;
		try { currentModel = (await api.command("get_state", {}, owner)).model; }
		catch { currentModel = previous; }
		showError(error);
	} finally {
		modelSwitching = false;
		renderModelSelection();
	}
});
stop.addEventListener("click", async () => {
	if (tabSwitching) return;
	const id = activeAgentId;
	try {
		await api.command("abort", {}, id);
		if (activeAgentId === id) addProgress("Stop requested", "Desktop action");
	} catch (error) { if (activeAgentId === id) showError(error); }
});
async function newConversation() {
	if (submitting || sessionSwitching || !connected) return;
	stashActiveView();
	submitting = true;
	state();
	try { await loadAgent(await api.newChat(), summaryEpoch); }
	catch (error) { showError(error); }
	finally { submitting = false; state(); }
}
sidebarNew.addEventListener("click", () => {
	if (narrowRecent) { setRecentOpen(false); recentToggle.focus(); }
	return newConversation();
});

function openDialog() {
	if (modal.open || !dialogQueue.length) return;
	const request = dialogQueue.shift();
	activeDialog = request;
	const title = document.querySelector("#dialog-title");
	const message = document.querySelector("#dialog-message");
	const body = document.querySelector("#dialog-content");
	const buttons = document.querySelector("#dialog-buttons");
	const approval = request.type === "desktop_approval_request";
	modal.setAttribute("data-kind", approval ? "approval" : "extension");
	title.textContent = `${approval ? "Approval required" : "Extension request"}${request.projectPath ? ` · ${request.projectPath}` : request.projectLabel ? ` · ${request.projectLabel}` : ""}${request.chatLabel ? ` · ${request.chatLabel}${request.background ? " · Background chat" : ""}` : ""}`;
	message.textContent = approval ? `Tool: ${request.toolName} · Risk: ${request.tier}` : `${request.title ?? "Me Write Code"}${request.message ? `\n${request.message}` : ""}`;
	body.replaceChildren();
	buttons.replaceChildren();
	let answered = false;
	const timeout = request.type === "desktop_approval_request" ? undefined : request.timeout ? setTimeout(() => answer({ cancelled: true }), request.timeout) : undefined;
	function answer(data) {
		if (answered) return;
		dismissDialog();
		dismissDialog = undefined;
		if (request.type === "desktop_approval_request") api.approvalReply(request.desktopAgentId, request.token, data.decision).catch(showError);
		else api.reply({ desktopAgentId: request.desktopAgentId, id: request.id, ...(typeof data === "function" ? data() : data) }).catch(showError);
		modal.close();
		openDialog();
	}
	function onCancel(event) {
		event.preventDefault();
		answer(request.type === "desktop_approval_request" ? { decision: "deny" } : { cancelled: true });
	}
	dismissDialog = () => {
		answered = true;
		clearTimeout(timeout);
		modal.removeEventListener("cancel", onCancel);
		activeDialog = undefined;
	};
	modal.addEventListener("cancel", onCancel);
	function button(label, data) {
		const node = document.createElement("button");
		node.type = "button";
		node.textContent = label;
		node.addEventListener("click", () => answer(data));
		buttons.append(node);
	}
	if (request.type === "desktop_approval_request") {
		const details = document.createElement("pre");
		details.id = "approval-arguments";
		details.textContent = request.argumentsJson;
		body.append(details);
		button("Deny", { decision: "deny" });
		button("Approve once", { decision: "once" });
	} else {
		if (request.method === "select") {
			for (const option of request.options ?? []) button(option, { value: option });
		} else if (request.method === "confirm") {
			button("Decline", { confirmed: false });
			button("Confirm", { confirmed: true });
		} else {
			const field = document.createElement(request.method === "editor" ? "textarea" : "input");
			field.value = request.prefill ?? "";
			field.placeholder = request.placeholder ?? "";
			field.setAttribute("aria-label", request.title ?? "Response");
			body.append(field);
			button("Submit", () => ({ value: field.value }));
		}
		button("Cancel", { cancelled: true });
	}
	modal.showModal();
}

function closeApproval(token) {
	const index = dialogQueue.findIndex((request) => request.type === "desktop_approval_request" && request.token === token);
	if (index !== -1) dialogQueue.splice(index, 1);
	if (activeDialog?.type !== "desktop_approval_request" || activeDialog.token !== token) return;
	dismissDialog?.();
	dismissDialog = undefined;
	if (modal.open) modal.close();
	openDialog();
}

function queueBackgroundEvent(event) {
	let compact;
	if (event.type === "message_update") {
		const update = event.assistantMessageEvent ?? {};
		compact = { type: event.type, desktopAgentId: event.desktopAgentId, projectLabel: event.projectLabel, projectPath: event.projectPath, message: { role: event.message?.role }, assistantMessageEvent: { type: update.type, contentIndex: update.contentIndex, delta: update.delta, content: update.content, redacted: update.redacted } };
	} else if (event.type === "message_end") compact = { type: event.type, desktopAgentId: event.desktopAgentId, message: event.message };
	else if (event.type === "desktop_idle" || event.type === "rpc_error" || (event.type === "response" && !event.success && event.command === "prompt")) compact = event;
	else return;
	const view = agentViews.get(event.desktopAgentId) ?? {};
	view.pending ??= [];
	view.pendingBytes ??= 0;
	const bytes = JSON.stringify(compact).length;
	if (bytes > 1024 * 1024 || view.pendingBytes + bytes > 1024 * 1024) {
		view.pending = [];
		view.pendingBytes = 0;
		view.invalidated = true;
	} else {
		view.pending.push(compact);
		view.pendingBytes += bytes;
	}
	agentViews.set(event.desktopAgentId, view);
}

async function handleEvent(event) {
	if (event.type === "desktop_open_settings") {
		await openSettings();
		return;
	}
	if (event.type === "desktop_file_draft_lost") {
		editorContext++;
		resetFile();
		selectPanelView("files");
		setPanelOpen(true);
		fileError("Unsaved file edits could not be recovered after the desktop view reloaded. If Save was in progress, inspect the file on disk before reopening it.");
		return;
	}
	if (event.type === "desktop_agents") {
		summaryEpoch++;
		agentSummaries = event.agents;
		if (!activeAgentId && event.activeAgentId) activeAgentId = event.activeAgentId;
		for (const button of recentList.children) {
			const agent = agentSummaries.find((item) => item.desktopAgentId === button.desktopAgentId);
			if (!agent) continue;
			button.className = `recent-conversation${agent.busy ? " chat-running" : ""}`;
			button.textContent = `${button.sessionLabel}${agent.busy ? " · Running" : ""}${button.current ? " · Current" : ""}`;
		}
		state();
		return;
	}
	if (event.type === "desktop_agent_hydrated") {
		if (event.result.desktopAgentId !== activeAgentId) stashActiveView();
		transferReplacedChat(event.result);
		await loadAgent(event.result, summaryEpoch);
		if (event.result.composerDraftLost) {
			composerWarning.textContent = "Unsent message draft was lost after the desktop view reloaded.";
			composerWarning.hidden = false;
		}
		return;
	}
	if (event.type === "desktop_approval_request") {
		dialogQueue.push(event);
		openDialog();
		return;
	}
	if (event.type === "desktop_approval_closed") {
		closeApproval(event.token);
		return;
	}
	if (event.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(event.method)) {
		dialogQueue.push(event);
		openDialog();
		return;
	}
	if (event.desktopAgentId && event.desktopAgentId !== activeAgentId) {
		if (event.type === "rpc_error") clearDialogs(event.desktopAgentId);
		queueBackgroundEvent(event);
		return;
	}
	if (event.type === "agent_start") {
		toolActivityStatus.textContent = "";
		running = true;
		setStatus("Working…");
		turnRendered = false;
		beginThinking();
		addProgress("Run started");
		state();
	} else if (event.type === "turn_start") {
		beginThinking();
		addProgress("Turn started");
	} else if (event.type === "turn_end") {
		const stopped = event.message?.stopReason === "aborted";
		const failed = event.message?.stopReason === "error";
		if (panelToolRows.size) finishRunningTools(stopped ? "Stopped" : failed ? "Failed" : "Status unknown", failed);
		else clearToolActivity();
		addProgress(stopped ? "Turn stopped" : failed ? "Turn failed" : "Turn completed", "Live turn event", failed);
	} else if (event.type === "agent_end") {
		settleThinking(true);
		const assistant = [...(event.messages ?? [])].reverse().find((message) => message.role === "assistant");
		const failed = assistant?.stopReason === "error";
		const stopped = assistant?.stopReason === "aborted";
		finishRunningTools(failed ? "Failed" : "Stopped", failed);
		addProgress(failed ? "Run failed" : stopped ? "Run stopped" : "Run finished", "Live agent event", failed);
	} else if (event.type === "message_update" && event.message?.role === "assistant" && event.assistantMessageEvent?.type === "thinking_start") {
		showThinking(event.assistantMessageEvent.contentIndex);
	} else if (event.type === "message_update" && event.message?.role === "assistant" && event.assistantMessageEvent?.type === "thinking_delta") {
		showThinking(event.assistantMessageEvent.contentIndex);
		thinkingBody.textContent += event.assistantMessageEvent.delta ?? "";
		conversation.scrollTop = conversation.scrollHeight;
	} else if (event.type === "message_update" && event.message?.role === "assistant" && event.assistantMessageEvent?.type === "thinking_end") {
		showThinking(event.assistantMessageEvent.contentIndex);
		const part = event.message?.content?.[event.assistantMessageEvent.contentIndex];
		if ((part?.redacted || event.assistantMessageEvent.redacted) && !thinkingBody.textContent) {
			thinkingNode.className = "thinking-details thinking-loading thinking-unavailable";
			thinkingSummary.textContent = "Thinking… (text unavailable)";
		} else if (!thinkingBody.textContent) thinkingBody.textContent = event.assistantMessageEvent.content ?? "";
	} else if (event.type === "message_update" && event.message?.role === "assistant" && event.assistantMessageEvent?.type === "toolcall_start") {
		if (thinkingBody?.textContent) settleThinking();
	} else if (event.type === "message_update" && event.message?.role === "assistant" && event.assistantMessageEvent?.type === "text_start") {
		settleThinking();
		if (!stream) { stream = bubble("assistant", ""); stream.className = "message assistant streaming"; stream.setAttribute("aria-busy", "true"); stream.setAttribute("aria-live", "off"); }
		if (stream.textContent) stream.textContent += "\n";
	} else if (event.type === "message_update" && event.message?.role === "assistant" && event.assistantMessageEvent?.type === "text_delta") {
		settleThinking();
		if (!stream) { stream = bubble("assistant", ""); stream.className = "message assistant streaming"; stream.setAttribute("aria-busy", "true"); stream.setAttribute("aria-live", "off"); }
		stream.textContent += event.assistantMessageEvent.delta;
		conversation.scrollTop = conversation.scrollHeight;
	} else if (event.type === "message_end" && event.message?.role === "assistant") {
		const finalThinking = thinkingContent(event.message);
		const finalText = content(event.message);
		if (finalThinking) {
			showThinking(thinkingIndex);
			thinkingBody.textContent = finalThinking;
		}
		if (finalThinking || finalText) settleThinking(true);
		const completed = stream;
		stream = undefined;
		if (finalText) {
			const node = completed ?? bubble("assistant", "");
			node.className = "message assistant";
			node.removeAttribute("aria-live");
			turnRendered = true;
			await window.mewriteMarkdown.renderMarkdown(node, finalText);
			node.removeAttribute("aria-busy");
		}
	} else if (event.type === "tool_execution_start") {
		settleThinking(true);
		startPanelTool(event);
	} else if (event.type === "tool_execution_end") {
		endPanelTool(event);
	} else if (event.type === "desktop_idle") {
		settleThinking(true);
		if (panelToolRows.size) finishRunningTools("Status unknown");
		else clearToolActivity();
		running = false;
		slashTurn = false;
		setStatus("Ready");
		clearDialogs(event.desktopAgentId);
		try {
			if (!event.extensionOnly && !turnRendered) await refresh();
			await refreshRecentSessions();
		} catch (error) { showError(error); }
		turnRendered = false;
		state();
	} else if (event.type === "auto_retry_start") {
		setStatus(`Retrying in ${Math.ceil(event.delayMs / 1000)}s…`);
		addProgress("Retry scheduled", `Retrying in ${Math.ceil(event.delayMs / 1000)}s`);
	} else if (event.type === "auto_retry_end" && !event.success) {
		addProgress("Retry failed", "Live retry event", true);
		showError(event.finalError ?? "Unable to reach the model after retrying. Send your message again.");
	} else if (event.type === "desktop_commands") {
		commands = event.commands;
		renderCommandMenu();
	} else if (event.type === "desktop_models") {
		availableModels = event.models;
		availableDefaultModels = event.defaultModels ?? [];
		currentModel = event.model;
		currentDefaultModel = event.defaultModel;
		currentDefaultModelScope = event.defaultModelScope;
		renderModelSelection();
		renderDefaultModelSelection();
	} else if (event.type === "desktop_approval_mode") {
		updateApprovalMode({ approvalMode: event.enabled, rpcCapabilities: { approvalModeControl: event.capable } });
	} else if (event.type === "desktop_mcp_servers") {
		renderMcpServers(event.inventory);
	} else if (event.type === "extension_error") {
		addProgress("Extension failed", "Live extension event", true);
		showError(event.error);
		if (slashTurn) bubble("assistant", `Command error: ${event.error}`);
	} else if (event.type === "extension_ui_request") {
		if (event.method === "notify") {
			setStatus(event.message);
			if (slashTurn) bubble("assistant", event.message);
		}
	} else if (event.type === "response" && !event.success && event.command === "prompt") {
		settleThinking(true);
		finishRunningTools("Failed", true);
		addProgress("Prompt failed", "RPC response", true);
		running = false;
		submitting = false;
		slashTurn = false;
		clearDialogs(event.desktopAgentId);
		if (!prompt.value) { prompt.value = lastPrompt; api.setComposerDirty(prompt.value.length > 0, activeAgentId); }
		try { await refresh(); } catch { /* Agent may have exited. */ }
		state();
		showError(event.error);
	} else if (event.type === "rpc_error" || (event.type === "response" && !event.success)) {
		settleThinking(true);
		addProgress(event.type === "rpc_error" ? "Connection failed" : `${event.command} failed`, event.type === "rpc_error" ? "RPC transport" : "RPC response", true);
		if (event.type === "rpc_error") { finishRunningTools("Failed", true); viewGeneration++; connected = false; running = false; submitting = false; modelSwitching = false; sessionSwitching = false; slashTurn = false; clearDialogs(event.desktopAgentId); updateDefaultModel(undefined); updateApprovalMode(undefined); skillsSettingsControlCapable = false; renderSkills(undefined); renderMcpServers(undefined); state(); await refreshRecentSessions(); }
		showError(event.error);
	}
}
api.onEvent(handleEvent);
