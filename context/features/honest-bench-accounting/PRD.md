# PRD — Honest-Bench Token Accounting (issue #8)

**Priority:** P0 (BLOCKER) · **Effort:** M · **Owner:** caveman-code · **Status:** draft → council

**Scope note:** This delivers the corrected **harness + reproducible-run infrastructure**. Executing the paid multi-seed run that fills in the published numbers is deferred to the maintainer/CI (per session decision "harness now, you run it"). The harness must be trustworthy enough that the run, once executed, is defensible.

## 0. Council resolutions (authoritative — supersede §4 where they conflict)

PRD-council (ab-critic, ml-scientist, red-team) materially re-scoped this. Binding:

1. **Primary metric = cost ($) per resolved task**, not raw token sums. Token classes are priced 0.1×–3.75× apart, so summing them 1:1 is meaningless; `$` prices each class correctly and "per resolved task" pairs cost with quality (a cheaper-but-worse tool is not a win — couples to #9). Token breakdown (input/output/cacheRead/cacheWrite + `total_processed`) is reported as a **supplementary** audit table, not the headline. Drop `fresh_billable` as a headline metric (it double-penalizes cache-heavy multi-turn runs); keep the raw four-field breakdown instead.
2. **The "~2× fewer tokens" claim is likely false/inverted** under honest accounting (caveman ~1.59M incl. 1.06M cacheRead). **DoD now includes:** mark the live claim "pending revalidation (see #8)" in README/site the moment this merges, and file a follow-up issue to update or retract it once an honest run lands. (Decision: mark-pending, not delete.)
3. **Codex = parse-or-exclude, fail loudly, report `parse_failure_rate`.** Codex CLI has no JSON mode and isn't even runnable in this dev env (vendored binary missing) — the maintainer's env/CI is the only place it runs. Never fabricate: unparseable component → run excluded + raw stdout retained; if codex `parse_failure_rate > 20%`, the comparison is flagged not-publishable. Codex model is **parsed-or-`unknown`** — remove the hardcoded `"gpt-5.5"` (`run-honest-bench.ts:639`), which is itself fabrication.
4. **Paired analysis, not pooled means.** Compare only tasks where **both** tools resolve; report the per-task cost-ratio distribution + 95% CI (and n_pairs), not a pooled mean. n=3 is underpowered for binary ~29%-pass tasks — raise the seed floor and set the reproducibility tolerance **empirically after the first run**, not a preset ±10%.
5. **Apples-to-oranges is real and must be labeled.** Multi-turn caveman (large cacheRead from re-sent system prompt) vs single-shot `codex exec` (zero cacheRead) are different execution models; raw token counts aren't directly comparable. Cost-per-resolved-task is the defensible normalizer; the headline must name the corpus (SWE-bench) and the model tiers.
6. **`run-swebench.ts` token capture:** success path must capture all four token fields (`:233` currently keeps only input+output); error path must set all four to **null** (`:242` currently zeros them, silently feeding 0 into aggregates).

## 1. Problem

The flagship "~2× fewer tokens than Codex" headline is a **measurement artifact** (verified in `research/evals/run-honest-bench.ts`):

1. **Codex output + cache never captured.** Codex CLI has no JSON mode; the runner regex-scrapes stdout (`run-honest-bench.ts:438-454`). The primary regex never matches; the fallback lumps the grand total into `tokens_input`, **hardcodes `tokens_output = 0`**, and leaves `cache_read/write = null` — on all 25 codex rows.
2. **Asymmetric cache treatment.** Caveman is parsed correctly from `--mode json` into the full `Usage` shape (input/output/cacheRead/cacheWrite). The comparison's "fresh" metric is `input + output` (`:559`, `:632`) — but caveman's large `cacheRead` (~1.06M vs 524k fresh) is simply dropped, while codex's cached tokens are invisible (null). The two tools are not measured on the same axis.
3. **No shared audited unit.** Two parse paths (structured JSON vs fragile regex) with no common definition of what's being counted.
4. **No variance.** n=25, single run, trivial single-file tasks, no seeds, no error bars.
5. **Artifacts not published.** README claims per-task logs exist; codex logs for `honest-bench-2026-05-18/` are absent.

A skeptic dismantles this in 10 minutes. It's a launch-day landmine.

## 2. Goal

A token-accounting harness where **both tools are counted on identical, explicitly-defined axes**, fabrication is impossible (unparseable → recorded as error + excluded, never zeroed), runs carry variance, and a third party can re-run one command and reproduce the headline within tolerance. The harness produces the honest number — whatever it is.

## 3. Non-Goals

- Not running the paid benchmark to produce final published numbers (maintainer/CI does that).
- Not changing the marketing claim text (that's #13; this produces its honest input).
- Not modifying caveman's own token reporting (it's already correct).
- Not building a new task corpus from scratch — reuse the SWE-bench harness's tasks.

## 4. Proposed Solution

### 4.1 One shared audited unit (both tools, identical definition)
Both tools report the four-field `Usage` shape (`packages/ai/src/types.ts`: `input`, `output`, `cacheRead`, `cacheWrite`). Report **two headline metrics, defined once and applied identically**:

- **`total_processed` = input + cacheWrite + cacheRead + output** — every token the model computed over (the honest "work done" number; the fairest cross-tool axis because it doesn't depend on each vendor's cache-discount policy).
- **`fresh_billable` = input + cacheWrite + output** — tokens billed at full/write rate this run (cacheRead excluded as discounted reuse).

Both metrics reported for both tools. The headline states *which* metric it uses. If a tool can't supply a component, that run is **excluded** from that metric (see 4.2), never defaulted to 0.

### 4.2 No-fabrication codex capture
Codex CLI emits no JSON. Resolution, in priority order:
1. **Structured source if one exists** — investigate a codex `--json`/experimental flag or a session/usage file it writes; prefer it.
2. **Robust parse-or-fail** — if scraping stdout, parse input/output/cached into the `Usage` shape with explicit patterns; if **any** required component is missing, set the run's `parse_status = "failed"` and **exclude it from aggregates** (record raw stdout for audit). Never lump-to-input, never zero-out.
3. The codex cache axis may genuinely differ from caveman's; document it. `total_processed` is the primary comparable; `fresh_billable` carries a footnote if codex cache visibility is partial.

The harness must **fail loudly** (nonzero exit / visible WARN + excluded rows) rather than silently produce a flattering number.

### 4.3 Variance + realistic tasks
- **≥3 seeds** per (tool, task); aggregate reports mean ± stddev (and n) per metric.
- **Wire the SWE-bench harness** (`run-swebench.ts`) task source + multi-turn execution instead of trivial single-file tasks. Extend its `getSessionStats` capture to all four token fields (it currently keeps only input+output — `run-swebench.ts:233`).

### 4.4 Reproducibility + artifacts
- One command: `npm run bench:honest` (+ `npx tsx research/evals/run-honest-bench.ts ...`), seeds/models/tasks configurable via flags, defaults pinned.
- Write **per-task raw artifacts for BOTH tools** (stdout, stderr, parsed usage JSON) under `research/results/<run-id>/<tool>/<task>.{log,json}`, and commit them.
- Emit a `manifest.json` (models, seeds, tool versions, git SHA, per-metric mean±stddev) so a re-run is diffable.

## 5. Success Metrics

- **Primary (Done-when):** a third party runs the one command and reproduces the published headline within a stated tolerance (e.g. ±10%).
- **Guardrail:** zero fabricated token values — every reported number traces to a parsed structured source or an explicitly-excluded failed run.
- **Honesty:** `total_processed` and `fresh_billable` are defined identically for both tools and both are published.

## 6. Risks

- **Codex has no honest token source at all.** If neither a structured flag nor a reliable parse exists, the comparison may be unsupportable as-is — surface that as a finding (it would re-scope the headline) rather than papering over it. This is the highest risk and the council should probe it.
- **`total_processed` vs `fresh_billable` choice changes the headline direction.** Caveman's heavy cacheRead means `total_processed` may *not* favor caveman 2×. The harness must report the honest result even if it's unflattering.
- **Cache-semantics mismatch** across vendors makes any single axis arguable; mitigate by publishing both metrics + raw artifacts so others can recompute.
- **Cost/time** of the multi-seed SWE-bench run (deferred to maintainer; harness should support a small `--limit`/`--seeds` for cheap smoke runs).

## 7. Definition of Done

- Both tools counted on identical `total_processed` + `fresh_billable` axes; definitions in code + docs.
- Codex capture is structured-or-excluded; no lump-to-input, no zeroed output, no silent fabrication; failed parses are visible and excluded.
- ≥3-seed aggregation with mean ± stddev; SWE-bench task source wired; all four token fields captured.
- `npm run bench:honest` reproducible; per-task artifacts (both tools) + `manifest.json` written and committed.
- Unit tests cover the accounting math (metric definitions, parse-or-exclude, variance aggregation) without needing a live run.
- Tests green, `tsgo --noEmit` clean, biome clean. (Paid run + published numbers: maintainer follow-up.)
