# Judge anti-rubber-stamp controls — v1 vs v2

| fixture | kind | metric | expected (v2) | v1 actual | v2 actual | v2 holds |
| --- | --- | --- | --- | ---: | ---: | :---: |
| para-risks-reordered | paraphrase | recall | recall >= 0.9 | 1.000 | 1.000 | yes |
| para-tradeoff-merged | paraphrase | recall | recall >= 0.9 | 1.000 | 1.000 | yes |
| para-trace-restructured | paraphrase | recall | recall >= 0.9 | 1.000 | 1.000 | yes |
| omit-2-of-4-risks | omission | recall | recall <= 0.600 ((N−K)/N + 0.1) | 0.500 | 0.500 | yes |
| omit-1-of-3-tradeoff | omission | recall | recall <= 0.767 ((N−K)/N + 0.1) | 0.667 | 0.667 | yes |
| omit-3-of-4-trace | omission | recall | recall <= 0.350 ((N−K)/N + 0.1) | 0.250 | 0.250 | yes |
| qual-drop-temp0-determinism | qualifier-drop | qualifierFidelity | qualifierFidelity <= 0.99 (dropped condition) | 0.000 | 0.000 | yes |
| qual-drop-cache-reuse | qualifier-drop | qualifierFidelity | qualifierFidelity <= 0.99 (dropped condition) | 0.000 | 0.000 | yes |
| halluc-added-metric | hallucination | addedUnsupported | addedUnsupported >= 1 | 1.000 | 1.000 | yes |
| halluc-added-step | hallucination | addedUnsupported | addedUnsupported >= 1 | 1.000 | 1.000 | yes |

## Verdict

- paraphrase fixed (v2 recall up vs v1): **NO**
- still catches omissions / qualifiers / hallucinations: **YES**
- **v2 REJECTED**

- v2 does NOT beat v1 on paraphrase para-risks-reordered: v1=1.000 v2=1.000 (no improvement → v2 buys nothing)
- v2 does NOT beat v1 on paraphrase para-tradeoff-merged: v1=1.000 v2=1.000 (no improvement → v2 buys nothing)
- v2 does NOT beat v1 on paraphrase para-trace-restructured: v1=1.000 v2=1.000 (no improvement → v2 buys nothing)

v2 REJECTED by the controls — do NOT adopt v2 as the gate.
