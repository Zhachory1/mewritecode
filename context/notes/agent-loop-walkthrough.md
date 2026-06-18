# Agent Loop Walkthrough

> Read this first when touching the loop. It traces the real path from CLI boot
> to event emission, with file:line anchors into the current code. When the loop
> misbehaves, jump to **Debugging the loop with `CAVE_TRACE`** at the bottom.

This is the load-bearing control path: how a keystroke in the terminal becomes
an LLM request, tool calls, and a stream of typed events that drive the UI.

## The path at a glance

```
caveman (bin)
  → main.ts                              boot, arg parse, mode dispatch
    → InteractiveMode (modes/interactive/interactive-mode.ts)
        subscribeToAgent()  → session.subscribe(handleEvent)
        on Enter           → session.prompt(userInput)
          → AgentSession.prompt()        (core/agent-session.ts)
              → agent.prompt(messages)   (packages/agent/src/agent.ts)
                  → runAgentLoop(...)    (packages/agent/src/agent-loop.ts)
                      → runLoop()        turn loop: stream → tools → repeat
                          → emit(event)  → Agent.processEvents()
                              → reduce state, then fan out to listeners
                                  → AgentSession._handleAgentEvent
                                      → session listeners (UI, CAVE_TRACE sink)
```

## 1. Boot — `caveman` → `main.ts`

The `caveman` / `caveman-code` bin lands in
`packages/coding-agent/src/main.ts`. `main()` parses argv (`cli/args.ts`),
resolves an `AppMode` (`interactive` | `print` | `json` | `rpc`), handles
fast-path subcommands (`doctor`, `login`, `models`, `mcp`, `migrate`, `exec`,
…) that never load the agent runtime, then for the agent modes builds a
session via the SDK.

Session construction is centralized in `core/sdk.ts` `createAgentSession()`,
which `new AgentSession(...)` at `sdk.ts:414` and awaits `session.whenReady`.
Interactive mode wraps the session in an `AgentSessionRuntime`
(`core/agent-session-runtime.ts`) so `/new`, `/resume`, `/fork`, and import can
rebuild the session from the same factory.

There is exactly **one** `AgentSession` instance per live session, and every
prompt flows through it — which is why it is the right place to attach a passive
trace sink (see §6).

## 2. Dispatch — `InteractiveMode`

`modes/interactive/interactive-mode.ts` owns the TUI and delegates all business
logic to the session. Two wiring points matter:

- **`subscribeToAgent()`** (`interactive-mode.ts:2678`) calls
  `this.session.subscribe(handleEvent)`. This is the UI's single subscription to
  the session event stream. `handleEvent()` switches on
  `AgentSessionEvent.type` to update the footer, render messages, manage
  spinners, and handle retries.
- **Enter handling** calls `this.session.prompt(userInput)` (and the
  `initialMessage` variant for `-p` / piped input) around
  `interactive-mode.ts:841-861`.

Print / RPC / JSON modes use the same `session.prompt()` entry — they differ
only in rendering, not in the loop.

## 3. `AgentSession.prompt()` — the host seam

`core/agent-session.ts` `prompt(text, options)` (`agent-session.ts:1790`) is the
host-level entry. Before handing off to the runtime it does the heavy lifting
that the bare `Agent` does not know about:

- awaits `whenReady` (tool wiring, base system prompt, extension setup),
- expands slash/prompt templates and skill blocks, attaches queued "asides",
- applies chat-mode (plan/act) tool gating and system-prompt banners via
  `agent.toolFilter` / `agent.getSystemPrompt`,
- wires `agent.beforeToolCall` / `agent.afterToolCall` for checkpoints, hooks,
  and approval policy,
- installs `transformContext` for soft compaction / repomap / memory injection.

It then calls `this.agent.prompt(messages)` (`agent-session.ts:1941`). The
session is a **passive observer** of the resulting event stream: it subscribed
to the agent once in its constructor (`agent-session.ts:513`,
`this.agent.subscribe(this._handleAgentEvent)`), and `_handleAgentEvent`
re-emits each event to its own listeners (UI, extensions, persistence, and the
`CAVE_TRACE` sink) while also persisting messages on `message_end`.

## 4. `Agent.prompt()` → `runAgentLoop` — the runtime

`packages/agent/src/agent.ts` is the stateful runtime wrapper. `prompt()`
(`agent.ts:350`) rejects re-entrant calls (use `steer()` / `followUp()` to
queue), normalizes the input to `AgentMessage[]`, then `runPromptMessages()`
(`agent.ts:409`) calls `runAgentLoop()` with:

- a context snapshot (`systemPrompt`, a copy of `messages`, a copy of `tools`),
- a loop config (model, router/role, reasoning, transport, timeouts, maxTurns,
  the tool hooks, `convertToLlm`, `transformContext`, `getApiKey`),
- an `emit` callback that is just `(event) => this.processEvents(event)`,
- the active run's abort signal and the `streamFn`.

`processEvents()` (`agent.ts:537`) is the reducer + fan-out: it first updates
`_state` for the event (`streamingMessage`, `pendingToolCalls`, pushes finished
messages on `message_end`, records `errorMessage` on a failed `turn_end`), then
awaits every subscriber in registration order (`agent.ts:581`). Listener
promises are part of run settlement — the agent only becomes idle after
`agent_end` listeners resolve.

## 5. `runAgentLoop` → `runLoop` — the turn machine

`packages/agent/src/agent-loop.ts` is the pure loop. `runAgentLoop()`
(`agent-loop.ts:129`) seeds the transcript with the new prompts, emits
`agent_start`, an opening `turn_start`, and `message_start`/`message_end` for
each prompt, then enters `runLoop()` (`agent-loop.ts:189`).

`runLoop` is two nested loops:

