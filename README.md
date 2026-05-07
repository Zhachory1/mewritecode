<div align="center">

<img src="https://raw.githubusercontent.com/JuliusBrussee/caveman-cli/main/.github/assets/cave-banner.svg" alt="Cave" width="640" onerror="this.style.display='none'" />

<h1>Cave</h1>

<p>
  <strong>The terminal coding agent that costs 100× less.</strong><br/>
  Same work. 40× fewer tokens. 20+ providers. Plan mode. Subagents. Autopilot loop. MIT.
</p>

<p>
  <a href="https://www.npmjs.com/package/cave"><img src="https://img.shields.io/npm/v/cave?color=2ea043&label=npm&style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/cave"><img src="https://img.shields.io/npm/dm/cave?color=2ea043&label=downloads&style=flat-square" alt="npm downloads" /></a>
  <a href="https://github.com/JuliusBrussee/caveman-cli/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-2ea043?style=flat-square" alt="MIT License" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-2ea043?style=flat-square" alt="Node.js 20+" /></a>
  <a href="https://github.com/JuliusBrussee/caveman-cli/actions"><img src="https://img.shields.io/github/actions/workflow/status/JuliusBrussee/caveman-cli/ci.yml?branch=main&label=ci&style=flat-square" alt="CI" /></a>
  <a href="https://discord.com/invite/nKXTsAcmbT"><img src="https://img.shields.io/badge/discord-join-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="https://cave.sh/docs"><img src="https://img.shields.io/badge/docs-cave.sh-d97757?style=flat-square" alt="Docs" /></a>
</p>

<p>
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#whats-new">What's New</a> ·
  <a href="#why-cave">Why Cave</a> ·
  <a href="#how-it-saves-tokens">How It Saves Tokens</a> ·
  <a href="#features">Features</a> ·
  <a href="#sdk">SDK</a> ·
  <a href="#acknowledgements">Acknowledgements</a>
</p>

<img src="vhs/install.gif" width="760" alt="cave install + first prompt — 30 seconds" />

</div>

---

```
  Tokens per resolved task — Cave MicroBench vs published baselines

  cave         ▏ 59k · $0.07            ◀ you are here
  Codex        █████████████████████████████ 1,348k · $3.37
  Claude Code  ██████████████████████████████████████████████████ 2,353k · $7.35
```

> **23×** fewer tokens than Codex. **40×** fewer than Claude Code. **105×** cheaper per resolved task.
> 64% pass-rate on the 25-task MicroBench at $1.19 total · 75% prompt-cache hit rate from Cave Mode compression.
> [Full eval methodology + reproduce every number →](research/README.md)

---

## Install

```bash
curl -fsSL https://cave.sh/install | bash
```

That's the canonical install. Authenticate once, then go:

```bash
export ANTHROPIC_API_KEY=sk-ant-...    # or any other supported provider
cave                                    # launch the TUI
cave "explain this codebase"            # one-shot
cave --goal "ship feature X"            # autonomous loop
```

<details>
<summary><strong>Other install paths</strong> — Homebrew · npm · Docker · Windows · manual</summary>

```bash
# Homebrew (macOS / Linux)
brew tap juliusbrussee/cave https://github.com/JuliusBrussee/caveman-cli && brew install cave

# npm (any platform with Node 20+)
npm install -g cave

# Docker
docker run --rm -it -v "$PWD:/work" ghcr.io/juliusbrussee/caveman-cli:latest

# Windows (PowerShell)
irm https://cave.sh/install.ps1 | iex
```

