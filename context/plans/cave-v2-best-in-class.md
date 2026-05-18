# Caveman Code v2 — The Best Terminal Coding Agent
**Master Plan · April 2026**

> Goal: take `caveman` from "interesting niche compression-focused CLI" to "best-in-class terminal coding agent that beats Claude Code, Codex, Aider, Cline, Crush, and opencode head-to-head".

---

## 0. Provenance & the "Use Pi First" Rule

**`caveman` is a heavy fork of `pi-code`.** `pi-code` is the original upstream (the codebase that became `caveman` after the `@cavepi/pi-* → @caveman-code/*` rebrand). Caveman Code has diverged with substantial original work — Caveman Mode 3-layer compression, CaveKit (now being removed), session branching, ambient theming, terminal-blend primitives, the proof-bench eval harness — but `pi-code` is still the parent project and continues to evolve in its own direction.

**Operating rule for every workstream below:** before building anything, **check whether `pi-code` already ships a module, an extension, or a plugin that does the job**. If yes, vendor it, depend on it, or wrap it — do not reimplement.

Concretely, before starting any WS:
1. Search the upstream `pi-code` repo for an equivalent feature, package, or extension.
2. Search the `pi-*` npm scope (e.g. `pi-mcp`, `pi-sandbox`, `pi-skills`, `pi-hooks`) for published modules.
3. Search `pi-code`'s extensions directory and any `pi-extensions` registry for community extensions.
4. **If a pi extension/module exists and is reasonably maintained → use it; integrate via `@caveman-code/agent`'s extension system.** Note "borrowed from pi" in the WS deliverable.
5. **If only partial coverage exists → vendor what fits, add cave-specific deltas on top.** Contribute fixes upstream where the change is generally useful.
6. **Only build from scratch when nothing usable exists in the pi ecosystem.**

This applies most obviously to: TUI components, provider OAuth flows, MCP scaffolding (already in `packages/agent/src/mcp/`, much of which likely came from pi-code), sandbox primitives, repomap, slash command parser, settings manager, skills loader, and edit-format renderers. It probably does **not** apply to: cavemem integration (cave-specific), Caveman Mode compression layers (already cave-specific), CaveKit teardown (cave-specific), or anything cave invented.

**Why this matters:** keeps caveman-code's diff against upstream small enough to occasionally rebase or cherry-pick from `pi-code`; saves us reimplementing primitives that already exist; ensures we ride pi-code's bug fixes and security updates instead of forking them silently.

---

## TL;DR

Caveman Code already has unusually strong foundations — 20+ provider unified API, 4-layer token compression, session branching, 7 core tools, scaffolded MCP + sandbox primitives in `packages/agent/`, 360+ passing tests across `agent` and `coding-agent`. The gap to best-in-class is **packaging and distribution of capabilities**, not architecture. We close it by:

1. **Killing CaveKit** (`packages/cavekit-extension`) and replacing it with native Plan-mode + Markdown skills (Claude Code-compatible).
2. **Wiring up the latent infra** — surface `packages/agent/src/{mcp,sandbox}/` to the user-facing CLI as first-class features.
3. **Adopting Claude Code's authoring formats verbatim** (settings.json, frontmatter, agent definitions) for instant ecosystem compatibility — copy-paste Claude Code skills/hooks/agents Just Work.
4. **Integrating cavemem natively** as the canonical memory backend via the user's existing MCP server + 5 hook stubs; caveman-code's value-add is the episodic→semantic consolidation pass.
5. **Stealing the proven differentiators** — Aider's repo map, Codex's sandbox-as-utility, Cline's model-emitted approval bits, opencode's daemon, Hermes' shadow-git checkpoints, Sketch's containerized parallel sessions.
6. **Investing in install/docs** — `curl | sh` canonical, self-updater, 4-question first-run wizard, VitePress docs site, 5 VHS demo recordings.

The work fans out into **19 workstreams across 3 phases**, with 11 of them runnable in full parallel after a 1-2 day Phase 1.

---

## 1. Strategic Decisions

### 1.1 Keep (load-bearing — protect at all costs)
- **`packages/coding-agent`** (`caveman` CLI) — the user surface
- **`packages/ai`** (`pi-ai`) — 20+ providers, OAuth flows, prompt caching. Best-in-class as-is
- **`packages/agent`** — runtime + event bus + sandbox/MCP scaffolding. Foundational
- **`packages/tui`** — already differential, color-depth detection
- **Caveman Mode** (3-layer compression, ~85% on tool output, $1.70-$6.92/session savings) — *the* unique differentiator
- **Session branching** (`/tree`, `/fork`) — no major competitor has this
- **20+ provider OAuth** (Claude Pro, ChatGPT, Copilot, Gemini, Antigravity) — unique
- **Multi-mode operation** (interactive, print `-p`, JSON, RPC) — competitive

### 1.2 Trim (de-prioritize, do not block v2 push)
- **`packages/web-ui`** — keep building independently, but it does not gate v2
- **`packages/mom`** (Slack bot) — separate product surface; stays as-is
- **`packages/pods`** (GPU deployment) — separate product surface; stays as-is

