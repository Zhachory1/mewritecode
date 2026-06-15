# PRD — Prompt-cache reuse: measure headroom before optimizing — issue #42

**Priority:** P2 · **Effort:** S (gated spike; NOT a feature build) · **Status:** PRD-council unanimous SHIP-WITH-CHANGES (false-consensus flagged) → revised (this doc). Council blockers folded in §0.

## 0. Council resolutions (authoritative)
PRD-council (ab-critic + software-architect + red-team, all SHIP-WITH-CHANGES; synth flagged FALSE-CONSENSUS — heeded). The original framing (P1, M-L, "likely add a tools breakpoint first") **inverted its own measurement-first discipline**. Binding changes:

1. **This is a measurement SPIKE, not a feature.** Reframe to **P2 / S-effort, gated.** The dominant likely outcome is "caching is already near-optimal — stop." Do not scope a build before the gate.
2. **Headroom is probably ~1–3% (red-team + all).** ~92% of tokens are *already* cache-read; the uncached ~8% is `cacheWrite` (7.3% on sonnet) which is **mostly the necessarily-new rolling tail** (new tool output must be written so the next turn reads it). The avoidable portion (re-caching *stable* content) is what's attackable — and the stable [system+tools] prefix is already cached via the system breakpoint + the rolling-tail segment + Anthropic auto-prefix-match. So the explicit tools breakpoint is **very likely a no-op.**
3. **Attribution is NOT isolable from aggregate cacheRead/cacheWrite (ab-critic).** Per-request totals collapse all prefix segments. The ONLY valid test of "does breakpoint X reduce cacheWrite" is a **controlled paired replay: the SAME multi-turn session run WITH vs WITHOUT the breakpoint**, fixed session length, repeated to characterize the 5-min-ephemeral-TTL noise (cold/warm confounds small deltas). Before/after on different live runs is invalid.
4. **CUT target C** (`_softCompactTransform` history mutation): it's a default-OFF path (`mlCompression=false` everywhere) AND the PRD named the wrong seam (architect: it's transform-chain cache-poisoning upstream of `convertMessages`, not serialization; the fix is a non-trivial reseat, unjustified for a default-off path). Out of scope.
5. **CUT target D** (cross-session static/dynamic system-prompt split) from this item: it's a different architecture (flat system string → ordered named blocks, bit-identical static block) AND the 5-min ephemeral TTL makes cross-session reuse structurally cold for typical >5-min session gaps (no evidence `ttl:"1h"` is sent). If pursued, it's its own ticket — and first needs to confirm `ttl:"1h"` is even on.
6. **No shared cache-policy abstraction** — Anthropic (explicit `cache_control`) and OpenAI (`prompt_cache_key`) are too different; keep placement logic in each provider; don't build a cross-provider seam.
7. **Correctness guardrail scoped** to what it can catch: cache_control not placed mid-generation / on a malformed block (caching is otherwise output-transparent). Not a behavior A/B.
8. Note for the spike: `_rebuildSystemPrompt` is called ~5× (skill/theme/tool changes) and re-bakes `new Date()`+git-status — can bust the "stable" prefix *within* a session. The instrumentation should check whether this fires in practice.

## 1. Goal
Determine — cheaply — whether there is **any** worthwhile prompt-cache headroom beyond the ~92% already captured, BEFORE building anything. If yes, quantify it via controlled paired replay and fix the largest confirmed source. If no (the likely case), report "caching already near-optimal" and stop.

## 2. The gating experiment (the whole deliverable, until it says otherwise)
1. **Decompose the cost** (from existing grid2 data + cache semantics, mostly done above): cacheRead 92.7% / cacheWrite 7.3% / fresh ~0. Establish the cacheWrite $ magnitude (sonnet: ~52k tok × $3.75/M ≈ $0.20/task) and how much is *avoidable* (re-cache of stable content) vs *necessary* (new tail).
2. **One controlled paired replay** to test the single highest-value hypothesis (explicit [system+tools] breakpoint): same SWE-bench instance(s), run WITH and WITHOUT the breakpoint (a ~1-line change in `anthropic.ts`), fixed length, ≥2 repeats per arm to gauge TTL noise, compare `cacheWrite`. If the breakpoint doesn't move cacheWrite beyond noise → it's a no-op → stop.
3. **Honest outcome:** if avoidable cacheWrite is ~1–3% and/or the breakpoint is a no-op, the deliverable is the report "Anthropic auto-prefix-caching already captures the reuse; no worthwhile headroom" + stop. (Prior-work lesson: report the ceiling, don't ship inert markers.)

## 3. Success / DoD
- Cost decomposition (cacheRead/Write/$ + avoidable-vs-necessary split) documented.
- The one paired-replay hypothesis tested with TTL-noise repeats; result honest (likely no-op).
- If a real, repeatable cacheWrite reduction at equal output is found → ship that single change; else report near-optimal + stop.
- No inert breakpoints shipped. tsgo/biome/tests green if any code lands.

## 4. Risks
- **Chasing ~0 headroom** (the main risk) — mitigated by gating §2 + the descope to S-effort.
- **TTL noise masks/fakes a small delta** — mitigated by paired same-content replay + repeats.
- **Cargo-cult breakpoint** — the no-op test in §2.2 + no-inert rule.

## 5. Non-goals
- Prose lever (closed, #39); compression-budget tuning (#40 — shown small/negative); cross-session split (separate, TTL-cold); a shared cache-policy abstraction.
