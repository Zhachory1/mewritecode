# Caveman Code UI — Hermes-Parity Components

**Status:** plan, 2026-04-28
**Scope:** ship the visible UI components hermes has that cave lacks. Build on top of caveman-code's existing `@caveman-code/tui` primitives (`Container`, `Box`, `Text`, `OverlayHandle`, `SidePanelHandle`, `SelectList`, `Markdown`, `DiffView`, `Loader`, `StatusLine`, sync-output, OSC-52, terminal-image, theme). **No new low-level primitives. No reactive layer. No mouse / ScrollBox / AlternateScreen rework.** Components subscribe to events and call `invalidate()` on the renderer cave already ships.

**Reference (MIT):** `~/.hermes/hermes-agent/ui-tui/src/components/` — patterns reproduced, no source copied. Each new file gets a `// inspired by hermes-agent (MIT)` comment where lineage is direct.

---

## Workstreams

| WS  | Component                            | Days | Depends on |
|-----|--------------------------------------|------|------------|
| C1  | Banner + session-panel (rock sprite) | 1    | —          |
| C2  | Status rule overhaul (face/ctx/spawn/duration) | 3 | — |
| C3  | Spinner library (thinking + tool variants) | 1 | —          |
| C4  | Tool-shelf grouping in streaming     | 2    | —          |
| C5  | Live-markdown progressive renderer   | 2    | —          |
| C6  | Approval prompt (preview + reason)   | 1    | —          |
| C7  | Clarify prompt (multi-choice + free) | 1    | C6         |
| C8  | Confirm prompt (Y/N + danger)        | 0.5  | C6         |
| C9  | Secret + sudo prompts (masked)       | 1    | C6         |
| C10 | Subagent overlay (F2)                | 5    | C2         |
| C11 | Sticky-prompt ribbon                 | 1    | —          |
| C12 | Skills hub overlay                   | 2    | —          |
| C13 | Autopilot HUD (cost/stall/runaway)   | 3    | C2, C10    |
| C14 | Queued-messages editor               | 1    | —          |

Total: ~24 dev days. Earliest ship: C1 / C3 / C6 / C11 (no deps).

---

## C1. Banner + Session Panel

**File:** `packages/coding-agent/src/modes/interactive/components/banner.ts`, `session-panel.ts`

Render as transcript-anchored intro rows (kind: `intro`), not one-shot startup print. Survives clear/scrollback.

