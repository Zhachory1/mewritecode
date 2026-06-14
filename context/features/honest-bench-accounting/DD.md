# DD — Honest Bench: Caveman ON-vs-OFF Ablation + Cost Accounting (issues #8 + #9, merged)

**Status:** PRD + DD councils (×2) + maintainer decision → **pivoted**. The honest, runnable, controlled measurement is caveman-mode **ON vs OFF at a fixed model** (this answers #9 directly and gives #8 its honest accounting). The codex cross-tool token comparison is demoted to best-effort/flagged (likely `comparable:false`; codex emits no structured tokens + isn't runnable here to confirm). Live "~2× fewer tokens" claim → **neutral wording, number dropped** + follow-up issue.

**Deliverable:** trustworthy ablation+cost harness + reproducible infra + unit-tested accounting math. Paid run (the published table) = maintainer follow-up.

## 0.2 SPLIT (post-ablation-council, authoritative)

Three councils converged: caveman-mode is **two separable features** — prose/reasoning-style injection (the #9 quality risk) and tool-output **compression** (the #8 savings driver) — bundled behind `caveEnabled = getCaveModeToolCompression() && getCaveModeEnabled()` (`agent-session.ts:601`). A clean measurement needs a **2-factor** design (prose-intensity × compression-on/off), pre-registered MDE + acceptance criteria, McNemar pass-rate CIs, difficulty stratification, and a paid run. That's too large/un-validatable to land blind. Split:

**Piece 1 — land now (honest, fully unit-testable, NO paid run):**
1. **Pull the unsupported claim.** README/site "~2× fewer tokens" → neutral "token efficiency under revalidation — see #8" (number dropped). The follow-up issue + PR state **explicitly** that the prior Codex comparison was never independently measured (different model, no structured codex tokens, never run) — not merely "being refined" (red-team transparency).
2. **Fix `run-swebench.ts` (pure correctness, regardless of ablation):** capture all 4 token fields (`:162,:233`), error path nulls all 4 (`:241`, not 0), and parameterize the cave level (`:182-185` hardcodes enabled+ultra).
3. **Pure `honest-metrics.ts` module + unit tests** (§3 below): `computeCost` (single price table), `costPerResolved` (two-stage equal-task-weight median), `costDeltaVsOff` (log-ratio bootstrap, nPairs<10→null, width>3×→powerWarning, pairedRate<0.5 flag), **`passRateDeltaVsOff` (McNemar / paired bootstrap on the (task,seed) resolved matrix)**, `parseFailureRate`, `parseCodexUsage` (best-effort, Usage+model only). `bench:test` runs it. No live run needed.

**Piece 2 — maintainer-run research issue (the actual experiment):** the 2-factor ablation in a new `run-cave-ablation.ts` — conditions: prose ∈ {off,lite,full,ultra} × compression ∈ {on,off} (held constant where isolating the other), `--cave` pinned to `setCaveModeSessionDisabled()` for a true off (verified: prompt block absent AND `caveEnabled=false`), shared external resolver (`evaluate-patches.sh`) sets `resolved` for all, difficulty stratification + a reasoning-sensitive task slice, pre-registered MDE + `acceptanceCriteria`, ≥N seeds with intra-level variance + realized power reported, Holm-corrected primary=ultra, reasoning-trace snapshot test, manifest + artifacts. Consumes Piece-1's `honest-metrics.ts`. Needs the paid run + careful design — filed as its own issue, not built here.

Everything below (§1–§10) is the full target design; **Piece 1 implements §3 (metrics module) + §6 swebench fixes + §8 claim**. §1–§2,§4–§5,§7,§9-ablation,§10 land in Piece 2.

## 1. The honest comparison (controlled)

Hold **model + reasoning-effort + task corpus + seed fixed**; vary ONLY caveman intensity across **off / lite / full / ultra**. For each level report, on the SWE-bench corpus:
- **pass-rate** (shared external scorer — see §4),
- **cost ($)** per resolved task (median + bootstrap CI, two-stage task weighting),
- **token breakdown** (input/output/cacheRead/cacheWrite) — supplementary,
- vs the **off** baseline: cost delta % and pass-rate delta (with CI).

This yields #9's "≤X% quality delta for Y% token saving" statement (or shows degradation → triggers the reasoning-trace gate, §7).

## 2. Caveman intensity control (per-run, non-interactive)

The spawned `caveman` child must run at a chosen level without interaction. Wire a knob the non-interactive (`-p`/`--mode json`) path honors:
- Prefer a CLI flag `--cave <off|lite|full|ultra>` mapping to: `off` → `setCaveModeSessionIntensity` disabled (so `buildCaveModePrompt` returns "" — `system-prompt.ts:178,180`); `lite|full|ultra` → enabled + that intensity (`agent-session.ts:1874-1876`, `:3695`).
- If adding a flag is out of scope, set it via an isolated settings file (`caveMode.enabled` + `caveMode.intensity`, `settings-manager.ts:1107,1120`) the child reads — but a flag is cleaner + testable.
- **Verify `off` truly removes the cave-mode block from the system prompt** (not just relabels) — assert the rendered prompt has no Communication-Style/Cave section at `off`.

## 3. Pure accounting module `research/evals/honest-metrics.ts` (testable, no I/O)

```ts
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; }
export const totalProcessed = (u: Usage) => u.input + u.output + u.cacheRead + u.cacheWrite; // supplementary only

export interface PricingRow { input: number; output: number; cacheRead: number; cacheWrite: number; } // $/Mtok
export function computeCost(u: Usage, table: Record<string, PricingRow>, model: string): number | null; // null if model unpriced

export interface Run { level: "off"|"lite"|"full"|"ultra"|"codex"; model: string; task: string; seed: number; resolved: boolean; usage: Usage|null; parseStatus: "ok"|"failed"|"n/a"; }

/** Two-stage, equal task weight, MEDIAN: per-task median over resolved seeds, then median over tasks. Cost via shared table. */
export function costPerResolved(runs: Run[], table: Record<string,PricingRow>): { level: string; model: string; medianCost: number; nTasks: number }[];

/** Pass-rate per (level, model): resolved tasks / attempted tasks (shared scorer). */
export function passRate(runs: Run[]): { level: string; model: string; rate: number; n: number }[];

/** LOG-ratio bootstrap of cost vs the `off` baseline, per level, over tasks BOTH levels resolved (same seed).
 *  Returns exp(CI). nPairs<10 → ci:null + "insufficient_pairs". width>3x → powerWarning. pairedRate<0.5 → flag. */
export function costDeltaVsOff(runs: Run[], table: Record<string,PricingRow>, prng: () => number): { level: string; medianRatio: number|null; ci95: [number,number]|null; nPairs: number; pairedRate: number; powerWarning: boolean; note?: string }[];

export function parseFailureRate(runs: Run[], level: string): number;
/** Codex best-effort: parse Usage+model ONLY (never cost — cost computed via shared table). Missing input|output → failed. */
export function parseCodexUsage(stdout: string): { usage: Usage|null; model: string|null; status: "ok"|"failed" };
export function meanSdMedian(xs: number[]): { median: number; mean: number; sd: number; n: number };
```

Bootstrap: percentile bootstrap on `log(cost_level/cost_off)` per matched (task,seed) pair, exponentiate endpoints; **seeded PRNG** passed in (deterministic tests). No external dep.

## 4. Shared external resolver (both levels AND codex)

`Run.resolved` is set by ONE verifier — the SWE-bench patch evaluator (`research/evals/evaluate-patches.sh` / `evaluate_predictions`) applied to each run's produced patch — **never** the tool's own exit code. Same scorer for every level and for codex. (Without this the cost-per-resolved denominator isn't a shared unit.)

## 5. Single price table + model as first-class axis

- `pricingTable` (one source, dated, in `honest-metrics.ts`): per model → {input,output,cacheRead,cacheWrite}/Mtok. Both caveman levels and codex compute `cost = computeCost(usage, table, model)`.
- All aggregates group by `(level, model)`. The ablation holds model FIXED across levels, so the on-vs-off comparison is iso-model by construction. Codex (different model) is reported separately + labeled; comparing codex cost to caveman cost across model tiers → manifest `comparable:"model-tier-mismatch"` (never an iso-model headline).

## 6. Orchestration, outputs, reproducibility

- `--levels off,lite,full,ultra` (+ optional `codex`), `--seeds <n>` (default 5; doc that a tight CI needs more), `--model <id>` (fixed across levels), `--tasks swebench`, `--limit <n>`.
- **run-swebench.ts**: capture all 4 token fields (`:162,:233`); error path nulls all 4 (`:241`, not 0). Reused as the caveman run path per level.
- Per-(level,task,seed) raw artifacts: `research/results/<run-id>/<level>/<task>-s<seed>.{log,json}`, committed. Codex stdout retained for audit.
- `manifest.json`: git SHA, model + pricing tier, seeds, per-level {passRate, medianCostPerResolved, costDeltaVsOff (median ratio + exp-CI + nPairs + pairedRate + powerWarning)}, parseFailureRate (codex), `comparable` flags, `cache_warmup_effect`. **No `total_processed`** in manifest (cherry-pick vector) — raw CSV only. Codex `parseFailureRate>0.1` → `comparable:false` + reason.
- Scripts: `"bench:honest": "tsx research/evals/run-honest-bench.ts"`, `"bench:test": "vitest run research/evals"`.

## 7. #9 result-conditional follow-up (reasoning traces)
If the run shows a material pass-rate drop ON vs OFF, #9's remedy is to **gate caveman-mode OUT of the model's reasoning traces** and apply it only to final user-facing prose (`buildCaveModePrompt` currently injects into all generation incl. reasoning). The harness produces the evidence; the gating change is a **separate follow-up** triggered by the data (not built now).

## 8. Live claim + follow-up
- README/site: replace "~2× fewer tokens" with neutral **"token efficiency under revalidation — see #8"** (no number). 
- File a follow-up issue: run the paid ablation, publish the ON-vs-OFF table, update/restore a claim only if the data supports it.

## 9. Test plan (`research/evals/__tests__/honest-metrics.test.ts`, `npm run bench:test`)
- `computeCost`: prices each class; unpriced model → null.
- `costPerResolved`: two-stage equal-task-weight median; excludes unresolved; hand-checked fixture exposing the weighting (a task resolving 5× must not dominate).
- `costDeltaVsOff`: log-ratio bootstrap; nPairs<10 → ci null+insufficient_pairs; width>3× → powerWarning; pairedRate<0.5 flagged; CI brackets median; deterministic under seeded PRNG.
- `passRate`: resolved/attempted per (level,model).
- `parseCodexUsage`: fixture = a CAPTURED real codex stdout sample (committed w/ provenance) → ok; missing output → failed (no fabrication); garbage → failed. **If no real sample is available, mark the codex path UNCONFIRMED in code + manifest and treat 100% parse-fail as expected.**
- `parseFailureRate`, `meanSdMedian`: hand-checked.
- `off`-disables-prompt: rendered system prompt at `off` contains no cave-mode block.

## 10. Definition of Done
- ON-vs-OFF ablation harness at fixed model: per-level pass-rate + cost (median + bootstrap CI) + delta-vs-off; SWE-bench corpus; shared external resolver; single price table; model fixed across levels.
- `--cave off|lite|full|ultra` (or equivalent) honored non-interactively; `off` verified to remove the prompt block.
- Codex best-effort, parse-or-exclude, `comparable:false` on >10% parse-fail or model-tier mismatch; no fabrication; codex path flagged UNCONFIRMED absent a real stdout sample.
- run-swebench captures 4 token fields + nulls on error; per-(level,task,seed) artifacts + `manifest.json` (no total_processed); `bench:honest` + `bench:test`.
- Accounting math unit-tested green without a live run.
- README claim → neutral wording (number dropped) + follow-up issue filed.
- `tsgo --noEmit` clean, biome clean. (Paid run + published ON-vs-OFF table: maintainer follow-up.)
