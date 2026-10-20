const { execFile, spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { existsSync, realpath, realpathSync } = require("node:fs");
const { homedir } = require("node:os");
const { basename, dirname, join } = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const { APPROVAL_CAPABILITY, ApprovalBroker, matchesApprovalCapability } = require("./approval.cjs");
const { openProjectFile, saveProjectFile } = require("./file-editor.cjs");
const { Rpc } = require("./rpc.cjs");

const SESSION_LIST_TIMEOUT_MS = 10_000;
let window;
const agents = new Map();
let activeAgentId;
let picking = false;
let quitting = false;
let externalPromptOpen = false;
let rendererGeneration = 0;
let rendererReady = false;
let shutdownPromise;
let editor;
let editorOperation = false;
let editorTransition = false;
let chatOpening = false;
const composerDirty = new Set();
let composerDraftLost = false;

function active() {
	return [...agents.values()].find((ctx) => ctx.id === activeAgentId);
}

function valid(ctx) {
	return Boolean(ctx?.rpc && agents.get(ctx.id) === ctx && !ctx.rpc.closed);
}

function summaries() {
	return [...agents.values()].map((ctx) => ({ desktopAgentId: ctx.id, projectLabel: ctx.label, projectPath: ctx.cwd, busy: ctx.busy, status: ctx.approvalBroker.pending.size || ctx.dialogs.size ? "Needs approval" : ctx.failed ? "Failed" : ctx.busy ? "Working" : "Ready" }));
}

function send(ctx, event) {
	if (!rendererReady || !window || window.isDestroyed()) return;
	let visible = event;
	if (ctx.id !== activeAgentId) {
		if (event.type === "message_update") {
			const update = event.assistantMessageEvent ?? {};
			const redacted = update.redacted === true || event.message?.content?.[update.contentIndex]?.redacted === true;
			visible = { type: event.type, message: { role: event.message?.role }, assistantMessageEvent: { type: update.type, contentIndex: update.contentIndex, delta: redacted ? undefined : update.delta, content: redacted ? undefined : update.content, redacted } };
		} else if (event.type === "message_end") visible = { type: event.type, message: { role: event.message?.role, content: event.message?.content } };
		else if (!["desktop_idle", "rpc_error", "desktop_approval_request", "desktop_approval_closed", "extension_ui_request", "extension_error"].includes(event.type) && !(event.type === "response" && !event.success && event.command === "prompt")) return;
	}
	const dialogOrigin = ["desktop_approval_request", "extension_ui_request"].includes(visible.type) ? { chatLabel: `${(ctx.sessionName || "New chat").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 80)} · ${(ctx.sessionId || ctx.id).slice(0, 8)}`, background: ctx.id !== activeAgentId } : {};
	window.webContents.send("agent-event", { ...visible, desktopAgentId: ctx.id, projectLabel: ctx.label, projectPath: ctx.cwd, ...dialogOrigin });
}

function sendSummaries() {
	if (rendererReady && window && !window.isDestroyed()) window.webContents.send("agent-event", { type: "desktop_agents", agents: summaries(), activeAgentId });
}

function cancelDialogs(ctx) {
	for (const id of ctx.dialogs.keys()) ctx.rpc.reply({ id, cancelled: true });
	ctx.dialogs.clear();
	sendSummaries();
}

function rendererLost(ready = false) {
	rendererReady = ready;
	if (!ready) { rendererGeneration++; composerDraftLost ||= composerDirty.size > 0; composerDirty.clear(); }
	for (const ctx of agents.values()) {
		ctx.approvalBroker.setRendererGeneration(rendererGeneration, ready);
		if (!ready) cancelDialogs(ctx);
	}
}

async function restoreRenderer() {
	rendererLost(true);
	const lostComposer = composerDraftLost;
	const lostDraft = editor?.dirty ? editor.ctx : undefined;
	editor = undefined;
	sendSummaries();
	if (lostDraft) send(lostDraft, { type: "desktop_file_draft_lost" });
	const ctx = active();
	const generation = rendererGeneration;
	if (!valid(ctx)) {
		if (ctx?.lastHydration) {
			send(ctx, { type: "desktop_agent_hydrated", result: { ...ctx.lastHydration, agents: summaries(), busy: false, connected: false, preserveView: true, composerDraftLost: lostComposer } });
			if (lostComposer) composerDraftLost = false;
		}
		return;
	}
	try {
		const result = await hydrate(ctx);
		if (rendererReady && generation === rendererGeneration && active() === ctx) {
			send(ctx, { type: "desktop_agent_hydrated", result: { ...result, composerDraftLost: lostComposer } });
			if (lostComposer) composerDraftLost = false;
		}
	} catch (error) {
		if (rendererReady && generation === rendererGeneration && active() === ctx) {
			if (valid(ctx) && ctx.lastHydration) send(ctx, { type: "desktop_agent_hydrated", result: { ...ctx.lastHydration, agents: summaries(), busy: ctx.busy, connected: true, preserveView: true, degraded: true, composerDraftLost: lostComposer } });
			else send(ctx, { type: "rpc_error", error: lostComposer ? `${error.message.replace(/\.$/, "")}. Your unsent message was lost when the desktop view reloaded.` : error.message });
			if (lostComposer) composerDraftLost = false;
		}
	}
}

async function physicalPath(path) {
	if (!realpath) return realpathSync(path);
	return new Promise((resolve, reject) => realpath(path, (error, resolved) => error ? reject(error) : resolve(resolved)));
}

function visibleState(ctx, state) {
	const { sessionFile: _sessionFile, ...visible } = state;
	return {
		...visible,
		rpcCapabilities: state.rpcCapabilities && {
			...state.rpcCapabilities,
			approvalModeControl: state.rpcCapabilities.approvalModeControl === true && ctx.approvalDialogNegotiated,
		},
	};
}

function desktopCommands(commands) {
	// ponytail: extension UI requirements are not advertised; only /tips is known to work over RPC. First supported name in server order wins.
	const excluded = new Set(commands.filter((command) => command.source === "extension" && command.name !== "tips").map((command) => command.name));
	const seen = new Set();
	return commands.filter((command) => {
		if (excluded.has(command.name) || seen.has(command.name)) return false;
		if (command.source !== "skill" && command.source !== "prompt" && !(command.source === "extension" && command.name === "tips")) return false;
		seen.add(command.name);
		return true;
	});
}

function modelChoice(model) {
	return { provider: model.provider, id: model.id, name: model.name };
}

function confirmDiscard(message, dirty = editor?.dirty) {
	if (!dirty) return true;
	const options = { type: "warning", buttons: ["Keep editing", "Discard changes"], defaultId: 0, cancelId: 0, message };
	return (window && !window.isDestroyed() ? dialog.showMessageBoxSync(window, options) : dialog.showMessageBoxSync(options)) === 1;
}

function confirmQuitDrafts() {
	const message = editor?.dirty && composerDirty.size ? "Discard unsaved file changes and unsent messages and quit?" : composerDirty.size ? "Discard unsent messages and quit?" : "Discard unsaved file changes and quit?";
	return confirmDiscard(message, Boolean(editor?.dirty || composerDirty.size));
}

function editorFrame(event) {
	if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("File editor request unavailable.");
}

function editorOwner(ctx) {
	return Boolean(ctx && agents.get(ctx.id) === ctx && active()?.cwd === ctx.cwd);
}

function editorError(error, action) {
	if (/^(File |Binary files |Save requires |Save exceeds )/.test(error.message)) return error;
	return new Error(`Unable to ${action} this file. Check that it still exists and that you can ${action === "save" ? "write to" : "read"} it, then try again.`);
}

function confirmStop() {
	const options = {
		type: "warning",
		buttons: ["Keep working", "Stop and quit"],
		defaultId: 0,
		cancelId: 0,
		message: "Agent is still working. Stop it and quit?",
	};
	return (window && !window.isDestroyed() ? dialog.showMessageBoxSync(window, options) : dialog.showMessageBoxSync(options)) === 1;
}

async function hydrate(ctx) {
	const current = ctx.rpc;
	const command = (type) => current.command(type, {}, undefined, 5000);
	const [state, history, available, models] = await Promise.all([command("get_state"), command("get_messages"), command("get_commands"), command("get_available_models")]);
	const defaultModels = state.rpcCapabilities?.defaultModelControl === true ? await command("get_default_models") : models;
	const mcp = state.rpcCapabilities?.mcpSettingsControl === true ? await command("get_mcp_servers") : undefined;
	if (!valid(ctx)) throw new Error("This chat's agent stopped. Choose the project again to reconnect.");
	ctx.slashCapable = state.rpcCapabilities?.promptCompletion === true;
	ctx.modelSwitchCapable = state.rpcCapabilities?.sessionModelSwitch === true;
	ctx.defaultModelControlCapable = state.rpcCapabilities?.defaultModelControl === true;
	ctx.approvalModeControlCapable = state.rpcCapabilities?.approvalModeControl === true && ctx.approvalDialogNegotiated;
	ctx.mcpSettingsControlCapable = state.rpcCapabilities?.mcpSettingsControl === true;
	ctx.skillsSettingsControlCapable = state.rpcCapabilities?.skillsSettingsControl === true;
	ctx.modelList = models.models.map(modelChoice);
	ctx.defaultModelList = defaultModels.models.map(modelChoice);
	ctx.sessionListCapable = state.rpcCapabilities?.projectSessions === true;
	const commands = desktopCommands(available.commands);
	ctx.commandNames = new Set(commands.map((command) => command.name));
	ctx.sessionFile = state.sessionFile;
	ctx.sessionId = state.sessionId;
	ctx.sessionName = state.sessionName;
	const result = { desktopAgentId: ctx.id, agents: summaries(), cwd: ctx.cwd, state: visibleState(ctx, state), messages: history.messages, commands, models: ctx.modelList, defaultModels: ctx.defaultModelList, mcp, busy: ctx.busy };
	ctx.lastHydration = { ...result, messages: [] };
	return result;
}

async function activateAgent(ctx) {
	if (!valid(ctx)) {
		if (!ctx?.lastHydration) throw new Error("This chat's agent stopped. Choose the project again to reconnect.");
		activeAgentId = ctx.id;
		sendSummaries();
		return { ...ctx.lastHydration, agents: summaries(), busy: false, connected: false, preserveView: true };
	}
	let result;
	try { result = await hydrate(ctx); }
	catch (error) {
		ctx.failed = true;
		if (!ctx.lastHydration) { sendSummaries(); throw error; }
		activeAgentId = ctx.id;
		sendSummaries();
		return { ...ctx.lastHydration, agents: summaries(), busy: ctx.busy, connected: true, preserveView: true, degraded: true };
	}
	if (!valid(ctx)) throw new Error("This chat's agent stopped. Choose the project again to reconnect.");
	if (activeAgentId !== ctx.id) {
		ctx.skillsInventory = undefined;
		ctx.skillsGeneration++;
	}
	activeAgentId = ctx.id;
	sendSummaries();
	return result;
}

async function terminateAgent(ctx) {
	if (ctx.exited) return true;
	ctx.closing = true;
	ctx.rpc.child.stdin.end();
	let exited = await Promise.race([ctx.exitPromise.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 2000))]);
	if (!exited) {
		ctx.rpc.child.kill?.();
		exited = await Promise.race([ctx.exitPromise.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 1000))]);
	}
	if (!exited) {
		ctx.rpc.child.kill?.("SIGKILL");
		exited = await Promise.race([ctx.exitPromise.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 500))]);
	}
	return exited;
}

