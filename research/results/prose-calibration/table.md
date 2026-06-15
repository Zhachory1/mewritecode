# Prose Microbench — GATED output-token reduction (single-turn Q&A)

> HONESTY: gated-median reduction over PASS prompts only; headline valid ONLY when n_pass/n_total >= 0.80.
> Substance gate per DD §0.1: PASS = reduction>0 AND recall>=0.90 AND qualifierFidelity>=0.90 AND addedUnsupported==0 AND stable.
> NO bootstrap-CI at small n — distribution reported. PARTIAL view, NOT total cost (#36).

Model-under-test: `anthropic/claude-sonnet-4-6` | Judge: `openai/gpt-4.1` (prose-judge-v1) | split: `tune` | repeats: 3

| prompt | genre | split | reduction | recall | qualFid | addedUnsup | maxSpread | PASS |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | :---: |
| code-explain-roles | code-explain | tune | 28.6% | 0.80 | 1.00 | 2 | 11.5% | fail |
| code-explain-honest-metrics | code-explain | tune | 15.5% | 0.95 | 1.00 | 2 | 10.4% | fail |
| tradeoff-median-vs-mean | trade-off | tune | 17.6% | 1.00 | 1.00 | 0 | 17.8% | fail |

**Gated-median reduction (PASS prompts):** 0.0% (mean 0.0%)
**n_pass / n_total:** 0 / 3 (0%) — headline INVALID (need >=80% PASS)