### 1.3 Kill (delete or extract to separate repo)
- **`packages/cavekit-extension`** — 7 `/ck:*` commands, build-site machinery, convergence tracking. Replaced by:
  - Plan mode (read-only exploration before edits) — Claude Code/Cursor/Codex/Gemini all have this
  - Markdown skills (auto-loaded descriptions, body-on-demand)
  - Plain markdown plans in `.cave/plans/`
  - Recipes as YAML in `.cave/recipes/` (Goose-style)
- All `/ck:*` commands become slash commands or skills built on the new primitives

### 1.4 Add
See workstreams §5–§7. Headline additions: native MCP, native sandboxing surfaced to CLI, 12-event hook system, Claude-Code-format markdown skills/commands/agents, plan mode, subagents with worktree isolation, repo map (Aider PageRank), cavemem integration, daemon + multi-client, shadow-git checkpoints, plugin marketplace, recipes, install + onboarding overhaul.

---

## 2. Design Principles

1. **Compatible Superset** — Adopt Claude Code's authoring formats (`settings.json`, command frontmatter, agent frontmatter, hook config) verbatim. A user paste of `~/.claude/commands/foo.md` into `~/.cave/commands/foo.md` Just Works. Free ecosystem.
2. **Progressive Disclosure** — Skill descriptions in context, bodies on invoke. MCP tools deferred behind ToolSearch by default. Always-on tool slice ≤ 2k tokens.
3. **Reversibility-Aware Permissioning** — Default highlighted button is "Allow once". Allow-always keys are normalized command shapes, not raw strings. Reversibility tier (read/edit/exec/network) drives default verb.
4. **Cache-Stable Layout** — `[tools] → [system] → [CLAUDE.md] → [pinned] → [history] → [user turn]`. Breakpoint after pinned context, never inside rolling history. 5-min TTL is the new default; pay the 1-hour TTL premium only for pinned project context.
5. **Hooks Are First-Class** — 12 lifecycle events, stdout-as-context pattern, deny via exit 2. Hooks > prompting for invariants.
6. **Cavemem Is the Memory Layer** — cave never reimplements embeddings/FTS/compression. Caveman Code owns *policy*: when to write, what to inject, episodic→semantic consolidation, MEMORY.md bridging.
7. **One Canonical Install Command** — `curl -fsSL https://getcaveman.dev/install | bash` at the top of the README, with everything else behind a disclosure.
8. **Defer Schemas, Lazy-Load Tools** — Anthropic ToolSearch reduced 85% of token bloat; we should match that immediately.

---

## 3. Caveman Code's Differentiation Story (post-v2)

| Axis | Caveman Code v2 | Claude Code | Codex | Aider | Crush | opencode |
|---|---|---|---|---|---|---|
| Token compression (3-layer Caveman Mode) | ✅ unique | ❌ | ❌ | repo map only | ❌ | ❌ |
| 20+ provider OAuth (Claude Pro / ChatGPT / Copilot / Gemini) | ✅ unique | Anthropic only | ChatGPT only | env keys only | subset | env keys |
| Session branching + fork | ✅ | ❌ | fork only | git only | ❌ | ❌ |
| Native MCP | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Native sandbox | ✅ | partial | ✅ best-in-class | ❌ | partial | partial |
| Plan mode | ✅ | ✅ | ✅ | architect | ❌ | ✅ |
| Repo map (PageRank) | ✅ | ❌ | ❌ | ✅ best-in-class | ❌ | ❌ |
| Edit-format-per-model | ✅ | ❌ | ❌ | ✅ best-in-class | ❌ | ❌ |
| Worktree-isolated subagents | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Daemon / multi-client | ✅ | ❌ | ✅ app-server | ❌ | ❌ | ✅ best-in-class |
| Shadow-git checkpoints + `/rollback N` | ✅ | ❌ | ❌ | git only | ❌ | ❌ |
| Containerized parallel sessions | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Cost transparency (per-msg $) | ✅ | partial | partial | ✅ best-in-class | ❌ | ❌ |
| MIT open source | ✅ | closed | Apache | Apache | FSL | MIT |

The pitch: **"Caveman Code is the only terminal coding agent that beats Claude Code on cost, Aider on context selection, Codex on provider flexibility, and opencode on session UX — in a single MIT-licensed binary."**

---

## 4. Workstream Map

```
PHASE 1 — Serial Cleanup (1–2 days)
└── WS1  Trim & Repo Hygiene   ◄── unblocks everything

PHASE 2 — Parallel Foundation + UX (10–12 workstreams concurrent)
├── WS2  MCP Native                  [MCP Builder]
├── WS3  Sandboxing & Permissions    [Security Engineer]
├── WS4  Hooks System                [Backend Architect]
├── WS5  Markdown Skills & Commands  [Backend Architect]
├── WS6  Subagents & Plan Mode       [AI Engineer]
├── WS7  Memory (cavemem) Integration [AI Engineer]
├── WS8  Repo Map & Edit Formats     [AI Engineer]
├── WS9  Daemon & Server/Client      [Backend Architect]
├── WS10 TUI Polish                  [Frontend Developer + UI Designer]
├── WS11 Install + Onboarding + Update [DevOps Automator]
├── WS12 Docs Site & Marketing       [Technical Writer + Visual Storyteller]

PHASE 3 — Ecosystem & Polish (parallel after foundations stabilize)
├── WS13 Plugin Marketplace          [Backend Architect]
├── WS14 Recipes                     [Backend Architect]
├── WS15 Provider Registry (Catwalk) [Backend Architect]
├── WS16 cave exec / CI mode         [DevOps Automator]
├── WS17 Shadow-Git Checkpoints      [Backend Architect]
├── WS18 Watch-Files / AI! Comments  [Senior Developer]
└── WS19 Cost Transparency Panel     [Frontend Developer]
```

