// WS3: tests for the local CONNECT proxy.
import { connect } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { isHostAllowed, parseConnectRequest, startConnectProxy } from "../sandbox/proxy.js";

describe("isHostAllowed", () => {
	it("matches bare hosts case-insensitively", () => {
		expect(isHostAllowed("github.com", ["github.com"])).toBe(true);
		expect(isHostAllowed("GitHub.com", ["github.com"])).toBe(true);
	});
	it("supports *.suffix wildcards", () => {
		expect(isHostAllowed("api.github.com", ["*.github.com"])).toBe(true);
		expect(isHostAllowed("github.com", ["*.github.com"])).toBe(true);
		expect(isHostAllowed("evilgithub.com", ["*.github.com"])).toBe(false);
	});
	it("denies unknown hosts", () => {
		expect(isHostAllowed("evil.com", ["github.com", "*.github.com"])).toBe(false);
	});
});

describe("parseConnectRequest", () => {
	it("parses standard CONNECT line", () => {
		const buf = Buffer.from("CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\n");
		expect(parseConnectRequest(buf)).toEqual({ host: "github.com", port: 443 });
	});
	it("returns undefined for non-CONNECT", () => {
		expect(parseConnectRequest(Buffer.from("GET / HTTP/1.1\r\n\r\n"))).toBeUndefined();
	});
	it("returns undefined for malformed lines", () => {
		expect(parseConnectRequest(Buffer.from("CONNECT garbage\r\n\r\n"))).toBeUndefined();
	});
});

describe("startConnectProxy", () => {
	const handles: { stop(): Promise<void> }[] = [];
	afterAll(async () => {
		for (const h of handles) await h.stop();
	});

	it("403s a CONNECT to a non-allowlisted host and reports it via onAttempt", async () => {
		const attempts: Array<{ host: string; allowed: boolean }> = [];
		const proxy = await startConnectProxy({
			allowedHosts: ["github.com"],
			onAttempt: (host, _port, allowed) => attempts.push({ host, allowed }),
		});
		handles.push(proxy);

		const text = await openAndExpectClose(proxy.port, "CONNECT evil.com:443 HTTP/1.1\r\n\r\n");
		expect(text).toMatch(/^HTTP\/1\.1 403/);
		expect(attempts).toEqual([{ host: "evil.com", allowed: false }]);
	});

	it("accepts allowlisted hosts (501 stub for now)", async () => {
		const attempts: Array<{ host: string; allowed: boolean }> = [];
		const proxy = await startConnectProxy({
			allowedHosts: ["github.com"],
			onAttempt: (host, _port, allowed) => attempts.push({ host, allowed }),
		});
		handles.push(proxy);

		const text = await openAndExpectClose(proxy.port, "CONNECT github.com:443 HTTP/1.1\r\n\r\n");
		// We're a scaffold today; allowed → 501. The contract under test is
		// that allowlisting is honoured (no 403 for this host).
		expect(text).not.toMatch(/^HTTP\/1\.1 403/);
		expect(attempts).toEqual([{ host: "github.com", allowed: true }]);
	});
});

function openAndExpectClose(port: number, body: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const sock = connect(port, "127.0.0.1");
		const chunks: Buffer[] = [];
		sock.on("connect", () => sock.write(body));
		sock.on("data", (c) => chunks.push(c));
		sock.on("end", () => resolve(Buffer.concat(chunks).toString()));
		sock.on("close", () => resolve(Buffer.concat(chunks).toString()));
		sock.on("error", reject);
	});
}
