# Design Doc: Live Token-Savings Meter

- Status: draft (pre-review)
- Author: Zhachory Volker
- Date: 2026-06-12
- Implements: [PRD.md](./PRD.md) — **§9 (authoritative)**. Closes #12.

## 1. Summary

A session-scoped `SavingsTracker` accumulates provenance-tracked savings, fed from the data already in scope at the cave compression site + per-message provider usage. Surfaced as `/savings`, a session-end line, and cumulative persistence (the screenshot). Three honesty buckets (PRD §9.1): **caveman context-saved** (headline) = dedup + structured + general compression; **provider cache-reuse** (separate, labeled); **excluded** = truncation/RTK/output-terseness. Count once per event (PRD §9.2). StatusLine segment is a Should/fast-follow.

## 2. Data model

```ts
// packages/coding-agent/src/core/savings-tracker.ts
export type SavingsSource = "dedup" | "structured" | "general"; // caveman headline sources
export interface SavingsTotals {
  tokensSaved: number;          // caveman context tokens eliminated (≈ chars/4)
  dollarsSaved: number;         // tokensSaved × current input rate
  originalTokens: number;       // baseline for %-compressed (sum of pre-compression estimates)
  bySource: Record<SavingsSource, { tokens: number; dollars: number }>;
  cacheReuseDollars: number;    // SEPARATE provider-feature line, NOT in dollarsSaved
}
export class SavingsTracker {
  recordCompression(source: SavingsSource, originalChars: number, keptChars: number, inputRatePerMTok: number): void;
  recordCacheReuse(cacheReadTokens: number, inputRatePerMTok: number, cacheReadRatePerMTok: number): void;
  totals(): SavingsTotals;
  percentCompressed(): number;  // tokensSaved / originalTokens (caveman sources only)
  reset(): void;
}
```
- `recordCompression`: `savedChars = max(0, originalChars - keptChars)`; `tokens = round(savedChars/4)`; `dollars = tokens * rate/1e6`; accrue into total + bySource + `originalTokens += round(originalChars/4)`. **Once per event.**
- `recordCacheReuse`: `cacheReuseDollars += cacheReadTokens * (inputRate - cacheReadRate)/1e6`. Kept OUT of `dollarsSaved`.
- Pricing: use the model **at event time** (`session.model.cost.input`, `.cacheRead`, per-million). Tokens stored rate-independent; dollars computed at event.

## 3. Capture sites (no new estimation where a real delta exists)

### Caveman compression (headline) — `agent-session.ts afterToolCall` (~529-650)
At each compression step the original and processed content are both in scope:
- **dedup** (~538-575): `recordCompression("dedup", fullText.length, stubLength, rate)`.
- **structured** (JSON/XML, ~the structured step): `recordCompression("structured", originalChars, compressedChars, rate)`.
- **general** cave compression (~the general step): `recordCompression("general", beforeChars, afterChars, rate)`.
Use the char length of the specific block transformed (disjoint per PRD §9.3 — each step measures its own input→output; truncation is NOT a step here and is excluded). Guard: only when `getCaveModeEnabled() && getCaveModeToolCompression()` (the steps already run under this gate).