Soft dependencies: WS5 (skills) → WS13 (marketplace), WS6 (plan mode) → WS11 (onboarding shows plan mode), WS4 (hooks) → WS7 (cavemem write hooks), WS8 (repo map) → WS5 (`/repomap` slash command). Everything else is independent.

---

## 5. Phase 1 — Serial Foundation Cleanup

> **Pi-check first (see §0):** before deleting cavekit-extension or any cave-specific code, confirm whether the equivalent already exists in upstream `pi-code` — if so, the deletion is automatically safe; if caveman-code's variant is genuinely original (Caveman Mode, terminal-blend, proof-bench), keep it.

### WS1: Trim & Repo Hygiene
- **Owner:** Software Architect + Senior Developer
- **Scope:** Remove `packages/cavekit-extension`. Move `packages/coding-agent/test/proof-bench/` (currently untracked) into a tracked location with passing CI. Delete `.cave/extensions/tps.ts`-style test crud where stale. Decide whether `mom`, `pods`, `web-ui` stay in monorepo or split out (recommend stay, but mark `core-v2` workspace as the v2 surface). Update top-level `CLAUDE.md` and `package.json` workspace list.
- **Deliverables:** clean `git status`, monorepo with 4 v2-core packages (coding-agent, ai, agent, tui) + clearly demarcated "out of scope for v2" packages, all tests green, fresh `npm run build`.
- **Files to touch:**
  - `packages/cavekit-extension/` → delete
  - `packages/coding-agent/src/core/slash-commands/ck-*.ts` → delete or migrate to recipes
  - `context/kits/` and `context/plans/build-site*` → archive to `context/archive/`
  - Top-level `CLAUDE.md` → update package table
  - `package.json` workspaces
- **Effort:** 1–2 days

---

## 6. Phase 2 — Parallel Foundation + UX

> **Pi-check first (see §0):** every WS below begins with "scan `pi-code` upstream + `pi-*` npm scope + pi extensions registry for an existing module that does this job". If found, vendor or wrap; do not reimplement. Note the provenance in the WS deliverable.