async function closeAgent(ctx) {
	if (!ctx || ctx.busy || ctx.switching || ctx.modelSwitching || ctx.approvalBroker.pending.size || ctx.dialogs.size) throw new Error("Stop current work before closing this agent.");
	if (!await terminateAgent(ctx)) throw new Error("Agent is still shutting down.");
	agents.delete(ctx.id);
	if (editor?.ctx === ctx) editor = undefined;
	if (activeAgentId !== ctx.id) return { closed: true, agents: summaries(), activeAgentId };
	for (const next of agents.values()) {
		if (!valid(next)) continue;
		try {
			const result = await hydrate(next);
			next.skillsInventory = undefined;
			next.skillsGeneration++;
			activeAgentId = next.id;
			sendSummaries();
			return { closed: true, ...result };
		} catch { /* Try another live slot. */ }
	}
	activeAgentId = undefined;
	sendSummaries();
	return { closed: true, agents: summaries() };
}

function shutdownAgents() {
	if (shutdownPromise) return shutdownPromise;
	shutdownPromise = (async () => {
		const contexts = [...agents.values()];
		for (const ctx of contexts) {
			ctx.approvalBroker.denyAll();
			cancelDialogs(ctx);
			if (ctx.busy && !ctx.rpc.closed) ctx.rpc.command("abort").catch(() => { });
			ctx.rpc.child.stdin.end();
		}
		await Promise.race([Promise.all(contexts.map((ctx) => ctx.exitPromise)), new Promise((resolve) => setTimeout(resolve, 2000))]);
		for (const ctx of contexts) if (!ctx.exited) ctx.rpc.child.kill?.();
		await Promise.race([Promise.all(contexts.map((ctx) => ctx.exitPromise)), new Promise((resolve) => setTimeout(resolve, 1000))]);
		for (const ctx of contexts) if (!ctx.exited) ctx.rpc.child.kill?.("SIGKILL");
		await Promise.race([Promise.all(contexts.map((ctx) => ctx.exitPromise)), new Promise((resolve) => setTimeout(resolve, 500))]);
		quitting = true;
		app.quit();
	})();
	return shutdownPromise;
}

