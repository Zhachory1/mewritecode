import { spawn } from "node:child_process";
import type { ContextCompressionInput, ContextCompressionOutput, ContextCompressor } from "./context-compression.js";

export interface HeadroomCompressorOptions {
	python: string;
	timeoutMs: number;
	maxInputBytes: number;
	maxOutputBytes: number;
}

export class HeadroomCompressor implements ContextCompressor {
	readonly name = "headroom-local";
	private unavailableUntil = 0;

	constructor(private readonly options: HeadroomCompressorOptions) {}

	async compress(input: ContextCompressionInput, signal?: AbortSignal): Promise<ContextCompressionOutput> {
		if (Date.now() < this.unavailableUntil) {
			throw new Error("headroom temporarily unavailable");
		}
		if (Buffer.byteLength(input.content, "utf8") > this.options.maxInputBytes) {
			throw new Error("headroom input exceeded cap");
		}
		try {
			return await runHeadroomPython(this.options, input, signal);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/ENOENT|timed out|import headroom failed|temporarily unavailable/i.test(message)) {
				this.unavailableUntil = Date.now() + 30_000;
			}
			throw error;
		}
	}
}

export function createHeadroomCompressor(options: {
	enabled: boolean;
	python?: string;
	timeoutMs?: number;
	maxInputBytes?: number;
	maxOutputBytes?: number;
}): ContextCompressor | undefined {
	if (!options.enabled) return undefined;
	return new HeadroomCompressor({
		python: resolveHeadroomPython(options.python),
		timeoutMs: options.timeoutMs ?? 500,
		maxInputBytes: options.maxInputBytes ?? 64 * 1024,
		maxOutputBytes: options.maxOutputBytes ?? 128 * 1024,
	});
}

export function resolveHeadroomPython(configuredPython: string | undefined): string {
	return (
		configuredPython?.trim() ||
		process.env.MEWRITE_HEADROOM_PYTHON?.trim() ||
		process.env.HEADROOM_PYTHON?.trim() ||
		"python3"
	);
}

const HELPER = `
import json, sys
payload = json.load(sys.stdin)
try:
    import headroom
except Exception as exc:
    print(json.dumps({"error":"import headroom failed","detail":str(exc)[:200]}))
    sys.exit(2)
message = {"role":"tool", "content": payload["content"]}
result = headroom.compress([message], model=payload.get("model", "gpt-5.5"), model_limit=payload.get("modelLimit", 200000))
messages = getattr(result, "messages", None)
if messages is None and hasattr(result, "compressed_messages"):
    messages = result.compressed_messages
if messages is None:
    messages = result["messages"] if isinstance(result, dict) and "messages" in result else [message]
content = messages[0].get("content", payload["content"])
print(json.dumps({"protocolVersion":1,"id":payload["id"],"content":content}))
`;

function runHeadroomPython(
	options: HeadroomCompressorOptions,
	input: ContextCompressionInput,
	signal: AbortSignal | undefined,
): Promise<ContextCompressionOutput> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(options.python, ["-c", HELPER], {
			stdio: ["pipe", "pipe", "pipe"],
			detached: true,
			env: minimalEnv(),
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			fn();
		};
		const killGroup = () => {
			try {
				process.kill(-child.pid!, "SIGKILL");
			} catch {
				child.kill("SIGKILL");
			}
		};
		const onAbort = () => {
			killGroup();
			finish(() => reject(new Error("headroom compression aborted")));
		};
		const timer = setTimeout(
			() => {
				killGroup();
				finish(() => reject(new Error("headroom compression timed out")));
			},
			Math.max(1, options.timeoutMs),
		);
		signal?.addEventListener("abort", onAbort, { once: true });
		child.on("error", (error) => {
			finish(() => reject(error));
		});
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
			if (stdout.length > options.maxOutputBytes) {
				killGroup();
				finish(() => reject(new Error("headroom output exceeded cap")));
			}
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk).slice(0, 2048);
		});
		child.on("close", (code) => {
			finish(() => {
				if (code !== 0) {
					reject(new Error(stderr.trim() || stdout.trim() || `headroom exited ${code}`));
					return;
				}
				try {
					const parsed = JSON.parse(stdout) as {
						protocolVersion?: number;
						id?: unknown;
						content?: unknown;
						error?: string;
					};
					if (parsed.error) throw new Error(parsed.error);
					if (parsed.protocolVersion !== 1) throw new Error("headroom protocol mismatch");
					if (parsed.id !== input.id) throw new Error("headroom id mismatch");
					if (typeof parsed.content !== "string") throw new Error("headroom content missing");
					resolvePromise({ id: input.id, content: parsed.content });
				} catch (error) {
					reject(error instanceof Error ? error : new Error(String(error)));
				}
			});
		});
		child.stdin.end(JSON.stringify({ protocolVersion: 1, id: input.id, content: input.content }));
	});
}

function minimalEnv(): NodeJS.ProcessEnv {
	const allowed: NodeJS.ProcessEnv = {};
	for (const key of ["PATH", "HOME", "TMPDIR", "PYTHONPATH", "VIRTUAL_ENV", "QMD_CONFIG_DIR", "XDG_CACHE_HOME"]) {
		if (process.env[key]) allowed[key] = process.env[key];
	}
	allowed.HEADROOM_NO_TELEMETRY = "1";
	allowed.DO_NOT_TRACK = "1";
	return allowed;
}
