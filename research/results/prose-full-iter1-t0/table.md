# Prose Microbench — GATED output-token reduction (single-turn Q&A)

> HONESTY: gated-median reduction over PASS prompts only; headline valid ONLY when n_pass/n_total >= 0.80.
> Substance gate per DD §0.1: PASS = reduction>0 AND recall>=0.90 AND qualifierFidelity>=0.90 AND addedUnsupported==0 AND stable.
> NO bootstrap-CI at small n — distribution reported. PARTIAL view, NOT total cost (#36).

Model-under-test: `openai/gpt-4o-mini` | Judge: `openai/gpt-4.1` (prose-judge-v1) | split: `tune` | repeats: 3

| prompt | genre | split | reduction | recall | qualFid | addedUnsup | maxSpread | PASS |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | :---: |
| code-explain-roles | code-explain | tune | 7.1% | 0.64 | 1.00 | 2 | 7.3% | fail |
| code-explain-honest-metrics | code-explain | tune | 26.8% | 0.76 | 0.00 | 1 | 11.0% | fail |
| tradeoff-median-vs-mean | trade-off | tune | 12.8% | 0.92 | 0.00 | 2 | 25.0% | fail |
| tradeoff-temp0-vs-repeats | trade-off | tune | 39.3% | 0.60 | 0.50 | 2 | 20.4% | fail |
| risk-cave-always-on | risk-enumeration | tune | 37.3% | 0.43 | 1.00 | 3 | 7.1% | fail |
| trace-reduction-null-baseline | multi-step-trace | tune | 3.6% | 0.00 | 0.00 | 7 | 4.0% | fail |
| factual-temp0-meaning | short-factual | tune | 8.5% | 1.00 | 1.00 | 1 | 0.0% | fail |

**Gated-median reduction (PASS prompts):** 0.0% (mean 0.0%)
**n_pass / n_total:** 0 / 7 (0%) — headline INVALID (need >=80% PASS)
