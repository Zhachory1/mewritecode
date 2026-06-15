# Prose Microbench — output-token reduction (single-turn Q&A)

> HONESTY: OUTPUT-prose compression on SINGLE turns only — a clean but PARTIAL view.
> Real savings also come from input/tool-output compression + prompt-cache reuse over long sessions (#36).
> Do NOT present this as total cost savings.

Model: `openai/gpt-4o-mini`

| prompt | out_off | out_full | Δ out | Δ% |
| --- | ---: | ---: | ---: | ---: |
| agent-roles | 492 | 427 | 65 | 13.2% |
| honest-metrics-header | 458 | 371 | 87 | 19.0% |
| ai-types-messages | 631 | 569 | 62 | 9.8% |
| settings-cave-knobs | 571 | 448 | 123 | 21.5% |
| readme-trick | 420 | 294 | 126 | 30.0% |

**Median output reduction:** 19.0% (mean 18.7%, n=5, excluded zero-baseline=0)
