# Prose Microbench — GATED output-token reduction (single-turn Q&A)

> HONESTY: gated-median reduction over PASS prompts only; headline valid ONLY when n_pass/n_total >= 0.80.
> Substance gate per DD §0.1: PASS = reduction>0 AND recall>=0.90 AND qualifierFidelity>=0.90 AND addedUnsupported==0 AND stable.
> NO bootstrap-CI at small n — distribution reported. PARTIAL view, NOT total cost (#36).

Model-under-test: `anthropic/claude-sonnet-4-6` | Judge: `openai/gpt-4.1` (prose-judge-v1) | reference: `gold` (`openai/gpt-4.1` prose-gold-v1; 4/7 golds flagged) | split: `tune` | repeats: 3

| prompt | genre | split | reduction | recall | qualFid | addedUnsup | maxSpread | PASS |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | :---: |
| code-explain-roles | code-explain | tune | 47.9% | 1.00 | 1.00 | 1 | 33.1% | fail |
| code-explain-honest-metrics | code-explain | tune | 14.9% | 0.94 | 0.50 | 1 | 15.1% | fail |
| tradeoff-median-vs-mean | trade-off | tune | 15.9% | 1.00 | 1.00 | 2 | 18.4% | fail |
| tradeoff-temp0-vs-repeats | trade-off | tune | 21.4% | 0.67 | 0.60 | 3 | 54.6% | fail |
| risk-cave-always-on | risk-enumeration | tune | 18.0% | 0.90 | 1.00 | 2 | 31.6% | fail |
| trace-reduction-null-baseline | multi-step-trace | tune | 71.7% | 0.00 | 1.00 | 4 | 162.3% | fail |
| factual-temp0-meaning | short-factual | tune | 17.0% | 0.75 | 0.00 | 0 | 9.0% | fail |

**Gated-median reduction (PASS prompts):** 0.0% (mean 0.0%)
**n_pass / n_total:** 0 / 7 (0%) — headline INVALID (need >=80% PASS)
