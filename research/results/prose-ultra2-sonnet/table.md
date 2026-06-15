# Prose Microbench — GATED output-token reduction (single-turn Q&A)

> HONESTY: gated-median reduction over PASS prompts only; headline valid ONLY when n_pass/n_total >= 0.80.
> Substance gate per DD §0.1: PASS = reduction>0 AND recall>=0.90 AND qualifierFidelity>=0.90 AND addedUnsupported==0 AND stable.
> NO bootstrap-CI at small n — distribution reported. PARTIAL view, NOT total cost (#36).

Model-under-test: `anthropic/claude-sonnet-4-6` | Judge: `openai/gpt-4.1` (prose-judge-v1) | split: `tune` | repeats: 3

| prompt | genre | split | reduction | recall | qualFid | addedUnsup | maxSpread | PASS |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | :---: |
| code-explain-roles | code-explain | tune | 32.5% | 0.80 | 1.00 | 2 | 35.7% | fail |
| code-explain-honest-metrics | code-explain | tune | 40.3% | 0.86 | 1.00 | 0 | 21.8% | fail |
| tradeoff-median-vs-mean | trade-off | tune | 22.6% | 0.88 | 1.00 | 2 | 23.7% | fail |
| tradeoff-temp0-vs-repeats | trade-off | tune | 29.4% | 0.67 | 1.00 | 3 | 25.8% | fail |
| risk-cave-always-on | risk-enumeration | tune | 12.9% | 0.45 | 1.00 | 4 | 19.4% | fail |
| trace-reduction-null-baseline | multi-step-trace | tune | -6.7% | 0.79 | 0.50 | 2 | 47.0% | fail |
| factual-temp0-meaning | short-factual | tune | -21.6% | 1.00 | 1.00 | 1 | 17.6% | fail |

**Gated-median reduction (PASS prompts):** 0.0% (mean 0.0%)
**n_pass / n_total:** 0 / 7 (0%) — headline INVALID (need >=80% PASS)
