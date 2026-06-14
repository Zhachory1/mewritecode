# Honest-Bench Piece 1 — Implementation Plan (issue #8, landable slice)

> **For agentic workers:** TDD. Test first. The DD §0.2 SPLIT is authoritative — Piece 1 only (metrics module + swebench token fix + claim pull). Piece 2 (the 2-factor ablation) is #33, not built here. Revert `packages/ai/src/models.generated.ts` + `package-lock.json` before commits. Stage by path. Commit signed (`-S`).

**Goal:** Land the honest, fully-unit-testable foundation: the accounting math module, the run-swebench 4-field token fix, and pulling the unsupported "2×" claim — without needing a paid run.

**Architecture:** Pure `research/evals/honest-metrics.ts` (no I/O) holds all metric math, unit-tested via a new `bench:test` script. `run-swebench.ts` gets correct 4-field token capture + null-on-error + level parameterization. README claim → neutral.

---

## Chunk A: Pure accounting module + tests

**Files:**
- Create: `research/evals/honest-metrics.ts`
- Create: `research/evals/__tests__/honest-metrics.test.ts`
- Modify: root `package.json` (add `"bench:test": "vitest run research/evals"`)

- [ ] **A1. Failing tests** per DD §3/§9: write `honest-metrics.test.ts` covering:
  - `computeCost(usage, table, model)`: prices each class; unpriced model → null.
  - `costPerResolved`: two-stage equal-task-weight **median** (per-task median over resolved seeds, then median over tasks); excludes unresolved; fixture where one task resolves 5× must NOT dominate.
  - `costDeltaVsOff(runs, table, prng)`: log-ratio bootstrap vs `off`; nPairs<10 → `ci95:null` + `"insufficient_pairs"`; CI-width ratio >3× → `powerWarning:true`; pairedRate<0.5 flagged; CI brackets median; deterministic under seeded PRNG.
  - `passRateDeltaVsOff(runs)`: McNemar (or paired bootstrap) on (task,seed) resolved matrix; returns delta + CI; hand-checked discordant-pairs fixture.
  - `parseFailureRate`, `meanSdMedian`: hand-checked.
  - `parseCodexUsage(stdout)`: returns Usage+model **only** (no cost); missing input|output → `status:"failed"` (NO fabrication); garbage → failed. Mark codex path UNCONFIRMED in a doc comment (no real sample captured).
  Run `npm run bench:test` → FAIL (module absent).
- [ ] **A2. Implement** `honest-metrics.ts` per DD §3 signatures: `Usage`, `totalProcessed`, `PricingRow`, `computeCost`, `Run`, `costPerResolved`, `passRate`, `costDeltaVsOff`, `passRateDeltaVsOff`, `parseFailureRate`, `parseCodexUsage`, `meanSdMedian`. Seeded-PRNG percentile bootstrap, no external dep. Run `bench:test` → PASS. `npx tsgo --noEmit` → clean.
- [ ] **A3. Commit:** `feat(evals): pure honest-metrics module (cost/pass-rate stats, parse-or-exclude)`

## Chunk B: run-swebench token-capture fix

**Files:**
- Modify: `research/evals/run-swebench.ts`

- [ ] **B1.** Extend the result `tokens` type (`:162`) to all 4 fields `{input,output,cacheRead,cacheWrite}`.
- [ ] **B2.** Success path (`:233`): capture all 4 from `session.getSessionStats().tokens`. Error path (`:241`): set all 4 to **`null`** (not 0) so failed runs are excludable, not counted as zero.
- [ ] **B3.** Parameterize the cave level: replace the hardcoded `setCaveModeEnabled(true)` + `setCaveModeIntensity("ultra")` (`:182-185`) with a `--cave <off|lite|full|ultra>` flag (default = current behavior to avoid changing existing runs); `off` → `setCaveModeSessionDisabled()` (verify it disables, not just resets). Keep it minimal — full ablation wiring is #33.
- [ ] **B4.** `npx tsgo --noEmit` clean; run any existing swebench-related test or a dry `--limit 0`/`--help` smoke. Commit: `fix(evals): capture 4 token fields in swebench, null on error, parameterize cave level`

## Chunk C: Pull the unsupported claim

**Files:**
- Modify: `README*` (+ any in-repo site/docs copy with the token claim)

- [ ] **C1.** Find the "~2× fewer tokens" claim (`grep -rn "2x\|2×\|fewer tokens" README* docs/ 2>/dev/null`). Replace with neutral: "token efficiency under revalidation — see #8" (no number).
- [ ] **C2. Commit:** `docs: pull unsupported token claim pending honest revalidation (#8)` — commit body states plainly the prior Codex comparison was never independently measured (different model, no structured codex tokens, never run).

## Chunk D: Verify
- [ ] **D1.** `git checkout -- packages/ai/src/models.generated.ts package-lock.json`
- [ ] **D2.** `npm run bench:test` green; root `npx tsgo --noEmit` clean; `npx biome check --error-on-warnings` on touched TS clean.
- [ ] **D3.** Confirm artifacts not staged.
