const { StringDecoder } = require("node:string_decoder");
const { APPROVAL_CAPABILITY } = require("./approval.cjs");

class Rpc {
	constructor(child, onEvent) {
		this.child = child;
		this.onEvent = onEvent;
		this.pending = new Map();
		this.nextId = 0;
		this.decoder = new StringDecoder("utf8");
		this.buffer = "";
		this.closed = false;
		child.stdout.on("data", (chunk) => this.read(chunk));
		child.stdout.on("end", () => this.end("Agent output closed"));
		child.stdout.on("close", () => this.end("Agent output closed"));
		child.stdout.on("error", (error) => this.end(error.message));
		child.stdin.on("error", (error) => this.end(error.message));
		child.on("error", (error) => this.end(error.message));
		child.on("exit", (code) => this.end(`Agent exited (${code ?? "signal"})`));
	}

	read(chunk) {
		this.buffer += this.decoder.write(chunk);
		let newline;
		while ((newline = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, newline).replace(/\r$/, "");
			this.buffer = this.buffer.slice(newline + 1);
			if (!line) continue;
			let message;
			try {
				message = JSON.parse(line);
			} catch (error) {
				this.onEvent({ type: "rpc_error", error: error.message });
				continue;
			}
			if (message.type === "response" && this.pending.has(message.id)) {
				const { resolve, reject, timeout } = this.pending.get(message.id);
				this.pending.delete(message.id);
				clearTimeout(timeout);
				if (message.success) resolve(message.data);
				else reject(new Error(message.error ?? "Agent command failed"));
			} else {
				this.onEvent(message);
			}
		}
	}

	command(type, data = {}, onId, timeoutMs) {
		if (this.closed) return Promise.reject(new Error("Agent is not running"));
		const id = String(++this.nextId);
		onId?.(id);
		return new Promise((resolve, reject) => {
			const timeout = timeoutMs ? setTimeout(() => {
				if (!this.pending.delete(id)) return;
				reject(new Error(`Agent command timed out: ${type}`));
			}, timeoutMs) : undefined;
			timeout?.unref?.();
			this.pending.set(id, { resolve, reject, timeout });
			try {
				this.child.stdin.write(`${JSON.stringify({ id, type, ...data })}\n`);
			} catch (error) {
				this.pending.delete(id);
				clearTimeout(timeout);
				reject(error);
			}
		});
	}

	reply(data) {
		return this.write({ type: "extension_ui_response", ...data });
	}

	approvalResponse(id, decision) {
		if (typeof id !== "string" || (decision !== "once" && decision !== "deny")) return false;
		return this.write({
			type: "approval_response",
			id,
			version: APPROVAL_CAPABILITY.version,
			dangerPolicyVersion: APPROVAL_CAPABILITY.dangerPolicyVersion,
			decision,
		});
	}

	write(data) {
		if (this.closed) return false;
		try {
			this.child.stdin.write(`${JSON.stringify(data)}\n`, (error) => {
				if (error) this.end(error.message);
			});
			return true;
		} catch {
			return false;
		}
	}

	end(reason) {
		if (this.closed) return;
		this.closed = true;
		try { this.child.stdin.end(); } catch { /* Transport is already closed. */ }
		for (const { reject, timeout } of this.pending.values()) { clearTimeout(timeout); reject(new Error(reason)); }
		this.pending.clear();
		this.onEvent({ type: "rpc_error", error: reason });
	}
}

module.exports = { Rpc };
