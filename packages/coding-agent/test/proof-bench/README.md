# CAVE Compression Proof

Mac-runnable, scrutiny-proof benchmark of the caveman compression stack. Runs the real `caveman` CLI binary end-to-end across an ablation grid, externally audits every token count, quality-gates every claim, and refuses to publish if gates fail.

**Full suite:** ≤ ~$5, ≤ ~45 min wall-clock on a MacBook. Default model `claude-haiku-4-5`.

## Quick start

```bash
# Smoke test (~$0.15, ~5 min)
export ANTHROPIC_API_KEY=sk-...
./scripts/run-quick.sh

# Full suite (~$2-3, hard-capped at $5, ~45 min)
./scripts/run-all.sh
```

Artifacts land in `./results/<timestamp>/`:
- `results.md` — publishable human report
- `results.json` — versioned machine record (validated against `schema/results.schema.json`)
- `waterfall.txt` — per-layer contribution chart
- `audit-log.jsonl` — every `count_tokens` recount, for independent verification

## What this measures

11 caveman compression layers:

| # | Layer | Measured via |
|---|---|---|
| 1 | Flint Chipper — per-tool line budgets | fixture + replay-no-flint |
| 2 | Stone Tablet — JSON/XML semantic compression | fixture + replay-no-stone |
| 3 | Read deduplication cache | fixture + replay-no-dedup |
| 4 | ANSI / blank-line strip | fixture (constant) |
| 5 | History compaction | replay-no-compaction |
| 6 | Branch summarization | replay |
| 7 | Caveman output mode (lite / full / ultra) | live + Haiku-as-judge |
| 8 | Prompt cache layers | live `cacheRead` / `cacheWrite` |
| 9 | Middle-drop message trimming | replay |
| 10 | System prompt overhead | fixture (constant) |
| 11 | Append-only history | structural, not token-measured |

## Methodology

### Three measurement modes

- **Live** — real `caveman` binary, real API. Used for headline tokens-per-resolved and caveman-output eval. Minimal matrix: 4 configs × 10 tasks × 2 seeds = 80 runs.
- **Replay** — load real `.jsonl` sessions, re-pipe through the compression stack with each layer disabled. $0 cost. Used for layer-isolation on production traces.
- **Fixture** — static tool-output corpus → compression functions directly. $0 cost. Used for per-layer micro-math.

### Ablation grid

| Config | enabled | intensity | toolCompression | mlCompression | Mode |
|---|---|---|---|---|---|
| `A-baseline` | false | — | false | false | live |
| `D-output-only` | true | full | false | false | live |
| `F-cave-full` | true | full | true | false | live (default) |
| `G-cave-ultra` | true | ultra | true | true | live |
| `replay-no-flint` | true | full | true | false | replay |
| `replay-no-stone` | true | full | true | false | replay |
| `replay-no-dedup` | true | full | true | false | replay |
| `replay-no-compaction` | true | full | true | false | replay |

Per-run settings are injected via a temp `settings.json` + the existing `CAVE_CODING_AGENT_DIR` env var — no source-code changes needed.

### Token audit (free)

Every live row has its prompt payload recounted via Anthropic's `count_tokens` endpoint (free). Required tolerance: `|cli_reported − recount| / cli_reported < 2%`. Rows that fail the audit are flagged and block publication.

### Caveman-output quality gate (biggest gap addressed)

15 generation prompts × 4 intensities × 2 seeds. Each output is scored by Haiku 4.5 as judge on a 0–10 rubric (informational completeness, correctness, helpfulness). An intensity is accepted only if `min_quality(intensity) ≥ min_quality(off) − 1`. Only accepted intensities enter the published output-token reduction.

### Preflight gates (CI-enforced)

`scripts/run-all.sh` exits non-zero and refuses to emit `results.md` unless **all** pass:

- pass@1 gap between `A-baseline` and every caveman config `< 2pp`
- `|cli_reported − count_tokens_recount| / cli_reported < 2%` on every live row
- iso-quality intersection size `≥ 7` tasks (of 10)
- caveman-output judge quality gap `≤ 1` pt for every accepted intensity
- `sha256(datasets/**) == manifest.dataset_hash`
- `git rev-parse HEAD == manifest.code_sha`
- every live config has `≥ 2` seeds
- `results.json` validates against `schema/results.schema.json`
- cumulative cost ≤ `manifest.cost_cap_usd`

## Why public scrutiny holds

- **Real binary.** Every headline number is from `spawn("cave", [...])`, not an SDK wrapper.
- **Pre-registration.** `manifest.json` pins dataset hash, code SHA, model, grid *before* the run.
- **External audit.** Tokens recounted via Anthropic's free endpoint; deltas published.
- **Replay self-consistency.** Anyone with the published `.jsonl` sessions can re-run `replay-runner.ts` and verify compression math to ±0.1 tokens.
- **Out-of-scope is explicit.** SWE-bench Verified and Terminal-Bench head-to-head are complementary, published separately from the Windows box with x86 Docker.

## Reproduction

```bash
git clone https://github.com/Zhachory1/mewritecode
cd mewritecode
git checkout <manifest.code_sha>
cd packages/coding-agent
npm install && npm run build
cd test/proof-bench
export ANTHROPIC_API_KEY=...
./scripts/run-all.sh
```

Compare your `results.json` to the published one — tokens must match per-row within the 2% audit tolerance.

## Files

- `manifest.json` — pre-registration (dataset/code/model/grid lock)
- `ablation-matrix.ts` — produces the 4 live + 4 replay configs
- `layer-isolation.ts` — fixture per-layer math
- `live-runner.ts` — real `caveman` binary via child-process spawn
- `replay-runner.ts` — deterministic session replay
- `cave-output-eval.ts` — generation-side quality-gated measurement
- `token-auditor.ts` — `count_tokens` recount + delta check
- `preflight.ts` — CI gate
- `reporter.ts` — `results.md` + `results.json` + `waterfall.txt`
- `schema/results.schema.json` — JSON Schema for result validation
- `datasets/` — pinned task + fixture + prompt corpora
- `scripts/` — orchestrator shell scripts