### WS2: MCP Native Integration
- **Owner:** MCP Builder agent
- **Scope:** Surface `packages/agent/src/mcp/{client,serve,acp}.ts` to the `caveman` CLI. Three transports: **stdio** (subprocess + JSON-RPC), **Streamable HTTP** (SSE deprecating mid-2026), **in-process** (zero-spawn for caveman-code's own tools). OAuth 2.1 + PKCE with two-tool pattern (`authenticate` returns OAuth URL, `complete_authentication` finalizes). Token cache in OS keychain (`keytar`). MCP tool namespacing as `mcp__<server>__<tool>`. Warm pool (idle servers SIGSTOP, resume SIGCONT). Defer schemas via ToolSearch by default.
- **Deliverables:** `caveman mcp add <name>`, `caveman mcp list`, `caveman mcp doctor`, `caveman mcp login <name>`, `caveman mcp remove`. Project `.mcp.json` + user `~/.cave/mcp.json` discovery. `caveman mcp-server` mode (cave as MCP server itself, like Codex).
- **Files to touch:**
  - `packages/agent/src/mcp/client.ts` (extend)
  - `packages/agent/src/mcp/transport/{stdio,http,inproc}.ts` (new)
  - `packages/coding-agent/src/core/tools/mcp-bridge.ts` (new)
  - `packages/coding-agent/src/core/slash-commands/mcp.ts` (new)
- **Effort:** 5–7 days

### WS3: Sandboxing & Permissions
- **Owner:** Security Engineer
- **Scope:** Promote `packages/agent/src/sandbox/{seatbelt,landlock,windows}.ts` to user surface. Define `SandboxPolicy` IR (tagged union: `read_only` | `workspace_write` | `danger_full_access`). On macOS: dynamic SBPL with `(deny default)` + `(allow file-write* (subpath cwd))` + per-host network via local CONNECT proxy. On Linux: bubblewrap + Landlock. On Windows: Restricted Tokens. Five permission modes (`default`, `plan`, `acceptEdits`, `auto`, `bypassPermissions`) cycled by Shift+Tab. Auto mode uses Haiku-class classifier with cached system prompt. 4-verb prompt with default-highlighted "Allow once". Allow-always persisted with normalized command keys to `.cave/permissions.json`.
- **Deliverables:** `caveman sandbox -- <cmd>` (sandbox-as-utility, Codex-style), `caveman debug sandbox`, `caveman execpolicy check`, all tools route through `SandboxPolicy` reducer.
- **Files to touch:**
  - `packages/agent/src/sandbox/policy.ts` (new — IR + reducer)
  - `packages/agent/src/sandbox/{seatbelt,landlock,windows}.ts` (extend)
  - `packages/agent/src/sandbox/proxy.ts` (new — local CONNECT proxy)
  - `packages/coding-agent/src/core/permission-prompt.ts` (rewrite)
  - `packages/coding-agent/src/core/slash-commands/sandbox.ts` (new)
- **Effort:** 7–10 days

### WS4: Hooks System
- **Owner:** Backend Architect
- **Scope:** Match Claude Code's 12 lifecycle events: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact`, `Notification`, plus `FileChanged`, `CwdChanged`. Use Claude Code's `settings.json` schema verbatim under `hooks` key (matchers + commands + decisions). PreToolUse synchronous + blocking with 30s timeout, returns `allow`/`deny`/`ask`/`defer`. PostToolUse async/advisory by default. **stdout-as-assistant-context** pattern (the killer feature). HTTP and LLM-prompt hook types as v2 stretch.
- **Deliverables:** `caveman hooks list`, `caveman hooks test <event>`, settings.json schema valid against Claude Code's, 4 default hook recipes shipped (auto-format on Edit, auto-test on Stop, conventional-commit gate, secret-scan PreToolUse for Write).
- **Files to touch:**
  - `packages/coding-agent/src/core/hooks/{registry,executor,events}.ts` (new)
  - `packages/coding-agent/src/core/settings-manager.ts` (extend hooks key)
  - `packages/coding-agent/src/core/slash-commands/hooks.ts` (new)
- **Effort:** 4–6 days

### WS5: Markdown Skills & Slash Commands
- **Owner:** Backend Architect
- **Scope:** Two filesystem locations + plugin namespace, fully Claude Code-compatible. Frontmatter: `name`, `description`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `model`, `effort`, `context: fork`, `agent`, `hooks`, `paths`, `shell`. Substitutions: `$ARGUMENTS`, `$0..$N`, `${CAVE_SESSION_ID}`, `${CAVE_SKILL_DIR}`, `${CAVE_EFFORT}`. Inline shell preprocessing via `` !`cmd` ``. Live filesystem watch for hot reload. Skills auto-loaded by description match (5k token cap when re-attached after compaction; 25k shared budget). Commands explicit via `/`. Discovery: project `.cave/commands/`, `.cave/skills/<name>/SKILL.md`, user-scope under `~/.cave/`.
- **Deliverables:** 10 default commands (`/commit`, `/test`, `/review`, `/explain`, `/fix-types`, `/perf`, `/sec-review`, `/clean`, `/log`, `/migrate`); 5 default skills migrated from `cavekit-extension/skills/`; existing TS extension API kept for richer behavior.
- **Files to touch:**
  - `packages/coding-agent/src/core/skills.ts` (rewrite — frontmatter parser, hot reload, progressive disclosure)
  - `packages/coding-agent/src/core/slash-commands.ts` (rewrite — markdown loader)
  - `packages/coding-agent/commands/*.md` (new — 10 defaults)
  - `packages/coding-agent/skills/*/SKILL.md` (new — defaults)
- **Effort:** 5–7 days

### WS6: Subagents & Plan Mode
- **Owner:** AI Engineer
- **Scope:** Native `Task` / `Agent` tool. Custom agents at `.cave/agents/<name>.md` and `~/.cave/agents/<name>.md`, frontmatter: `description`, `prompt`, `tools`, `disallowedTools`, `model`, `permissionMode`, `mcpServers`, `hooks`, `maxTurns`, `skills`, `effort`, `background`, `isolation: worktree|none`. Worktree isolation via `git worktree add .cave/worktrees/<id> <branch>`. Plan mode = read-only tools (Read/Glob/Grep + Bash with read-only allowlist), output ends in structured plan, user accepts → flips to `acceptEdits`. Per-subagent model tier; result-schema validation; up to 7 parallel via `Task`.
- **Deliverables:** `Task` and `Agent` built-in tools, `.cave/agents/` discovery, `caveman plan` shorthand, plan-mode permission profile, 5 default agents (`Explore`, `Reviewer`, `Tester`, `Implementer`, `Critic`).
- **Files to touch:**
  - `packages/agent/src/subagent.ts` (new)
  - `packages/agent/src/worktree.ts` (new)
  - `packages/coding-agent/src/core/tools/{task,agent}.ts` (new)
  - `packages/coding-agent/src/core/agent-defs/loader.ts` (new)
  - `packages/coding-agent/agents/*.md` (new)
- **Effort:** 7–10 days

### WS7: Memory (cavemem) Integration
- **Owner:** AI Engineer
- **Scope:** Add `MemoryProvider` interface in `@caveman-code/agent`. Two implementations: `CavememProvider` (default — talks to cavemem stdio MCP server + writes via `cavemem hook run`) and `FilesProvider` fallback (CLAUDE.md + plain `.cave/memory/*.md`). Wire 5 hook stubs (`session-start`, `user-prompt-submit`, `post-tool-use`, `stop`, `session-end`) using cavemem's `hook run` CLI. Surface 4 cavemem MCP tools (`search`, `timeline`, `get_observations`, `list_sessions`) as native cave tools. Session-start prelude runs `cavemem search "<task summary>"` and injects compact snippets. **Caveman Code's value-add: episodic→semantic consolidation pass** — `/memory consolidate` clusters observations by topic, asks Haiku for semantic facts, writes back as `kind:semantic` with provenance. Bridge to Claude Code's `~/.claude/projects/.../memory/MEMORY.md` (read on startup, `caveman memory sync --from claude` for one-shot import). Auto-install during `caveman init` if `cavemem` on `$PATH`.
- **Deliverables:** `/memory search|save|show|forget|export|consolidate|off|on|config|sync`, MemoryProvider interface, both providers, MEMORY.md bridge, **PR to `JuliusBrussee/cavemem` adding `caveman` IDE installer to `packages/installers/`**.
- **Files to touch:**
  - `packages/agent/src/memory/provider.ts` (new — interface)
  - `packages/agent/src/memory/cavemem.ts` (new — wraps cavemem MCP+CLI)
  - `packages/agent/src/memory/files.ts` (new — fallback)
  - `packages/coding-agent/src/core/slash-commands/memory.ts` (new)
  - `packages/coding-agent/src/core/memory-bridge.ts` (new — claude MEMORY.md import/export)
  - **External:** PR to `github.com/JuliusBrussee/cavemem` adding cave installer
- **Effort:** 5–7 days
- **Detail:** see §8

### WS8: Repo Map & Edit Formats
- **Owner:** AI Engineer
- **Scope:** Port `packages/agent/src/repomap/` to user surface. Tree-sitter parsers for TS/JS/Python/Go/Rust/Java/C++/Ruby/PHP. Build symbol graph (files = nodes, references = edges), run **PageRank with chat-state personalization** (added files, recently mentioned files = personalization vector). Send signatures only, body on demand. `--map-tokens` config (default 1k, dynamic expand when no files in chat). Per-model edit-format auto-selection (`whole`, `diff`, `diff-fenced`, `udiff`, `editor-diff`, `editor-whole`) backed by ablation results in `proof-bench/`. Architect/editor split as separate chat mode (`/architect`).
- **Deliverables:** `/repomap`, `/architect` mode, edit format defaults table, `--map-tokens` flag, `--edit-format` override, perf benchmark on 5 reference repos.
- **Files to touch:**
  - `packages/agent/src/repomap/{builder,pagerank,treesitter}.ts` (extend)
  - `packages/coding-agent/src/core/edit-formats/{whole,diff,udiff,editor}.ts` (new)
  - `packages/coding-agent/src/core/chat-modes/architect.ts` (new)
  - `packages/coding-agent/src/core/slash-commands/{repomap,architect}.ts` (new)
- **Effort:** 7–10 days

### WS9: Daemon & Server/Client (`caveman serve`)
- **Owner:** Backend Architect
- **Scope:** Headless HTTP daemon with OpenAPI-described endpoints + SQLite session store (opencode pattern). Multi-client attach (TUI + future desktop + future mobile against the same backend session). Sessions survive SSH drops and machine sleep. Generated TS SDK from OpenAPI. `caveman attach <session-id>`, `caveman list`, `caveman serve --port`. JSON-RPC over WS for low-latency token streaming (Codex app-server pattern). Worker-daemon registration for `&`-prefix cloud handoff: prepend `&` to any prompt and it's dispatched to a registered remote `caveman worker`; local terminal frees up; user `caveman attach <id>` later.
- **Deliverables:** `caveman serve`, `caveman attach`, `caveman worker {start,list,stop}`, `caveman list`, OpenAPI spec, generated TS SDK published as `@caveman-code/sdk`.
- **Files to touch:**
  - `packages/coding-agent/src/core/daemon/{server,client,protocol}.ts` (new)
  - `packages/coding-agent/src/cli/serve.ts` (new)
  - `packages/coding-agent/openapi.yaml` (new)
  - `packages/sdk/` (new package)
- **Effort:** 10–14 days

### WS10: TUI Polish & Differentiators
- **Owner:** Frontend Developer + UI Designer
- **Scope:** **DEC mode 2026 synchronized output** (`\e[?2026h`/`\e[?2026l`) — kills flicker, makes cave feel "fast". Subagent observability overlay (Hermes pattern — F2 key opens live tree of running subagents with current tool, token spend, elapsed; expandable to inline transcript). **Mid-session model swap with preserved context** (Crush pattern — `/model <name>` reformats transcript and continues). OSC-52 clipboard copy from TUI (works over SSH). Status line (Claude Code-style): pluggable via `command` field, JSON context piped in, ships with `detailed` default. Diff rendering: side-by-side ≥ 100 cols, unified otherwise, AAA contrast. Inline images via Kitty / iTerm2 / Sixel. Vim mode optional. "Chapters"-style transcript grouping (Gemini) — auto-fold turns by detected intent.
- **Deliverables:** sync output detect+emit, F2 subagent overlay, OSC-52 copy, mid-session model swap, configurable status line, vim mode, chapters folding.
- **Files to touch:**
  - `packages/tui/src/sync-output.ts` (new)
  - `packages/tui/src/components/{SubagentOverlay,Chapters,StatusLine,DiffView}.ts` (new)
  - `packages/coding-agent/src/modes/interactive/interactive-mode.ts` (extend)
- **Effort:** 7–10 days

### WS11: Install, Onboarding, Auto-Update, Doctor
- **Owner:** DevOps Automator
- **Scope:** **Canonical:** `curl -fsSL https://getcaveman.dev/install | bash` (or whatever domain we acquire). Self-updater binary checks GitHub releases API once/24h, downloads tarball, atomic replace, re-exec. Three release channels (`stable`, `beta`, `canary`). Detect package manager for `caveman update` (brew/npm/native). **First-run wizard:** 4 questions max — theme (auto-detect bg), auth (detect env keys, OAuth/API/skip), default model, telemetry off-by-default. Persist `hasCompletedOnboarding`. **`caveman doctor`** — kernel version, terminal capabilities, sandbox availability, MCP servers reachable, missing tooling. Cross-platform: macOS (Intel + ARM), Linux (x86 + ARM), Windows via WSL with native PS path as preview.
- **Deliverables:** `getcaveman.dev` install script, `caveman update` self-updater, first-run wizard ≤ 5s to interactive, `caveman doctor`, `homebrew-cave` tap freshened, `winget` manifest, Docker image, `caveman login --device-auth` for headless.
- **Files to touch:**
  - `installers/install.sh` (new — write to webserver root)
  - `packages/coding-agent/src/cli/{update,doctor,login}.ts` (new/extend)
  - `packages/coding-agent/src/onboarding/wizard.ts` (new)
  - `.github/workflows/release.yml` (extend — multi-arch binaries via Bun)
- **Effort:** 7–10 days

### WS12: Docs Site & Marketing
- **Owner:** Technical Writer + Visual Storyteller
- **Scope:** **VitePress** at `getcaveman.dev/docs` (free, fast, self-hostable). Sections: Quickstart, Install, Auth, Models, Tools, Slash Commands, Skills, Subagents, Memory (cavemem), MCP, Hooks, Permissions, Plan Mode, Daemon, Recipes, Troubleshooting, Migration from Claude Code/Codex/Aider, Cookbook, API. Ship `llms.txt` and per-page "Copy for LLMs" button. Algolia DocSearch (free for OSS). README rewrite per WS11 wizard pattern: logo + tagline, token-savings chart, single canonical install, **30s GIF**, Quick Start, "I want to..." router, comparison table, providers, monorepo bottom. **5 VHS recordings** (charmbracelet/vhs): (1) 30s install + first prompt, (2) cave-mode A/B vs Claude Code with token counter, (3) `/plan → /act` flow, (4) session branching `/tree`, (5) extension hot-load. Discord. Weekly changelog. Release notes auto-generated from conventional commits.
- **Deliverables:** `docs/` VitePress site, `installers/install.sh`, `README.md` rewrite, 5 VHS tape files in CI (re-record on tag), Discord linked from README, `CHANGELOG.md`, llms.txt, comparison page.
- **Files to touch:**
  - `docs/` (new)
  - `README.md` (rewrite)
  - `vhs/*.tape` (new)
- **Effort:** 7–10 days

---

## 7. Phase 3 — Ecosystem & Polish

> **Pi-check first (see §0):** every WS below begins with "scan `pi-code` upstream + `pi-*` npm scope + pi extensions registry for an existing module that does this job". If found, vendor or wrap; do not reimplement. Note the provenance in the WS deliverable.

### WS13: Plugin Marketplace
- **Owner:** Backend Architect
- **Scope:** Manifest at `.cave-plugin/plugin.json`. Plugin bundles `commands/`, `skills/`, `agents/`, `hooks/`, `.mcp.json`. Three marketplace scopes: repo (`.cave/plugins/marketplace.json`), personal (`~/.cave/plugins/marketplace.json`), remote (URL). Commands: `caveman plugin search`, `caveman plugin install <user/plugin>`, `caveman plugin marketplace add <url>`, `caveman plugin upgrade`. Built-in `$plugin-creator` skill scaffolds a manifest. Hub aspect (Continue-style): publish a complete cave config — model role assignments + rules + MCP servers + recipes + themes + skills.
- **Effort:** 7 days

### WS14: Recipes
- **Owner:** Backend Architect
- **Scope:** Goose-style YAML at `.cave/recipes/<name>.yaml`. Schema: `goal`, `tools` (allowed), `model`, `env`, `include` (subrecipes). `caveman run-recipe <name>`. Ship 10 built-ins: `migrate-deps`, `add-feature-flag`, `port-to-typescript`, `add-tests`, `bump-deps`, `extract-component`, `seo-audit`, `accessibility-audit`, `migrate-to-biome`, `release`.
- **Effort:** 4 days

### WS15: Provider/Model Registry (Catwalk-style)
- **Owner:** Backend Architect
- **Scope:** Externalize provider definitions from binary into a versioned JSON registry hosted at `github.com/cave-cli/registry`. `caveman models update` pulls latest. Community PRs add models without releasing cave. Local override via `~/.cave/registry.json`.
- **Effort:** 3 days

### WS16: `caveman exec` / CI Mode
- **Owner:** DevOps Automator
- **Scope:** `caveman exec <prompt>` non-interactive: `--json`, `--output-schema schema.json`, `--ephemeral` (ignore user config), `--skip-git-repo-check`, `--output-last-message <file>`, `--cwd`, `--model`, `--profile`. Idiomatic for GitHub Actions / GitLab CI. Stable JSON event stream on stdout. Exit codes documented.
- **Effort:** 4 days

### WS17: Shadow-Git Checkpoint Manager
- **Owner:** Backend Architect
- **Scope:** Hermes pattern. Real shadow git repo at `~/.cave/checkpoints/<repo-hash>`. Snapshot before every destructive tool call (write/edit/exec). `caveman rollback <N>` restores; `caveman rollback <N> --file <path>` for surgical revert. Integrate with worktree from WS6 so rollback never touches user's index. `/checkpoint <name>` for manual snapshots.
- **Effort:** 5 days

### WS18: Watch-Files / AI! Comments
- **Owner:** Senior Developer
- **Scope:** Aider pattern. `caveman --watch` polls repo for `// cave!` (fire), `// cave?` (Q&A), `// cave` (accumulate context). Trailing `!` triggers code edits with cwd + comment + surrounding lines as context.
- **Effort:** 3 days

### WS19: Cost Transparency Panel
- **Owner:** Frontend Developer
- **Scope:** Per-message inline `$0.0042 (cached: $0.0001)`, session-end summary. `/tokens` breaks down system / repomap / history / files / tool-results. Cache hit/miss reported. Weak/editor models priced separately. Persist daily/weekly $ totals. (`pi-ai` already tracks usage; just surface it.)
- **Effort:** 3 days

### Optional / stretch (cut if budget pressed)
- **Containerized parallel sessions** (Sketch pattern): `caveman run --container --parallel 3 <task>` spawns N Docker containers, each on `cave/<slug>-N` branch; UI picks winning diff to merge. **Effort: 7 days.** Defer to v2.1.
- **Encrypted-IPC sudo elevation**: Cursor pattern; password prompts via OS keychain / ssh-askpass, never crossing the model. **Effort: 4 days.** Defer to v2.1.
- **AGENTS.override.md directory-scoped overrides**: Codex pattern. **Effort: 2 days.** Could land with WS5.

---

## 8. Cavemem Integration Detail

`cavemem` (github.com/JuliusBrussee/cavemem, MIT, v0.1.3, ~195 stars) is the user's existing memory system. **Pipeline:** event → redact `<private>...</private>` → caveman-grammar compress → SQLite (FTS5) ↔ MCP queries. ~75% prose-token reduction, code/paths/URLs preserved byte-for-byte. Hybrid search: BM25 + local vectors (`Xenova/all-MiniLM-L6-v2`, alpha=0.5).

### 8.1 Integration architecture

```
caveman session
  ├── on session_start  ──► cavemem hook run session-start  (write)
  ├── on user_prompt    ──► cavemem hook run user-prompt-submit  (write)
  ├── on post_tool_use  ──► cavemem hook run post-tool-use  (write, async, non-blocking)
  ├── on stop           ──► cavemem hook run stop  (write)
  └── tools surfaced from cavemem MCP server (read):
        ├── search(query, limit?)         → top-k snippets
        ├── timeline(session_id, ...)     → session timeline
        ├── get_observations(ids[])       → expanded bodies on demand
        └── list_sessions(limit?)         → recent sessions
```

### 8.2 Caveman Code's value-add (not in cavemem)

- **Episodic→semantic consolidation**: nightly or `/memory consolidate` job clusters observations by topic, asks Haiku to extract semantic facts, writes them back as `kind:semantic` with provenance ids. Closes the loop most agents skip; what makes Letta/Zep feel "smart" — but local, deterministic, cheap.
- **Auto-trigger learning**: when a tool call fails twice and then succeeds, caveman-code writes a "lesson" observation (mirrors Claude Code Auto-Memory).
- **MEMORY.md bridge**: read `~/.claude/projects/<slug>/memory/MEMORY.md` first 200 lines into context on session start so cave behaves consistently when invoked alongside Claude Code; `caveman memory sync --from claude` imports per-fact `.md` files as cavemem observations.

### 8.3 PR upstream

Add `caveman` installer to cavemem's `packages/installers/`. The Installer interface already exists (Claude Code, Cursor, Codex, OpenCode, Gemini CLI). Caveman Code just becomes the 6th. Spawn Node explicitly so Windows survives `EFTYPE`.

---

## 9. Format Compatibility Strategy

Use Claude Code as the format authority where it makes sense. The user gets free ecosystem.

| Format | Source of truth | Caveman Code path | Notes |
|---|---|---|---|
| `settings.json` schema | Claude Code | `~/.cave/settings.json`, `.cave/settings.json` | Hook key + permissions key + statusLine identical |
| Slash commands | Claude Code | `.cave/commands/*.md`, `~/.cave/commands/*.md` | Frontmatter superset |
| Skills | Claude Code | `.cave/skills/<name>/SKILL.md` | Identical |
| Subagents | Claude Code | `.cave/agents/<name>.md` | Frontmatter superset |
| Hooks | Claude Code | inside `settings.json` `hooks` key | 12-event match |
| Project context | Multi-tool | `AGENTS.md` (Codex/Gemini/Crush), `CAVE.md` (cave-specific), `CLAUDE.md` (Claude Code), `.local` variants | Layered merge per Crush pattern |
| MCP config | MCP standard | `.mcp.json` | Codex-compatible |
| Plugins | Codex | `.cave-plugin/plugin.json` | Codex-compatible at root level |
| Memory | cavemem | `~/.cavemem/` (managed by cavemem) | + bridge to Claude Code MEMORY.md |
| Recipes | Goose | `.cave/recipes/<name>.yaml` | Goose-compatible |

The promise: **a user with existing Claude Code commands/skills/agents/hooks/MCP/CLAUDE.md drops in `caveman` with zero migration**. A user with Codex AGENTS.md and plugins ditto.

---

## 10. Sequencing & Parallelization

```
Day 0   : WS1 trim starts
Day 2   : WS1 done.  WS2-WS12 launch in parallel (one agent each)
Day 12  : Foundation phase done.  WS13-WS19 launch.
Day 19  : Ecosystem phase done.  Beta release.
Day 25  : Public 1.0 launch + docs site live.
```

**Critical path:** WS1 → (WS4 hooks) → WS7 cavemem (depends on hooks). WS5 skills → WS13 marketplace.

**Total wall-clock time** with 11 parallel agents in Phase 2 + 7 parallel agents in Phase 3 ≈ **3.5 weeks to public 1.0**, contingent on agent quality and cycle time.

---

## 11. Success Metrics

- **Token efficiency:** maintain 85%+ tool-output compression, $1.70-$6.92/session savings vs Claude Code on equivalent tasks (already proven).
- **Terminal-Bench:** match or beat Claude Code on the existing eval (research/evals/terminal-bench).
- **Install TTFP:** ≤ 25s from `curl ... | bash` to first interactive prompt on a clean machine.
- **First-run completion:** ≥ 80% of new users reach first prompt without abandoning.
- **Provider coverage:** 25+ providers + 6 OAuth flows working in CI.
- **Format compat:** 95%+ of Claude Code skills/commands/agents/hooks pasted into `~/.cave/` work unchanged.
- **Adoption proxies:** ≥ 1k GitHub stars in 30 days post-launch, ≥ 500 weekly active installs (telemetry opt-in), ≥ 10 third-party plugins on the marketplace.

---

## 12. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| 11 parallel agents step on each other's files | Strict workspace boundaries per WS (declared above); each agent works in its assigned directories. Reconciliation via small Phase 2.5 merge sprint. |
| cavemem upstream PR not merged in time | Vendor cavemem in `packages/cave-memory` as a fallback (MIT, allowed); switch to upstream when merged. |
| Claude Code format drift mid-build | Pin to Claude Code v2.1.119 schemas as source of truth; track schema delta in a CI check. |
| Sandbox bugs leak to user mid-build | Sandbox WS lands behind a `--sandbox=experimental` flag for first 2 weeks; flip default after 1k internal hours. |
| Daemon (WS9) is heavy and can slip | Cut to v2.1 if not done by Phase 2 end; ship v2.0 as TUI-only. |
| Telemetry backlash | Default off, opt-in with one-screen explainer; never enable post-install upgrade. |
| Containerized parallel sessions deferred | Document as "v2.1 roadmap"; ship now via subagents-with-worktrees as the proxy. |

---

## 13. First Sprint Recommendation

If we have to pick **one week of work to maximize signal**:

1. **WS1 trim** (Mon): cut cavekit-extension, get clean tree.
2. **WS2 + WS3 + WS4 + WS5** in parallel (Mon→Fri): MCP, sandbox, hooks, markdown skills/commands. These are the "instant ecosystem compatibility" layer — landing them lets Claude Code users try caveman with zero migration.
3. **WS11 install + WS12 docs** in parallel (Mon→Fri): canonical install, first-run wizard, VitePress site, comparison table, README rewrite.

After this sprint: cave looks and feels like Claude Code for someone with an existing setup, but cheaper. That's the strongest narrative for adoption.

Then in week 2: WS6 subagents, WS7 cavemem, WS8 repomap. Then in week 3: daemon + ecosystem.

---

## Appendix A — Agent Assignment Matrix

| WS | Agent type | Why |
|---|---|---|
| WS1 | Software Architect + Senior Developer | Deletion + careful migration |
| WS2 | MCP Builder | Domain match |
| WS3 | Security Engineer | Sandboxing is security-critical |
| WS4 | Backend Architect | Lifecycle events + matchers |
| WS5 | Backend Architect | File/parser/registry work |
| WS6 | AI Engineer | Plan mode + agent loop reasoning |
| WS7 | AI Engineer | Memory consolidation reasoning |
| WS8 | AI Engineer | PageRank tuning + edit format ablations |
| WS9 | Backend Architect | OpenAPI + JSON-RPC + SQLite |
| WS10 | Frontend Developer + UI Designer | TUI rendering, visual polish |
| WS11 | DevOps Automator | Multi-platform install, CI |
| WS12 | Technical Writer + Visual Storyteller | Docs + GIFs |
| WS13 | Backend Architect | Marketplace + manifest |
| WS14 | Backend Architect | YAML schema + runner |
| WS15 | Backend Architect | Registry hosting |
| WS16 | DevOps Automator | CI ergonomics |
| WS17 | Backend Architect | Git plumbing |
| WS18 | Senior Developer | File watcher + parser |
| WS19 | Frontend Developer | Surfacing existing data |

---

*This plan is intentionally aggressive but grounded in caveman-code's existing scaffolding (sandbox/, mcp/, repomap/, agent loop, 360+ tests). Each workstream is independently shippable and reversible — none of the foundational architectural decisions are bet-the-company.*
