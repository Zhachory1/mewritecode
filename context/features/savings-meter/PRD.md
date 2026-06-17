# PRD: Live Token-Savings Meter

- Status: draft
- Author: Zhachory Volker
- Date: 2026-06-12
- Closes: #12
- Surface: `packages/coding-agent` (session savings tracker, `/savings`, statusline, session-end), `packages/tui` (StatusLine segment)

## 1. Problem

Whole pitch = "saving compounds across the session." Yet user **cannot see their own savings**. `/tokens` cave-mode-savings bucket is heuristic AND unwired (never reached in the real TUI). No statusline figure, no session-end savings line. A wedge the user can't feel = a wedge they won't share. (Council P1, top product conviction.)

## 2. The credibility constraint (non-negotiable)

A token-savings product whose number is marketing dies on contact with a skeptic (see the benchmark issue #8). So the meter shows **only provenance-tracked savings** — original-vs-kept actually known in code:

**Measured (headline):**
- Tool-output truncation (bash/read/grep): `totalBytes − outputBytes` (exact, always-on).
- Cave read-dedup: full re-read content → one-line stub (exact byte delta).
- Cave budget / general / structured (JSON/XML) compression: original-vs-kept line/byte counts (first-class in code).
- **Prompt-cache reuse:** `cacheRead × (input_rate − cacheRead_rate)` — a true billed-dollar saving from real provider usage.

**NOT in the headline (heuristic / unobservable):**
- Caveman-mode OUTPUT terseness — no counterfactual; inherently a guess. Excluded from the headline number. (Optionally shown in `/savings` as a clearly-labeled `(est.)` line — see OQ.)
- RTK command rewriting — cavecode never sees the un-rewritten output size.

All "measured" sources are computable from data **already in scope** (compression site `agent-session.ts:578/628`, `TruncationResult`, provider `usage`) — today simply **not captured**.

## 3. Goal

Make the wedge **felt and trustworthy**: a live, accurate, provenance-tracked savings figure visible in-session and at session end, so every session is proof — and a shareable screenshot.

## 4. Users & use cases

- **U1 in-session glance:** statusline shows `saved ≈12k tok (~$0.04)` updating as the session compresses tool output / reuses cache. (Primary — the "felt" wedge.)
- **U2 drill-down:** `/savings` shows a breakdown by source (truncation, dedup, structured, cache-reuse) with tokens + $ each, and the session total.
- **U3 session end:** the existing exit summary (`Session cost: $X (Yk in / Zk out)`) gains a second line `Saved ≈X tok (~$Y) this session` — the screenshot moment.

## 5. Requirements

### Must
- **F1 SavingsTracker (session-scoped).** A tracker accumulating per-event savings, tagged by source (`truncation` | `dedup` | `structured` | `general` | `cache-reuse`). Fields: `tokensSaved`, `dollarsSaved`, per-source subtotals. Owned by `AgentSession` (like the activity registry), reset per session.
- **F2 Capture at the real sites.** Record savings where the data already exists: the cave compression pipeline (`afterToolCall`, original `result.content` vs `processedContent`), tool `TruncationResult` (`totalBytes/outputBytes`), and the cache-read dollar discount (from each assistant message `usage`). No new estimation where a real delta exists.
- **F3 bytes→tokens→$ conversion (consistent + labeled).** Convert saved bytes/lines to tokens via the same `chars/4` estimate the codebase already uses (label tokens as `≈`); $ = savedTokens × model input rate. Cache-reuse $ is exact (billed). Use the CURRENT model's pricing.
- **F4 `/savings` command.** Breakdown by source (tokens + $) + session total + a one-line honest note ("measured compression + cache reuse; excludes un-measurable output-terseness").
- **F5 StatusLine segment.** Persistent `saved ≈Xk (~$Y)` segment (detailed view; compact form in default). Only shown once savings > 0.
- **F6 Session-end line.** Append `Saved ≈X tok (~$Y) this session` to the existing `printAndPersistSessionCost` summary; persist a cumulative savings aggregate alongside `~/.cave/cost-totals.json`.

### Should
- **S1** `/savings` and the statusline use consistent formatting (k-suffix tokens, 4-dp $).
- **S2** Cache-reuse shown distinctly (it's a billed-$ saving, the most defensible number).

### Won't (this cycle)
- No caveman-mode-output savings in the headline (heuristic). (OQ: optional labeled `(est.)` line in `/savings` only.)
- Not fixing the unrelated `/tokens` bucket-wiring bug (note it; separate).
- No RTK measurement. No new tokenizer dependency (reuse chars/4).
- No web-ui/SDK surface.

## 6. Success criteria

- A session that truncates a large bash output / re-reads a file / reuses cache shows a **non-zero, correct** savings figure in the statusline, `/savings`, and the exit line.
- The headline number reconciles with the underlying byte/token deltas (±5% of a hand-computed replay — the metric).
- Zero savings claimed for caveman-mode output in the headline.
- No measurable per-turn latency added (accumulation is O(1) at sites that already hold the data).
- Authed/normal flow unchanged; savings simply accrue.

## 7. Risks

- **R1 Credibility:** any inflated/double-counted number is worse than none. Mitigate: count each source once at its single site; reconcile in tests against known deltas; exclude heuristics from the headline.
- **R2 bytes→tokens fudge:** `chars/4` is approximate. Mitigate: label tokens `≈`; cache-reuse (exact $) is the defensible anchor; document the estimate in `/savings`.
- **R3 Double-counting:** truncation (tool layer) vs cave compression (session layer) could both fire on the same output. Mitigate: define source precedence so a given byte is attributed once (design doc).
- **R4 Perf:** must not add work to the hot path beyond a few arithmetic ops at sites already holding original+compressed.

## 8. Open questions (design doc)
- OQ1 Show caveman-mode-output as a separate labeled `(est.)` line in `/savings`, or omit entirely? (Lean: omit v1 — keep the meter purely measured; revisit.)
- OQ2 Tokens estimate: `chars/4` everywhere, or use the provider tokenizer when available for the saved text? (Lean: chars/4 for consistency + zero deps; label `≈`.)
- OQ3 R3 attribution: if both tool-truncation and cave-compression touch one output, which owns the saving? (Lean: attribute at the OUTERMOST point that changed bytes the model would otherwise have paid for — design doc to pin precedence.)
- OQ4 Persist cumulative savings in `cost-totals.json` (daily/weekly) like cost? (Lean: yes — cheap, enables "saved $X this week".)

---

## 9. Post-council revision (AUTHORITATIVE — supersedes §2/§3/§5 where conflicting)

Two reviews split on cache-reuse (red-team: demote, not product-attributable; CEO: elevate, only material number). Resolution + the other catches:

### 9.1 Three honesty buckets (the core reframe)
The meter separates savings by attribution + truth, and **only the first is the headline**:

1. **Context saved by Caveman (HEADLINE, product-attributable, elimination-true):**
   - **Read-dedup** — a re-read replaced by a stub; the content is already in context, so re-sending is genuinely eliminated. Caveman feature.
   - **Structured (JSON/XML) + general cave compression** — bytes the model sees are genuinely reduced. Caveman feature.
   These ELIMINATE context bytes (not defer), and they ARE the product. Headline noun = **"context saved"** (tokens/bytes that never (re-)entered the window), $ as a secondary line at the current model input rate.

2. **Prompt-cache reuse (separate, labeled "provider feature", NOT in the headline):** `cacheRead × (input_rate − cacheRead_rate)` — billed-exact, materially large on long sessions, but generic (Anthropic/SDK, not caveman). Shown in `/savings` as its own line "prompt cache reuse (provider): $X — shown for completeness", explicitly outside the caveman total. (Satisfies CEO materiality without letting a skeptic dismiss the product number.)

3. **Excluded:** tool-output **truncation** (red-team: deferral — full output goes to `fullOutputPath` temp file the model can re-read; not elimination), **RTK**, **caveman-mode output terseness** (no counterfactual). Truncation may appear as a neutral info line ("N bytes deferred to temp file"), never as "saved".

### 9.2 Counting rule (red-team crux)
**Count each compression/dedup event exactly ONCE, at the moment it happens, as a single-turn token delta.** Do NOT re-sum per future turn (overcount) — this deliberately undercounts the compounding, the safe direction. Compounding may be surfaced as a labeled qualitative note ("compresses every turn it stays in context"), never folded into the number.

### 9.3 Disjoint attribution (no double-count)
A given byte is attributed to exactly one source. Since the cave layer compresses the already-(tool-)truncated `result.content`, and truncation is excluded anyway, the cave-compression delta (`original result.content → processedContent`) is the clean, single-owned measure. Dedup owns the re-read→stub delta. No precedence ambiguity.

### 9.4 Revised requirement set
- **F1 SavingsTracker** (session-scoped) — subtotals per source, with the 3-bucket separation (caveman-headline vs provider-cache vs excluded/info).
- **F2 Capture** dedup + structured + general compression deltas at `afterToolCall` (original vs processed, in scope); capture cache-reuse $ from each message `usage`.
- **F3 bytes→tokens→$** chars/4 (labeled `≈`; note it over-estimates on dense output); $ at current model input rate; cache-reuse $ exact.
- **F4 `/savings`** — caveman "context saved" headline (tokens + $), provider-cache line (separate, labeled), cumulative all-time/week, honesty footnote.
- **F6 Session-end line** — `Caveman saved ~X tok of context (~$Y) this session` + the cumulative figure.
- **F7 (PROMOTED to Must — CEO) Cumulative persistence** — daily/weekly/all-time savings alongside `cost-totals.json`; surfaced in `/savings` + session-end ("~$Y this week / ~$Z all-time"). This is the screenshot.
- **F5 StatusLine segment → demoted to SHOULD (fast-follow)** — most fiddly, least viral.
- **S-share (Should)** — a copyable one-line brag with **percentage of context compressed** ("Caveman compressed N% of tool context this session"). Percentages travel.

### 9.5 Success criteria (add materiality)
Keep correctness (±5% vs hand-computed replay of the count-once deltas). ADD: cumulative all-time/week figure is the durable, shareable number; headline reconciles to dedup+compression deltas only; cache-reuse never inside the caveman total; truncation never counted as saved.

### 9.6 Resolved OQs
- OQ1 caveman-output estimate: **omit** (the "context saved" reframe removes the need).
- OQ2 tokens: **chars/4 + `≈`** (note dense-output overestimate; cache-reuse $ is the exact anchor).
- OQ3 attribution: **disjoint** per §9.3 (truncation excluded → no contest).
- OQ4 cumulative persistence: **yes, now F7 Must.**
