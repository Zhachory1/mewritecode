# Caveman Code core agent loop — walkthrough

## Process boot (`packages/coding-agent/src/main.ts` → modes)

`caveman` binary launch → resolve config/auth/model → pick mode:
- **interactive** (TUI, default) → `modes/interactive/interactive-mode.ts`
- **print** (`-p` one-shot) → `modes/print-mode.ts`
- **exec** (single command) → `modes/exec/`
- **rpc/serve** (daemon, IDE) → `modes/rpc/`, `cli/serve.ts`

Boot wires: `AgentSession` (`core/agent-session.ts`) + `Agent` runtime (`@caveman-code/agent`) + tools (`core/tools/`) + extensions/plugins/skills/MCP/hooks.

## Chat input dispatch (`interactive-mode.ts:2210` `setupEditorSubmitHandler`)

User hit Enter. Three branches:

1. **Built-in slash** (hardcoded `if` ladder lines 2215-2414): `/settings /model /export /import /share /copy /name /session /changelog /hotkeys /skills /plugins /fork /tree /login /logout /new /clear /compact /freeze /checkpoints /caveman /tokens /cost /reload /hooks /debug /resume /quit /mcp /memory /repomap /architect /recipe /checkpoint /rollback /plan /act` — handled in TUI, no LLM call.
2. **Bash escape** `!cmd` / `!!cmd` (excluded from ctx) → `handleBashCommand` direct shell.
3. **Everything else** → `session.prompt(text)` → LLM turn.

If unknown `/x` and no matching markdown/extension → error "not wired".

## `session.prompt` pipeline (`agent-session.ts:1396`)

1. **Extension command lookup** (`/foo` registered by extension) → run handler, return.
2. **`input` extension event** → may transform/swallow text.
3. **Skill expand** `/skill:name args` + **prompt template expand** (`expandPromptTemplate`).
4. **Markdown commands** (`.cave/commands/*.md`, `~/.cave/commands/*.md`, bundled, plugins) — Claude Code-compatible frontmatter (`allowed-tools`, `model`, `agent`, `context: fork`, `paths`, `shell`, `argument-hint`). Substitutions: `$ARGUMENTS $@ $0..N ${CAVE_SESSION_ID} ${CAVE_SKILL_DIR}`. Inline `` !`cmd` `` runs at expansion.
5. If streaming: queue as **steer** (inject before next assistant turn) or **followUp** (after agent would stop).
6. Compaction check on last assistant. Build user `AgentMessage` (text + images + pending nextTurn customs).
7. `before_agent_start` extension event — extensions can inject custom messages + override system prompt.
8. `agent.prompt(messages)` → enters `runAgentLoop` in `packages/agent/src/agent-loop.ts`.

## Core loop (`agent-loop.ts:155 runLoop`)

```
agent_start → turn_start
loop:
  turn_start (after first)
  inject pendingMessages (steers)
  streamAssistantResponse:
    transformContext (compaction, repomap injection)
    convertToLlm (AgentMessage[] → @caveman-code/ai Message[])
    getSystemPrompt (fresh per turn — supports plan-mode banner)
    toolFilter (plan mode: read-only gating)
    router.route(role) → resolve model
    streamSimple(model, ctx) → @caveman-code/ai provider
    emit message_start/update/end on text/thinking/toolcall deltas
  if toolCalls > 0:
    executeToolCalls (parallel default, sequential opt):
      prepareToolCall: validate args, beforeToolCall hook (block guard)
      tool.execute(id, args, signal, onPartial)
      afterToolCall hook (mutate result)
      emit tool_execution_start/update/end + toolResult message
    push toolResults → continue inner loop
  else: turn_end
  pendingMessages = getSteeringMessages()
  if no more tool calls and no steers:
    followUpMessages = getFollowUpMessages()  # queued continuations
    if any: continue outer; else exit
agent_end(messages)
```

Stops: `stopReason ∈ {error, aborted}` short-circuits; `maxTurns` cap; no tool calls + no steers + no follow-ups.

## What gets sent each turn (`core/system-prompt.ts:237 buildSystemPrompt`)

