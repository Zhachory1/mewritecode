const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
	APPROVAL_CAPABILITY,
	ApprovalBroker,
	matchesApprovalCapability,
} = require("../approval.cjs");

function rpc() {
	return { responses: [], approvalResponse(id, decision) { this.responses.push({ id, decision }); return true; } };
}

function request(id, argumentsJson = '{"path":"file.txt"}') {
	return {
		type: "approval_request",
		id,
		version: 1,
		dangerPolicyVersion: "danger-policy-v1",
		toolName: "write",
		tier: "write",
		argumentsJson,
		decisions: ["once", "deny"],
		timeoutMs: 120000,
	};
}

test("matches only the exact approval capability", () => {
	assert.equal(matchesApprovalCapability(APPROVAL_CAPABILITY), true);
	for (const capability of [
		undefined,
		{ ...APPROVAL_CAPABILITY, version: 2 },
		{ ...APPROVAL_CAPABILITY, dangerPolicyVersion: "other" },
		{ ...APPROVAL_CAPABILITY, maxPayloadBytes: 8193 },
		{ ...APPROVAL_CAPABILITY, decisions: ["deny", "once"] },
		{ ...APPROVAL_CAPABILITY, decisions: ["once", "deny", "session"] },
	]) assert.equal(matchesApprovalCapability(capability), false);
});

test("broker hides runtime ids and consumes decisions once", () => {
	const events = [];
	const child = rpc();
	const broker = new ApprovalBroker((event) => events.push(event));
	broker.bind(child, 3, true);
	broker.setRendererGeneration(3, true);
	assert.equal(broker.request(child, request("runtime-secret")), true);
	const shown = events.pop();
	assert.equal(shown.type, "desktop_approval_request");
	assert.notEqual(shown.token, "runtime-secret");
	assert.equal("id" in shown, false);
	assert.equal(shown.argumentsJson, '{"path":"file.txt"}');
	assert.equal(broker.respond(shown.token, "once", child, 3), true);
	assert.deepEqual(child.responses, [{ id: "runtime-secret", decision: "once" }]);
	assert.equal(broker.respond(shown.token, "once", child, 3), false);
});

test("broker correlates concurrent requests and denies stale generations", () => {
	const events = [];
	const first = rpc();
	const second = rpc();
	const broker = new ApprovalBroker((event) => events.push(event));
	broker.bind(first, 1, true);
	broker.setRendererGeneration(1, true);
	broker.request(first, request("left"));
	broker.request(first, request("right"));
	const [left, right] = events.splice(0);
	broker.respond(right.token, "once", first, 1);
	broker.respond(left.token, "deny", first, 1);
	assert.deepEqual(first.responses, [{ id: "right", decision: "once" }, { id: "left", decision: "deny" }]);
	broker.request(first, request("stale"));
	const stale = events.shift();
	broker.bind(second, 2, true);
	broker.setRendererGeneration(2, true);
	assert.deepEqual(first.responses.at(-1), { id: "stale", decision: "deny" });
	assert.ok(events.some((event) => event.type === "desktop_approval_closed" && event.token === stale.token));
	assert.equal(broker.respond(stale.token, "once", second, 2), false);
});

test("broker expires renderer authority at the runtime deadline", () => {
	const events = [];
	const child = rpc();
	let expire;
	const broker = new ApprovalBroker((event) => events.push(event), {
		setTimeout: (callback) => { expire = callback; return { unref() {} }; },
		clearTimeout: () => {},
	});
	broker.bind(child, 1, true);
	broker.setRendererGeneration(1, true);
	broker.request(child, request("expires"));
	const shown = events.shift();
	expire();
	assert.deepEqual(child.responses, [{ id: "expires", decision: "deny" }]);
	assert.deepEqual(events, [{ type: "desktop_approval_closed", token: shown.token }]);
	assert.equal(broker.respond(shown.token, "once", child, 1), false);
});

test("broker rejects malformed, oversized, closed, and unnegotiated requests", () => {
	const events = [];
	const child = rpc();
	const broker = new ApprovalBroker((event) => events.push(event));
	broker.bind(child, 1, false);
	broker.setRendererGeneration(1, true);
	assert.equal(broker.request(child, request("off")), false);
	broker.bind(child, 1, true);
	assert.equal(broker.request(child, { ...request("bad"), decisions: ["session"] }), false);
	assert.equal(broker.request(child, request("large", `{"value":"${"x".repeat(8192)}"}`)), false);
	assert.deepEqual(child.responses.map((entry) => entry.decision), ["deny", "deny", "deny"]);
	assert.equal(events.length, 0);
	broker.request(child, request("closed"));
	const shown = events.pop();
	assert.equal(broker.closed(child, "closed"), true);
	assert.equal(child.responses.some((entry) => entry.id === "closed"), false);
	assert.equal(events.pop().token, shown.token);
});