**Layout** (matches Claude Code's banner shape, swaps creature for a stone):

```
╭───────────────────────────────────────────────╮
│   ▄████▄    Caveman Code  v2.0.0                      │
│  ████████   Opus 4.7 (1M context) · xhigh     │
│  ▀██████▀   /Users/julb/Desktop/GitHub/...    │
╰───────────────────────────────────────────────╯
```

**Sprite:** 3 rows × 8 cells, `theme.color.accent` (warm stone). Three variants via `theme.brand.sprite`:

- `rock` (default, plain stone):
  ```
   ▄████▄
  ████████
  ▀██████▀
  ```
- `rock-eyes` (caveman-pet whimsy):
  ```
   ▄████▄
  ██●  ●██
  ▀██████▀
  ```
- `rock-ascii` (legacy-terminal fallback):
  ```
   _####_
  |#    #|
   \####/
  ```

Auto-fall back to `rock-ascii` when `terminal-detect.ts` reports no block-glyph support.

**Right column:** line 1 bold accent (`Caveman Code  vX.Y.Z`); line 2 dim (`<model> (<context>) · <effort>`); line 3 dim cwd, truncated from left with `…/` prefix when wider than `cols - 14`.

**SessionPanel** (rendered immediately after banner, no border): `mode: <plan|edit|ask>`, `auth: <provider/account>`, `tip: <rotating>`. Same width; right column aligned with banner's text column.

---

## C2. Status Rule Overhaul

**File:** `packages/coding-agent/src/modes/interactive/components/status-rule.ts`

Replaces the current footer rendering. Existing `StatusLine.ts` stays as the Claude-Code-script backend mode. Container subclass; owns a snapshot, subscribes to agent events + delegation store + `setInterval(invalidate, 1000)` for the elapsed clock.

**Single line rendering** (top or bottom — setting `statusRule.position`):

```
─ (˃ᴗ˂) thinking… · 12s │ opus-4.7 xhigh │ 142k/1M │ [████████░░] 65% │ 4m 12s │ d2/5 ⚡3/7 │ $0.0143  ─  src/agent
```

**Pieces (left → right):**

1. **Face ticker** — emoji-face + verb cycling every 2.5s; elapsed since turn started, ticking each second. Faces from `content/faces.ts`, verbs from `content/verbs.ts` (~30/40 entries each, generic).
2. **Model label** — short form (`opus-4.7 xhigh`), normalized like hermes' `shortModelLabel` (strip vendor prefix, dotify version digits, append effort + `fast` flag).
3. **Context tokens** — `used/max` with `fmtK` formatting.
4. **Context fill bar** — `[██████░░░░] 65%`, 10 cells default. Color escalates: `<50` good, `50–80` warn, `80–95` bad, `>=95` critical (blink at `>=98`).
5. **Session duration** — `4m 12s`, ticking each second.
6. **SpawnHud** — only renders when descendants > 0 or paused: `d<depth>/<cap> ⚡<widestLevel>/<concCap>+<extraActive> ⏸`. Color escalates with `max(depthRatio, concRatio)`. `⚠` prefix at cap.
7. **Bg tasks count** — `2 bg` if any.
8. **Cost** — `$0.0143` if `showCost`.
9. **Cwd label** — right-aligned, truncated from left.

**Settings:** `statusRule.position: 'top'|'bottom'`, `showFaceTicker`, `contextBarCells`, `showCost`, `showDuration`.

**Acceptance:** legible at 80 / 100 / 200 cols; 95% context triggers red bar; SpawnHud appears during fan-out.

---

## C3. Spinner Library

**Files:** `packages/tui/src/spinners.ts`, `packages/tui/src/components/spinner.ts`

Frame data only (no external dep): `helix`, `breathe`, `orbit`, `dna`, `waverows`, `snake`, `pulse` (thinking variants); `cascade`, `scan`, `diagswipe`, `fillsweep`, `rain`, `columns`, `sparkle` (tool variants). Each `{ frames: string[], interval: ms }`. ~150 LOC.

`Spinner` Container takes `{ variant, color }`, runs its own `setInterval`, calls `invalidate()` per frame. Wired into `Loader`, tool execution row, and the face-ticker fallback.

Settings: `spinners.thinking`, `spinners.tool` (default `breathe` / `scan`).

---

## C4. Tool-Shelf Grouping

**File:** `packages/coding-agent/src/modes/interactive/components/tool-shelf.ts`

When the assistant emits `>= 2` sequential tool calls in one turn, collapse them into a one-line shelf:

```
▸ 4 tools · read · grep · edit · bash    (1.4s)
```

Click or `Ctrl+E` expands to the existing per-tool render. Expand state persists across stream chunks (don't auto-collapse if the user expanded mid-stream).

**Files to touch:** `tool-execution.ts` emits a `groupHint`; `streaming-assistant.ts` decides shelf vs inline based on `compact` mode + count.

---

## C5. Live-Markdown Progressive Renderer

**File:** `packages/tui/src/components/streaming-markdown.ts`

Existing `Markdown` renders complete strings. This wraps it for streamed input: tracks open code-fence / list / quote state across chunks; recovers if a chunk arrives mid-`**bold` or unfinished `[link`. On stream finalize, replaces partial render with full canonical markdown render (no flicker thanks to sync-output).

`assistant-message.ts` swaps its ad-hoc partial render for this.

---

## C6. Approval Prompt (with Preview + Reason)

**File:** `packages/coding-agent/src/modes/interactive/components/approval-prompt.ts`

OverlayHandle that captures focus until resolved. Replaces the visual layer of the existing `permission-prompt.ts` (logic / `chooseVerb` is unchanged).

```
╔════════════════════════════════════════════╗
║ ⚠ approval required · run shell command    ║
║   git push --force origin main             ║
║   … +2 more lines                          ║
║   ▸ reason: rebase rewrote published commits║
║                                            ║
║ ▸ 1. Allow once                            ║
║   2. Allow this session                    ║
║   3. Allow always                          ║
║   4. Deny                                  ║
║ ↑/↓ select · Enter confirm · 1-4 quick · ^C deny ║
╚════════════════════════════════════════════╝
```

**Pieces:**
- Double border, color = `theme.color.warn` (or `theme.color.error` if `danger: true`).
- Command preview: up to 10 lines, `… +N more lines` overflow indicator.
- Optional `reason` line (agent-supplied; falls back to a generic from the tool definition).
- 4-verb selector: arrow nav + 1–4 quick keys + `Ctrl+C` for instant deny.

**Plumbing:** `permission-prompt.ts:104,164` already invokes `ui.chooseVerb({...})`. Extend `PromptOptions` with `commandPreview: string`, `reason?: string`, `danger?: boolean`. Provide both at every existing call site.

---

## C7. Clarify Prompt

**File:** `packages/coding-agent/src/modes/interactive/components/clarify-prompt.ts` + `packages/agent/src/tools/clarify.ts`

New agent-callable tool: `Clarify({ question, choices? })` returns the user's selection or typed answer.

```
ask which test framework do you use here?
  ▸ 1. Vitest
    2. Jest
    3. Bun test
    4. Other (type your answer)
↑/↓ select · Enter confirm · 1-4 quick · Esc cancel
```

Selecting "Other" opens the caveman-code editor inline below the prompt. `Esc` from the typing state returns to the choice list (when choices exist) or cancels.

**Acceptance:** roundtrip works during a long autopilot turn — agent waits, user answers, agent receives string.

---

## C8. Confirm Prompt

**File:** `packages/coding-agent/src/modes/interactive/components/confirm-prompt.ts`

Y/N modal with `danger: true` flag (red double-border). Shape:

```
╔════════════════════════════════════════════╗
║ ⚠ Drop the local main branch?              ║
║   This cannot be undone.                   ║
║                                            ║
║   ▸ No                                     ║
║     Yes                                    ║
║ ↑/↓ select · Enter confirm · Y/N quick · Esc cancel ║
╚════════════════════════════════════════════╝
```

`Y` / `N` quick keys. Default selection always non-destructive (`No`). Used by destructive built-in tools and any plugin that opts in.

---

## C9. Secret + Sudo Prompts

**File:** `packages/coding-agent/src/modes/interactive/components/secret-prompt.ts`, `sudo-prompt.ts`

Masked input (`••••••`) for API keys, passwords, sudo tokens. Never echoed to TTY; not added to editor history; not persisted to `~/.cave/sessions/*.jsonl`. `Sudo` variant is labeled and audited (logged to `~/.cave/audit.log` with timestamp + tool requesting it, value redacted).

---

## C10. Subagent Overlay (F2)

**File:** `packages/coding-agent/src/modes/interactive/components/subagent-overlay.ts` + `packages/agent/src/subagent-tree.ts`

Rendered via `SidePanelHandle` (full-pane takeover). `F2` toggles. Subscribes to subagent runtime events; calls `invalidate()` per event + every 1s for live elapsed counters.

**Tree row format:**

```
01 ●   plan-architect              read·grep·glob×3      12s    8.4k tok   $0.012   ▁▂▃▅▇█▇▅
02   ✓   └─ research-tests          read×4               4.2s    2.1k tok   $0.003   ▁▁▂▂▁
03 ●     └─ run-tests               bash·read            6.0s    1.8k tok   $0.002   ▂▃▂▂▃▁
```

- Status glyphs: `●` running (amber), `○` queued (dim), `✓` completed (green), `■` interrupted (warn), `✗` failed (red).
- Sort modes (cycle with `s`): `spawn order` / `slowest` / `busiest` / `status`.
- Filter modes (cycle with `f`): `all` / `running` / `failed` / `leaves`.
- Hotness sparkline per row (heatmap palette, cold→hot bronze→amber→gold→warn→error).
- Actions: `i` interrupt selected; `p` pause/resume delegation (no new spawns); `Enter` open inline transcript view (sub-overlay); `q` / `F2` / `Esc` close.
- Spawn diff (`d <leftIdx>` then `d <rightIdx>`): two-snapshot delta of tokens / cost / duration.

**Library:** `subagent-tree.ts` — port of hermes' tree helpers (buildSubagentTree, treeTotals, widthByDepth, sparkline, hotness bucket). ~250 LOC pure functions.

**Runtime hooks:** `packages/agent/src/runtime.ts` emits `subagent:start|tool|complete|fail|interrupt`. New `packages/agent/src/delegation-store.ts` holds `maxSpawnDepth`, `maxConcurrentChildren`, `paused`. Read by both C2 (SpawnHud) and C10 (overlay).

---

## C11. Sticky-Prompt Ribbon

**File:** `packages/coding-agent/src/modes/interactive/components/sticky-prompt-tracker.ts`

When the user scrolls up past the most recent visible user message, render a one-line ribbon at the top of the transcript pane:

```
↳ refactor the auth module to use the new permission store
```

Dim color, single-line truncated. Disappears when scrolled back to bottom. Uses caveman-code's existing `scroll-buffer.ts` viewport state — no new ScrollBox needed; reads `scrollTop` and walks message offsets to find the most-recent-above-viewport user message.

---

## C12. Skills Hub Overlay

**File:** `packages/coding-agent/src/modes/interactive/components/skills-hub.ts`

Three-stage navigation built on caveman-code's existing `SelectList`:

1. **Category list** — bundled / user / project / marketplace.
2. **Skill list** — names with source tag (`[t]` / `[u]` / `[p]` / `[mkt]`).
3. **Action menu** — `i` inspect (show metadata), `x` install (to `~/.cave/skills/<name>`), `Esc` back.

Wires into existing skills loader. Slash command: `/skills` opens the overlay; `/plugins` reuses the same shell with the marketplace source.

Loading + error states. No new RPC layer needed — call into `skills_hub.ts` equivalent (use caveman-code's `skills-config.ts` or its planned WS5 successor).

---

## C13. Autopilot HUD

**File:** `packages/coding-agent/src/modes/interactive/components/autopilot-hud.ts` + `packages/coding-agent/src/core/autopilot.ts`

The headline component. Pinned panel above the C2 status rule when autopilot mode is engaged.

```
┌─ autopilot ────────────────────────────────────────┐
│ ▸ phase: implementing 4/12 tasks                    │
│ $1.23 / $5.00 budget (24%)  ·  142 / 200 tool calls │
│ d2/5 ⚡3/7  ·  no stall  ·  ⏵ running               │
└─────────────────────────────────────────────────────┘
```

**States the panel renders:**
- **Normal:** all metrics within bounds, `⏵ running`.
- **Stall warn (>= stallSec):** `⚠ stalled 18s` (yellow). `r` soft-restart, `i` interrupt.
- **Stall critical (>= 2× stallSec):** `⛔ stalled 60s, intervention recommended` (red).
- **Runaway suspected:** cost-per-task > `runawayMultiplier` × rolling 3-task median, OR depth/conc cap hit. Shows `⚠ runaway suspected` with one-key acknowledge / abort.
- **Budget breached:** auto-halt; offer rollback to last shadow-git checkpoint (WS17 dependency).
- **Paused:** `⏸ paused` (delegation store paused).

**Controller (`autopilot.ts`):**
- Caps: `maxCostUsd`, `maxDurationMin`, `maxToolCalls`. Hard cap → halt; soft cap (80%) → warn.
- Watchdog: every 5s, evaluate stall + runaway thresholds; emit events to HUD.
- Pause/resume composes the C10 delegation store.
- Auto-checkpoint: snapshot via WS17 shadow-git every N successful tool calls + before any destructive action; on runaway detection, offer `/rollback`.

**Slash commands:** `/autopilot on|off|status`, `/budget set <usd>`, `/halt` (hard stop).

**Settings:** `autopilot.maxCostUsd`, `autopilot.maxToolCalls`, `autopilot.stallSec`, `autopilot.runawayMultiplier`, `autopilot.autoCheckpoint`.

**Acceptance:** synthetic infinite-loop test → runaway HUD fires within 30s, autopilot halts at first cap; `Ctrl+C` once = pause; `Ctrl+C` twice = full halt + rollback prompt.

---

## C14. Queued-Messages Editor

**File:** `packages/coding-agent/src/modes/interactive/components/queued-messages.ts`

Caveman Code already has a queued-messages count. Extend to show the actual queue and let the user edit/remove pending entries before they send.

```
queued (3):
  1. add tests for the new validator
  2. ▸ then run the full suite           [editing]
  3. and commit if green
↑/↓ select · Enter edit · Del remove · Esc back
```

Triggered by `Ctrl+Q` or by clicking the count in the status rule. Backed by caveman-code's existing queue state.

---

## Settings Schema Additions

```jsonc
{
  "ui": {
    "compact": false,
    "stickyPrompt": true,
    "goodVibesHeart": false
  },
  "statusRule": {
    "position": "bottom",
    "showFaceTicker": true,
    "contextBarCells": 10,
    "showCost": true,
    "showDuration": true
  },
  "spinners": {
    "thinking": "breathe",
    "tool": "scan"
  },
  "autopilot": {
    "maxCostUsd": 5.00,
    "maxToolCalls": 200,
    "stallSec": 60,
    "runawayMultiplier": 3.0,
    "autoCheckpoint": true
  }
}
```

---

## Sequencing

```
C1  ─→ ship anytime
C3  ─→ ship anytime
C11 ─→ ship anytime
C14 ─→ ship anytime

C2 ─┐
    ├─→ C13 (autopilot HUD)
C10 ┘

C6 ─┬─→ C7 (clarify)
    ├─→ C8 (confirm)
    └─→ C9 (secret/sudo)

C4, C5 — independent streaming polish; ship as ready.
C12 — skills hub, independent.
```

Critical path to autopilot HUD: C2 + C10 in parallel → C13. ~8 days end-to-end.

---

## Acceptance — Project-Level

- [ ] Banner renders with rock sprite at first launch and after `clear`; `rock-ascii` variant on TERM=dumb.
- [ ] Status rule legible at 80 / 100 / 200 cols; SpawnHud appears mid-fan-out; context bar turns red at 95%.
- [ ] All four prompt types (approval, clarify, confirm, secret) capture focus, return cleanly on `Esc`.
- [ ] F2 opens subagent overlay during a 3-subagent run; `i` interrupts; `p` pauses.
- [ ] Autopilot HUD halts a runaway loop within 30s; rollback prompt appears.
- [ ] No new dependency on React, Ink, Yoga, or any external UI framework.
- [ ] Every component renders correctly with `NO_COLOR=1`.

---

## Out of Scope

- Mouse / wheel / scrollbar / AlternateScreen / NoSelect primitive work — caveman-code's existing TUI is enough.
- Virtual transcript / variable-row-height virtualization — defer until performance evidence demands it.
- Reactive shell / signals / JSX — explicitly not building.
- `interactive-mode.ts` rewrite — incremental swap-ins only, file stays.