- **Outer loop** restarts when queued follow-up messages arrive after the agent
  would otherwise stop.
- **Inner loop** drives turns while there are more tool calls or pending
  steering messages, bounded by `maxTurns`. Each turn:
  1. emits `turn_start` (the first turn's `turn_start` was already emitted by
     `runAgentLoop`),
  2. streams an assistant response — `message_start`, then a burst of
     `message_update` (one per stream delta), then `message_end`,
  3. executes any tool calls — `tool_execution_start`,
     `tool_execution_update*`, `tool_execution_end` per call (parallel or
     sequential per `toolExecution`); `checkpoint_taken` may precede a mutating
     call,
  4. emits `turn_end` carrying the finished assistant `message` (with `usage`)
     and the `toolResults`.

When no more tool calls or steering/follow-up messages remain, the loop emits
`agent_end` with the full `messages` array and returns.

## 6. The event taxonomy + where to tap it

The typed union is `AgentEvent` in `packages/agent/src/types.ts:386`. The
session widens it to `AgentSessionEvent`
(`core/agent-session.ts:145`) with session-level variants: `queue_update`,
`compaction_start` / `compaction_end`, `auto_retry_start` / `auto_retry_end`.

Key facts for instrumentation:

- **Turn boundaries:** `turn_start` and `turn_end`. Wall-clock between them is
  per-turn latency. `turn_end.message` is the assistant message; `turn_end`
  also carries `toolResults`.
- **Token usage** rides on the `AssistantMessage.usage` object
  (`packages/ai/src/types.ts:167`): `input`, `output`, `cacheRead`,
  `cacheWrite`, `totalTokens`, plus a `cost` breakdown. It is present on the
  `message` field of `message_start` / `message_end` / `turn_end` for assistant
  messages.
- **Cleanest seam:** subscribe to the session, not the bare agent. Two public
  subscription points exist:
  - `Agent.subscribe(listener)` (`agent.ts:254`) — raw `AgentEvent` stream,
    listeners awaited as part of run settlement.
  - `AgentSession.subscribe(listener)` (`agent-session.ts:1500`) — the full
    `AgentSessionEvent` stream, fire-and-forget, multi-listener. **This is the
    seam the trace sink uses**: it sees everything the UI sees, including
    compaction/retry, without being load-bearing for run settlement.

## Debugging the loop with `CAVE_TRACE`

`CAVE_TRACE` is an opt-in, passive JSONL trace of the live event stream
(`core/trace.ts`). Default OFF: when the env var is unset, the session never
subscribes a trace sink and there is zero overhead (verified by the unit test
"does not subscribe when CAVE_TRACE is unset").

### Enable it

```bash
# Default path: ~/.cave/trace/<sessionId>-<ts>.jsonl
CAVE_TRACE=1 caveman

# Or an explicit file path
CAVE_TRACE=/tmp/loop.jsonl caveman
```

`1` / `true` / empty resolve to the default `~/.cave/trace/...` path
(`resolveTracePath` in `trace.ts`); anything else is treated as a literal file
path. The sink is attached in the `AgentSession` constructor
(`agent-session.ts`, gated on `process.env.CAVE_TRACE`) by subscribing to the
session's own event stream — so it captures the real stream regardless of entry
point (interactive / print / rpc) and is torn down in `dispose()`.

### What it emits

One JSON object per line. Every line has `ts` (wall-clock ms) and `type` (the
event type), plus salient per-type fields:

| Event | Extra fields |
|-------|--------------|
| `turn_start` | — (marks the wall-clock start of a turn) |
| `turn_end` | `turnDurationMs` (since the matching `turn_start`), `role`, `toolResultCount`, `tokenDelta?` |
| `message_start` / `message_end` | `role`, `tokenDelta?` |
| `tool_execution_start` | `toolName`, `toolCallId` |
| `tool_execution_end` | `toolName`, `toolCallId`, `isError` |
| `agent_end` | `messageCount` |
| `checkpoint_taken` | `checkpointId`, `toolName`, `fileCount` |
| `subagent_progress` | `subagentName`, `phase`, `detail?` |
| `compaction_start` / `compaction_end` | `reason`, (`aborted`, `willRetry` on end) |
| `auto_retry_start` / `auto_retry_end` | `attempt`, `maxAttempts`/`success` |

`tokenDelta` is the increase in cumulative `usage.totalTokens` since the
previous usage-bearing event — so summing `tokenDelta` reconstructs total token
spend, and per-turn deltas show where tokens go. Streaming noise
(`message_update`, `tool_execution_update`) is **skipped** to keep the log
readable; the sink writes nothing for those events.

The sink swallows its own I/O errors: a broken trace file never breaks the loop.

### Read it

```bash
# Per-turn latency
jq 'select(.type=="turn_end") | {turnDurationMs, tokenDelta}' ~/.cave/trace/*.jsonl

# Which tools ran, and which errored
jq 'select(.type=="tool_execution_end") | {toolName, isError}' /tmp/loop.jsonl

# Total tokens spent (sum of deltas)
jq -s 'map(.tokenDelta // 0) | add' /tmp/loop.jsonl

# Spot a slow turn (>10s)
jq 'select(.type=="turn_end" and .turnDurationMs > 10000)' /tmp/loop.jsonl
```

Because the format is one event per line, `tail -f` on the trace file gives a
live, low-noise view of the loop while it runs.

### Where the code lives

- Pure serializer + path resolver + sink factory: `core/trace.ts`
  (`formatTraceLine`, `resolveTracePath`, `createTraceSink`).
- Unit tests (serialization + sink, fs mocked): `core/__tests__/trace.test.ts`.
- Wiring (gated on `CAVE_TRACE`, torn down in `dispose()`):
  `core/agent-session.ts` constructor.