function openDesktopWindow(chooseProject = false) {
	const args = [...(app.isPackaged ? [] : [__dirname]), ...(chooseProject ? ["--choose-project"] : [])];
	if (process.platform !== "darwin") return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, { detached: true, stdio: "ignore" });
		child.once("error", reject);
		child.once("spawn", () => { child.unref(); resolve(); });
	});
	return new Promise((resolve, reject) => {
		execFile("open", ["-n", "-a", join(dirname(process.execPath), "../.."), ...(args.length ? ["--args", ...args] : [])], { timeout: 10_000 }, (error) => error ? reject(error) : resolve());
	});
}

async function pickProject() {
	const choice = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
	if (choice.canceled) return null;
	const cwd = await physicalPath(choice.filePaths[0]);
	return startAgent(cwd);
}

async function startAgent(cwd, selected, fresh = false) {
	const ctx = { id: randomUUID(), cwd, label: basename(cwd) || cwd, sessionFile: selected?.path, sessionId: selected?.id, busy: false, retrying: false, agentRunning: false, starting: true, failed: false, exited: false, switching: false, modelSwitching: false, slashCapable: false, modelSwitchCapable: false, defaultModelControlCapable: false, approvalModeControlCapable: false, mcpSettingsControlCapable: false, skillsSettingsControlCapable: false, skillsInventory: undefined, skillsGeneration: 0, approvalDialogNegotiated: false, modelList: [], defaultModelList: [], sessionListCapable: false, sessionSelections: new Map(), listGeneration: 0, commandNames: new Set(), dialogs: new Map() };
	ctx.approvalBroker = new ApprovalBroker((event) => {
		if (!window || window.isDestroyed()) throw new Error("Renderer unavailable");
		send(ctx, event);
		sendSummaries();
	});
	agents.set(ctx.id, ctx);
	const rendererAtStart = rendererGeneration;
	const local = join(homedir(), ".local", "bin", "mewrite");
	const binary = app.isPackaged ? join(process.resourcesPath, "app", "runtime", "bin", "node") : process.env.MEWRITE_BIN || (existsSync(local) ? local : "mewrite");
	const args = app.isPackaged ? [join(process.resourcesPath, "app", "runtime", "node_modules", "@zhachory1", "mewrite-code", "dist", "cli.js"), "--mode", "rpc"] : ["--mode", "rpc"];
	let child;
	try {
		child = spawn(binary, args, {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				PATH: [join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH].join(":"),
			},
		});
	} catch (error) {
		agents.delete(ctx.id);
		throw error;
	}
	let stderr = "";
	const settle = () => {
		if (!valid(ctx) || ctx.retrying || ctx.agentRunning || (ctx.activeSlash && !ctx.activeSlash.completed)) return;
		ctx.busy = false;
		cancelDialogs(ctx);
		send(ctx, { type: "desktop_idle", extensionOnly: ctx.activeSlash?.started === false });
		ctx.activeSlash = undefined;
		sendSummaries();
	};
	child.stderr.on("data", (data) => {
		stderr = (stderr + data.toString()).slice(-1500);
	});
	child.stderr.on("error", (error) => {
		stderr = `Agent stderr unavailable: ${error.message}`;
	});
	ctx.exitPromise = new Promise((resolve) => {
		let settled = false;
		const done = (code, signal) => {
			if (settled) return;
			settled = true;
			ctx.exited = true;
			ctx.exitCode = code;
			ctx.exitSignal = signal;
			resolve();
			sendSummaries();
			if (activeAgentId === ctx.id && !ctx.closing && !shutdownPromise) {
				const fallback = [...agents.values()].find((candidate) => candidate !== ctx && valid(candidate));
				if (fallback) void activateAgent(fallback).then((result) => {
					if (active() === fallback) send(fallback, { type: "desktop_agent_hydrated", result });
				}).catch(() => { /* Keep the failed chat visible if recovery also fails. */ });
			}
		};
		child.once("exit", done);
		child.once("close", done);
		child.once("error", () => { if (child.pid == null) done(); });
	});
	const session = new Rpc(child, (event) => {
		if (agents.get(ctx.id) !== ctx || (typeof event.type === "string" && event.type.startsWith("desktop_"))) return;
		if (event.type === "approval_request") {
			ctx.approvalBroker.request(session, event);
			return;
		}
		if (event.type === "approval_closed") {
			ctx.approvalBroker.closed(session, event.id);
			return;
		}
		if (event.type === "agent_start") {
			ctx.busy = true;
			ctx.agentRunning = true;
			if (ctx.activeSlash) ctx.activeSlash.started = true;
			clearTimeout(ctx.idleTimer);
		}
		if (event.type === "auto_retry_start") {
			ctx.retrying = true;
			clearTimeout(ctx.idleTimer);
		}
		if (event.type === "auto_retry_end") {
			ctx.retrying = false;
			if (!event.success) ctx.failed = true;
		}
		if (event.type === "turn_end") ctx.failed = event.message?.stopReason === "error";
		if (event.type === "agent_end") {
			ctx.agentRunning = false;
			ctx.failed = [...(event.messages ?? [])].reverse().find((message) => message.role === "assistant")?.stopReason === "error" || ctx.failed;
		}
		const completedSlash = ctx.activeSlash && event.type === "prompt_complete" && event.id === ctx.activeSlash.id;
		if (completedSlash) ctx.activeSlash.completed = true;
		if (event.type === "agent_end" || completedSlash || (event.type === "auto_retry_end" && !event.success)) {
			clearTimeout(ctx.idleTimer);
			ctx.idleTimer = setTimeout(settle, 100);
		}
		if (event.type === "response" && event.command === "prompt" && !event.success) {
			if (!ctx.activeSlash || event.id === ctx.activeSlash.id) {
				clearTimeout(ctx.idleTimer);
				ctx.busy = false;
				ctx.failed = true;
				ctx.activeSlash = undefined;
				cancelDialogs(ctx);
				send(ctx, { type: "desktop_idle" });
			}
		}
		if (event.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(event.method)) {
			if (!rendererReady) {
				session.reply({ id: event.id, cancelled: true });
				return;
			}
			ctx.dialogs.set(event.id, event.method);
			sendSummaries();
		}
		if (event.type === "rpc_error") {
			clearTimeout(ctx.idleTimer);
			ctx.busy = false;
			ctx.failed = true;
			ctx.activeSlash = undefined;
			event.error = stderr.trim() || event.error;
			cancelDialogs(ctx);
			ctx.approvalBroker.bind(session, rendererGeneration, false);
			if (ctx.starting) return;
		}
		send(ctx, event);
	});
	ctx.rpc = session;
	try {
		const state = await session.command("get_state", {}, undefined, 5000);
		let startupWarning;
		if (selected) {
			const switched = await session.command("switch_session", { sessionPath: selected.path }, undefined, 5000);
			if (switched.cancelled) throw new Error("Conversation switch was cancelled.");
			const current = await session.command("get_state", {}, undefined, 5000);
			if (current.sessionFile !== selected.path || current.sessionId !== selected.id) throw new Error("Conversation changed while opening; refresh and retry.");
		} else if (!fresh && state.rpcCapabilities?.projectSessions === true) {
			let sessions;
			try { ({ sessions } = await session.command("list_project_sessions", {}, undefined, 5000)); }
			catch (error) {
				if (!valid(ctx)) throw error;
				startupWarning = "Saved conversations could not be listed. Started a new chat.";
			}
			if (sessions?.length > 0) {
				const resumed = await session.command("switch_session", { sessionPath: sessions[0].path }, undefined, 5000);
				if (resumed.cancelled) startupWarning = "Recent conversation switch was cancelled. Started a new chat.";
			}
		} else if (!fresh) startupWarning = "Update installed Me Write Code to resume saved chats safely. Started a new chat.";
		if (matchesApprovalCapability(state.rpcCapabilities?.approvalDialog)) {
			const negotiated = await session.command("client_capabilities", { approvalDialog: APPROVAL_CAPABILITY }, undefined, 5000);
			ctx.approvalDialogNegotiated = negotiated.approvalDialog === true;
		}
		ctx.approvalBroker.bind(session, rendererGeneration, ctx.approvalDialogNegotiated);
		ctx.approvalBroker.setRendererGeneration(rendererGeneration, rendererReady);
		const result = await activateAgent(ctx);
		ctx.starting = false;
		const hydrated = startupWarning ? { ...result, startupWarning } : result;
		if (rendererReady && rendererAtStart !== rendererGeneration && active() === ctx) send(ctx, { type: "desktop_agent_hydrated", result: hydrated });
		return hydrated;
	} catch (error) {
		ctx.failed = true;
		ctx.approvalBroker.denyAll();
		cancelDialogs(ctx);
		const exited = await terminateAgent(ctx);
		if (exited) agents.delete(ctx.id);
		throw new Error(`${error.message.replace(/\.$/, "")}. Check that Me Write Code is installed and configured. ${stderr.trim()}`);
	}
}

