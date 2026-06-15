---
id: factual-temp0-meaning
goldModel: gpt-4.1
promptVersion: prose-gold-v1
questionB64: V2hhdCBkb2VzIHNldHRpbmcgYW4gTExNIHNhbXBsaW5nIHRlbXBlcmF0dXJlIHRvIDAgZG8gdG8gaXRzIG91dHB1dD8gQW5zd2VyIGNvbmNpc2VseS4=
---
Setting an LLM sampling temperature to 0 makes the model always select the highest-probability (most likely) next token at each step, producing deterministic, repeatable outputs for the same input. This eliminates randomness and diversity in generation, causing the model to follow the most probable path through its learned distribution. No alternative phrasings or creative variations are sampled; only the single most likely completion is returned unless the model’s probability distribution is exactly tied at any step, in which case tie-breaking may be implementation-dependent.
