# DD — Caveman prose 40% output cut, honestly (issue: prose-40pct)

**Status:** PRD + DD councils SPLIT (red-team BLOCK both). All guardrails folded (§0 + §0.1). Target = **~40% output-token reduction AT preserved substance**, on a LOCKED test set + 2nd model — not raw token reduction, and only if the honest ceiling allows.

## 0.1 DD-council hardening (authoritative — supersede where they conflict)
The gate must not be gameable by the tuner. Final design:
- **Frozen judge oracle.** The judge prompt TEXT + judge MODEL are committed to source and **version-locked BEFORE any tuning** (Phase B may not edit them). Judge model ≠ model-under-test (use a strong model, e.g. `gpt-4.1` or `claude-sonnet-4-6`). Judge lists **atomic** claims in REFERENCE and returns three scores:
  - **recall** = fraction of REFERENCE claims present in CANDIDATE,
  - **qualifier_fidelity** = of REFERENCE claims carrying a correctness condition (only-if / unless / requires / warning / risk), fraction preserved (NOT inverted/dropped),
  - **added_unsupported** = count of CANDIDATE claims absent from / contradicting REFERENCE (hallucination/precision).
- **Per-prompt PASS** requires ALL: `reductionPct > 0` AND `recall ≥ 0.90` AND `qualifier_fidelity ≥ 0.90` AND `added_unsupported == 0`. A fail (incl. a LONGER answer) does NOT count as a win.
- **Headline = gated-median reduction over PASS prompts, AND require `n_pass/n_total ≥ 0.80`** to claim a headline. Always report `n_pass/n_total` + the per-prompt distribution. **No bootstrap-CI claim at small n** — report the distribution; expand corpus toward ≥15 (≥3 per genre) where feasible.
- **Three partitions, locked test.** `tune` (iterate here) / `validation` (go-no-go signal; do NOT re-tune against specific validation failures) / **`test` = LOCKED** (committed + hashed before tuning starts; evaluated EXACTLY ONCE at the end on the 2nd model). Pre-register the final prompt (commit it) before the single test run.
- **Ceiling probe = HARD futility stop.** Run `ultra` (gated) on `tune` FIRST. If gated reduction `< 38%`, **report the honest ceiling and STOP Phase B** (no grinding toward an unreachable 40%). Ultra is a feasibility signal, not an exact bound on `full`.
- **Stability:** **n≥3 per (prompt,condition) at temp=0** (not "and/or"); report max per-prompt token variance; flag/exclude any prompt with max−min > 5% of mean.
- **Corpus diversity:** genres = code-explain, trade-off, risk-enumeration, multi-step-trace, short-factual; ≥3 per genre across the partitions; for the test set, prefer ≥1 prompt with EXTERNAL ground truth (known answer) so the judge isn't only graded against verbose off-mode.
- **Scope (stated, not accidental):** this measures **single-turn batch** prose only. Multi-turn / interactive UX regression (cryptic fragments mid-session) is **out of scope** for this work item.
- **Judge calibration:** before trusting it, hand-score the judge on ~3 prompts' claim lists; report agreement; if >10% disagreement, fix the judge prompt (then re-freeze).

**Honest-outcome clause:** if the gated ceiling is ~25–30%@substance, that IS the deliverable (report it) — the goal is "get close," not fabricate 40%.

