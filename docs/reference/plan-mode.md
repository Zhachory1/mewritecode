---
title: Plan Mode
description: Read-only exploration, then a structured plan, then user-accepted edits.
---

# Plan Mode

Plan mode is a permission profile + a prompt convention. The agent is restricted to read-only tools and is instructed to end its turn with a structured plan. The user reviews and either accepts (`/act` flips to `acceptEdits`) or asks for revisions.

<CopyForLlms />

## Why

- **Auditable.** You see what the agent intends to do before any byte is written.
- **Cheaper.** Plans are smaller than full implementations; you can iterate on the plan with a smaller model.
- **Reversibility.** The plan becomes the artifact. You can pin it, share it, run it later.

## Enter plan mode

```bash
caveman --plan          # boot in plan mode
cave                 # then Shift+Tab → "plan"
/plan                # inside a session
```

In plan mode:

- Tools allowed: `Read`, `Glob`, `Grep`, `Bash` (with read-only allowlist), `Task` (subagents inherit plan mode unless overridden).
- Tools blocked: `Edit`, `Write`, network calls, exec outside the allowlist.
- The system prompt instructs the model to end with a structured `## Plan` section.

## Plan format

```markdown
## Plan

**Goal:** <one sentence>

**Steps:**
1. Edit `path/to/file.ts` — <what changes and why>
2. Run `npm test` — expect tests in `packages/foo/test/bar.test.ts` to update.
3. Edit `path/to/other.ts` — <reason>.

**Risks:**
- The migration touches the public API of `@caveman-code/agent`. Bump major.
- ...

**Estimate:** ~6 file edits, 1 test run, ~5 min.
```

The model is prompted to emit this exact shape so caveman-code can parse the steps for `/act`.

## Accept and execute

```
/act
```

Flips to `acceptEdits`, the model walks each plan step in order. Steps that fail surface for confirmation; the rest of the plan is paused.

`/act --step 2` runs only step 2 (e.g. for re-running a flaky test step).

`/act --skip 3` skips step 3.

## Architect mode (split planning + edit)

```bash
caveman --architect claude-opus-4-7 --editor claude-haiku-4
```

Architect mode is plan-mode + auto-handoff:

1. Architect (Opus) plans.
2. Editor (Haiku) executes each step in a worktree-isolated subagent.
3. Architect reviews subagent results, refines the plan if needed.

This is the cheapest way to use a frontier model for hard reasoning while keeping mechanical edits on a cheap model.

## Plans on disk

`/plan save <name>` writes the current plan to `.cave/plans/<name>.md`. Re-run with:

```bash
caveman --plan-from .cave/plans/refactor-auth.md
```

Useful for: handing the same plan to another teammate, sharing in PR description, replaying after rebasing.

## Importing from Claude Code

Claude Code's plan mode uses an analogous `## Plan` shape. Copy the markdown directly. Caveman Code's parser is forgiving about heading depth and bullet style.