### Cache-reuse (separate line) — per assistant message
Where each assistant message finalizes with `usage` (the same place `getSessionStats` reads), call `recordCacheReuse(usage.cacheRead, model.cost.input, model.cost.cacheRead)`. Simplest: compute in `getSessionStats`-adjacent accumulation OR a per-message hook in agent-session when a message completes. Avoid double-add: record once per message (track last-recorded message index, or compute cache-reuse as a pure function of the message list in `totals()` rather than accumulating — **preferred**: derive cacheReuseDollars from the message list on read, like getSessionStats does, so it can't double-count).

> Decision: compression savings are EVENT-accumulated (the original bytes aren't retained post-compression); cache-reuse is DERIVED-on-read from message usages (idempotent). Two mechanisms, each chosen for correctness.

## 4. Surfaces

### F4 `/savings` (new slash command)
`core/slash-commands/savings.ts` (pure formatter) + `handleSavingsCommand` in interactive-mode. Renders:
```
Context saved by Caveman this session
  dedup         ≈ 4.2k tok   ~$0.013
  compression   ≈ 1.1k tok   ~$0.004     (structured + general)
  total         ≈ 5.3k tok   ~$0.017     (≈ 31% of tool context compressed)
Prompt cache reuse (provider feature)     ~$0.42
Cumulative: ~$0.17 this week · ~$1.90 all-time
Note: measured context elimination (dedup + compression). Excludes output terseness (no baseline) and truncation (deferred to temp file).
```
Register in `BUILTIN_SLASH_COMMANDS` + wire the handler (the `/tokens` handler is the pattern; do NOT reuse its unwired bucket path).

### F6 session-end line — `interactive-mode.ts printAndPersistSessionCost` (~6040) + `cost-formatter.ts`
After the existing `Session cost: …` line, add via `formatSessionEndSummary` (extend it, or a sibling `formatSavingsLine`):
```
Caveman saved ≈5.3k tok of context (~$0.017) · ~$1.90 all-time
```
Only when `tokensSaved > 0`.

### F7 cumulative persistence (Must) — `cost-persistence.ts` (~88-131)
Extend the `~/.cave/cost-totals.json` record (atomic-rename already there) with `savings: { tokens, dollars }` daily/weekly/all-time aggregates; increment in `persistSessionCost` alongside cost. `/savings` + session-end read the weekly/all-time figure.

### F5 StatusLine (Should / fast-follow) — `tui/StatusLine.ts` + `interactive-mode.ts resolveStatusLine` (~6078)
Extend `StatusLineContext.cave` with `savedTokens?/savedDollars?`; render `· saved ≈Xk` in `renderDetailed` when > 0; populate from `session.getSavings()` in `resolveStatusLine`. Implement if time permits this cycle; otherwise defer (does not block F1/F4/F6/F7).

### S-share (Should) `/savings --share`
Copyable one-liner: `🪨 Caveman compressed N% of my tool context this session (~Xk tokens saved). caveman-code` — percentages travel.

## 5. Edge cases
| Case | Handling |
|------|----------|
| Cave mode off | compression steps don't run → no compression savings; cache-reuse still derived (it's provider-level). `/savings` shows $0 caveman + the cache line. |
| Model switched mid-session | $ computed at event time with then-current rate; tokens rate-independent. cache-reuse derived per-message uses each message's model? (use the session's pricing-by-message if available; else current model — acceptable, note it). |
| originalTokens == 0 | `percentCompressed()` returns 0 (guard divide-by-zero). |
| compression made it bigger (kept>original) | `max(0, …)` → 0 saved (never negative). |
| no compression all session | `tokensSaved==0` → session-end savings line omitted; `/savings` shows the honest zero + provider cache line. |
| session reset / new session | tracker.reset(); cumulative persistence unaffected. |

## 6. Files
- NEW `core/savings-tracker.ts` + test.
- NEW `core/slash-commands/savings.ts` (formatter) + test.
- `core/agent-session.ts` — own `SavingsTracker`; feed compression at `afterToolCall`; derive cache-reuse; `get savings()` / `getSavings()`.
- `core/cost-formatter.ts` — savings line formatter + test.
- `core/cost-persistence.ts` — cumulative savings aggregate.
- `interactive-mode.ts` — `handleSavingsCommand`, session-end savings line, (Should) statusline.
- `core/slash-commands.ts` (or wherever BUILTIN_SLASH_COMMANDS lives) — register `/savings`.
- (Should) `tui/StatusLine.ts`.

## 7. Testing
- **savings-tracker.test.ts:** recordCompression accrues tokens/$/bySource + originalTokens; max(0) on negative; recordCacheReuse into separate field (NOT dollarsSaved); percentCompressed (incl. /0 guard); reset.
- **Derivation correctness:** cache-reuse derived from a message list is idempotent (compute twice → same), and equals `Σ cacheRead×(rateΔ)`.
- **Reconciliation (the ±5% metric):** given a fixed (original,kept) pair, tokens == round((orig-kept)/4) and $ == tokens×rate/1e6 — exact, hand-checkable.
- **savings.ts formatter:** headline-only total (cache-reuse on its own line, NOT summed); zero-state; % shown.
- **Integration:** drive afterToolCall with a dedup + a compression event (mock) → tracker totals; session-end line appears only when >0.
- **cost-persistence:** savings aggregate increments + reads weekly/all-time.

## 8. Rollout
Branch `feat/savings-meter`, staged commits (tracker → capture → /savings → session-end → persistence → [statusline]). No flag — purely additive. caveman linked for live smoke (run a session with a big bash output + a re-read → /savings shows non-zero).

