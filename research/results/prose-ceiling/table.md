# Prose Microbench — GATED output-token reduction (single-turn Q&A)

> HONESTY: gated-median reduction over PASS prompts only; headline valid ONLY when n_pass/n_total >= 0.80.
> Substance gate per DD §0.1: PASS = reduction>0 AND recall>=0.90 AND qualifierFidelity>=0.90 AND addedUnsupported==0 AND stable.
> NO bootstrap-CI at small n — distribution reported. PARTIAL view, NOT total cost (#36).

Model-under-test: `openai/gpt-4o-mini` | Judge: `openai/gpt-4.1` (prose-judge-v1) | split: `tune` | repeats: 3

| prompt | genre | split | reduction | recall | qualFid | addedUnsup | maxSpread | PASS |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | :---: |
| code-explain-roles | code-explain | tune | 16.2% | 1.00 | 1.00 | 3 | 57.7% | fail |
| code-explain-honest-metrics | code-explain | tune | -16.5% | 0.67 | 0.00 | 2 | 77.1% | fail |
| tradeoff-median-vs-mean | trade-off | tune | 25.3% | 0.71 | 1.00 | 1 | 32.6% | fail |
| tradeoff-temp0-vs-repeats | trade-off | tune | 32.6% | 0.75 | 0.71 | 4 | 33.2% | fail |
| risk-cave-always-on | risk-enumeration | tune | 12.4% | 0.68 | 0.00 | 2 | 23.1% | fail |
| trace-reduction-null-baseline | multi-step-trace | tune | 25.8% | 1.00 | 1.00 | 1 | 17.2% | fail |
| factual-temp0-meaning | short-factual | tune | 32.0% | 0.80 | 1.00 | 0 | 12.0% | fail |

**Gated-median reduction (PASS prompts):** 0.0% (mean 0.0%)
**n_pass / n_total:** 0 / 7 (0%) — headline INVALID (need >=80% PASS)
