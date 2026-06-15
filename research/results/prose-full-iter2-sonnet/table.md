# Prose Microbench — GATED output-token reduction (single-turn Q&A)

> HONESTY: gated-median reduction over PASS prompts only; headline valid ONLY when n_pass/n_total >= 0.80.
> Substance gate per DD §0.1: PASS = reduction>0 AND recall>=0.90 AND qualifierFidelity>=0.90 AND addedUnsupported==0 AND stable.
> NO bootstrap-CI at small n — distribution reported. PARTIAL view, NOT total cost (#36).

Model-under-test: `anthropic/claude-sonnet-4-6` | Judge: `openai/gpt-4.1` (prose-judge-v1) | split: `tune` | repeats: 3

| prompt | genre | split | reduction | recall | qualFid | addedUnsup | maxSpread | PASS |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | :---: |
| code-explain-roles | code-explain | tune | 37.3% | 0.67 | 1.00 | 2 | 19.8% | fail |
| code-explain-honest-metrics | code-explain | tune | 33.7% | 0.81 | 1.00 | 2 | 32.5% | fail |
| tradeoff-median-vs-mean | trade-off | tune | 17.9% | 1.00 | 1.00 | 2 | 15.3% | fail |
| tradeoff-temp0-vs-repeats | trade-off | tune | 33.8% | 0.81 | 1.00 | 3 | 35.3% | fail |
| risk-cave-always-on | risk-enumeration | tune | 15.4% | 0.59 | 0.00 | 6 | 57.1% | fail |
| trace-reduction-null-baseline | multi-step-trace | tune | -63.6% | 0.40 | 1.00 | 0 | 183.3% | fail |
| factual-temp0-meaning | short-factual | tune | 24.5% | 0.50 | 1.00 | 1 | 9.9% | fail |

**Gated-median reduction (PASS prompts):** 0.0% (mean 0.0%)
**n_pass / n_total:** 0 / 7 (0%) — headline INVALID (need >=80% PASS)
