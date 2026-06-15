# Prose Microbench — GATED output-token reduction (single-turn Q&A)

> HONESTY: gated-median reduction over PASS prompts only; headline valid ONLY when n_pass/n_total >= 0.80.
> Substance gate per DD §0.1: PASS = reduction>0 AND recall>=0.90 AND qualifierFidelity>=0.90 AND addedUnsupported==0 AND stable.
> NO bootstrap-CI at small n — distribution reported. PARTIAL view, NOT total cost (#36).

Model-under-test: `anthropic/claude-sonnet-4-6` | Judge: `openai/gpt-4.1` (prose-judge-v1) | split: `tune` | repeats: 3

| prompt | genre | split | reduction | recall | qualFid | addedUnsup | maxSpread | PASS |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | :---: |
| code-explain-roles | code-explain | tune | 23.2% | 1.00 | 1.00 | 2 | 58.6% | fail |
| code-explain-honest-metrics | code-explain | tune | 7.7% | 1.00 | 1.00 | 0 | 33.8% | fail |
| tradeoff-median-vs-mean | trade-off | tune | 13.4% | 0.77 | 0.80 | 5 | 25.0% | fail |
| tradeoff-temp0-vs-repeats | trade-off | tune | -14.1% | 0.36 | 0.20 | 4 | 70.0% | fail |
| risk-cave-always-on | risk-enumeration | tune | 17.8% | 0.21 | 0.50 | 6 | 51.5% | fail |
| trace-reduction-null-baseline | multi-step-trace | tune | -58.7% | 1.00 | 1.00 | 0 | 151.2% | fail |
| factual-temp0-meaning | short-factual | tune | 4.0% | 0.50 | 1.00 | 1 | 12.0% | fail |

**Gated-median reduction (PASS prompts):** 0.0% (mean 0.0%)
**n_pass / n_total:** 0 / 7 (0%) — headline INVALID (need >=80% PASS)
