# Prose Microbench — GATED output-token reduction (single-turn Q&A)

> HONESTY: gated-median reduction over PASS prompts only; headline valid ONLY when n_pass/n_total >= 0.80.
> Substance gate per DD §0.1: PASS = reduction>0 AND recall>=0.90 AND qualifierFidelity>=0.90 AND addedUnsupported==0 AND stable.
> NO bootstrap-CI at small n — distribution reported. PARTIAL view, NOT total cost (#36).

Model-under-test: `anthropic/claude-sonnet-4-6` | Judge: `openai/gpt-4.1` (prose-judge-v1) | split: `tune` | repeats: 3

| prompt | genre | split | reduction | recall | qualFid | addedUnsup | maxSpread | PASS |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | :---: |
| code-explain-roles | code-explain | tune | 9.6% | 1.00 | 1.00 | 1 | 24.5% | fail |
| code-explain-honest-metrics | code-explain | tune | 31.8% | 0.92 | 1.00 | 1 | 13.0% | fail |
| tradeoff-median-vs-mean | trade-off | tune | 25.2% | 0.69 | 1.00 | 4 | 39.1% | fail |
| tradeoff-temp0-vs-repeats | trade-off | tune | 23.9% | 0.00 | 0.00 | 7 | 28.5% | fail |
| risk-cave-always-on | risk-enumeration | tune | 10.2% | 0.67 | 1.00 | 7 | 21.3% | fail |
| trace-reduction-null-baseline | multi-step-trace | tune | -449.5% | 0.47 | 1.00 | 6 | 150.8% | fail |
| factual-temp0-meaning | short-factual | tune | -17.0% | 0.50 | 1.00 | 1 | 8.1% | fail |

**Gated-median reduction (PASS prompts):** 0.0% (mean 0.0%)
**n_pass / n_total:** 0 / 7 (0%) — headline INVALID (need >=80% PASS)