## 9. Open questions for review
- OQ-A cache-reuse pricing when model changed mid-session: per-message model pricing vs current — is per-message available cheaply (does the message carry its model)? (Grounding: each AssistantMessage has `model` + `usage.cost` already computed by the provider — so use the message's OWN `usage.cost`-implied rates / or just sum the already-computed cost deltas. Likely we can derive cache-reuse $ directly from `usage.cost.cacheRead` vs a hypothetical input cost. Confirm.)
- OQ-B Is `afterToolCall` the only compression site, or can compression also happen in soft-compaction (context pruning) that we'd want to count? (Grounding flagged soft-compaction — decide if in scope; lean: v1 = tool-output compression only.)
- OQ-C `/tokens` is unwired (separate bug) — fix here or leave? (Lean: leave; note.)

---

## 10. Post-DD-council redesign (AUTHORITATIVE — supersedes §2/§3 where conflicting)

Architect + red-team converged: the per-stage capture is unbuildable (entangled truncation/ML), the % denominator cherry-picks, and the $ headline is unshareable. Authoritative v1:

### 10.1 Measure ONE net delta per tool result (not per stage)
The `afterToolCall` cave pipeline (`agent-session.ts:577-625`) runs budget-truncation → structured → general → (or ML instead, rule-based as safety net). Stages are NOT cleanly separable and ML bypasses them. So measure the **net** effect once per tool result:
- `compression` saving = `sumTextLen(result.content) − sumTextLen(processedContent)` (exact BYTES), booked ONCE after the whole pipeline. `sumTextLen` = Σ over text blocks only (exclude image/non-text).
- This pipeline operates on the already-(tool-layer)-truncated `result.content`; the tool-layer temp-file truncation (`bash.ts fullOutputPath`) happens BEFORE and is NOT measured (it's deferral). The afterToolCall reductions are not temp-filed → genuine context elimination this turn.

### 10.2 Sources (collapsed): `dedup` | `compression` | `compaction`
- **dedup** — early-return path (`agent-session.ts:537-575`): `fullText.length − stubLength` bytes. NOTE (red-team R1): dedup's fingerprint is `length:first-256-chars` — a file edited past byte 256 at equal length mis-reads as unchanged. So label dedup honestly ("re-read avoided") and do NOT claim absolute elimination-certainty; it's still the cleanest measured source. (Hardening the fingerprint is a separate agent-soundness issue, out of scope.)
- **compression** — §10.1 net pipeline delta.
- **compaction** — soft-compaction (`_softCompactTransform:1220-1230`, caveman-gated, idempotent per `_softCompressedTimestamps`): `block.text.length − compressed.length` per message. Disjoint from inline compression (operates on stored post-inline text). INCLUDE (architect B2) — long-session materiality.

### 10.3 Lead with BYTES; tokens/$ are `≈` riders
Headline noun = **bytes of context eliminated** (exact) + **% of tool output compressed** (honest denominator below). Tokens (`≈ bytes/4`) and `$` (`≈ tokens × input rate`) are clearly-secondary, `≈`-labeled. Bytes are unattackable; `chars/4` over-counts ~1.3-1.6× on dense output so it must NOT be the headline.

### 10.4 Honest % denominator
Track `totalToolOutputBytes` = Σ bytes of EVERY tool result the model received (compressed or not, captured at `afterToolCall` entry for every result). `% compressed = (dedup+compression+compaction bytes) / totalToolOutputBytes`. Claim: "compressed N% of all tool output this session" — not cherry-picked.

### 10.5 Cache-reuse — separate, recomputed per-message, NOT in headline
Derive on read (idempotent fold over `state.messages`): `Σ msg.usage.cacheRead × (rate.input − rate.cacheRead)/1e6`, resolving rates from **each message's own `model`** (handles mid-session switch; `usage.cost.cacheRead` is the BILLED cost, NOT the saving — must recompute). Shown as its own labeled "prompt cache reuse (provider feature)" line; NEVER summed into the caveman total; NEVER in the `--share` string.

### 10.6 SavingsTracker shape (revised)
```ts
type SavingsSource = "dedup" | "compression" | "compaction";
interface SavingsTotals {
  bytesSaved: number; bySource: Record<SavingsSource,{bytes:number}>;
  totalToolOutputBytes: number;     // denominator
  tokensSavedApprox: number;        // ≈ bytesSaved/4 (rider)
  dollarsSavedApprox: number;       // ≈ tokens × current input rate (rider)
  cacheReuseDollars: number;        // derived per-message, SEPARATE
  percentCompressed(): number;      // bytesSaved/totalToolOutputBytes, /0-guarded
}
recordToolOutput(totalBytes)         // every result → denominator
recordSaving(source, savedBytes)     // dedup/compression/compaction, once each
```
Compression/dedup/compaction = event-accumulated bytes; cache-reuse = derived on read from the message list. Owned by AgentSession, reset per session.

### 10.7 F7 cumulative — hardened (red-team R4)
Persist all-time/weekly savings in `cost-totals.json` keyed/idempotent by **session id** (an add is applied at most once per session id — store last-persisted session id or a small ring of applied ids), and guard the read-modify-write against concurrent sessions (best-effort file lock or atomic compare-and-set; at minimum don't double-apply on resume/replay). Persist BYTES (exact) as the durable figure; $ derived.

### 10.8 Surfaces (unchanged from §4 except numbers)
`/savings` (copy the WIRED `handleTokensCommand` pattern — architect M5; `/tokens` is fine, only its bucket math is heuristic). Lead line: `Caveman eliminated ≈X KB of context (N% of tool output)`; then `≈ Y tok · ~$Z` rider; then separate `prompt cache reuse (provider): ~$W`; then `cumulative: X MB / ~$ this week · all-time`. Session-end line + cumulative. StatusLine `· saved NkB` (Should/fast-follow). `--share` = bytes + % only.

### 10.9 Verdict
GO. v1 = bytes-led, 3 clean sources (dedup + net-compression + compaction), honest all-tool-output denominator, cache-reuse separate+recomputed, hardened idempotent cumulative. Removes the per-stage/ML mis-attribution, the cherry-picked %, the chars/4 headline, and the cumulative drift.
