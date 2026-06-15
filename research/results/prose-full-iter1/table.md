# Prose Microbench — GATED output-token reduction (single-turn Q&A)

> HONESTY: gated-median reduction over PASS prompts only; headline valid ONLY when n_pass/n_total >= 0.80.
> Substance gate per DD §0.1: PASS = reduction>0 AND recall>=0.90 AND qualifierFidelity>=0.90 AND addedUnsupported==0 AND stable.
> NO bootstrap-CI at small n — distribution reported. PARTIAL view, NOT total cost (#36).

Model-under-test: `openai/gpt-4o-mini` | Judge: `openai/gpt-4.1` (prose-judge-v1) | split: `tune` | repeats: 3

| prompt | genre | split | reduction | recall | qualFid | addedUnsup | maxSpread | PASS |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | :---: |
| code-explain-roles | code-explain | tune | -5.7% | 1.00 | 1.00 | 1 | 44.4% | fail |
| code-explain-honest-metrics | code-explain | tune | 18.3% | 0.75 | 1.00 | 2 | 17.1% | fail |
| tradeoff-median-vs-mean | trade-off | tune | 38.9% | 0.69 | 1.00 | 1 | 56.9% | fail |
| tradeoff-temp0-vs-repeats | trade-off | tune | 36.8% | 0.60 | 0.50 | 2 | 51.7% | fail |
| risk-cave-always-on | risk-enumeration | tune | 36.7% | 0.70 | 0.00 | 3 | 87.1% | fail |
| trace-reduction-null-baseline | multi-step-trace | tune | -1.4% | 0.00 | 1.00 | 7 | 140.7% | fail |
| factual-temp0-meaning | short-factual | tune | 7.0% | 1.00 | 1.00 | 1 | 19.8% | fail |

**Gated-median reduction (PASS prompts):** 0.0% (mean 0.0%)
**n_pass / n_total:** 0 / 7 (0%) — headline INVALID (need >=80% PASS)
