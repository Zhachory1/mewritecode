# Prose Microbench — GATED output-token reduction (single-turn Q&A)

> HONESTY: gated-median reduction over PASS prompts only; headline valid ONLY when n_pass/n_total >= 0.80.
> Substance gate per DD §0.1: PASS = reduction>0 AND recall>=0.90 AND qualifierFidelity>=0.90 AND addedUnsupported==0 AND stable.
> NO bootstrap-CI at small n — distribution reported. PARTIAL view, NOT total cost (#36).

Model-under-test: `anthropic/claude-sonnet-4-6` | Judge: `openai/gpt-4.1` (prose-judge-v1) | split: `tune` | repeats: 3

| prompt | genre | split | reduction | recall | qualFid | addedUnsup | maxSpread | PASS |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | :---: |
| code-explain-roles | code-explain | tune | 26.3% | 1.00 | 1.00 | 0 | 21.2% | fail |
| code-explain-honest-metrics | code-explain | tune | 14.7% | 1.00 | 1.00 | 1 | 26.6% | fail |
| tradeoff-median-vs-mean | trade-off | tune | 25.2% | 0.95 | 0.86 | 2 | 53.7% | fail |
| tradeoff-temp0-vs-repeats | trade-off | tune | 36.5% | 0.62 | 1.00 | 4 | 23.0% | fail |
| risk-cave-always-on | risk-enumeration | tune | -6.6% | 0.75 | 1.00 | 4 | 33.2% | fail |
| trace-reduction-null-baseline | multi-step-trace | tune | -216.1% | 0.71 | 1.00 | 0 | 130.0% | fail |
| factual-temp0-meaning | short-factual | tune | 9.3% | 1.00 | 1.00 | 0 | 0.0% | PASS |

**Gated-median reduction (PASS prompts):** 9.3% (mean 9.3%)
**n_pass / n_total:** 1 / 7 (14%) — headline INVALID (need >=80% PASS)
