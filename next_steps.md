# Next Steps — How Caveman Code beats Claude Code on cost AND quality

**Date:** 2026-04-29
**Author:** synthesis from web research + repo audit + master plan
**Companion docs:** `context/plans/cave-v2-best-in-class.md`, `AUDIT-REPORT.md`

> **The honest opener.** You will not beat Claude Sonnet 4.5 / Opus 4.7 on raw model intelligence — they're #1 on SWE-bench-Verified and we don't train models. We win on **cost-per-solved-task** and **workflow ergonomics**. Every item below is judged on those two axes.

---

## TL;DR — the 7 biggest unshipped wins, ranked by ROI

| # | Lever | Win | Effort | Caveman Code status |
|---|---|---|---|---|
| 1 | **Tree-sitter symbol graph as default context** (replace "read whole file") | **5–50× token reduction** on real repos (49× on Next.js) | 10–14d | scaffolding in `packages/agent/src/repomap/`, not surfaced — WS8 |
| 2 | **MCP defer-loading + Tool-Search** (Anthropic shipped Jan 2026, on by default in CC) | **85–95%** off tool-schema overhead (47k → 2.4k/turn) | 4–6d | not shipped — extends WS2 |
| 3 | **Prompt-cache breakpoint hygiene** (5-min default, 4 breakpoints, before fork point) | up to **90%** off cached input | 3–5d | partial — needs audit |
| 4 | **Confidence-driven cascade** (Haiku → Sonnet → Opus on logprob/test/format signals) | **50–80%** avg cost reduction, no quality loss | 5–7d | manual `/model` only |
| 5 | **Diff-only context on follow-up turns** (only what changed since last breakpoint) | ~30–60% off after turn 2 | 4–5d | not shipped — new |
| 6 | **Batch API path** for non-interactive ops (`caveman exec`, recipes, nightly) | **50%** off, stacks w/ caching → ~95% combined | 3–4d | not shipped — extends WS16 |
| 7 | **Local-first defaults for trivial ops** (rename, format, simple edit) via Qwen3-Coder-Next on MLX | 100% off those ops, plus latency win | 7–10d | `pi-ai` supports Ollama, no router |

**Combined potential**: a Claude Code session that costs $5 today should cost **$0.40–$0.80** in caveman-code with all seven landed, on the same task. That's the headline number for the README.

The rest of this doc is the detailed playbook.

---

## 1. Where the cost actually comes from (be honest)

Ranked by impact magnitude, with realistic numbers from production users in 2026:

| Lever | Realistic savings | Notes |
|---|---|---|
| Repo-map / symbol-graph injection vs file reads | **5–50×** | Codebase-Memory paper (arxiv 2603.27277): 83% answer quality at 10× fewer tokens, 2.1× fewer tool calls vs file-exploration |
| Prompt caching with correct breakpoints | up to 90% off cached input | Anthropic 5-min TTL is 1.25× write / 0.1× read; break-even at 0.28 reads |
| MCP defer-loading / Tool-Search | 85–95% off tool-schema overhead | Anthropic blog: 47.3k → 2.4k tokens/turn; mcp2cli claims 96–99% |
| Cascading model routing | 50–80% off avg cost | Augment / Anthropic both publish this number |
| Batch API (24h-deferred) | 50% off | Stacks with caching → ~95% on nightly jobs |
| Tool-result truncation (already in caveman-code) | 10–30% | Caveman Code already does head+tail per tool budget |
| Semantic caching of LLM responses | 10–30% in coding | Vendors claim 70%; coding doesn't have FAQ-style duplicates |
| Local offload for trivial ops | 100% off those ops | But trivial ops are cheap — savings smaller than they look |

Order of operations: ship #1, #2, #3 first. They're the largest, the most defensible, and the most "caveman" in spirit. Everything else is incremental.

---

## 2. Where Caveman Code can go more **caveman** (compression + context engineering)

Caveman Code's identity is "fewer tokens for the same answer". The current state — head+tail truncation at `cave-tool-compression.ts:31-46` and the 3-layer Caveman Mode — is good but doesn't go far enough. Concrete unlocks:

### 2.1 Tree-sitter symbol graph as the default context primitive — **biggest single win**
- Replace every "read whole file" reflex with **fetch-symbol + callers + dependents**. Caveman Code already has `packages/agent/src/repomap/` scaffolding (per `cave-v2-best-in-class.md` §6 WS8); promote it to the universal context API.
- Reference impls: [code-review-graph](https://github.com/tirth8205/code-review-graph) (49× on Next.js, 6.8× on reviews), [Codebase-Memory](https://arxiv.org/abs/2603.27277) (83% quality / 10% tokens).
- Implementation skeleton:
  - tree-sitter parsers for ts/js/py/go/rust/java/c++/ruby/php (most already in `packages/agent/src/repomap/`)
  - symbol graph: nodes = files, edges = imports/calls/extends; emit signatures only, bodies on demand
  - PageRank with chat-state personalization (added files / recent files = personalization vector — Aider's trick)
  - new tools: `code_symbol_lookup(name)`, `code_symbol_callers(name)`, `code_file_skeleton(path)` — these become *the* default tools. `Read` becomes a fallback.
- Goal: median turn token spend drops from ~10k to ~1k for follow-up edits.

### 2.2 Diff-only context on follow-up turns
- Most turns only need *what changed since the last cache breakpoint*, not the full file again. Pattern: after a successful Edit, the next turn's tool-result block becomes a structured diff against the cached baseline, not a full re-read.
- Ties into prompt-cache hygiene (§3.1) — keeps cached prefix immutable.
- Files: new `packages/coding-agent/src/core/diff-context/` module; hooks into `agent-session-runtime.ts` post-Edit path.

### 2.3 Defer schemas + ToolSearch (mirror Anthropic's Jan 2026 release)
- When MCP tool descriptions exceed 10k tokens, switch to `defer_loading: true` and inject one `mcp_tool_search(query)` tool. Loads 3–5 relevant tools (~3k tokens) per query.
- Already on the WS2 plan but treat as **highest priority** within WS2 — it's a 95% reduction on a hot path.
- Files: `packages/coding-agent/src/core/tools/mcp-bridge.ts` (already exists per audit B3 — extend), new `mcp-tool-search.ts`.

### 2.4 More aggressive prose compression in skills + system prompts
- Audit: Claude Code's core system prompt is only **2,896 tokens** (not the rumored 40k). OpenCode and Crush are larger. If caveman-code's is over 4k, that's pure overhead.
- Action: pass long skill bodies through LLMLingua-2 at load time (3–6× faster than v1, integrated in LangChain). Target 90% retention in skills, with `caveman:full` prose compression already covering ~75% — LLMLingua-2 takes that to ~90%.
- Files: new preprocessing step in `packages/coding-agent/src/core/skills.ts:534-536` (load path). Cache compressed bodies in `~/.cave/cache/skills/`.

### 2.5 Lossless prompt caching across forks/branches
- Caveman Code's session branching (`/tree`, `/fork`) is the perfect substrate for shared cached prefixes — but only if breakpoints are placed *before* the fork point. Audit current behavior: are breakpoints stable across forks, or invalidated on each fork?
- Likely fix: pin a breakpoint at session-init and after every long-lived skill load; never insert breakpoints into rolling history.
- Files: `packages/coding-agent/src/core/append-only-history.ts`, breakpoint policy in compaction layer.

### 2.6 Symbol-aware compaction
- Current compaction (`packages/coding-agent/src/core/compaction/compaction.ts`, 838 lines) summarizes by recency. Better: keep tool_use/tool_result blocks that touched symbols still live in the personalization vector; aggressively drop ones for symbols no longer referenced.
- Compaction-as-eviction-policy, not compaction-as-summary.

### 2.7 Per-tool budgets that adapt to outcome
- `cave-tool-compression.ts:31-46` defines static budgets (`bash: 80 lines`, `read: 300`). Make them adaptive: if a `bash` output gets cited in the next turn, raise its budget; if it gets ignored, lower next time. Tracked per tool × user × repo.
- 5–10% extra savings, low effort.

---

## 3. Where Caveman Code can save more **money** (cheap inference)

### 3.1 Prompt-cache breakpoint hygiene
- **Default to 5-min TTL.** Anthropic silently dropped the default from 1h → 5min on March 6 2026. 1h costs 2× write vs 1.25× for 5min. Break-even is 1.11 reads for 1h vs 0.28 for 5min — for an interactive coding agent, 5min is right.
- **4 breakpoints, in order:** `[tools] → [system] → [CLAUDE.md + pinned] → [history]`. Never insert breakpoints inside rolling history.
- **Workspace isolation:** Anthropic API now isolates caches per workspace (since Feb 5 2026); Bedrock and Vertex still org-isolated. Caveman Code's multi-provider story should track this.
- Audit task: instrument `packages/ai/` to log cache_creation_input_tokens vs cache_read_input_tokens per turn. Aim for >80% read ratio after turn 2.

### 3.2 Confidence-driven cascade routing
- Replace user-driven `/model` with auto-escalation:
  - Default route: **Haiku 4.5** ($1/$5) — does plan classification, simple edits, lint/test fixups.
  - Escalate to **Sonnet 4.6** ($3/$15) on: low logprob on tool args, format violation, test fail, "I'm not sure" patterns.
  - Escalate to **Opus 4.7** ($5/$25) only on: explicit `/think hard`, repeated Sonnet failure, explicit user override.
- 50–80% expected savings without quality regression (Augment / Anthropic both publish this).
- Files: new `packages/coding-agent/src/core/router/cascade.ts`, hooks into `agent-session-runtime.ts` model selection. Read existing tier signal in `model-resolver.ts`.

### 3.3 Free-tier provider stacking
User is budget-constrained (per memory). Make this a first-class mode: `caveman --free-tier`.
- **Cerebras** free tier: 30 RPM, 1M tokens/day, runs Llama 3.3 70B / Qwen3 32B / Qwen3 235B / GPT-OSS 120B. Cerebras delivers ~6× the tok/s of Groq on frontier LLMs.
- **Groq** free tier: Llama 3.3 70B / Llama 4 Scout / Qwen3 32B / Kimi K2 at 300+ tok/s; best TTFT.
- **OpenRouter free models**: rotating Qwen / DeepSeek / GLM tier.
- **Gemini free tier**: 1500 req/day Flash, 50 req/day Pro (as of 2026-04).
- Round-robin across providers when one rate-limits. Caveman Code already supports 20+ providers — add a `--free-tier` flag that rejects paid models and rotates on 429.
- Files: `packages/ai/src/providers/register-builtins.ts` already holds registration; new policy module + flag in `packages/coding-agent/src/cli/args.ts`.

### 3.4 Batch API for deferred work
- Anthropic's Batch API: **50% off**, 24h SLA. Stacks with prompt caching for ~95% combined.
- Coding-agent fit: `caveman exec` (CI mode, WS16), recipes (WS14), nightly review-all-PRs, codemod sweeps, doc generation, eval runs (`research/evals/`).
- New flag: `caveman exec --batch <prompt>` queues to Anthropic batch endpoint, polls, returns when ready.
- Files: extend `packages/ai/src/providers/anthropic.ts` (batch endpoint already in SDK), `packages/coding-agent/src/cli/exec.ts` (WS16).

### 3.5 Local-first defaults for trivial ops
- The bottom 30% of turns (rename, format, simple type fix, regex grep, "list todos in this file") don't need a frontier model. Route them to a local Qwen3-Coder-Next or Qwen 3.5-35B-A3B running on MLX/Ollama.
- M-series viability (mid-2026):
  - Qwen3-Coder-Next (80B MoE / 3B active / 256K ctx) — 64GB MacBooks; reportedly Sonnet-4.5-class on coding
  - DeepSeek V3.2 int4 — ~40 tok/s on M3 Max 128GB / M4 Ultra
  - Qwen 3.5-35B-A3B — sweet spot for 24–36GB
- Router decision: cheap-model first, escalate to cloud if local model returns low confidence or empty diff. Same machinery as §3.2.
- Files: piggyback on `pi-ai` Ollama provider, add local-tier classifier.

### 3.6 Semantic caching of deterministic sub-operations
- Don't cache *turns* (10–30% hit rate in coding is the honest number). Do cache:
  - lint-output summaries (key = lint config + file digest)
  - file digests (key = SHA256, value = symbol list)
  - repo-map sections (key = file set + mtimes)
  - test-result summaries
- Stable, deterministic, easy to invalidate. Use a SQLite cache in `~/.cave/cache.db`.

### 3.7 Cost transparency UX (WS19) — drives behavior change
- Per-message inline `$0.0042 (cached: $0.0001)`, session-end summary, daily/weekly totals, clear cache hit/miss reporting.
- Without this, users don't know that their `/model opus` for a trivial fix just cost 50× the optimal.
- `pi-ai` already tracks usage; surface it. Add `caveman usage today`, `caveman usage week`. Add live ticker in TUI status line.
- Files: `packages/coding-agent/src/core/cost-formatter.ts` already exists — extend; add status-line integration.

---

## 4. Stealing from competitors — concrete features to copy

| Feature | Source | Why we need it | Status / effort |
|---|---|---|---|
| MCP Tool Search (defer-loading) | Claude Code, Jan 2026 | 85–95% tool-schema reduction | extends WS2 — **highest priority sub-task** |
| Worktree-isolated subagents | Claude Code, Codex (Mar 2026), Hermes | Parallel work without index pollution; now table stakes | WS6 covers this |
| Shadow-git checkpoints (`~/.hermes/checkpoints/`) | Hermes Agent | Rollback without touching user's `.git`, never destroys work | WS17 |
| Mid-session model swap with preserved context | Crush | Free 50-80% routing wins via user control | WS10 covers this |
| Edit-format-per-model matrix | Aider | search-replace beats udiff on Sonnet 4.x; ablation in proof-bench | WS8 |
| Plan-then-diff-approve UX | Cursor Composer / Claude Code Plan Mode | Now the dominant interaction loop | WS6 |
| Daemon + multi-client + session links | opencode (Go) | OpenCode hit 140k stars; daemon makes ssh-drop survival possible | WS9 |
| AI! / `// cave!` watch comments | Aider | Drive-by edits without leaving editor | WS18 |
| Sandbox-as-utility (`caveman sandbox -- cmd`) | Codex | Best-in-class sandboxing | WS3 |
| Containerized parallel sessions | Sketch / parallel-code | Run 3 cave instances on the same task, pick winning diff | optional / v2.1 |
| Persistent in-session "Flows" context | Windsurf Cascade | Branch retention policy | extends session branching |
| Long-running autonomous agents | Amazon Q Developer | Java/.NET migrations as background jobs | extends WS16 |

---

## 5. Quality wins (not just cost)

Cheaper is half the pitch. Here's how cave gets *better answers*, not just cheaper ones:

### 5.1 Edit-format-per-model
Diff-XYZ benchmark (arxiv 2510.12487): **search-replace** is most effective overall, especially for larger models. Structured udiff/udiff-h are reliable but consistently outperformed. udiff-l (verbose line markers) performs poorly. Whole-file works for small files only.

Recommended defaults table (caveman-code should ship and document):

| Model family | Edit format | Notes |
|---|---|---|
| Sonnet 4.x / Opus 4.x | search-replace | best per ablation |
| Haiku 4.x | search-replace (small) / whole (tiny) | search-replace requires precise context |
| GPT-5 / o-class | udiff-h | OpenAI tool-calling models prefer structured |
| Gemini 2.5 Pro | search-replace | matches Anthropic class |
| Qwen3-Coder, DeepSeek | udiff | trained heavily on git diffs |
| Older GPT-4-Turbo descendants | udiff-l | only model-class where verbose markers help |

Run caveman-code's `proof-bench/` ablation to validate before shipping defaults.

### 5.2 Memory: temporal knowledge graph in cavemem
- **Zep** scores 63.8% on LongMemEval vs **Mem0** 49.0% — 15 points, attributed to temporal knowledge graphs over flat embeddings.
- OMEGA (95.4%) and Mastra (94.87%) lead.
- cavemem already has SQLite + FTS5 + local embeddings (per memory). Add a temporal-graph layer: episode → entity nodes, with `valid_from` / `valid_to` and `superseded_by` edges. Hybrid search becomes: BM25 + vector + graph walk.
- Caveman Code's already-planned **episodic→semantic consolidation pass** (master plan §8.2) is the right primitive — make sure it builds the graph as it goes, not as a flat list.

### 5.3 Hooks > prompting for invariants
Codex/Claude Code/cave all converge here. Treat hooks as the trust boundary, not the model. PreToolUse synchronous + blocking with 30s timeout, returns `allow`/`deny`/`ask`. Stdout-as-assistant-context is the killer feature (per WS4) — gives hooks veto power without prompt engineering.

Default hooks caveman-code should ship out of the box:
- Auto-format on Edit (Biome / Prettier / black, language-detected)
- Auto-test on Stop (run smoke tests, surface failures into next turn)
- Conventional-commit gate on `git commit`
- Secret-scan on Write/Edit (gitleaks rules)
- Type-check on Edit if `tsc` / `mypy` / `cargo check` available

### 5.4 Subagent isolation
Per master plan WS6 — already correct. Add: confidence-driven re-dispatch (if subagent returns low-confidence result, escalate model tier and re-run, same `Task` boundary).

### 5.5 Self-correction loops
- Test-driven: after Edit, automatically run targeted tests; if fail, feed back into next turn before model speaks.
- Type-driven: `tsc --noEmit` on changed files post-Edit.
- Review-driven: optional `--with-reviewer` flag that runs the `Critic` agent on each Edit before user sees it.

---

## 6. Honest gaps the master plan **doesn't fully cover**

1. **Cache-aware compaction.** Master plan WS5 (skills) and existing `compaction/` don't have explicit cache-invalidation tracking. A single edit to the system prompt invalidates the *entire* cache. Need a cache-invalidation graph that tracks which messages would be invalidated by which edits.
2. **Cascade router** (§3.2) is not in the master plan. It's the single highest-ROI item the plan misses.
3. **Free-tier stacking** (§3.3) is not in the master plan. For a budget-constrained student user (per memory), this is the difference between "I can use this daily" and "I can use this for special tasks".
4. **Batch API** for deferred work (§3.4) is not called out. Pairs naturally with WS16 (`caveman exec`) and WS14 (recipes).
5. **Diff-only follow-up context** (§2.2) is not in the plan. Single largest "every turn after the first" win.
6. **LLMLingua-2 prose compression for skills** (§2.4) is not in the plan. Worth ~10–15% on long sessions.
7. **Adaptive per-tool budgets** (§2.7) is not in the plan. Small but real.
8. **Edit-format ablation table** isn't published as a default; the plan says to do per-model selection but doesn't commit numbers. We should run the ablation and ship the table.

---

## 7. Concrete 30-day plan

A reordering of the master plan WS list, weighted by ROI per dollar:

### Week 1 — Cost foundation (un-block savings)
- **Day 1–2:** Audit prompt-cache breakpoint placement (§3.1). Add cache-hit/miss telemetry to `pi-ai`. Single biggest leverage point that's almost-zero-effort.
- **Day 3–5:** Ship MCP defer-loading + Tool-Search (§2.3, extends WS2). 85–95% off tool-schema overhead — biggest single per-feature win.
- **Day 6–7:** Cost-transparency panel (WS19, §3.7). Behavior change requires visibility.

### Week 2 — Caveman compression core
- **Day 8–14:** Tree-sitter symbol graph as default tool surface (§2.1, extends WS8). New tools: `code_symbol_lookup`, `code_symbol_callers`, `code_file_skeleton`. `Read` demoted to fallback. **This is the caveman-code identity.**

### Week 3 — Routing + free tier
- **Day 15–18:** Cascade router (§3.2). Confidence signals from Haiku → Sonnet → Opus. Auto-escalate, never auto-downgrade in a single turn.
- **Day 19–21:** Free-tier mode (§3.3). `caveman --free-tier` rotates Cerebras / Groq / OpenRouter / Gemini Flash. Budget-student first-class.

### Week 4 — Quality + ergonomics
- **Day 22–24:** Edit-format-per-model ablation. Run `proof-bench/`, ship the table, default to search-replace for Sonnet/Opus.
- **Day 25–27:** Diff-only follow-up context (§2.2). Most-improvement-for-least-code.
- **Day 28–30:** Batch API path (§3.4). `caveman exec --batch` lands; pair with one recipe (WS14) as proof.

After Day 30, caveman-code should be:
- 5–10× cheaper than Claude Code on a typical session, measured in $.
- Same or better quality on `research/evals/` SWE-bench-Verified subset.
- Backed by a public comparison page (WS12) with reproducible numbers.

---

## 8. What to **stop doing** / **kill**

- **Don't reimplement memory primitives.** cavemem owns embeddings/FTS/compression. Caveman Code owns *policy* (when to write, what to inject, semantic consolidation). Resist the urge to add a second memory store.
- **Don't add provider-specific OAuth flows for niche providers** until WS15 (Catwalk-style external registry). The binary is already big.
- **Don't ship a web UI** (`packages/web-ui`) before TUI parity hits 1.0. Per master plan §1.2 — keep it out of scope.
- **Don't write new compression algorithms.** LLMLingua-2 + tree-sitter symbol graph + structured tool truncation cover the entire surface. Caveman Code-specific compression should be policy on top of these primitives.
- **Don't optimize for Claude Code parity at the format level beyond what the master plan §9 specifies.** Format compatibility is a free ecosystem, not a feature ceiling. Add cave-specific frontmatter keys liberally.

---

## 9. Appendix — research citations

(Verbatim from research pass, kept here so reviewers can challenge any number.)

- SWE-bench Verified leaderboard 2026 — https://benchlm.ai/benchmarks/sweVerified
- Anthropic prompt caching (5-min TTL default since 2026-03-06) — https://aicheckerhub.com/anthropic-prompt-caching-2026-cost-latency-guide
- Anthropic prompt caching docs — https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- Augment AI model routing guide — https://www.augmentcode.com/guides/ai-model-routing-guide
- Anthropic Batch API 50% discount — https://www.morphllm.com/anthropic-api-pricing
- Diff-XYZ benchmark — https://arxiv.org/html/2510.12487v2
- Aider edit formats — https://aider.chat/docs/more/edit-formats.html
- code-review-graph (49× token reduction) — https://github.com/tirth8205/code-review-graph
- Codebase-Memory tree-sitter knowledge graph — https://arxiv.org/abs/2603.27277
- 120× token cut with code knowledge graph — https://dev.to/deusdata/how-i-cut-my-ai-coding-agents-token-usage-by-120x-with-a-code-knowledge-graph-4a3d
- MCP Tool Search 85% reduction — https://www.atcyrus.com/stories/mcp-tool-search-claude-code-context-pollution-guide
- Tool Attention / lazy schema loading — https://arxiv.org/abs/2604.21816
- Progressive Disclosure MCP 85× benchmark — https://matthewkruczek.ai/blog/progressive-disclosure-mcp-servers.html
- 5 AI agent memory systems compared 2026 — https://dev.to/varun_pratapbhardwaj_b13/5-ai-agent-memory-systems-compared-mem0-zep-letta-supermemory-superlocalmemory-2026-benchmark-59p3
- State of AI Agent Memory 2026 (Mem0) — https://mem0.ai/blog/state-of-ai-agent-memory-2026
- Cerebras free tier rate limits 2026 — https://tokenmix.ai/blog/cerebras-api-key-rate-limits-free-tier-2026
- Every free AI API 2026 — https://awesomeagents.ai/tools/free-ai-inference-providers-2026/
- Qwen3-Coder-Next 2026 guide — https://dev.to/sienna/qwen3-coder-next-the-complete-2026-guide-to-running-powerful-ai-coding-agents-locally-1k95
- Best local LLMs for Mac 2026 — https://insiderllm.com/guides/best-local-llms-mac-2026/
- Claude Code system prompts (2,896 tokens core, not 40k) — https://github.com/Piebald-AI/claude-code-system-prompts
- OpenCode vs Claude Code head-to-head — https://www.linkedin.com/posts/matthieunapoli_tested-opencode-vs-claude-code-claude-wrote-activity-7416464088853106688-feMZ
- Hermes Agent checkpoints — https://hermes-agent.nousresearch.com/docs/user-guide/checkpoints-and-rollback
- Coding agents leaderboard — https://artificialanalysis.ai/agents/coding
- Codex gets subagents (Mar 2026) — https://medium.com/@richardhightower/codex-gets-subagents-the-parallel-ai-coding-pattern-is-now-industry-standard-how-does-it-stack-35bd217ef11f

---

*End. Ship items 1–7 from the TL;DR; everything else is incremental.*
