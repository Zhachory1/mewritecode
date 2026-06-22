# Prose-40pct — Report: the honest ceiling (directional)

**Goal:** push caveman `full` single-turn output-token cut from ~19% to ~40% **at preserved substance**, via prompt tuning, measured by the gated `bench:prose` harness (DD §0/§0.1).

**Outcome (revised after gold re-measurement):** the ~26% "ceiling" was **partly a measurement artifact of the padded baseline** — when recall is graded against a *faithful, complete-but-terse gold* instead of the bloated off-mode answer, the cleanest-measured prompt jumps to **47.9% reduction at recall 1.0 / qf 1.0** (code-explain). So **40%@substance IS reachable on compressible genres.** It is **not** a clean uniform median: the gold method only worked where the gold was faithful (2–3/7 prompts; the rest produced lossy golds the validation flagged), and the padding-vs-substance line is not reliably automatable. Net: 40% is achievable per-genre where content has compressible filler, unreachable where answers are already dense — a **genre-dependent ceiling**, not a flat "~15–26%." See "Gold-reference re-measurement" below. The earlier prose-prompt tuning (rules×2 + few-shot, 2 models) hit a ~15–26% ceiling *as measured against the padded baseline*; that measurement understated the true substance-preserving cut.

> **Status (council review, 2026-06-15):** ab-critic + ml-scientist = SHIP-WITH-CHANGES, red-team = BLOCK (dissent preserved). All three agreed the *direction* is robust but the first draft **oversold** it. This revision: softens "proven frontier" → directional; makes the variance-gate limitation primary; records the (previously skipped) judge calibration; scopes to tune-only; qualifies the #38 claim. red-team's standing dissent: do not treat this as a *protocol-complete* study — validation/test splits were not run (documented waiver below).

---

## The finding: reduction and substance trade off; 40%@substance is past where prompts land

Objective = *max output reduction SUBJECT TO* substance preserved (recall ≥ 0.90, qualifier-fidelity ≥ 0.90, zero added/hallucinated claims). Walking two prompt variants on sonnet (claude-sonnet-4-6), temp=0, n=3, gpt-4.1 judge, **tune split (n=7)**:

| `full` variant | RAW median reduction | mean recall | substance-clean prompts (variance-blind) |
|---|---|---|---|
| **iter1** (substance-first: ban scaffolding, keep qualifiers, no invent) | 14.7% | **0.86** | 2/7 |
| **iter2** (iter1 + hard "never expand / always shorter") | **24.5%** | 0.68 | 0/7 |
| **few-shot** (verbose→terse exemplars instead of rules) | 10.2% | 0.61 | 0/7 |