## 0. Council resolutions (authoritative)
1. **Objective = max output-reduction SUBJECT TO substance-recall ≥ 0.90** (per prompt). Token reduction with recall below the floor does NOT count. No credit for omission.
2. **Automated substance gate** (LLM-judge), in the bench loop — not eyeball.
3. **Train vs HELD-OUT prompt split**, with **diverse task genres** (not all "explain this file"): trade-off, risk-enumeration, multi-step reasoning, short factual. Tune on train; validate on held-out (don't peek until final).
4. **2nd model (sonnet) = HARD gate** with explicit threshold, run before "done."
5. **temp=0** (and/or n≥3/cell) for stable token counts; report **per-prompt floor + distribution + bootstrap CI**, not bare median.
6. **Probe the `ultra` ceiling first** — establishes the realistic prompt-only max; if <~40%@recall, that's the honest ceiling to report (goal says "until close").
7. Prompt rewrite **preserves correctness-qualifying hedges** ("only safe if idempotent") + the existing EXCEPTIONS (code/commits/security/ambiguity). Distinguish substantive qualification from filler hedging IN the prompt text.
8. Honest scope note: output-prose is likely the *smallest* cost lever (vs input/tool/cache, #36); we pursue it per the explicit goal, but the report states this.

## 1. Bench upgrade — substance-recall judge (`run-prompt-prose.ts`)
Add an LLM-judge recall score so the metric is gated, not token-only.
- After both `off` and `full` responses for a prompt, one judge call (cheap, **temp 0**): "Here is REFERENCE (the off-mode answer) and CANDIDATE (full-mode). List the distinct key claims/points in REFERENCE. For each, is it present in CANDIDATE (possibly rephrased/terser)? Return `{recall: present/total, missing: [...]}`." Judge model configurable (`--judge-model`, default a strong-ish cheap model e.g. gpt-4o or gpt-4.1 — NOT the model under test, to reduce shared blind spots).
- Per prompt record: `out_off`, `out_full`, `reductionPct`, `recall`, `missing[]`.
- **Gated aggregate:** median reduction over prompts with `recall ≥ 0.90`; a prompt with recall < 0.90 is a **FAIL** (reported, excluded from any "win"). Report per-prompt table + the recall column + bootstrap CI on the gated median.
- Pure helpers (testable): the recall parse, the gating, the aggregate. Judge call itself is I/O (mocked in tests).

## 2. Prompt corpus — train + held-out, diverse genres
- Keep the 5 code-explain prompts as **train**. Add **held-out** prompts (≥5) spanning genres: a **trade-off** ("X vs Y, when each?"), a **risk-enumeration** ("risks of X in production?"), a **multi-step reasoning/trace** ("what happens if arg is null at line N — trace callers"), a **short factual** ("what does flag --z do?"), an **open-ended advice** one. Tag each `split: train|heldout`.
- `--split train|heldout|all` flag. Tuning uses `train`; final validation uses `heldout` (+ 2nd model).

## 3. Stability
`runCondition`: set **temperature 0** explicitly (and/or `--repeats N` averaging output tokens, default 1 with temp0). Document. Re-run stability: gated-median variance < 3pp across 2 runs before trusting a result.

## 4. Tuning loop (Phase B — I run it)
0. **Ceiling probe:** run current `ultra` on train (gated) → record max prompt-only reduction@recall. Sanity-check that ~40% is reachable; if ultra ≪ 40%@recall, report the ceiling + stop near it.
1. Rewrite `buildCaveModePrompt("full")` (`system-prompt.ts`) for harder compression: mandate bullet/fragment form, ban meta-scaffolding ("Overview:", restating the question, summary-of-summary), drop filler hedging + transitions + padding — **but explicitly keep**: correctness-qualifying conditions, edge-case/risk notes, and the EXCEPTIONS block (code/commits/security/genuine ambiguity → normal English).
2. Run `bench:prose --split train` (gated). Read gated-median reduction + per-prompt recall/floor.
3. Iterate (pre-registered: ≤ ~8 prompt revisions; stop when gated-median stable across 2 iters and ≥ ~40%, or at the documented ceiling).
4. **Validate (hard gates, before done):** `--split heldout` AND **2nd model `claude-sonnet-4-6`** must both show **≥35% gated-median reduction with recall ≥ 0.90 and per-prompt recall floor ≥ 0.85**. If held-out/2nd-model fail, the train win was overfit → back to step 1.

## 5. Success / DoD
- `bench:prose` gated-median output reduction **≈40% (≥35% close) at recall ≥ 0.90**, on train AND held-out AND 2nd model (sonnet).
- **Per-prompt floor:** no prompt below recall 0.85; report the full distribution + bootstrap CI.
- `ultra` ceiling documented; if 40% is above the honest ceiling, report the achieved max + why (goal = "get close").
- EXCEPTIONS intact (code/commit/security/ambiguity untouched) — verified.
- Existing system-prompt tests + new bench-judge unit tests + `tsgo` + biome green.
- Short report: before/after prompt, train/held-out/2nd-model gated numbers, recall, ceiling, honest caveats.

## 6. Phasing
- **Phase A (subagent, no tuning):** build §1 judge + §2 corpus + §3 temp0 into run-prompt-prose.ts + tests.
- **Phase B (me, iterative):** §4 tuning loop against the gated bench until DoD or honest ceiling.
- Then `/code-review` + final `/council`.
