# Prose-40pct — Implementation Plan

> TDD for pure pieces. The MEASUREMENT must be trustworthy BEFORE tuning (council). Phase A builds
> the gated bench (subagent); Phase B is the tuning loop (operator/me). Revert models.generated.ts +
> package-lock.json before commits. Signed commits. Branch: feat/prose-40pct.

**Goal:** caveman `full` prose → ~40% single-turn output cut **at preserved substance** (or report the honest ceiling). DD §0/§0.1 authoritative.

---

## Phase A — gated bench (subagent build; NO tuning, NO paid runs beyond tiny dry/mocked)

### Chunk A1 — diverse corpus + partitions
- Modify `research/evals/run-prompt-prose.ts`: replace the 5 same-genre prompts with a tagged set across genres {code-explain, trade-off, risk-enumeration, multi-step-trace, short-factual}, ≥3 per genre, each tagged `split: tune|validation|test`. Test set committed; add a `--split tune|validation|test|all` flag (default tune). Prefer ≥1 test prompt with EXTERNAL ground truth noted.
- Test: split filtering + prompt loading (pure).

### Chunk A2 — frozen judge oracle
- New `research/evals/prose-judge.ts`: a **version-locked** judge — committed prompt TEXT + a `JUDGE_MODEL` const (≠ model-under-test; default `gpt-4.1`). `judgeSubstance(reference, candidate)` → `{ recall, qualifierFidelity, addedUnsupported, claims }`. The LLM call is I/O; the PARSE + the prompt text are pure/committed.
- Pure helpers: `parseJudge(json)`, and `passes(perPrompt)` = `reductionPct>0 && recall>=0.90 && qualifierFidelity>=0.90 && addedUnsupported===0`.
- Tests (mocked judge output): passes() truth table incl. each failing dimension (longer answer, low recall, dropped qualifier, hallucination).

### Chunk A3 — stability (n≥3, temp=0)
- `runCondition`: temperature 0, **n≥3 repeats per (prompt,condition)**, record per-repeat output tokens; report mean + max per-prompt variance; flag/exclude prompts with (max−min)/mean > 5%.
- Test: variance flag + averaging (pure).

### Chunk A4 — gated aggregate + reporting
- Per prompt: reductionPct (mean over repeats), recall, qualifierFidelity, addedUnsupported, PASS bool. Aggregate: **gated-median reduction over PASS prompts + `n_pass/n_total`**; headline only valid if `n_pass/n_total ≥ 0.80`. Output: results.json + table.md (per-prompt incl. all dimensions + PASS) + responses.md. NO bootstrap-CI claim; report distribution.
- `--ceiling-probe`: run `ultra` on `--split tune` (gated), print gated reduction (Phase-B futility input).
- Test: gated aggregate + n_pass/n_total + headline-validity (pure).

### Chunk A5 — verify + commit
- `bench:prose` updated; `npm run bench:test` green; root `tsgo --noEmit` clean; biome clean; no NUL bytes. Signed commit per chunk (or grouped). Push, PR (or extend an existing one).

## Phase B — tuning loop (operator/me; paid, cheap; after Phase A merged/verified)
1. **Judge calibration:** hand-score judge on ~3 prompts; if >10% disagreement, fix + re-freeze judge prompt.
2. **Ceiling probe:** `bench:prose --ceiling-probe`. If gated `ultra` reduction `< 38%` → report honest ceiling, STOP.
3. Iterate `buildCaveModePrompt("full")` (stronger compression; KEEP correctness-qualifiers + EXCEPTIONS) → `bench:prose --split tune` → read gated-median + n_pass/n_total. ≤8 revisions; report ALL iteration numbers.
4. **Validation** (`--split validation`) go/no-go (no re-tune against specific validation prompts).
5. **Pre-register** (commit) the final prompt, then **LOCKED test** ONCE on the 2nd model (`--split test`, `--model claude-sonnet-4-6`): require gated-median ≥35% (≈40% target) + `n_pass/n_total ≥ 0.80`.
6. Write report: before/after prompt, tune/validation/test gated numbers, n_pass/n_total, ceiling, calibration, honest caveats + scope (single-turn).
7. `/code-review` + final `/council`.