app.whenReady().then(() => {
	window = new BrowserWindow({
		width: 1080,
		height: 760,
		minWidth: 620,
		minHeight: 460,
		title: "Me Write Code",
		titleBarStyle: "hidden",
		trafficLightPosition: { x: 20, y: 19 },
		webPreferences: {
			preload: join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("will-navigate", (event) => event.preventDefault());
	window.webContents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
		if (isMainFrame) rendererLost();
	});
	let chooseOnLoad = process.argv.includes("--choose-project");
	window.webContents.on("did-finish-load", () => {
		restoreRenderer();
		if (!chooseOnLoad) return;
		chooseOnLoad = false;
		picking = true;
		void pickProject().then((result) => {
			if (result) send(active(), { type: "desktop_agent_hydrated", result });
		}).catch((error) => {
			if (window && !window.isDestroyed()) window.webContents.send("agent-event", { type: "rpc_error", error: error.message });
		}).finally(() => { picking = false; });
	});
	window.webContents.on("render-process-gone", () => rendererLost());
	window.on("close", (event) => {
		if (quitting || agents.size === 0) return;
		event.preventDefault();
		if (shutdownPromise || editorOperation || picking || editorTransition || !confirmQuitDrafts() || ([...agents.values()].some((ctx) => ctx.busy) && !confirmStop())) return;
		rendererLost();
		shutdownAgents();
	});
	window.on("closed", () => rendererLost());
	const openSettings = () => {
		if (rendererReady && window && !window.isDestroyed()) window.webContents.send("agent-event", { type: "desktop_open_settings" });
	};
	const fileMenu = { label: "File", submenu: [
		{ label: "New Window", accelerator: process.platform === "darwin" ? "Command+N" : "Ctrl+N", click: () => { void openDesktopWindow().catch((error) => dialog.showErrorBox("Could not open window", error.message)); } },
		{ type: "separator" }, { role: "close" },
	] };
	if (process.platform === "darwin") Menu.setApplicationMenu(Menu.buildFromTemplate([
		{ label: "Me Write Code", submenu: [
			{ role: "about" },
			{ type: "separator" },
			{ label: "Settings…", accelerator: "Command+,", click: openSettings },
			{ type: "separator" },
			{ role: "services" },
			{ type: "separator" },
			{ role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
			{ type: "separator" },
			{ role: "quit" },
		] },
		fileMenu, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }, { role: "help" },
	]));
	else Menu.setApplicationMenu(Menu.buildFromTemplate([
		{ ...fileMenu, submenu: [...fileMenu.submenu, { label: "Settings…", accelerator: "Ctrl+,", click: openSettings }] },
		{ role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }, { role: "help" },
	]));
	window.loadFile(join(__dirname, "index.html"));
});

ipcMain.handle("open-external", async (_event, href) => {
	let url;
	try { url = typeof href === "string" && new URL(href); }
	catch { /* Rejected below. */ }
	if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) throw new Error("Unsupported external URL.");
	if (externalPromptOpen) throw new Error("External link prompt already open.");
	externalPromptOpen = true;
	try {
		const { response } = await dialog.showMessageBox(window, { type: "question", buttons: ["Cancel", "Open link"], defaultId: 0, cancelId: 0, message: "Open external link?", detail: url.href });
		if (response !== 1) return false;
		await shell.openExternal(url.href);
		return true;
	} finally {
		externalPromptOpen = false;
	}
});
ipcMain.handle("pick-project", async () => {
	if (active()?.modelSwitching) throw new Error("Model switch in progress.");
	if (picking || active()?.switching || editorOperation || editorTransition) throw new Error("Project selection is already in progress.");
	if (active()) { await openDesktopWindow(true); return { openingNewWindow: true }; }
	picking = true;
	const previous = active();
	try {
		const result = await pickProject();
		if (active() !== previous) editor = undefined;
		return result;
	} finally { picking = false; }
});
ipcMain.handle("activate-agent", async (_event, id) => {
	if (picking || active()?.switching || active()?.modelSwitching || editorOperation || editorTransition) throw new Error("Finish the current change before switching projects.");
	const ctx = [...agents.values()].find((candidate) => candidate.id === id);
	if (ctx !== active() && !confirmDiscard("Discard unsaved file changes and switch projects?")) return { cancelled: true };
	editorTransition = true;
	const previous = active();
	try {
		const result = await activateAgent(ctx);
		if (active() !== previous) editor = undefined;
		return result;
	} finally { editorTransition = false; }
});
ipcMain.handle("close-agent", async (_event, id) => {
	if (editorOperation || picking || editorTransition) throw new Error("Finish the current file or project change before closing this agent.");
	const ctx = [...agents.values()].find((candidate) => candidate.id === id);
	const fileDirty = editor?.ctx === ctx && editor.dirty;
	const messageDirty = Boolean(ctx && composerDirty.has(ctx.id));
	if ((fileDirty || messageDirty) && !confirmDiscard(fileDirty && messageDirty ? "Discard unsaved file changes and unsent message and close this project?" : messageDirty ? "Discard unsent message and close this project?" : "Discard unsaved file changes and close this agent?", true)) return { cancelled: true };
	editorTransition = true;
	try {
		const result = await closeAgent(ctx);
		if (result.closed) composerDirty.delete(ctx.id);
		return result;
	} finally { editorTransition = false; }
});
ipcMain.handle("open-project-file", async (event) => {
	editorFrame(event);
	const ctx = active();
	if (!editorOwner(ctx) || picking || editorTransition || editorOperation) throw new Error("Wait for the current file or project change to finish, then try again.");
	editorOperation = true;
	try {
		const choice = await dialog.showOpenDialog(window, { defaultPath: ctx.cwd, properties: ["openFile"] });
		if (choice.canceled) return null;
		if (!editorOwner(ctx)) throw new Error("Project changed while opening file.");
		let opened;
		try { opened = await openProjectFile(ctx.cwd, choice.filePaths[0]); }
		catch (error) { throw editorError(error, "open"); }
		if (!editorOwner(ctx)) throw new Error("Project changed while opening file.");
		if (!confirmDiscard("Discard unsaved file changes and open another file?")) return null;
		const token = randomUUID();
		editor = { ctx, token, proof: opened.proof, dirty: false };
		return { token, relativePath: opened.relativePath, content: opened.content };
	} finally { editorOperation = false; }
});
ipcMain.handle("save-project-file", async (event, token, content) => {
	editorFrame(event);
	if (editorOperation || picking || editorTransition) throw new Error("Wait for the current file or project change to finish, then try again.");
	const opened = editor;
	if (typeof token !== "string" || !opened || opened.token !== token || !editorOwner(opened.ctx)) throw new Error("This file is no longer open here. Open it again to keep editing.");
	if ([...agents.values()].some((ctx) => ctx.cwd === opened.ctx.cwd && ctx.busy)) throw new Error("Wait for project agents to finish before saving this file.");
	editorOperation = true;
	try {
		let proof;
		try { proof = await saveProjectFile(opened.proof, content); }
		catch (error) { throw editorError(error, "save"); }
		if (!editorOwner(opened.ctx) || editor !== opened) throw new Error("Project changed while saving file.");
		opened.proof = proof;
		opened.token = randomUUID();
		opened.dirty = true;
		return { token: opened.token };
	} finally { editorOperation = false; }
});
ipcMain.on("composer-dirty", (event, dirty, agentId) => {
	event.returnValue = false;
	if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || typeof dirty !== "boolean" || ![...agents.values()].some((ctx) => ctx.id === agentId)) return;
	if (dirty) composerDirty.add(agentId);
	else composerDirty.delete(agentId);
	event.returnValue = true;
});
ipcMain.on("set-editor-dirty", (event, token, dirty) => {
	try {
		editorFrame(event);
		if (picking || editorTransition || editorOperation || typeof dirty !== "boolean" || typeof token !== "string" || editor?.token !== token || !editorOwner(editor.ctx)) throw new Error("Wait for the current file or project change to finish, then try again.");
		editor.dirty = dirty;
		event.returnValue = true;
	} catch { event.returnValue = false; }
});
ipcMain.handle("list-sessions", async () => {
	const ctx = active();
	if (ctx?.modelSwitching) throw new Error("Model switch in progress.");
	if (picking || ctx?.switching || !valid(ctx)) throw new Error("Project selection is in progress.");
	if (!ctx.sessionListCapable) throw new Error("Update installed Me Write Code to browse conversations.");
	const generation = ++ctx.listGeneration;
	const { sessions } = await ctx.rpc.command("list_project_sessions", {}, undefined, SESSION_LIST_TIMEOUT_MS);
	if (generation !== ctx.listGeneration || !valid(ctx) || active() !== ctx || ctx.switching) throw new Error("Newer conversation list opened or project changed.");
	const selections = new Map();
	const visible = sessions.map((session) => {
		const owner = [...agents.values()].find((candidate) => candidate.cwd === ctx.cwd && candidate.sessionFile === session.path && candidate.sessionId === session.id);
		const token = randomUUID();
		selections.set(token, { path: session.path, id: session.id, ownerId: owner?.id });
		return { token, name: session.name, firstMessage: session.firstMessage, created: session.created, modified: session.modified, messageCount: session.messageCount, active: owner?.id === activeAgentId, busy: owner?.busy === true, desktopAgentId: owner?.id };
	});
	for (const owner of agents.values()) {
		if (owner.cwd !== ctx.cwd || !owner.sessionFile || visible.some((entry) => selections.get(entry.token)?.path === owner.sessionFile)) continue;
		const token = randomUUID();
		selections.set(token, { path: owner.sessionFile, id: owner.sessionId, ownerId: owner.id });
		visible.unshift({ token, name: owner.sessionName || "New chat", firstMessage: "", active: owner.id === activeAgentId, busy: owner.busy === true, desktopAgentId: owner.id });
	}
	ctx.sessionSelections = selections;
	return visible;
});
ipcMain.handle("switch-session", async (event, token) => {
	if (!window || window.isDestroyed() || event?.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("Conversation request unavailable.");
	const ctx = active();
	if (picking || chatOpening || ctx?.switching || !valid(ctx)) throw new Error("Chat change already in progress.");
	const selected = typeof token === "string" && ctx.sessionSelections.get(token);
	if (!selected) throw new Error("Unknown conversation. Refresh the list.");
	ctx.switching = true;
	chatOpening = true;
	try {
		const owner = [...agents.values()].find((candidate) => candidate.id === selected.ownerId && candidate.cwd === ctx.cwd && candidate.sessionFile === selected.path && candidate.sessionId === selected.id);
		if (owner?.starting && !owner.exited) throw new Error("Conversation agent is still starting or shutting down.");
		if (owner && valid(owner)) return { ...await activateAgent(owner), cancelled: false };
		if (owner && !owner.exited) throw new Error("Conversation agent is still shutting down.");
		const { sessions } = await ctx.rpc.command("list_project_sessions", {}, undefined, SESSION_LIST_TIMEOUT_MS);
		if (!valid(ctx) || active() !== ctx) throw new Error("Conversation changed; refresh and retry.");
		const saved = sessions.some((item) => item.path === selected.path && item.id === selected.id);
		const fresh = !saved && owner?.exited && !existsSync(selected.path);
		if (!saved && !fresh) throw new Error("Conversation changed; refresh and retry.");
		const result = await startAgent(ctx.cwd, fresh ? undefined : selected, fresh);
		if (owner) {
			if (editor?.ctx === owner) editor.ctx = agents.get(result.desktopAgentId);
			agents.delete(owner.id);
			if (composerDirty.delete(owner.id)) composerDirty.add(result.desktopAgentId);
			sendSummaries();
		}
		return { ...result, ...(owner ? { replacesDesktopAgentId: owner.id } : {}), cancelled: false };
	} finally { ctx.switching = false; chatOpening = false; }
});
ipcMain.handle("new-chat", async (event) => {
	if (!window || window.isDestroyed() || event?.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("Chat request unavailable.");
	const ctx = active();
	if (picking || chatOpening || !valid(ctx) || ctx.switching || editorOperation) throw new Error("Finish the current change before starting a chat.");
	chatOpening = true;
	try { return await startAgent(ctx.cwd, undefined, true); }
	finally { chatOpening = false; }
});
ipcMain.handle("agent-command", async (event, type, data, desktopAgentId) => {
	if (desktopAgentId !== undefined && (!window || window.isDestroyed() || event?.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)) throw new Error("Agent command unavailable");
	const ctx = desktopAgentId === undefined ? active() : [...agents.values()].find((candidate) => candidate.id === desktopAgentId && candidate.cwd === active()?.cwd);
	if (picking || ctx?.switching || !valid(ctx) || !["prompt", "abort", "new_session", "get_state", "get_messages", "set_session_model"].includes(type)) throw new Error("Agent command unavailable");
	if (ctx.modelSwitching && ["prompt", "new_session", "set_session_model"].includes(type)) throw new Error("Model switch in progress.");
	if (type === "set_session_model") {
		if (ctx.busy) throw new Error("Wait for current turn or stop it first.");
		if (!ctx.modelSwitchCapable) throw new Error("Update installed Me Write Code to switch models in desktop.");
		if (typeof data?.provider !== "string" || typeof data?.modelId !== "string" || !ctx.modelList.some((model) => model.provider === data.provider && model.id === data.modelId)) throw new Error("That model isn't available for this chat. Choose another model, or sign in to its provider.");
		ctx.modelSwitching = true;
		try {
			const model = await ctx.rpc.command("set_session_model", { provider: data.provider, modelId: data.modelId });
			if (!valid(ctx) || active() !== ctx) throw new Error("Project changed while model was switching.");
			return modelChoice(model);
		} finally {
			ctx.modelSwitching = false;
		}
	}
	if (type === "prompt" && (typeof data?.message !== "string" || !data.message.trim() || data.message.length > 100000)) throw new Error("Enter a shorter message.");
	if (ctx.busy && (type === "prompt" || type === "new_session")) throw new Error("Wait for current turn or stop it first.");
	if (editorOperation && (type === "prompt" || type === "new_session")) throw new Error("File open or save is in progress.");
	const slash = type === "prompt" && data.message.trim().startsWith("/");
	if (slash) {
		if (!ctx.slashCapable) throw new Error("Update installed Me Write Code to use slash commands in desktop.");
		const name = data.message.trim().slice(1).split(" ", 1)[0];
		if (/\s/.test(name)) throw new Error("Use a space after the slash command name.");
		if (!ctx.commandNames.has(name)) throw new Error(`/${name} isn't available in the desktop app. Type / to see available commands.`);
	}
	if (type === "prompt" || type === "new_session") {
		ctx.busy = true;
		if (type === "new_session") {
			ctx.switching = true;
			ctx.skillsInventory = undefined;
			ctx.skillsGeneration++;
		}
		ctx.failed = false;
		sendSummaries();
	}
	try {
		const result = await ctx.rpc.command(type, type === "prompt" ? { message: data.message } : {}, slash ? (id) => { ctx.activeSlash = { id, completed: false, started: false }; } : undefined, type === "abort" ? 3000 : undefined);
		if (!valid(ctx)) throw new Error("This chat's agent stopped. Choose the project again to reconnect.");
		if (type === "new_session") {
			if (!result.cancelled) {
				const hydrated = await hydrate(ctx);
				if (active() !== ctx) throw new Error("Project changed while new conversation loaded.");
				ctx.listGeneration++;
				ctx.sessionSelections.clear();
				send(ctx, { type: "desktop_commands", commands: hydrated.commands });
				send(ctx, { type: "desktop_models", models: hydrated.models, defaultModels: hydrated.defaultModels, model: hydrated.state.model && modelChoice(hydrated.state.model), defaultModel: hydrated.state.defaultModel, defaultModelScope: hydrated.state.defaultModelScope });
				send(ctx, { type: "desktop_approval_mode", capable: ctx.approvalModeControlCapable, enabled: hydrated.state.approvalMode === true });
				if (ctx.mcpSettingsControlCapable) send(ctx, { type: "desktop_mcp_servers", inventory: hydrated.mcp });
			}
			ctx.busy = false;
			sendSummaries();
		}
		return type === "get_state" ? visibleState(ctx, result) : result;
	} catch (error) {
		if (type === "prompt" || type === "new_session") {
			ctx.busy = false;
			ctx.activeSlash = undefined;
			sendSummaries();
		}
		throw error;
	} finally {
		if (type === "new_session") ctx.switching = false;
	}
});
ipcMain.handle("get-skills", async (event) => {
	if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("Skills settings request unavailable.");
	const ctx = active();
	if (!valid(ctx) || !ctx.skillsSettingsControlCapable) throw new Error("Update installed Me Write Code to manage skills here.");
	if (picking || ctx.switching || ctx.modelSwitching || editorTransition) throw new Error("Finish the current change before refreshing skills.");
	const generation = ++ctx.skillsGeneration;
	const inventory = await ctx.rpc.command("get_skills");
	if (!valid(ctx) || active() !== ctx || ctx.switching || generation !== ctx.skillsGeneration) throw new Error("Project or conversation changed while skills loaded. Reopen Settings to retry.");
	ctx.skillsInventory = inventory;
	return inventory;
});
ipcMain.handle("set-skill-enabled", async (event, input) => {
	if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("Skills settings request unavailable.");
	const ctx = active();
	if (!valid(ctx) || !ctx.skillsSettingsControlCapable) throw new Error("Update installed Me Write Code to manage skills here.");
	if (picking || editorTransition || ctx.switching || ctx.modelSwitching || ctx.busy || ctx.approvalBroker.pending.size || ctx.dialogs.size) throw new Error("Wait for current work to finish before changing skills.");
	const inventory = ctx.skillsInventory;
	const entry = typeof input?.skillId === "string" && inventory?.skills.find((skill) => skill.id === input.skillId);
	if (typeof input?.revision !== "string" || input.revision !== inventory?.revision || !entry?.editable || !["project", "user"].includes(input.scope) || entry.scope !== input.scope || typeof input.enabled !== "boolean" || input.enabled === entry.enabled) throw new Error("Skill inventory changed. Reopen Settings to refresh and retry.");
	ctx.switching = true;
	const renderer = rendererGeneration;
	try {
		const replacement = entry.replacement;
		const displaced = entry.displaces;
		const detail = `${entry.name} · ${entry.scope}${input.enabled && displaced ? `\nCurrent: ${displaced.name} · ${displaced.source} · ${displaced.scope}` : !input.enabled && replacement ? `\nNext if unchanged: ${replacement.name} · ${replacement.source} · ${replacement.scope}` : ""}`;
		const { response } = await dialog.showMessageBox(window, { type: "warning", buttons: ["Cancel", input.enabled ? "Enable skill" : "Disable skill"], defaultId: 0, cancelId: 0, message: input.enabled ? "Enable this skill for new chats? Skill instructions can influence agent actions and may replace another skill; inspect SKILL.md before enabling." : "Disable this skill for new chats? Another same-named skill may become active.", detail });
		if (response !== 1) return { cancelled: true };
		if (!valid(ctx) || active() !== ctx || renderer !== rendererGeneration) throw new Error("Project changed while skills were updating.");
		ctx.skillsGeneration++;
		ctx.skillsInventory = undefined;
		await ctx.rpc.command("set_skill_enabled", { skillId: entry.id, revision: inventory.revision, scope: entry.scope, enabled: input.enabled });
		if (!valid(ctx) || active() !== ctx) throw new Error("Project changed while skills were updating.");
		let fresh;
		try { fresh = await ctx.rpc.command("get_skills", {}, undefined, 5000); }
		catch { return { saved: true, warning: "Skill setting saved. Reopen Settings to refresh the list." }; }
		if (!valid(ctx) || active() !== ctx) throw new Error("Project changed while skills were updating.");
		ctx.skillsInventory = fresh;
		return { inventory: fresh };
	} finally { ctx.switching = false; }
});
ipcMain.handle("get-mcp-servers", async (event) => {
	if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("MCP settings request unavailable.");
	const ctx = active();
	if (!valid(ctx) || !ctx.mcpSettingsControlCapable) throw new Error("Update installed Me Write Code to manage MCP servers here.");
	if (picking || ctx.switching) throw new Error("Project or conversation change in progress.");
	const inventory = await ctx.rpc.command("get_mcp_servers");
	if (!valid(ctx) || active() !== ctx || ctx.switching) throw new Error("Project changed while MCP settings loaded.");
	return inventory;
});
ipcMain.handle("mcp-settings", async (event, type, data) => {
	if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("MCP settings request unavailable.");
	const ctx = active();
	if (!valid(ctx) || !ctx.mcpSettingsControlCapable || !["save_mcp_server", "remove_mcp_server"].includes(type)) throw new Error("Update installed Me Write Code to manage MCP servers here.");
	if (picking || ctx.switching || ctx.modelSwitching || ctx.busy) throw new Error("Wait for current work to finish before changing MCP settings.");
	const validName = typeof data?.name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(data.name);
	const validPreviousName = data?.previousName === undefined || (typeof data.previousName === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(data.previousName));
	if (!validName || !validPreviousName || !["project", "user"].includes(data.scope) || typeof data.revision !== "string") throw new Error("Server names start with a letter or number and use only letters, numbers, dots, dashes and underscores. Rename it, then save again.");
	if (type === "save_mcp_server" && (data.transport !== "stdio" || typeof data.command !== "string" || !data.command || data.command.length > 4096 || /[\u0000-\u001f\u007f]/.test(data.command) || !Array.isArray(data.args) || data.args.length > 100 || data.args.some((arg) => typeof arg !== "string" || arg.length > 4096 || /[\u0000-\u001f\u007f]/.test(arg)) || data.command.length + data.args.reduce((length, arg) => length + arg.length, 0) > 16384)) throw new Error("Enter a command and up to 100 arguments, one per line, under 16,384 characters in total and without tabs or control characters. Then save again.");
	ctx.switching = true;
	try {
		const identity = data.previousName && data.previousName !== data.name ? `${data.scope}: ${data.previousName} → ${data.name}` : `${data.scope}: ${data.name}`;
		const detail = type === "save_mcp_server" ? [identity, data.command, ...data.args].join("\n") : identity;
		const { response } = await dialog.showMessageBox(window, { type: "warning", buttons: ["Cancel", type === "save_mcp_server" ? "Save server" : "Remove server"], defaultId: 0, cancelId: 0, message: type === "save_mcp_server" ? "Allow this MCP command to run in new sessions?" : "Remove this MCP server?", detail });
		if (response !== 1) return { cancelled: true };
		if (!valid(ctx) || active() !== ctx) throw new Error("Project changed while MCP settings were updating.");
		await ctx.rpc.command(type, data);
		const inventory = await ctx.rpc.command("get_mcp_servers");
		if (!valid(ctx) || active() !== ctx) throw new Error("Project changed while MCP settings were updating.");
		return { cancelled: false, inventory };
	} finally {
		ctx.switching = false;
	}
});
ipcMain.handle("set-default-model", async (event, provider, modelId) => {
	if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("Default model request unavailable.");
	const ctx = active();
	if (picking || ctx?.switching || ctx?.modelSwitching || ctx?.busy || !valid(ctx)) throw new Error("Wait for current project work to finish before changing the default model.");
	if (!ctx.defaultModelControlCapable) throw new Error("Update installed Me Write Code to change the default model here.");
	if (typeof provider !== "string" || typeof modelId !== "string" || !ctx.defaultModelList.some((model) => model.provider === provider && model.id === modelId)) throw new Error("That model isn't available. Choose another default model, or sign in to its provider.");
	ctx.switching = true;
	try {
		const model = await ctx.rpc.command("set_default_model", { provider, modelId });
		if (!valid(ctx) || active() !== ctx) throw new Error("Project changed while the default model was updating.");
		return modelChoice(model);
	} finally {
		ctx.switching = false;
	}
});
ipcMain.handle("set-approval-mode", async (event, enabled) => {
	if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("Approval mode request unavailable.");
	if (typeof enabled !== "boolean") throw new Error("Approval mode value is invalid.");
	const ctx = active();
	if (picking || ctx?.switching || ctx?.modelSwitching || ctx?.busy || !valid(ctx)) throw new Error("Wait for current work to finish before changing approval mode.");
	if (!ctx.approvalModeControlCapable) throw new Error("Update installed Me Write Code to change approval mode in desktop.");
	ctx.switching = true;
	try {
		const result = await ctx.rpc.command("set_approval_mode", { enabled });
		if (!valid(ctx) || active() !== ctx) throw new Error("Project changed while approval mode was updating.");
		return result;
	} finally {
		ctx.switching = false;
	}
});
ipcMain.handle("approval-reply", (event, id, token, decision) => {
	if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
	const ctx = [...agents.values()].find((candidate) => candidate.id === id);
	if (!valid(ctx)) return false;
	const replied = ctx.approvalBroker.respond(token, decision, ctx.rpc, rendererGeneration);
	sendSummaries();
	return replied;
});
ipcMain.handle("extension-reply", (event, response) => {
	if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
	const ctx = [...agents.values()].find((candidate) => candidate.id === response?.desktopAgentId);
	if (!valid(ctx) || !ctx.dialogs.has(response.id)) return false;
	const method = ctx.dialogs.get(response.id);
	ctx.dialogs.delete(response.id);
	sendSummaries();
	if (response.cancelled) return ctx.rpc.reply({ id: response.id, cancelled: true });
	if (method === "confirm") return ctx.rpc.reply({ id: response.id, confirmed: response.confirmed === true });
	if (typeof response.value === "string") return ctx.rpc.reply({ id: response.id, value: response.value });
	return false;
});
app.on("before-quit", (event) => {
	if (quitting || agents.size === 0) return;
	event.preventDefault();
	if (shutdownPromise || editorOperation || picking || editorTransition || !confirmQuitDrafts() || ([...agents.values()].some((ctx) => ctx.busy) && !confirmStop())) return;
	shutdownAgents();
});
app.on("will-quit", () => {
	for (const ctx of agents.values()) {
		ctx.approvalBroker.denyAll();
		cancelDialogs(ctx);
		ctx.rpc.child.stdin.end();
	}
});
app.on("window-all-closed", () => app.quit());
