const { randomUUID } = require("node:crypto");

const APPROVAL_CAPABILITY = Object.freeze({
	version: 1,
	dangerPolicyVersion: "danger-policy-v1",
	maxPayloadBytes: 8192,
	decisions: Object.freeze(["once", "deny"]),
});
const TIERS = new Set(["read", "sensitive-read", "write", "exec", "destructive"]);

function matchesApprovalCapability(value) {
	return value?.version === APPROVAL_CAPABILITY.version
		&& value?.dangerPolicyVersion === APPROVAL_CAPABILITY.dangerPolicyVersion
		&& value?.maxPayloadBytes === APPROVAL_CAPABILITY.maxPayloadBytes
		&& Array.isArray(value?.decisions)
		&& value.decisions.length === 2
		&& value.decisions[0] === "once"
		&& value.decisions[1] === "deny";
}

function validRequest(value) {
	return value?.type === "approval_request"
		&& typeof value.id === "string" && value.id.length > 0
		&& value.version === APPROVAL_CAPABILITY.version
		&& value.dangerPolicyVersion === APPROVAL_CAPABILITY.dangerPolicyVersion
		&& typeof value.toolName === "string"
		&& TIERS.has(value.tier)
		&& typeof value.argumentsJson === "string"
		&& Buffer.byteLength(value.argumentsJson, "utf8") <= APPROVAL_CAPABILITY.maxPayloadBytes
		&& Array.isArray(value.decisions)
		&& value.decisions.length === 2
		&& value.decisions[0] === "once"
		&& value.decisions[1] === "deny"
		&& value.timeoutMs === 120000;
}

class ApprovalBroker {
	constructor(sendRenderer, timers = {}) {
		this.sendRenderer = sendRenderer;
		this.setTimer = timers.setTimeout ?? setTimeout;
		this.clearTimer = timers.clearTimeout ?? clearTimeout;
		this.pending = new Map();
		this.rpc = undefined;
		this.rendererGeneration = 0;
		this.rendererReady = false;
		this.negotiated = false;
	}

	bind(rpc, rendererGeneration, negotiated) {
		this.denyAll();
		this.rpc = rpc;
		this.rendererGeneration = rendererGeneration;
		this.negotiated = negotiated === true;
	}

	setRendererGeneration(rendererGeneration, ready = false) {
		this.denyAll();
		this.rendererGeneration = rendererGeneration;
		this.rendererReady = ready;
	}

	request(rpc, request) {
		if (rpc !== this.rpc || !this.negotiated || !this.rendererReady || !validRequest(request)) {
			if (typeof request?.id === "string") rpc.approvalResponse(request.id, "deny");
			return false;
		}
		const token = randomUUID();
		const entry = {
			token,
			runtimeId: request.id,
			rpc,
			rendererGeneration: this.rendererGeneration,
			timeout: this.setTimer(() => this.#deny(token), request.timeoutMs),
		};
		entry.timeout.unref?.();
		this.pending.set(token, entry);
		try {
			this.sendRenderer({
				type: "desktop_approval_request",
				token,
				toolName: request.toolName,
				tier: request.tier,
				argumentsJson: request.argumentsJson,
			});
			return true;
		} catch {
			this.pending.delete(token);
			this.clearTimer(entry.timeout);
			rpc.approvalResponse(request.id, "deny");
			return false;
		}
	}

	respond(token, decision, rpc, rendererGeneration) {
		const entry = this.pending.get(token);
		if (!entry) return false;
		this.pending.delete(token);
		this.clearTimer(entry.timeout);
		const current = this.rendererReady && rpc === this.rpc && entry.rpc === rpc && rendererGeneration === this.rendererGeneration && entry.rendererGeneration === rendererGeneration;
		entry.rpc.approvalResponse(entry.runtimeId, current && decision === "once" ? "once" : "deny");
		return true;
	}

	closed(rpc, runtimeId) {
		const entry = [...this.pending.values()].find((candidate) => candidate.rpc === rpc && candidate.runtimeId === runtimeId);
		if (!entry) return false;
		this.pending.delete(entry.token);
		this.clearTimer(entry.timeout);
		this.#notifyClosed(entry.token);
		return true;
	}

	denyAll() {
		for (const entry of [...this.pending.values()]) {
			this.pending.delete(entry.token);
			this.clearTimer(entry.timeout);
			entry.rpc.approvalResponse(entry.runtimeId, "deny");
			this.#notifyClosed(entry.token);
		}
	}

	#deny(token) {
		const entry = this.pending.get(token);
		if (!entry) return;
		this.pending.delete(token);
		this.clearTimer(entry.timeout);
		entry.rpc.approvalResponse(entry.runtimeId, "deny");
		this.#notifyClosed(token);
	}

	#notifyClosed(token) {
		try { this.sendRenderer({ type: "desktop_approval_closed", token }); }
		catch { /* Renderer loss is already a denial path. */ }
	}
}

module.exports = { APPROVAL_CAPABILITY, ApprovalBroker, matchesApprovalCapability };
