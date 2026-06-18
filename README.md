<div align="center">

# 🪨 Me Write Code

**The terminal coding agent that talks like a caveman — and compresses at every layer.**

Same model. Same task. **Token efficiency under revalidation — see [#8](https://github.com/Zhachory1/mewritecode/issues/8).** 20+ providers · plan mode · autopilot loop · MIT.

<p>
  <a href="https://github.com/Zhachory1/mewritecode/stargazers"><img src="https://img.shields.io/github/stars/Zhachory1/mewritecode?color=d97757&style=flat-square" alt="Stars" /></a>
  <a href="https://www.npmjs.com/package/@zhachory1/mewrite-code"><img src="https://img.shields.io/npm/v/%40zhachory1%2Fmewrite-code?color=2ea043&label=npm&style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@zhachory1/mewrite-code"><img src="https://img.shields.io/npm/dm/%40zhachory1%2Fmewrite-code?color=2ea043&label=downloads&style=flat-square" alt="npm downloads" /></a>
  <a href="https://github.com/Zhachory1/mewritecode/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-2ea043?style=flat-square" alt="MIT License" /></a>
</p>

<a href="#install">Install</a> ·
<a href="#-the-trick">The Trick</a> ·
<a href="#how-it-saves-tokens">How It Saves Tokens</a> ·
<a href="#why-me-write-code">Why Me Write Code</a> ·
<a href="#features">Features</a> ·
<a href="#sdk">SDK</a>

<!-- TODO before publish: render the demo gif → `vhs vhs/install.tape`, then uncomment the line below.
<img src="vhs/install.gif" width="760" alt="mewrite install + first prompt — 30 seconds" />
-->

</div>

---

## 🔥 The trick

Big agent waffle. Waffle cost token. Caveman no waffle.

**Asked** ▸ *why does this component re-render on every keystroke?*

| Ordinary agent · **~290 tokens** | 🪨 Me Write Code · **31 tokens** |
|---|---|
| Great question! A React component can re-render on every keystroke for several reasons. The most common cause is passing a fresh object or function reference as a prop on each render, which defeats React's referential-equality bail-out and forces the child to reconcile again … *(three more paragraphs)* | New object ref each render. Inline prop = new ref = re-render. Wrap in `useMemo`. |

Same answer. Same model. The terse reply is the **visible** layer — fun, and it trims the model's own output.

But the reply is the *smallest* token sink. The compounding saving in a real session comes from what the agent reads **back** every turn: tool output (what the shell returns) and the cached context prefix. Caveman Mode compresses the first and rides the second — see [How It Saves Tokens](#how-it-saves-tokens). The caveman voice is the hood ornament; the engine is input-context compression + prompt-cache reuse.

---

## The proof

*25-task MicroBench · `gpt-5.5` · xhigh reasoning · 2026-05-18*

> **Token efficiency under revalidation — see [#8](https://github.com/Zhachory1/mewritecode/issues/8).**
> A prior caveman-vs-Codex token comparison was never independently measured — different model tier, no structured token accounting from Codex, and the comparison was never actually run. We are rebuilding an honest, controlled ON-vs-OFF ablation at a fixed model with a shared external scorer before publishing any number.
>
> Methodology under #8: each tool spawned as a real child process, each task verified by a shared external scorer, raw CSV + per-task logs published.

```bash
npx tsx research/evals/run-honest-bench.ts --tools caveman,codex   # reproduce in one command
```

[Raw CSV](research/results/honest-bench-2026-05-18.csv) · [Aggregate JSON](research/results/honest-bench-2026-05-18.json) · [Methodology](research/README.md) · [25 task prompts](research/evals/microbench/tasks/)

---

## Install

```bash
npm install -g @zhachory1/mewrite-code
```

Installs `mewrite` (primary), `mewritecode`, and `mewrite-code` commands.

```bash
export ANTHROPIC_API_KEY=sk-ant-...     # or any supported provider's key
mewrite                                 # launch the TUI
mewrite "explain this codebase"          # one-shot
mewrite -p "summarize this"              # print mode (non-interactive)
mewrite goal start "ship feature X"      # autonomous Ralph loop
```

<details>
<summary><strong>Other install paths</strong> — pnpm · yarn · bun · Docker · OAuth login</summary>

```bash
pnpm add -g @zhachory1/mewrite-code
yarn global add @zhachory1/mewrite-code
bun  add -g @zhachory1/mewrite-code

# Docker
docker run --rm -it -v "$PWD:/work" ghcr.io/zhachory1/mewritecode:latest

# No API key? Use a subscription you already pay for:
mewrite && /login   # Claude Pro · ChatGPT Plus · Copilot · Gemini · Antigravity
```

CI / headless install: [docs/getting-started/installation.md](docs/getting-started/installation.md).

</details>

---

## Quick Start

```bash
mewrite                            # interactive TUI
mewrite "fix the failing tests"     # start with a prompt
mewrite -p "summarize this file"    # non-interactive: print and exit
cat err.log | mewrite -p "debug"    # pipe stdin
mewrite -c                          # continue last session
mewrite -r                          # browse + resume sessions
mewrite /plan                       # plan mode — read-only (slash command)
mewrite goal start "ship payments v2"   # autonomous Ralph loop
```

Type `/` inside the TUI for every slash command. Reference: [docs/reference/slash-commands.md](docs/reference/slash-commands.md).

---

## How It Saves Tokens

Always-on, hitting token sinks in order of **size**. The agent re-reads its whole context every turn, so the big wins are on the **input** side (what the shell returns + the cached prefix) — not the model's reply.

| Token sink | Layer | What happens | Cut |
|---|---|---|---|
| **Tool output** (biggest sink) | Tool Budgets | Per-tool line caps (bash 80 · read 300 · grep 120), ANSI strip, blank-line collapse, semantic JSON/XML extraction. | **−67% to −94%** |
| | Read Dedup | Files fingerprinted per session — re-reads return a stub, not the bytes. | **−99%** on repeats |
| | **[RTK](https://github.com/rtk-ai/rtk)** | Optional external Rust binary ("Rust Token Killer") — pipes bash output through `rtk` before it enters context. | **−60% to −90%** (RTK's own bench) |
| **Cached prefix** (dominant over long sessions) | Prompt-cache reuse | The stable system+tools+history prefix is re-read at the provider's cache rate (~10% of input) every turn. In long multi-turn sessions the large majority of context tokens are cache hits — the single biggest cost lever, and it compounds. | provider cache rate |
| **Model reply** (smallest sink) | Caveman Mode | Terse technical fragments — no filler, no hedging. Levels `lite` · `full` · `ultra`. The visible layer; trims the model's own output, but it's the smallest of the four (dense technical answers don't compress far without dropping substance). | reply only |

Pays for itself after one tool call. The headline saving is the input side; Caveman Mode is the cherry on top.

<details>
<summary><strong>Benchmark</strong> — 10 real tool-output fixtures · −86% aggregate</summary>

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
| System-prompt overhead | 120–195 tokens (lite–ultra) |
| Net savings — 15-turn session | **+567K tokens (~$1.70, Sonnet)** |
| Net savings — 30-turn session | **+1.13M tokens (~$6.92, Sonnet)** |

```bash
npm run bench:offline   # compression analysis — free, <1s
npm run bench:replay    # analyze your real sessions — free
npm run bench:live      # A/B with live LLM calls — needs API key
```

</details>

```bash
Use `/mewrite [lite|full|ultra|off]` in the TUI to adjust compression aggressiveness.
```

---

## Why Me Write Code

| Capability | Caveman | Claude Code | Codex | Aider | opencode |
|---|:---:|:---:|:---:|:---:|:---:|
| 4-layer token compression | ✅ | ❌ | ❌ | repo map only | ❌ |
| 20+ provider OAuth | ✅ | Anthropic | ChatGPT | API keys | ✅ |
| Autonomous goal loop | ✅ | ❌ | ❌ | ❌ | ❌ |
| Autopilot — no permission prompts | ✅ | ❌ | ❌ | ✅ | ❌ |
| Repo map (PageRank, Aider-style) | ✅ | ❌ | ❌ | ✅ | ❌ |
| Architect / editor model split | ✅ | ❌ | ❌ | ✅ | ❌ |
| Session branching + shadow-git checkpoints | ✅ | ❌ | fork only | git only | ❌ |
| Persistent semantic memory (cavemem) | ✅ | MEMORY.md | ❌ | ❌ | ❌ |
| MIT open source | ✅ | closed | Apache-2.0 | Apache-2.0 | ✅ |

Full table including Crush: [docs/comparison.md](docs/comparison.md).

---

## Features

| | Feature | Trigger |
|---|---|---|
| 🤖 | **Autonomous goal loop** — Ralph-style autopilot. Rolling state, per-iteration $/token ledger, shadow-git checkpoints, ranked termination (sentinel · iteration cap · $-cap · no-progress · SIGINT). Resume any time. | `mewrite goal start` |
| 🧠 | **Plan mode** — read-only chat. Model sees only `read`/`grep`/`find`/`ls`, produces a written plan, never edits. Subagents inherit the gate. `/act` to execute. | `/plan` |
| 👥 | **Subagents** — up to 7 parallel, worktree-isolated. Frontmatter agents at `.cave/agents/*.md` (Claude Code superset). Five ship by default. | `Task` tool |
| 🪞 | **Architect / editor split** — slow model plans, fast model executes. ~3–5× cheaper than a single-model run. | `--architect` · `--editor` |

Latest release: plan mode · goal loop · native memory tools · subagent registry. Full history → [CHANGELOG.md](CHANGELOG.md).

<details>
<summary><strong>More</strong> — sessions · providers · MCP · memory · recipes · daemon · CLI flags</summary>

### 🌳 Sessions, branching, replay
JSONL sessions in `~/.cave/agent/sessions/`, organized by working directory. Branching never overwrites history.

```bash
mewrite -c                    # continue most recent
mewrite -r                    # browse and select
mewrite --fork <path|id>      # fork into a new file
```
`/tree` navigate + branch in-place (search · fold · page · filter) · `/compact` manual compaction · `/checkpoint` + `/rollback N` rewind code **and** conversation together.

### 🌐 20+ providers, 6 OAuth flows
**OAuth** — Claude Pro/Max · ChatGPT Plus/Pro · GitHub Copilot · Google Gemini · Antigravity · Vertex
**API keys** — Anthropic · OpenAI · Azure · Vertex · Bedrock · Mistral · Groq · Cerebras · xAI · OpenRouter · Vercel AI Gateway · Hugging Face · Kimi · MiniMax · Z.AI · DeepSeek
**Custom** — any OpenAI-/Anthropic-/Google-compatible endpoint via `~/.cave/agent/models.json`.

### 🔌 MCP, hooks, skills, commands — Claude Code-compatible
Authoring formats are a **superset** of Claude Code's — paste your existing config, it works.

| Claude Code | Caveman | Notes |
|---|---|---|
| `~/.claude/settings.json` | `~/.cave/settings.json` | Hooks identical (run as observers, never block) |
| `~/.claude/commands/*.md` | `~/.cave/commands/*.md` | Frontmatter superset |
| `~/.claude/skills/<name>/SKILL.md` | `~/.cave/skills/<name>/SKILL.md` | Identical |
| `~/.claude/agents/<name>.md` | `~/.cave/agents/<name>.md` | Frontmatter superset |
| `.mcp.json` | `.mcp.json` | Same path, no change |

MCP transports: stdio · Streamable HTTP · in-process. OAuth 2.1 + PKCE; tokens in OS keychain.
```bash
mewrite mcp add <name>      # add a server
mewrite mcp doctor          # health-check + tool listing
mewrite mcp-server          # run mewrite itself as an MCP server (Codex-compatible)
```

### 🧠 Memory via cavemem
Persistent memory delegated to [cavemem](https://github.com/JuliusBrussee/cavemem) (MIT, hybrid BM25 + local vectors). Agent has two native tools — `memory_search` and `memory_save`; relevant recall is auto-injected each turn.
```bash
/memory search "auth migration"
/memory consolidate            # cluster recent observations into semantic facts
/memory sync --from claude     # import Claude Code's MEMORY.md
```

### 🛠️ Recipes
Declarative multi-step YAML workflows at `~/.cave/recipes/*.yaml`. Ten built in: `accessibility-audit` · `add-feature-flag` · `add-tests` · `bump-deps` · `extract-component` · `migrate-deps` · `migrate-to-biome` · `port-to-typescript` · `release` · `seo-audit`.
```bash
/recipe run add-tests src/auth.ts
```

### 🖥️ Daemon
```bash
mewrite serve --port 39245             # start the daemon
mewrite attach --host localhost:39245  # attach a TUI
```
Sessions live in SQLite and survive SSH drops. Prepend `&` to any prompt to dispatch to a remote `mewrite worker`.

### ⚙️ CLI flags
| Flag | Description |
|---|---|
| `-c` / `-r` | Continue / browse-resume session |
| `-p`, `--print` | Non-interactive: print and exit |
| `--mode json\|rpc` | Structured output modes |
| `--provider` / `--model` | Provider name / model ID (`:<thinking>` suffix ok) |
| `--thinking <level>` | `off`·`minimal`·`low`·`medium`·`high`·`xhigh` |
| `--architect` / `--editor <model>` | Architect/editor split |
| `--tools <list>` | Enable specific tools |
| `--no-tools` | Disable all built-in tools |
| `--extension <path>` | Load an extension |
| `--no-extensions` | Disable extension discovery |

### 📋 Slash commands (in TUI)
| Command | Description |
|---|---|
| `/plan` | Toggle plan mode (read-only exploration) |
| `/act` | Execute a saved plan |
| `/mewrite [level]` | Adjust token compression (`lite`·`full`·`ultra`·`off`) |
| `/login`, `/logout` | OAuth authentication |
| `/model` | Switch models |
| `/settings` | Configure theme, thinking, compaction |
| `/resume` | Browse and resume sessions |
| `/tree` | Navigate session history |
| `/checkpoint`, `/rollback N` | Git-like version control |

### 🚀 Subcommands
| Command | Description |
|---|---|
| `mewrite goal start "<text>"` | Autonomous Ralph-style loop |
| `mewrite goal resume [id] [--force]` | Resume a paused goal |
| `mewrite goal status [id]` | Show goal state and ledger |
| `mewrite goal cancel [id]` | Mark goal as cancelled |
| `mewrite goal list` | List all goals in project |
| `mewrite mcp <subcmd>` | Manage MCP servers |
| `mewrite watch [paths]` | File watcher for `// cave!` triggers |
| `mewrite exec [flags] "<prompt>"` | Non-interactive CI mode |
| `mewrite plugin <subcmd>` | Plugin marketplace |
| `mewrite run-recipe <name>` | Run YAML workflow recipes |
| `mewrite rollback N` | Revert to checkpoint N |
| `mewrite models <subcmd>` | Manage model registry |
| `mewrite serve` / `attach` | Daemon mode |

Env: `ANTHROPIC_API_KEY` · `OPENAI_API_KEY` · `CAVE_CODING_AGENT_DIR` (config dir) · `CAVE_CACHE_RETENTION=long` (extended prompt cache).

</details>

---

## SDK

```typescript
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@zhachory1/mewrite-code";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage: AuthStorage.create(),
  modelRegistry: ModelRegistry.create(AuthStorage.create()),
});

session.on("message", (msg) => console.log(msg.role, msg.text));
await session.prompt("Refactor src/auth.ts to use the new TokenStore.");
```

Talk to a running daemon over HTTP / WS via [`@zhachory1/mewrite-sdk`](packages/sdk). [API reference →](docs/api.md)

TypeScript monorepo, 9 packages — full layout in [CLAUDE.md](CLAUDE.md).

---

## Acknowledgements

**Me Write Code is a heavy fork of [pi-code](https://github.com/badlogic/pi-code) by [Mario Zechner](https://github.com/badlogic).** We track upstream and contribute fixes back where generally useful.

| From `pi-code` (upstream) | Me Write Code's own work |
|---|---|
| Agent runtime · MCP scaffolding · provider OAuth · repo map · slash-command parser · settings manager · skills loader · edit-format renderers · TUI components | Caveman Mode (4-layer compression) · goal loop · plan mode · cavemem integration · `/tree` session branching · architect/editor split · honest-bench harness |

Also indebted to [Aider](https://aider.chat) (repo map + edit-format-per-model), [Claude Code](https://www.anthropic.com/news/claude-code) (settings/commands/skills/agents/`.mcp.json` formats — adopted verbatim, then extended), [Codex](https://github.com/openai/codex) (cave-as-MCP-server), [RTK](https://github.com/rtk-ai/rtk) (optional bash-output compression layer), and [Biome](https://biomejs.dev) (single-binary lint/format).

Missing credit? [Open an issue](https://github.com/Zhachory1/mewritecode/issues) — we'll fix it fast.

---

## License

MIT © [Julius Brussee](https://github.com/JuliusBrussee). Forked from [pi-code](https://github.com/badlogic/pi-code) (MIT © Mario Zechner).

<div align="center">

[Issues](https://github.com/Zhachory1/mewritecode/issues) · [Releases](https://github.com/Zhachory1/mewritecode/releases) · [Changelog](CHANGELOG.md) · [Docs](docs/index.md)

<sub>Caveman no waste token. Caveman ship.</sub>

</div>
