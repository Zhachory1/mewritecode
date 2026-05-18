---
title: Caveman Code vs the field
description: Feature-by-feature comparison of Caveman Code with Claude Code, Codex, Aider, Crush, and opencode.
---

# Caveman Code vs Claude Code, Codex, Aider, Crush, opencode

This is the comparison table from the v2 master plan, kept current as features land. The pitch is short:

> **Caveman Code is the only terminal coding agent that beats Claude Code on cost, Aider on context selection, Codex on provider flexibility, and opencode on session UX — in a single MIT-licensed binary.**

<CopyForLlms />

## Capabilities

| Axis | Caveman Code v2 | Claude Code | Codex | Aider | Crush | opencode |
|---|---|---|---|---|---|---|
| Token compression (3-layer Caveman Mode) | yes (unique) | no | no | repo map only | no | no |
| 20+ provider OAuth (Claude Pro / ChatGPT / Copilot / Gemini) | yes (unique) | Anthropic only | ChatGPT only | env keys only | subset | env keys |
| Session branching + fork | yes | no | fork only | git only | no | no |
| Native MCP | yes | yes | yes | no | yes | yes |
| Native sandbox | yes | partial | yes (best-in-class) | no | partial | partial |
| Plan mode | yes | yes | yes | architect | no | yes |
| Repo map (PageRank) | yes | no | no | yes (best-in-class) | no | no |
| Edit-format-per-model | yes | no | no | yes (best-in-class) | no | no |
| Worktree-isolated subagents | yes | yes | yes | no | no | no |
| Daemon / multi-client | yes | no | yes (app-server) | no | no | yes (best-in-class) |
| Shadow-git checkpoints + `/rollback N` | yes | no | no | git only | no | no |
| Containerized parallel sessions | yes | no | no | no | no | no |
| Cost transparency (per-msg $) | yes | partial | partial | yes (best-in-class) | no | no |
| MIT open source | yes | closed | Apache | Apache | FSL | MIT |

## Where each agent shines

- **Claude Code** — first-party Anthropic, opinionated UX, polished out-of-box. Best if you only use Claude and don't care about cost.
- **Codex** — OpenAI's terminal agent. Excellent sandbox primitive ("sandbox-as-utility"). Single-vendor by design.
- **Aider** — pioneer of repo map + edit-format-per-model. Strongest at large-codebase context selection. Less ergonomic interactive UX.
- **Crush** — fast, polished TUI (Charm). Mid-session model swap. Smaller ecosystem.
- **opencode** — strong daemon / multi-client story. Newer; ecosystem still maturing.
- **Cave** — borrows the best of all five and adds **Caveman Mode compression** + **20+ provider OAuth** as native, unique differentiators.

## Tokens — the headline

25-task MicroBench, `gpt-5.5` on both sides, `xhigh` reasoning (2026-05-18):

| Agent | Fresh tokens | Pass rate | Cost |
|---|---|---|---|
| Codex CLI | 1,010,185 | 15/25 (60%) | $0 (codex sub) |
| **Caveman Code** | **524,703** | **14/25 (56%)** | **$1.78** |

**1.93× fewer tokens for ~equivalent pass rate.** Reproduce in one command:

```bash
npx tsx research/evals/run-honest-bench.ts --tools caveman,codex
```

Raw CSV and per-task logs live in [`research/results/`](https://github.com/JuliusBrussee/caveman-cli/tree/main/research/results). Methodology spawns each CLI as a real child process — no SDK shortcuts.

## Format compatibility

Caveman Code is a **superset** of Claude Code's authoring formats. Concretely, you can paste these directly into `~/.cave/`:

- `~/.claude/settings.json` → `~/.cave/settings.json` (hooks, permissions, statusLine identical schema)
- `~/.claude/commands/*.md` → `~/.cave/commands/*.md`
- `~/.claude/skills/<name>/SKILL.md` → `~/.cave/skills/<name>/SKILL.md`
- `~/.claude/agents/<name>.md` → `~/.cave/agents/<name>.md`
- `.mcp.json` (Codex / Claude Code standard) is read at the project root

See [migration from Claude Code](/migration/from-claude-code) for the step-by-step.

## Caveat — these comparisons evolve

Claude Code, Codex, Crush, and opencode all iterate weekly. We pin our compatibility target to **Claude Code v2.1.119 schemas** with a CI delta check; tracking the others is best-effort. If you spot drift, [open an issue](https://github.com/JuliusBrussee/caveman-cli/issues/new?labels=docs).
