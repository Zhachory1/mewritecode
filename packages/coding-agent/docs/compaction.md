# Compaction & Branch Summarization

Me Write Code keeps long sessions usable by summarizing older context while preserving recent turns and file history.

## Mechanisms

| Mechanism | Trigger | Purpose |
| --- | --- | --- |
| Compaction | Context exceeds threshold, or `/compact` | Summarize older turns to free context window space |
| Branch summarization | `/tree` navigation | Carry useful context when switching session branches |

Source files:

- [`src/core/compaction/compaction.ts`](../src/core/compaction/compaction.ts)
- [`src/core/compaction/branch-summarization.ts`](../src/core/compaction/branch-summarization.ts)
- [`src/core/compaction/utils.ts`](../src/core/compaction/utils.ts)
- [`src/core/session-manager.ts`](../src/core/session-manager.ts)

## Compaction flow

1. Walk backward from the newest message until `keepRecentTokens` is preserved.
2. Cut on a safe entry boundary: user, assistant, bash execution, or custom message.
3. Serialize older messages to plain text so the model summarizes them instead of continuing them.
4. Ask the model for a structured summary.
5. Append a `CompactionEntry` with `summary`, `firstKeptEntryId`, `tokensBefore`, and optional `details`.
6. Rebuild context from the summary plus messages from `firstKeptEntryId` onward.

Repeated compactions summarize from the previous kept boundary so context that survived an earlier compaction is not lost.

## Split turns

If one turn is larger than `keepRecentTokens`, compaction can cut inside that turn at an assistant message. Me Write Code summarizes the turn prefix and merges it with prior history so tool calls/results still stay paired.

## Branch summarization flow

When `/tree` moves to another branch:

1. Find the common ancestor between current branch and target branch.
2. Collect entries from the abandoned branch.
3. Summarize those entries within budget.
4. Append a `BranchSummaryEntry` at the navigation point.

This lets the new branch know what happened on the branch you left.

## File tracking

Compaction and branch summaries accumulate file operations from:

- tool calls in the summarized span
- previous compaction/branch summary `details`

Default `details` includes `readFiles` and `modifiedFiles`. Extensions may store their own JSON-serializable metadata.

## Summary format

Summaries use this shape:

```markdown
## Goal
[What the user is trying to accomplish]

## Constraints & Preferences
- [Requirements mentioned by user]

## Progress
### Done
- [Completed tasks]

### In Progress
- [Current work]

### Blocked
- [Issues, if any]

## Key Decisions
- **[Decision]**: [Rationale]

## Next Steps
1. [What should happen next]

## Critical Context
- [Data needed to continue]

<read-files>
path/to/file.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>
```

## Extension hooks

Extensions can customize compaction and branch summarization:

```typescript
import type { ExtensionAPI } from "@zhachory1/mewrite-code";

export default function (api: ExtensionAPI) {
  api.on("session_before_compact", async (event) => {
    return {
      compaction: {
        summary: "custom summary",
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
      },
    };
  });
}
```

Use `serializeConversation(convertToLlm(messages))` when sending summarized messages to your own model.

## Settings

Configure in `~/.mewrite/agent/settings.json` or `.mewrite/settings.json`:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

| Setting | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Enable auto-compaction |
| `reserveTokens` | `16384` | Tokens reserved for the model response |
| `keepRecentTokens` | `20000` | Recent tokens kept verbatim |

Disable auto-compaction with `"enabled": false`. Manual `/compact` still works.
