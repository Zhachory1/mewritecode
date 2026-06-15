---
id: tradeoff-temp0-vs-repeats
goldModel: gpt-4.1
promptVersion: prose-gold-v1
questionB64: Rm9yIHN0YWJsZSB0b2tlbi1jb3VudCBtZWFzdXJlbWVudHMsIGNvbXBhcmUgc2V0dGluZyB0ZW1wZXJhdHVyZT0wIHZlcnN1cyBhdmVyYWdpbmcgb3ZlciBOPjEgcmVwZWF0cy4gV2hlbiBkb2VzIGVhY2ggaGVscCwgYW5kIHdoZW4gZG8geW91IG5lZWQgYm90aD8=
---
- Setting temperature=0 ensures deterministic model outputs, eliminating sampling randomness and making token counts stable across runs, provided all other inputs and settings are identical.
- Averaging over N>1 repeats helps only when temperature>0 or other sources of nondeterminism exist, as it smooths out variability in token counts caused by stochastic sampling.
- If the model or system is fully deterministic at temperature=0, averaging is unnecessary; a single run suffices for stable token counts.
- If nondeterminism remains even at temperature=0 (e.g., due to non-temperature randomness, system-level nondeterminism, or non-deterministic model implementations), averaging over repeats is required for stable measurements.
- Both are needed only if temperature>0 (introducing sampling variability) and additional nondeterminism exists; in this case, averaging over repeats at temperature>0 is necessary to obtain stable token-count estimates.
- In summary: use temperature=0 for determinism when possible; use averaging only if nondeterminism cannot be eliminated. Use both only if both sources of variability are present.
