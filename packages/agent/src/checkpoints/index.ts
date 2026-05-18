/**
 * WS17: Shadow-Git Checkpoint Manager — public API barrel.
 *
 * Consumers import from "@caveman-code/agent/checkpoints" or via the barrel here.
 * Internal modules (manager, snapshotter, rollback) are re-exported selectively
 * to keep the surface small.
 */

export type {
	CheckpointIndexEntry,
	CheckpointIndexFile,
} from "./index-file.js";
export { CheckpointIndex } from "./index-file.js";
export { CheckpointManager } from "./manager.js";
export type {
	RollbackListEntry,
	RollbackOptions,
	RollbackResult,
} from "./rollback.js";
export { rollback, rollbackList } from "./rollback.js";
export type {
	CheckpointDirMetadata,
	CheckpointEntry,
	CheckpointGcPolicy,
	CheckpointLog,
	PickerEntry,
	RewindAdapter,
	RewindResult,
	SessionRow,
	ShadowRepoPath,
} from "./shadow-git.js";
export {
	buildPickerEntries,
	fuzzyFilter,
	isMutatingTool,
	JSONL_V3_COMPAT,
	rewindSession,
	ShadowCheckpoints,
	selectGcCandidates,
	shadowRepoPath,
	sortByRecency,
} from "./shadow-git.js";
export type { SnapshotReason, SnapshotResult, SnapshottedFile } from "./snapshotter.js";
export { Snapshotter } from "./snapshotter.js";
