import { realpathSync } from "node:fs";
import { resolve } from "node:path";

const fileMutationQueues = new Map<string, Promise<void>>();

function getMutationQueueKey(filePath: string): string {
	const resolvedPath = resolve(filePath);
	try {
		return realpathSync.native(resolvedPath);
	} catch {
		return resolvedPath;
	}
}

export interface FileMutationEvent {
	/** Absolute filesystem path that was mutated (best-effort realpath). */
	path: string;
	/** Epoch millis at which the mutation completed successfully. */
	at: number;
}

type FileMutationListener = (event: FileMutationEvent) => void;

const mutationListeners = new Set<FileMutationListener>();

/**
 * Subscribe to successful file mutations serialized through `withFileMutationQueue`.
 * Returns an unsubscribe function. Listeners must not throw; errors are swallowed.
 */
export function onFileMutation(listener: FileMutationListener): () => void {
	mutationListeners.add(listener);
	return () => {
		mutationListeners.delete(listener);
	};
}

function emitFileMutation(path: string): void {
	if (mutationListeners.size === 0) return;
	const event: FileMutationEvent = { path, at: Date.now() };
	for (const listener of mutationListeners) {
		try {
			listener(event);
		} catch {
			// Listener errors must not affect the mutation caller.
		}
	}
}

/**
 * Serialize file mutation operations targeting the same file.
 * Operations for different files still run in parallel.
 *
 * Fires `onFileMutation` listeners with the realpath-normalized target after
 * `fn` resolves successfully. Failed mutations do not emit.
 */
export async function withFileMutationQueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
	const key = getMutationQueueKey(filePath);
	const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve();

	let releaseNext!: () => void;
	const nextQueue = new Promise<void>((resolveQueue) => {
		releaseNext = resolveQueue;
	});
	const chainedQueue = currentQueue.then(() => nextQueue);
	fileMutationQueues.set(key, chainedQueue);

	await currentQueue;
	try {
		const result = await fn();
		// Emit the post-mutation realpath so daemons subscribing here can
		// symlink-match against realpath'd session roots (e.g. macOS /var vs
		// /private/var). Falls back to the queue key if realpath still fails.
		let emitPath = key;
		try {
			emitPath = realpathSync.native(resolve(filePath));
		} catch {
			// File may have been deleted by the mutation itself; keep the pre-op key.
		}
		emitFileMutation(emitPath);
		return result;
	} finally {
		releaseNext();
		if (fileMutationQueues.get(key) === chainedQueue) {
			fileMutationQueues.delete(key);
		}
	}
}