System prompt sections: cave identity → tone → tool guidance → bash/edit rules → cave-mode banner (if active) → CLAUDE.md hierarchy (root + cwd + parents) → repomap (PageRank) → skills index (when `read` tool present) → env (cwd, git status snapshot, branch, recent commits, OS, model id, knowledge cutoff, today's date) → docs paths.

Per turn fresh on demand: plan-mode read-only switch swaps tool list (`createReadOnlyTools` vs `createCodingTools`) + banners system prompt.

## Tools registered (`core/tools/index.ts`)

`read bash edit write grep find ls clarify task agent send_message task_status` + extension tools + MCP bridge (`mcp-bridge.ts`).

- `task` / `agent` — subagent spawn (Claude Code-compat). Defs in `core/agent-defs/`, registry `subagent-registry.ts`.
- `bash` — long-running, persistent shell semantics noted in prompt ("each call resets cwd").
- `edit` — diff-format edits, mutex via `file-mutation-queue.ts`.
- `clarify` — agent asks user inline.

## What happens with a plain message (no command)

```
user types "fix the auth bug"
  → onSubmit → not slash, not !
  → session.prompt(text)
     → no extension/skill/template match
     → AgentMessage{role:user}
     → agent.prompt → runAgentLoop
  → streamSimple to provider with tools attached
  → assistant streams text + tool calls (e.g. grep, read)
  → tools execute, results appended
  → loop until assistant stops calling tools
  → agent_end
```

Steering: while assistant streaming, user types more → queued; injected before next assistant response (steer) or after current turn ends (followUp via /act etc).

## Commands user can run

**Built-in (TUI-handled, no LLM)** — list above (lines 2215-2414).

**Markdown commands** — drop `.md` in `.cave/commands/` or `~/.cave/commands/` (Claude Code `~/.claude/commands/` works unchanged).

**Extension commands** — registered via `pi.registerCommand` in extensions; execute even mid-stream.

**Skill commands** — `/skill:<name> [args]` expanded inline.

**Prompt templates** — user/project templates, substituted at expansion.

**Bash escape** — `!cmd` runs in cwd, output joins context; `!!cmd` runs but excluded.

## Integrated subsystems

- **`@caveman-code/ai`** — provider unification (OpenAI, Anthropic, Google, Ollama, etc.), `streamSimple`, tool-call validation.
- **`@caveman-code/agent`** — `agentLoop`, state, router (role→model), checkpoints (shadow git), repomap (PageRank), compression, MCP client, subagent runtime, worktree, cost.
- **`@caveman-code/tui`** — diff renderer, Loader/spinner, components (chat, tool-execution, tool-group, footer, status).
- **MCP** — `core/tools/mcp-bridge.ts` + agent `src/mcp/` connect external servers, expose tools.
- **Hooks** — Claude Code-compat lifecycle (UserPromptSubmit, SessionStart, PreToolUse, PostToolUse, Stop) via `core/hooks/`, beforeToolCall/afterToolCall in loop config.
- **Extensions/plugins** — JS modules, register commands/tools/event handlers/system-prompt mutators.
- **Skills** — markdown w/ frontmatter, indexed in system prompt, lazy-load on trigger.
- **cavemem** — memory backend behind `/memory`, auto-loaded into system prompt section.
- **Plan mode** — `/plan` swaps to read-only tools + banner; `/act` restores edit tools, drains queued plan into next prompt.
- **Architect mode** — `/architect` splits into planner + editor models.
- **Recipes** — `/recipe` runs Goose-style YAML.
- **Checkpoints/rollback** — shadow git snapshots per turn or on-demand.
- **Compaction** — auto when ctx limit nears; `/compact` manual; `/freeze` cave-tuned checkpoint.
- **Caveman Code mode** — token compression layer.

Bottom line: TUI captures input → built-in slash short-circuits OR `session.prompt` → extension/skill/template/markdown command resolution → enqueue user msg → `runAgentLoop` streams from provider, executes tool calls in parallel, accepts steering mid-flight, exits when no more calls + no queue.