Anti-expansion bought +10pp of reduction by **spending recall** (0.86 → 0.68). **Few-shot** (the council's one named untried lever) was the WORST: it triggered verbose *imitation* on some genres (the multi-step-trace prompt expanded −449%), helping exactly one prompt (honest-metrics 31.8% @ recall 0.92, fails on a single hallucination) and hurting the rest — confirming the ceiling is **not rules-specific**. Not shipped (reverted to iter1). The single best substance-clean point across all **three** strategies × two models was `code-explain-roles` at **26% reduction, recall 1.0 / qf 1.0 / 0 hallucinations** (iter1, sonnet); the median never clears ~15% at substance. Nothing reached ~40% with recall ≥ 0.90 — the closest, `code-explain-honest-metrics` at 40.3%, did it by dropping/altering content (recall 0.857 + hallucinations).

**Why the direction is robust to the caveats:** the reduction↔substance tension is monotonic across **every** combination tested (3 prompt strategies × 2 models × 7 prompts × 5 genres) — wherever reduction exceeds ~30%, recall falls to 0.4–0.7. Even discarding the LLM judge entirely and reading raw behavior, hard compression visibly drops claims. A negative result of this shape cannot be manufactured by a lenient judge (lenient → *over*-counts passes), and calibration (below) found the judge defensible. The realistic substance-preserving single-turn cut is **~15% median (best genre ~26%)**, not 40%.

### Two mechanisms behind the wall
- **Information-theoretic:** substantive technical answers are dense; cutting 40% of tokens means omitting claims. The model already follows "keep all claims + qualifiers" (sonnet qf = 1.0 on 6/7 with iter1) — it isn't misunderstanding the task, the content just doesn't compress that far.
- **Expansion:** caveman prompting can make output *longer* on some genres — sonnet expanded the multi-step-trace prompt to −216% (iter1) / −63% (iter2), restructuring into a verbose trace. Ultra's original symbol/bullet mandates made this worse (fixed; see deliverables).

---

## Gold-reference re-measurement (removing the padded-baseline bias)
The frontier above grades recall against the **off-mode (verbose) answer**, which is padded — so caveman dropping *filler* is wrongly scored as lost recall (Caveat 3). To remove that bias: generate a frozen **gold** answer per prompt with a *different* model (gpt-4.1, completeness-first prompt, `prose-gold-v1`), **validate the gold is non-lossy** (judge recall of off-mode-claims-in-gold ≥ 0.85), and re-grade caveman recall against the gold. Reduction stays vs off (the real verbose baseline). Anti-gaming: gold model ≠ model-under-test, golds frozen before measuring, judge unchanged.

Result (sonnet, tune):

| prompt | gold faithful? (off-in-gold) | reduction (vs off) | recall vs gold | qf | added |
|---|---|---|---|---|---|
| **code-explain-roles** | yes (0.875) | **47.9%** | **1.00** | **1.00** | 1 |
| code-explain-honest-metrics | yes (0.95) | 14.9% | 0.94 | 0.50 | 1 |
| factual-temp0-meaning | yes (1.0) | 17.0% | 0.75 | 0.00 | 0 |
| tradeoff-median / tradeoff-temp0 / risk / trace | **NO — lossy gold (0.43 / 0.09 / 0.25 / 0.0)** | — | invalid | — | — |

- **The padded-baseline bias is real and material.** On `code-explain-roles` (faithful gold), caveman hits **47.9% reduction at recall 1.0 / qf 1.0** — its "26% ceiling" under the padded baseline was a measurement artifact. **40%@substance is reachable on compressible genres.** (It still trips the *strict* gate on `added=1` — one claim present in caveman but not the gold; `added` text isn't stored, so can't adjudicate real-addition vs minor-hallucination.)
- **But the method only worked on 2–3/7 prompts.** For trade-off/risk/trace, the gpt-4.1 "complete" gold dropped most of off-mode's claims (off-in-gold 0.0–0.43), so the validation flagged the golds **suspect** and grading against them is invalid. This is the same unresolved ambiguity in another form: a low off-in-gold means *either* off-mode is mostly padding (gold is fine) *or* the gold dropped real substance — **claim-counting cannot tell which**, so the gold floor is itself confounded.
- **Net:** 40%@substance is achievable where answers carry compressible filler (demonstrated ~48% on code-explain), and unreachable where answers are already dense. The ceiling is **genre-dependent**, not a flat ~15–26%. A clean cross-genre 40% median is *not* demonstrated (gold method limited to faithful-gold prompts; n small; `added=1` failures).

## Is the judge under-counting? Tested — NO (hypothesis refuted by controls)
I hypothesized the frozen judge under-counts recall on *reworded/reorganized* claims (the `risk-cave-always-on` gold scored off-in-gold=0.25 despite seeming to cover the same risks). To test it without gaming, a **semantic-matching judge v2** was built *with hard anti-rubber-stamp controls* (`research/evals/judge-controls.ts`): paraphrase fixtures (must score recall≥0.9 AND beat v1) + omission/qualifier/hallucination fixtures (v2 must STILL fail genuine drops). Ran v1 vs v2 on the real gpt-4.1 judge.

**Result: the hypothesis is REFUTED.** v1 already scores **recall 1.0 on every clean paraphrase fixture** — it matches reworded/reordered/merged claims correctly. v2 scored identically (1.0), so it "buys nothing" and the controls **REJECTED v2** (kept v1). Both versions correctly caught the omission (recall 0.25–0.67), qualifier-drop (qf 0), and hallucination (added≥1) fixtures.

**Implication:** the `risk` prompt's 0.25 was NOT a matching bug — the verbose off-mode genuinely had *more atomic claims* (elaboration, examples, sub-cases) than the terse answer, which dropped them. Whether those extra claims are **padding or substance is the irreducible ambiguity** (Caveat 3) — not a measurement defect a better judge can fix. So the "~26% ceiling / ~18% median" are **real reflections of terse answers carrying fewer atomic claims**, not a depressed measurement. The reduction↔substance trade-off is genuine.

(This corrects an earlier draft of this section that claimed "the binding constraint is the judge" — the controls disproved it. The anti-gaming machinery worked: a hypothesized bug, a fix built with falsifiable controls, and the controls rejected the fix rather than manufacturing a favorable number.)

**Net honest read (final):** 40%@substance is reachable **only where answers carry genuine compressible filler** — demonstrated at 48% on `code-explain` (its padded-baseline penalty was real, removed by the faithful gold), but NOT on claim-dense genres, where a 40% token cut means dropping real claims. A *uniform* ~40% median is therefore not a well-posed target (genre density varies), and the achievable median for dense technical Q&A is ~15–26%. This is the information-theoretic ceiling, now triangulated from three angles (prompt strategies, gold reference, semantic-judge controls) with the measurement validated rather than assumed.

## Caveats — read before quoting any number

1. **The variance gate (5%-spread exclusion) is too tight for this setting and is NOT the headline.** temp=0 is *not* deterministic on these providers: per-prompt output-length spread is 20–130% across n=3 repeats (trace prompt: 130%). So the frozen 5% variance-exclusion flags 6–7/7 prompts "unstable" and the gated `n_pass` is 0–1/7 in every run — **driven by provider non-determinism, not substance**. The 26%-at-perfect-substance result fails the full gate on variance alone. **The honest substance read is the "substance-clean (variance-blind)" column above**, not the gated `n_pass`. The frozen gate was *not* edited after seeing data (that would be gaming); the threshold is flagged here as empirically miscalibrated for open-ended generation at temp=0. A follow-up should re-derive the threshold from the observed spread distribution (e.g. ~30–40%) or use n ≥ 5 with an IQR test.
2. **Judge calibration (DD §0.1) — done, with a residual gap.** Hand-scored the gpt-4.1 judge's per-claim verdicts on 3 prompts (claims are now persisted to `results.json`):
   - `tradeoff-median-vs-mean` (recall 1.0): 15/15 present — agree.
   - `code-explain-honest-metrics` (recall 0.95): 18/19 present, arithmetic correct, but the reference was **over-atomized** (several near-duplicate claims), which biases recall *pessimistic*.
   - `code-explain-roles` (recall 0.80): the 2 "absent" claims are genuinely interpretive/optional — defensible.
   - **Verdict: recall + qualifier verdicts are defensible (< 10% disagreement); over-atomization bias runs *against* the compression result, so true substance is if anything slightly better than scored — it does not flip "40% unreachable."** Residual gap: stored `claims[]` are *reference* claims only, so `added_unsupported` (candidate-only claims) is a count without text — not yet fully auditable. Storing candidate claims is a follow-up.
3. **Recall is graded against the verbose off-mode reference,** which is padded (gpt-4o-mini emits ~10 risks where ~6 are substantive). Dropping padding counts as lost recall — under-crediting compression. Again biases *against* the result. The qualifier-fidelity and added-unsupported signals are independent of this.
4. **Scope (pre-registered partitions):** all runs are on the **tune split** (n=7, single domain — Me Write Code internals). The **validation and locked-test splits were NOT run.** For a *negative* result the tune-set monotonic trade-off is strong evidence (ml-scientist), but this is **not a protocol-complete study** (red-team): the DoD validation/2nd-model-test gates are **waived**, not satisfied. Treat "40% unreachable" as a well-supported hypothesis to stop on, not a measured ceiling. Only 2 of the ≤8 allowed iterations were run, both rules-based (no few-shot exemplars) — judged sufficient because the information-theoretic constraint is not prompt-fixable, but noted.

---

## Deliverables shipped (independent of the headline)

1. **temp=0 plumbing** (commit `9bf9cc7d`): `temperature` now threads `createAgentSession` → `AgentOptions` → `createLoopConfig` → `streamFn` → provider (verified end-to-end for openai + anthropic; ignored on anthropic when thinking is on, documented). Fixes the Phase-A deviation where temp was unplumbed. **Honest note:** it makes generations *more* deterministic but does **not** drop output-length variance below 5% on open-ended prompts — so it did not, by itself, make the variance gate satisfiable. Still a correct, reusable capability.
2. **Better `full` prompt** (iter1): bans meta-scaffolding (Overview:/restating/recap), explicitly keeps every claim + correctness qualifier, forbids invented detail. More substance-safe than baseline at comparable reduction (raw reduction is similar-or-slightly-lower; the gain is substance safety, on a calibrated-as-defensible judge). This shipped.
3. **Improved `ultra`** (#38 — *improved, not closed*): dropped the symbol/abbreviation/always-bullet mandates that made models expand + hallucinate; added the same substance guards. On sonnet (n=3, one model) vs original ultra: median raw reduction **7.7% → 22.6%**, mean recall **0.69 → 0.78**, mean hallucination **2.6 → 2.0**, trace expansion **−59% → −7%**. Clear improvement on the diagnosed pathology — **but** still 0/7 on the full gate, recall 0.78 < 0.90, and the short-factual prompt now expands −21.6%; validated on **one** model only. #38 stays open pending a 2nd-model check.

---

## Gated bench (frozen, reusable)
- `research/evals/run-prompt-prose.ts` — diverse 5-genre corpus, tune/validation/test splits, n≥3 @ temp=0, variance gate, gated aggregate + `n_pass/n_total`, `--ceiling-probe`. Persists judge per-claim rationale to `results.json`.
- `research/evals/prose-judge.ts` — frozen judge oracle `prose-judge-v1` (gpt-4.1, ≠ model-under-test): recall + qualifier-fidelity + added-unsupported.

## Raw results
`research/results/prose-ceiling{,-sonnet}/` (ultra ceiling probes), `prose-full-iter1{,-t0,-sonnet}/`, `prose-full-iter2-sonnet/`, `prose-ultra2-sonnet/`, `prose-calibration/` (judge calibration subset).

## Recommendation
Stop chasing 40% on single-turn prose — the evidence strongly indicates it's past the substance frontier, and the remaining uncertainty (validation split, judge added-claim audit) would not plausibly move it from ~15–26% to 40%. The shipped `full`/`ultra` prompts give an honest ~15–25% substance-safe cut. The user's lived 30–50% cost savings come from a different lever — tool-output compression + prompt-cache reuse amortized over long sessions (#36) — which this single-turn bench is structurally blind to. Cost work should go there.

### If someone wants to harden this to protocol-complete (red-team's bar)
Run the validation split on the shipped iter1 prompt; store candidate-side claims to audit `added_unsupported`; re-derive the variance threshold from observed spread (or n≥5 + IQR); then the locked-test split once on the 2nd model. None is expected to overturn the direction.
