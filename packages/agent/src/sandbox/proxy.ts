// WS3: per-host network gating via a local CONNECT proxy.
//
// When `SandboxPolicy.kind === "workspace_write"` the workspace can only reach
// hosts in `allowedHosts`. The Seatbelt/Landlock profiles deny direct network*
// syscalls — instead the bash subprocess inherits HTTPS_PROXY pointing at the
// proxy below. The proxy implements RFC 7231 CONNECT: every tunnel-establishment
// request is allowlisted by host, otherwise it returns 403.
//
// Usage:
//   const handle = await startConnectProxy({ allowedHosts: ["github.com"] });
//   process.env.HTTPS_PROXY = `http://127.0.0.1:${handle.port}`;
//   ...child process inherits env...
//   await handle.stop();
//
// Status: scaffold only — TODO(ws3-proxy-network): wire into seatbeltSandbox()
// so it sets HTTP(S)_PROXY in the child env and reroutes inherited fetches.

import { createServer, type Server } from "node:net";

export interface ConnectProxyOptions {
	/** Bare hosts ("github.com") or wildcards ("*.github.com"). */
	allowedHosts: string[];
	/** Bind port. 0 = random. */
	port?: number;
	/** Audit hook fired for every CONNECT — useful for tests. */
	onAttempt?: (host: string, port: number, allowed: boolean) => void;
}

export interface ConnectProxyHandle {
	port: number;
	stop(): Promise<void>;
}

export function isHostAllowed(host: string, allowed: string[]): boolean {
	const h = host.toLowerCase();
	return allowed.some((p) => {
		const pat = p.toLowerCase();
		if (pat.startsWith("*.")) {
			const base = pat.slice(2);
			return h === base || h.endsWith("." + base);
		}
		return h === pat;
	});
}

/** Parse `CONNECT host:port HTTP/1.1\r\n...\r\n\r\n` from the first chunk. */
export function parseConnectRequest(buf: Buffer): { host: string; port: number } | undefined {
	const text = buf.toString("ascii");
	const firstLine = text.split("\r\n", 1)[0];
	if (!firstLine?.startsWith("CONNECT ")) return undefined;
	const target = firstLine.split(" ")[1];
	if (!target) return undefined;
	const colon = target.lastIndexOf(":");
	if (colon === -1) return undefined;
	const host = target.slice(0, colon);
	const port = Number.parseInt(target.slice(colon + 1), 10);
	if (!host || !Number.isFinite(port)) return undefined;
	return { host, port };
}

export async function startConnectProxy(opts: ConnectProxyOptions): Promise<ConnectProxyHandle> {
	const server: Server = createServer((socket) => {
		socket.once("data", (chunk) => {
			const req = parseConnectRequest(chunk);
			if (!req) {
				socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
				return;
			}
			const allowed = isHostAllowed(req.host, opts.allowedHosts);
			opts.onAttempt?.(req.host, req.port, allowed);
			if (!allowed) {
				socket.end(`HTTP/1.1 403 Forbidden\r\nX-Cave-Sandbox: deny ${req.host}\r\n\r\n`);
				return;
			}
			// Allowed — TODO(ws3-proxy-network): open upstream tunnel and pipe.
			// For now we 501 so callers know the proxy is wired but tunneling
			// isn't implemented. Tests assert allow vs deny via onAttempt.
			socket.end("HTTP/1.1 501 Not Implemented\r\n\r\n");
		});
		socket.on("error", () => {
			/* swallow — proxy errors should not crash the process */
		});
	});

	await new Promise<void>((res, rej) => {
		server.once("error", rej);
		server.listen(opts.port ?? 0, "127.0.0.1", () => res());
	});

	const addr = server.address();
	const port = typeof addr === "object" && addr ? addr.port : 0;

	return {
		port,
		async stop() {
			await new Promise<void>((res) => server.close(() => res()));
		},
	};
}
