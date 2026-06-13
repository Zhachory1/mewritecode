# Savings Meter — Implementation Plan

> Authoritative: **DD §10**. TDD, commit per chunk, subagent-implement. Closes #12.

**Goal:** Credible, bytes-led savings meter — `/savings` + session-end line + hardened cumulative. Headline = bytes of context Caveman eliminated (dedup + net compression + compaction) + honest %; tokens/$ are `≈` riders; prompt-cache reuse shown SEPARATELY (provider, recomputed per-message); truncation/output-terseness excluded.

**Tech:** TS strict, vitest, biome. Verify CI-mirror (`OPENAI_API_KEY= … GIT_CONFIG_GLOBAL=/dev/null`). NOTE: run `tsgo --noEmit` (root, includes tests) before declaring done — build-tsconfig excludes tests (the #21 lesson). Don't regenerate models.generated.ts.

---

## Chunk A — SavingsTracker (pure, tested)
**Files:** NEW `packages/coding-agent/src/core/savings-tracker.ts` + `test/savings-tracker.test.ts`.

- [ ] **A1 failing test:** per DD §10.6 — `recordToolOutput(bytes)` accrues `totalToolOutputBytes`; `recordSaving(source, bytes)` accrues `bytesSaved` + `bySource` (max(0)); `tokensSavedApprox == round(bytesSaved/4)`; `dollarsApprox(rate) == tokens×rate/1e6`; `percentCompressed()` = bytesSaved/totalToolOutputBytes (0-guard); cache-reuse is NOT in bytesSaved/dollarsApprox (separate); `reset()`. Hand-checkable arithmetic.
- [ ] **A2 impl:** class with the §10.6 fields/methods. `dollarsApprox` takes the current input rate (pricing supplied by caller, tracker stays pricing-free for bytes/tokens). cacheReuse handled by the caller (derived) — tracker exposes a setter or the formatter combines; keep tracker = caveman bytes only + a `cacheReuseDollars` field set by caller.
- [ ] **A3:** biome + tsgo; commit `feat(savings): SavingsTracker (bytes-led, honest denominator)`.

## Chunk B — Capture in AgentSession
**Files:** `packages/coding-agent/src/core/agent-session.ts` + test.

- [ ] **B1** Own `private _savings = new SavingsTracker()`; `get savings()`; reset on new session (mirror activity registry).
- [ ] **B2 net compression (§10.1):** at `afterToolCall` (~577-625), compute `before = sumTextLen(result.content)` BEFORE the cave pipeline and `after = sumTextLen(processedContent)` AFTER it; `recordToolOutput(before)` (every result, for the denominator); if `before>after` → `recordSaving("compression", before-after)`. ONE measurement per result (covers ML + rule stages). `sumTextLen` = Σ text-block `.text.length` (exclude non-text). Gate: the pipeline already runs under cave-mode gate; record only when it ran.
- [ ] **B3 dedup (§10.2):** at the dedup early-return (~537-575) → `recordToolOutput(fullText.length)` + `recordSaving("dedup", fullText.length - stubLength)`. (Dedup short-circuits the pipeline, so B2 won't also fire for that result — disjoint.)
- [ ] **B4 compaction (§10.2):** in `_softCompactTransform` (~1220-1230) where `block.text` (in) and compressed (out) are in scope → `recordSaving("compaction", inLen - outLen)` per compressed message (already idempotent via `_softCompressedTimestamps`).
- [ ] **B5 cache-reuse (§10.5, derived):** add `getSavings()` (or have `savings.totals()` accept the message list) that computes `cacheReuseDollars = Σ msg.usage.cacheRead × (rate.input − rate.cacheRead)/1e6`, resolving rates from each message's own `model` (use the model-registry/`getModelById` lookup; degrade to 0 for an unresolvable id). Idempotent fold over `state.messages` — recomputed on read, never accumulated.
- [ ] **B6 test:** drive a fake `afterToolCall` result through dedup vs pipeline; assert tracker bytes + denominator; compaction path; cache-reuse derivation idempotent + equals Σ formula across a 2-model message list.
- [ ] **B7:** biome + tsgo; commit `feat(savings): capture dedup/compression/compaction + derive cache-reuse`.

## Chunk C — `/savings` command
**Files:** NEW `core/slash-commands/savings.ts` (pure formatter) + register + `handleSavingsCommand` (copy the WIRED `handleTokensCommand` pattern, interactive-mode ~5852) + test.

- [ ] **C1 failing test (formatter):** given totals → renders bytes-led headline (`≈X KB`, `N%`), `≈tok · ~$` rider, SEPARATE `prompt cache reuse (provider): ~$W`, cumulative line, honesty note. Zero-state. Cache-reuse never summed into the caveman total.
- [ ] **C2 impl** formatter + handler; register `{name:"savings"}` in BUILTIN_SLASH_COMMANDS + dispatch `if (text === "/savings" || text.startsWith("/savings ")) handleSavingsCommand(arg)`. Support `--share` (Should): bytes + % one-liner only (no $, no cache).
- [ ] **C3:** biome + tsgo; commit `feat(savings): /savings command (+ --share)`.

## Chunk D — Session-end line
**Files:** `core/cost-formatter.ts` (+ test) + `interactive-mode.ts printAndPersistSessionCost` (~6040).

- [ ] **D1** `formatSavingsLine(totals, cumulative)` → `Caveman eliminated ≈X KB of context (N% of tool output) · ~Y MB all-time` (only when bytesSaved>0). Test it.
- [ ] **D2** call it after the existing `Session cost:` line in `printAndPersistSessionCost`.
- [ ] **D3:** commit `feat(savings): session-end savings line`.

## Chunk E — Cumulative persistence (hardened)
**Files:** `core/cost-persistence.ts` (~88-131) + test.

- [ ] **E1 failing test:** persisting a session's savings increments daily/weekly/all-time BYTES; **idempotent by session id** (persisting the same session id twice does NOT double-add); concurrent/re-entrant guard (best-effort: store last-applied session ids / compare-and-set). Reads weekly + all-time.
- [ ] **E2 impl:** extend the `cost-totals.json` record with `savings:{bytes}` aggregates + a small applied-session-id guard; atomic rename already present. Don't double-apply on resume/replay.
- [ ] **E3:** commit `feat(savings): hardened cumulative savings persistence`.

## Chunk F — StatusLine (Should / fast-follow)
- [ ] Extend `StatusLineContext.cave` with `savedBytes?`; render `· saved NkB` in `renderDetailed` when >0; populate in `resolveStatusLine` from `session.savings`. tui node:test. If time-boxed out, defer (note in PR).

## Chunk G — Full verify
- [ ] Full coding-agent suite CI-mirror green; `npm run check` (root tsgo incl. tests) clean; biome clean.
- [ ] Manual smoke (caveman linked): session with a big bash output + a file re-read → `/savings` shows non-zero bytes + %, cache-reuse on its own line; exit prints the savings line.

## Done when
Chunks A–E (+ F if time) committed on `feat/savings-meter`; tracker + capture + /savings + session-end + cumulative in; bytes-led + honest %; cache-reuse separate; truncation/output-terseness excluded; suite + check + biome green.
