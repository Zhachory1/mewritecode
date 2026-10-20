const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Rpc } = require("../rpc.cjs");

function child() {
	const process = new EventEmitter();
	process.stdin = new PassThrough();
	process.stdout = new PassThrough();
	return process;
}

test("correlates responses and preserves Unicode separators across chunks", async () => {
	const process = child();
	const events = [];
	const rpc = new Rpc(process, (event) => events.push(event));
	const sent = [];
	process.stdin.on("data", (data) => sent.push(data.toString()));
	const pending = rpc.command("get_state");
	const { id } = JSON.parse(sent.join(""));
	const record = Buffer.from(`${JSON.stringify({ type: "message_update", text: "a\u2028b" })}\n`);
	process.stdout.write(record.subarray(0, 24));
	process.stdout.write(record.subarray(24));
	process.stdout.write(`${JSON.stringify({ id, type: "response", success: true, data: { sessionId: "one" } })}\n`);
	assert.deepEqual(await pending, { sessionId: "one" });
	assert.deepEqual(events, [{ type: "message_update", text: "a\u2028b" }]);
});

test("exposes the request id before a prompt can complete", async () => {
	const process = child();
	let requestId;
	const events = [];
	const rpc = new Rpc(process, (event) => events.push(event));
	process.stdin.on("data", (chunk) => {
		const { id } = JSON.parse(chunk.toString());
		assert.equal(requestId, id);
		process.stdout.write(`${JSON.stringify({ id, type: "response", command: "prompt", success: true })}\n`);
		process.stdout.write(`${JSON.stringify({ id, type: "prompt_complete" })}\n`);
	});
	await rpc.command("prompt", { message: "/tips" }, (id) => { requestId = id; });
	assert.deepEqual(events, [{ id: requestId, type: "prompt_complete" }]);
});

test("forwards delayed prompt failures after the acknowledgement", async () => {
	const process = child();
	const events = [];
	const rpc = new Rpc(process, (event) => events.push(event));
	const sent = [];
	process.stdin.on("data", (data) => sent.push(data.toString()));
	const pending = rpc.command("prompt", { message: "hello" });
	const { id } = JSON.parse(sent.join(""));
	process.stdout.write(`${JSON.stringify({ id, type: "response", command: "prompt", success: true })}\n`);
	await pending;
	process.stdout.write(`${JSON.stringify({ id, type: "response", command: "prompt", success: false, error: "No model" })}\n`);
	assert.equal(events[0].error, "No model");
});

test("bounds commands with an explicit deadline", async () => {
	const process = child();
	const rpc = new Rpc(process, () => {});
	await assert.rejects(rpc.command("get_state", {}, undefined, 10), /timed out: get_state/);
	assert.equal(rpc.pending.size, 0);
});

test("writes exact approval responses and refuses invalid or closed replies", () => {
	const process = child();
	const rpc = new Rpc(process, () => {});
	const sent = [];
	process.stdin.on("data", (data) => sent.push(JSON.parse(data.toString())));
	assert.equal(rpc.approvalResponse("runtime-id", "once"), true);
	assert.deepEqual(sent, [{ type: "approval_response", id: "runtime-id", version: 1, dangerPolicyVersion: "danger-policy-v1", decision: "once" }]);
	assert.equal(rpc.approvalResponse("runtime-id", "session"), false);
	rpc.end("closed");
	assert.equal(rpc.approvalResponse("runtime-id", "deny"), false);
	assert.equal(sent.length, 1);
});

test("invalidates commands when agent output disconnects", async () => {
	const process = child();
	const events = [];
	const rpc = new Rpc(process, (event) => events.push(event));
	const pending = rpc.command("get_state");
	process.stdout.end();
	await assert.rejects(pending, /output closed/);
	assert.equal(events.at(-1).type, "rpc_error");
});

test("invalidates commands on agent output errors", async () => {
	const process = child();
	const rpc = new Rpc(process, () => {});
	const pending = rpc.command("get_state");
	process.stdout.emit("error", new Error("broken pipe"));
	await assert.rejects(pending, /broken pipe/);
});

test("rejects outstanding commands if agent exits", async () => {
	const process = child();
	const rpc = new Rpc(process, () => {});
	const pending = rpc.command("get_state");
	process.emit("exit", 1);
	await assert.rejects(pending, /exited/);
});