Auto-update channels (`stable`, `beta`, `canary`) and headless / CI install: see
[docs/getting-started/installation](https://cave.sh/docs/getting-started/installation).

</details>

---

## Quick Start

```bash
# Authenticate (pick one)
export ANTHROPIC_API_KEY=sk-ant-...           # any supported provider's API key
cave && /login                                # OAuth: Claude Pro · ChatGPT Plus · Copilot · Gemini · Antigravity

# Use
cave                                          # interactive TUI
cave "fix the failing tests"                  # start with a prompt
cave -p "summarize this file"                 # non-interactive, print and exit
cat README.md | cave -p "review"              # pipe stdin
cave -c                                       # continue last session
cave -r                                       # browse + resume sessions
cave --plan "ship payments v2"                # plan mode (read-only)
cave --goal "ship payments v2"                # autonomous Ralph loop
```

Type `/` inside the TUI for the full slash-command list. Or browse
[docs/reference/slash-commands](https://cave.sh/docs/reference/slash-commands).

---

## I want to…

| Goal | Where to look |
|---|---|
| Try cave right now | [Quickstart](https://cave.sh/docs/getting-started/quickstart) |
| Migrate from Claude Code (paste your config) | [Migration guide](https://cave.sh/docs/migration/from-claude-code) |
| Migrate from Codex | [Codex migration](https://cave.sh/docs/migration/from-codex) |
| Migrate from Aider (repo map + edit-formats are first-class) | [Aider migration](https://cave.sh/docs/migration/from-aider) |
| Use my ChatGPT Plus / Claude Pro / Copilot subscription | [Auth & Providers](https://cave.sh/docs/getting-started/auth) |
| Compare cave vs the field | [Comparison](https://cave.sh/docs/comparison) |
| Run cave headless in CI | [Cookbook → cave exec](https://cave.sh/docs/cookbook#cave-exec-in-github-actions) |
| Author a slash command, skill, or subagent | [Skills & Commands](https://cave.sh/docs/reference/slash-commands) |
| Read everything as one file (LLM-friendly) | [llms.txt](https://cave.sh/llms.txt) |

---

## What's New

### `0.65` — Plan mode, autonomous goal loop, native memory

| Feature | What it does | Slash / flag |
|---|---|---|
| **Plan mode** | Read-only chat mode — model sees only `read`/`grep`/`find`/`ls`, produces a written plan, never edits. Hand off to `/act` to execute. Subagents inherit gating. | `/plan`, `/act`, `--plan` |
| **Goal loop** (Ralph-style autopilot) | Spawns `cave -p --mode json` per iteration with rolling state, ledger, transcript, and shadow-git. Terminates on completion sentinel, iteration cap, $-cap, no-progress, or SIGINT. | `/goal`, `cave --goal` |
| **Native memory tools** | `memory_search` / `memory_save` exposed as agent tools. Auto-injects relevant recall each turn from cavemem (BM25 + local vectors). | `/memory`, `/memory consolidate` |
| **Subagent registry** | Worktree-isolated, frontmatter-driven agents at `.cave/agents/<name>.md`. Five default agents (`Explore`, `Reviewer`, `Tester`, `Implementer`, `Critic`). Frontmatter is a Claude Code superset. | `Task` tool |
| **TUI chord input + notifications** | Multi-key chord bindings (`Ctrl+x g`, etc.) and a non-blocking notification system in the differential renderer. | configurable in `~/.cave/keybindings.json` |
| **Quick-open + task list** | `Ctrl+P` quick file open, live task list overlay during long-running tool runs. | `/quick-open`, `/task-list` |
| **No permission prompts** | Permission system stripped — cave runs autopilot. Hooks remain as observers, never blocking. | n/a |

Full changelog: [CHANGELOG.md](CHANGELOG.md).

---

## Why Cave

| Axis | **Cave** | Claude Code | Codex | Aider | opencode |
|---|---|---|---|---|---|
| 4-layer token compression (Cave Mode) | **yes** | no | no | repo map only | no |
| 20+ provider OAuth | **yes** | Anthropic only | ChatGPT only | env keys only | env keys |
| Autonomous goal loop | **yes** | no | no | no | no |
| Plan mode (read-only chat) | **yes** | partial | no | no | no |
| Session branching + fork + `/tree` | **yes** | no | fork only | git only | no |
| Native MCP (stdio + HTTP + in-proc) | **yes** | yes | yes | no | yes |
| Autopilot (no permission prompts) | **yes** | no | no | yes | no |
| Repo map (PageRank, Aider-style) | **yes** | no | no | yes | no |
| Edit-format-per-model | **yes** | no | no | yes | no |
| Worktree-isolated subagents | **yes** | yes | yes | no | no |
| Daemon / multi-client attach | **yes** | no | yes | no | yes |
| Shadow-git checkpoints + `/rollback N` | **yes** | no | no | git only | no |
| Per-message cost transparency | **yes** | partial | partial | yes | no |
| Architect / editor model split | **yes** | no | no | yes | no |
| Persistent semantic memory (cavemem) | **yes** | MEMORY.md only | no | no | no |
| MIT open source | **yes** | closed | Apache-2.0 | Apache-2.0 | MIT |

Full table including Crush: [docs/comparison](https://cave.sh/docs/comparison).

---

## How It Saves Tokens

Four compression layers. Always on. Break-even after one tool call.

| Layer | What happens | Impact |
|---|---|---|
| **Cave Mode** | Model responds in terse technical fragments — no filler, no hedging. Levels: `lite` · `full` · `ultra`. | Prompt + response compression |
| **Tool Budgets** | Per-tool line caps (bash: 80, read: 300, grep: 120) + ANSI strip + blank collapse + semantic JSON/XML extraction. | **−67% to −94%** on tool output |
| **Read Dedup** | Files are fingerprinted per session — re-reads return a stub, not the content. | **−99%** on repeated reads |
| **RTK** | Optional Rust binary that rewrites bash output before it enters context. | **~60%** additional reduction |

<details>
<summary>Full benchmark — 10 real-world tool output fixtures</summary>

```
  git diff (901 lines)   ██████████████████████████████████████████████████  -94%
  npm ls (701 lines)     ████████████████████████████████████████████████    -92%
  ls recursive (601 ln)  ███████████████████████████████████████████████     -90%
  grep results (801 ln)  █████████████████████████████████████████████       -89%
  test output (501 ln)   ████████████████████████████████████████████        -88%
  XML/pom.xml (382 ln)   ████████████████████████████████████████            -79%
  docker inspect (258)   ██████████████████████████████████                  -68%
  ANSI colored (97 ln)   █████████████████████████████                       -50%
  read file (429 lines)  ████████████████                                    -32%
  build output (19 ln)   █████████                                           -18%
                         ────────────────────────────────────────────────────
  AGGREGATE              ███████████████████████████████████████████████     -86%
```

| Metric | Value |
|---|---|
| Tokens saved (10 fixtures) | ~72,400 of 337K chars |
| System prompt overhead | 120–195 tokens (lite–ultra) |
| Net savings (15-turn session) | **+567K tokens (~$1.70 with Sonnet)** |
| Net savings (30-turn session) | **+1.13M tokens (~$6.92 with Sonnet)** |

```bash
npm run bench:offline   # compression analysis — free, <1s
npm run bench:replay    # analyze your real sessions — free
npm run bench:live      # A/B with LLM calls — needs API key
```

</details>

<details>
<summary>MicroBench eval — 25 coding tasks · $1.19 total · 14 minutes</summary>

| Difficulty | Pass Rate | Avg Cost | Avg Duration |
|---|---|---|---|
| Easy | 8 / 8 (100%) | $0.03 | 17s |
| Medium | 6 / 10 (60%) | $0.04 | 33s |
| Hard | 2 / 7 (29%) | $0.06 | 55s |
| **Total** | **16 / 25 (64%)** | **$0.05** | **33s** |

**75% prompt-cache hit rate** from Cave Mode compression.
[Run it yourself →](research/README.md)

</details>

---

## Features

<details>
<summary><strong>🧠 Plan mode</strong> — read-only chat, structured plan output, hand-off to <code>/act</code></summary>

`/plan` flips the active session into a read-only mode. The model only sees
file-discovery tools (`read`, `grep`, `find`, `ls`) and is instructed to
produce a written plan. Subagents spawned via the `Task` tool inherit the
gating. Type `/act` to flip back to edit mode and execute the plan.

```bash
cave --plan "ship payments v2"     # boot in plan mode
/plan show                         # show saved plan
/plan off                          # leave (alias of /act)
/act ship the plan                 # exit plan mode and submit a prompt
```

Plans are saved per-session in `~/.cave/agent/plans/`.

</details>

<details>
<summary><strong>🤖 Autonomous goal loop</strong> — Ralph-style autopilot with budgets and termination ranking</summary>

`/goal` (or `cave --goal`) spawns `cave -p --mode json` per iteration with
the iteration prompt on stdin. It maintains rolling state, a ledger
(per-iteration $/tokens/duration), a transcript, and shadow-git checkpoints.

**Termination ranking:**

1. completion sentinel in the iteration's last assistant text → **done**
2. iteration cap → failed
3. wall-clock cap → failed
4. $ cap (from ledger) → failed
5. consecutive no-progress iterations → **paused**
6. `SIGINT` / `cancel.json` sentinel → cancelled

Resume any time with `cave --goal --resume <id>`. Cancel cleanly with
`Ctrl+C` or by writing a sentinel file.

</details>

<details>
<summary><strong>🧬 Cave Mode compression</strong> — 4-layer, ~85% reduction on tool output</summary>

Always on. Per-tool budgets, read dedup, semantic JSON/XML extraction, optional Rust binary for bash rewriting.

```bash
cave --cave-mode ultra      # most aggressive
cave --cave-mode lite       # only system-prompt compression
cave --no-cave-mode         # disable
```

[Reference →](https://cave.sh/docs/reference/tools)

</details>

<details>
<summary><strong>🪞 Architect / editor split</strong> — Opus plans, Haiku executes</summary>

Run a slow, expensive model for planning and a fast, cheap one for execution.
Drops cost ~3–5× vs. a single-model run.

```bash
cave --architect claude-opus-4-7 --editor claude-haiku-4
```

</details>

<details>
<summary><strong>👥 Subagents</strong> — up to 7 parallel, worktree-isolated</summary>

Custom agents at `.cave/agents/<name>.md` and `~/.cave/agents/<name>.md`. Frontmatter is a Claude Code superset.

```yaml
---
description: "Read-only directory exploration. Returns 500-token summary."
prompt: "Walk the directory at $1. List subdirs with one-line purpose hints."
tools: [Read, Glob, Grep, Bash]
model: claude-haiku-4
isolation: worktree
---
```

Five default agents shipped: `Explore`, `Reviewer`, `Tester`, `Implementer`, `Critic`.
Spawn from any session via the `Task` tool.

[Subagents reference →](https://cave.sh/docs/reference/subagents)

</details>

<details>
<summary><strong>🌳 Sessions, branching, replay</strong> — auto-save, <code>/tree</code>, <code>/fork</code>, <code>/rollback</code></summary>

JSONL files in `~/.cave/agent/sessions/`, organized by working directory. Branching never overwrites history.

```bash
cave -c                    # continue most recent
cave -r                    # browse and select
cave --session <path|id>   # open specific session
cave --fork <path|id>      # fork into new file
```

- `/tree` — navigate and branch in-place with search · fold · page · filter
- `/compact` — manual context compaction
- `/checkpoint` and `/rollback N` — shadow-git snapshots; rewind code and conversation together

</details>

<details>
<summary><strong>🌐 20+ providers, 6 OAuth flows</strong> — your existing subscription works</summary>

**OAuth subscriptions** — Claude Pro/Max · ChatGPT Plus/Pro · GitHub Copilot · Google Gemini · Antigravity · Vertex

**API keys** — Anthropic · OpenAI · Azure OpenAI · Google Vertex · Bedrock · Mistral · Groq · Cerebras · xAI · OpenRouter · Vercel AI Gateway · Hugging Face · Kimi · MiniMax · Z.AI · DeepSeek

**Custom** — Any OpenAI-/Anthropic-/Google-compatible endpoint via `~/.cave/agent/models.json`.

[Auth & Providers →](https://cave.sh/docs/getting-started/auth)

</details>

<details>
<summary><strong>🔌 MCP, hooks, skills, commands</strong> — Claude Code-compatible</summary>

Cave's authoring formats are a **superset** of Claude Code's. Paste your existing config, it works.

| Claude Code path | Cave path | Notes |
|---|---|---|
| `~/.claude/settings.json` | `~/.cave/settings.json` | Hooks schema identical (cave runs hooks as observers, never blocks) |
| `~/.claude/commands/*.md` | `~/.cave/commands/*.md` | Frontmatter superset |
| `~/.claude/skills/<name>/SKILL.md` | `~/.cave/skills/<name>/SKILL.md` | Identical |
| `~/.claude/agents/<name>.md` | `~/.cave/agents/<name>.md` | Frontmatter superset |
| `.mcp.json` | `.mcp.json` | Same path; no change |

MCP transports: **stdio**, **Streamable HTTP**, **in-process** (zero-spawn for cave's own tools). OAuth 2.1 + PKCE with two-tool pattern. Token cache in OS keychain.

```bash
cave mcp add <name>           # add an MCP server
cave mcp doctor               # health-check + tool listing
cave mcp login <name>         # OAuth dance
cave mcp-server               # run cave itself as an MCP server (Codex-compatible)
```

[Migration guide →](https://cave.sh/docs/migration/from-claude-code)

</details>

<details>
<summary><strong>🧠 Memory via cavemem</strong> — episodic→semantic consolidation</summary>

Cave delegates persistent memory to [cavemem](https://github.com/JuliusBrussee/cavemem) (MIT, ~75% prose-token reduction, hybrid BM25 + local vectors). Cave's value-add: **policy** — when to write, what to inject, episodic→semantic consolidation, MEMORY.md bridge to Claude Code.

The agent has two native tools: `memory_search` and `memory_save`. Recall is auto-injected each turn; the model can also expand a hit, query a different topic, or write a fact mid-turn without taking the user-driven `/memory` slash route.

```bash
/memory search "auth migration"
/memory consolidate            # cluster recent observations, write back as semantic facts
/memory sync --from claude     # import Claude Code's MEMORY.md
```

[Memory reference →](https://cave.sh/docs/reference/memory)

</details>

<details>
<summary><strong>🛠️ Recipes</strong> — declarative multi-step workflows</summary>

YAML files at `~/.cave/recipes/<name>.yaml` describe ordered steps with prompts, tool constraints, and acceptance criteria. Ten built-in recipes:

`accessibility-audit` · `add-feature-flag` · `add-tests` · `bump-deps` · `extract-component` · `migrate-deps` · `migrate-to-biome` · `port-to-typescript` · `release` · `seo-audit`

```bash
/recipe run add-tests src/auth.ts
```

</details>

<details>
<summary><strong>🖥️ Daemon</strong> — <code>cave serve</code>, multi-client attach, survive SSH drops</summary>

```bash
cave serve --port 39245            # start the daemon
cave attach --host localhost:39245 # attach a TUI to it
cave list                          # list sessions
```

Sessions live in SQLite and survive SSH drops. Worker mode: prepend `&` to any prompt to dispatch to a registered remote `cave worker`.

[Daemon reference →](https://cave.sh/docs/reference/daemon)

</details>

<details>
<summary><strong>📡 SDK & scripting</strong> — embed, RPC, print mode, JSON mode</summary>

```typescript
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "cave";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage: AuthStorage.create(),
  modelRegistry: ModelRegistry.create(AuthStorage.create()),
});
await session.prompt("What files are in the current directory?");
```

```bash
cave --mode rpc                                       # JSONL over stdin/stdout
cave -p "Summarize this codebase"                     # print and exit
cave --mode json "List todos"                         # structured JSON output
cave exec "lint and fix" --output-schema schema.json  # CI mode with structured output
```

The SDK ships as `@cave/sdk` (openapi-generated TS client for the cave daemon HTTP+WS API).
[API reference →](https://cave.sh/docs/api)

</details>

<details>
<summary><strong>⚙️ CLI flags + env vars</strong></summary>

| Flag | Description |
|---|---|
| `-c`, `--continue` | Continue most recent session |
| `-r`, `--resume` | Browse and select session |
| `-p`, `--print` | Non-interactive: print and exit |
| `--mode json\|rpc` | Structured output modes |
| `--plan` | Boot in plan mode (read-only) |
| `--goal <prompt>` | Run autonomous goal loop |
| `--provider <name>` | `anthropic`, `openai`, `google`, … |
| `--model <pattern>` | Model ID or `provider/id`; supports `:<thinking>` suffix |
| `--thinking <level>` | `off` · `minimal` · `low` · `medium` · `high` · `xhigh` |
| `--architect <model>` / `--editor <model>` | Architect/editor split |
| `--tools <list>` | Enable specific tools (default: `read,bash,edit,write`) |
| `-e`, `--extension <src>` | Load a specific extension (repeatable) |
| `--cave-mode <level>` | `lite` · `full` · `ultra` |
| `--no-cave-mode` | Disable Cave Mode compression |

| Env var | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `CAVE_CODING_AGENT_DIR` | Override config directory |
| `CAVE_CACHE_RETENTION` | `long` for extended prompt cache (Anthropic: 1h, OpenAI: 24h) |

</details>

---

## SDK

```typescript
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "cave";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage: AuthStorage.create(),
  modelRegistry: ModelRegistry.create(AuthStorage.create()),
});

session.on("message", (msg) => console.log(msg.role, msg.text));
await session.prompt("Refactor src/auth.ts to use the new TokenStore.");
```

Or talk to a running daemon over HTTP / WS via [`@cave/sdk`](packages/sdk).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  cave (CLI)                                                      │
│  └─ packages/coding-agent — sessions, slash cmds, skills, hooks  │
│       │                                                          │
│       ├─ packages/agent     — tool-calling loop, state, MCP      │
│       │     │                                                    │
│       │     └─ packages/ai  — unified LLM API (20+ providers)    │
│       │                                                          │
│       ├─ packages/tui       — differential renderer, chord input │
│       │                                                          │
│       └─ packages/markdown-preview — TUI markdown                │
│                                                                  │
│  packages/sdk               — @cave/sdk (HTTP+WS client)         │
│                                                                  │
│  Out of v2 scope (independent surfaces):                         │
│   packages/web-ui   packages/mom   packages/pods                 │
└──────────────────────────────────────────────────────────────────┘
```

---

## Monorepo

| Package | Purpose |
|---|---|
| [`cave`](packages/coding-agent) | Coding agent CLI — sessions, extensions, skills, themes, slash commands, subagents |
| [`@cave/ai`](packages/ai) | Unified LLM API: OpenAI · Anthropic · Google · 17 more |
| [`@cave/agent`](packages/agent) | Agent runtime: tool calling, loop, state, system-prompt / toolFilter / maxTurns |
| [`@cave/tui`](packages/tui) | Terminal UI: differential rendering, chord input, notifications |
| [`@cave/sdk`](packages/sdk) | TS client for the cave daemon HTTP+WS API (openapi-generated) |
| [`@cave/markdown-preview`](packages/markdown-preview) | Markdown renderer used by TUI |
| [`@cave/web-ui`](packages/web-ui) | Web components for AI chat |
| [`@cave/mom`](packages/mom) | Slack bot → coding agent |
| [`@cave/pods`](packages/pods) | vLLM deployment on GPU pods |

---

## Roadmap

- ✅ **v0.65 — Plan mode, goal loop, native memory tools, subagent registry**
- ✅ **v0.50 — MCP native, repo-map, daemon, cavemem integration, edit-format-per-model**
- 🚧 **v0.70 — Plugin marketplace, scheduled routines, ambient theming polish**
- 🔭 **v1.0 — Public TUI design system, hosted agent runtime, audited security review**

Master plan: [`context/plans/cave-v2-best-in-class.md`](context/plans/cave-v2-best-in-class.md).

---

## Acknowledgements

**Cave is a heavy fork of [pi-code](https://github.com/badlogic/pi-code) by [Mario Zechner](https://github.com/badlogic).**
The `cave` codebase was forked from `pi-code` after the `@cavepi/pi-* → @cave/*` rebrand.
Substantial primitives — the agent runtime, MCP scaffolding, provider OAuth flows, repo
map, slash command parser, settings manager, skills loader, edit-format renderers, and
TUI components — originate in `pi-code`. We continue to track upstream and contribute
fixes back where the change is generally useful.

Cave's original work, layered on top:

- **Cave Mode** — 4-layer token compression (system prompt + tool budgets + read dedup + RTK)
- **Goal loop** — autonomous Ralph-style runner with budgets and termination ranking
- **Plan mode** — read-only chat with subagent gating and `/act` hand-off
- **cavemem integration** — episodic→semantic memory consolidation
- **Session branching `/tree`** — in-place fork with search/fold/page/filter
- **Architect/editor split** — model role assignments per turn
- **Proof-bench eval harness** — MicroBench + replay benchmarks
- **Terminal-blend ambient theming** — token-blend with transparent terminals

Other libraries we depend on or learned from:

- [**`@mariozechner/jiti`**](https://www.npmjs.com/package/@mariozechner/jiti) and [**`@mariozechner/clipboard`**](https://www.npmjs.com/package/@mariozechner/clipboard) — direct deps, also from Mario
- [**Aider**](https://aider.chat) — repo-map (PageRank) approach and edit-format-per-model idea
- [**Claude Code**](https://www.anthropic.com/news/claude-code) — settings · commands · skills · agents · `.mcp.json` formats (we adopted them verbatim, then extended)
- [**Codex**](https://github.com/openai/codex) — `cave mcp-server` mode (cave-as-MCP-server pattern)
- [**Continue**](https://continue.dev) — plugin hub idea (Cave plugin marketplace, in flight)
- [**Biome**](https://biomejs.dev) — single-binary lint/format

If your project is missing here and we should credit you, [open an issue](https://github.com/JuliusBrussee/caveman-cli/issues) — we'll fix it fast.

---

## Community

- 💬 **Discord** — [discord.com/invite/nKXTsAcmbT](https://discord.com/invite/nKXTsAcmbT)
- 🐛 **Issues** — [github.com/JuliusBrussee/caveman-cli/issues](https://github.com/JuliusBrussee/caveman-cli/issues)
- 🚢 **Releases** — [github.com/JuliusBrussee/caveman-cli/releases](https://github.com/JuliusBrussee/caveman-cli/releases)
- 📰 **Changelog** — [CHANGELOG.md](CHANGELOG.md) (auto-generated from conventional commits on tag push)
- 📚 **Docs** — [cave.sh/docs](https://cave.sh/docs)

---

## Contributing

```bash
git clone https://github.com/JuliusBrussee/caveman-cli.git
cd caveman-cli
npm install
npm run build
npm run check     # lint + format + type check
./test.sh         # run tests
```

[Biome](https://biomejs.dev/) for lint/format. TypeScript strict. Node.js 20+.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

---

## License

MIT © [Julius Brussee](https://github.com/JuliusBrussee). See [LICENSE](LICENSE).

Forked from [pi-code](https://github.com/badlogic/pi-code) (MIT © Mario Zechner). Cave's deltas are MIT-licensed and PRs upstream where useful.

<div align="center">
<sub>Built in the cave. Compressed by the cave. Run from the cave.</sub>
</div>
