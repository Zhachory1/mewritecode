/**
 * Memory subsystem (WS7) — pluggable backend for cave's memory layer.
 *
 * Public surface:
 *   - MemoryProvider         interface, plus types
 *   - CavememProvider        opt-in — wraps cavemem stdio MCP + `cavemem hook run`
 *   - FilesProvider          default — markdown under .mewrite/memory/
 *   - consolidate()          episodic→semantic consolidation pass (cave's value-add)
 *   - formatPrelude()        helper for the session-start prelude injection
 *
 * Cave's only original work in this subsystem is the consolidation pass
 * (consolidate.ts) and the MEMORY.md bridge (lives in coding-agent so it can
 * reach the user-facing config dir).
 */

export type { CavememExecResult, CavememHubLike, CavememProviderOptions } from "./cavemem.js";
export {
	CavememProvider,
	formatPrelude,
} from "./cavemem.js";
export type { ConsolidateOptions, ConsolidateResult, SemanticExtractor } from "./consolidate.js";
export {
	clusterObservations,
	consolidate,
	jaccard,
	tokenize,
} from "./consolidate.js";
export type { FilesProviderOptions } from "./files.js";
export { discoverFilesProviderReadDirs, FilesProvider } from "./files.js";
export * from "./provider.js";
