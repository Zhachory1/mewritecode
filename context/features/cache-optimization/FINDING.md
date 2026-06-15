# Cache-optimization finding — caching is already near-optimal (#42)

**Question (PRD §2 gate):** is there worthwhile prompt-cache headroom beyond the ~92% already captured — specifically, does an explicit `[system+tools]` cache breakpoint reduce cacheWrite over Anthropic's automatic prefix-matching?

**Answer: NO. The tools breakpoint is a confirmed no-op. Caching is already near-optimal; there is no neglected cost lever here. STOP (honest-outcome clause).**

## Method (controlled paired probe — the test ab-critic's council demanded)
`research/evals/cache-probe.ts`: a fixed multi-turn context (chunky system prompt + 5 realistic tool schemas + 3-turn history). Per (arm, repeat): a unique nonce makes the run start cold; Turn 1 warms the `[system+tools+history]` prefix; Turn 2 appends a tail and resends → measures Turn-2 cacheRead/cacheWrite. Arm OFF = no tools breakpoint; Arm ON = explicit `cache_control` on the last tool (env-gated `CAVE_TOOLS_CACHE_BREAKPOINT=1`, default off). 3 repeats/arm, sonnet, OAuth-resolved auth. Same content, only the breakpoint differs → clean isolation (not before/after on a noisy live run).

## Result
| arm | Turn-2 cacheRead | Turn-2 cacheWrite | Turn-2 input |
|---|---|---|---|
| OFF (no tools breakpoint) | 2028 | 34 | 3 |
| ON  (tools breakpoint) | 2028 | 34 | 3 |

**Δ cacheWrite = 0, Δ cacheRead = 0. Zero variance across 3 repeats per arm.** Turn 2 reads the entire ~2028-token `[system+tools+history]` prefix whether or not the explicit breakpoint is set — Anthropic's automatic longest-prefix-matching already caches it. cacheWrite (34) is just the genuinely-new tail; input (3) negligible.

## Conclusion (decomposition + probe together)
- **~92% of context tokens are already cache-read** (#40 grid2 data); the ~7.3% cacheWrite is **mostly necessary** (new tool output must be written so the next turn reads it).
- **The avoidable portion the tools breakpoint targets is zero** — the probe shows the stable prefix is already cached without it.
- Realistic headroom from breakpoint tuning: **~0%.** The earlier estimate of ~1–3% was generous; the controlled probe shows the specific lever is inert.

**Decision:** do not build the cache-breakpoint optimization. Caching already captures the reuse. The valuable finding is the **absence** of a neglected lever: cost is dominated by caching (#40) and caching is working. Per the PRD no-inert-change rule, no breakpoint is shipped to the active path.

## Caveats
- Single model (sonnet), synthetic context. But the mechanism (Anthropic auto-prefix-matching) is model-independent, and the result was perfectly consistent (0 variance).
- Does NOT test the (cut) cross-session split (target D) — that needs `ttl:"1h"` confirmation + a multi-block system prompt; separate item if ever pursued, and the 5-min ephemeral TTL makes typical >5-min-gap sessions structurally cold regardless.
- The `_softCompactTransform` history-mutation cache-poisoning path (target C) remains real but is default-OFF (`mlCompression=false`); out of scope here.

## Artifacts
- `research/evals/cache-probe.ts` (the controlled probe; reproducible — requires the default-off `CAVE_TOOLS_CACHE_BREAKPOINT` hook in `packages/ai/src/providers/anthropic.ts`).
- Raw: `/tmp` probe logs; numbers above.
