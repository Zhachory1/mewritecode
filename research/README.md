# research/

Reproducible research artifacts for the token-efficiency initiative.

## Layout

- `paper/` — source of the paper (LaTeX/Markdown)
- `evals/` — evaluation harness code and fixtures
- `results/nightly/<date>.json` — nightly CI bench output (50 SWE-bench Verified instances)
- `results/microbench-<date>.json` — MicroBench results
- `baselines/` — external system baselines (Codex, Claude Code) for comparison
- `plots/` — plot generators (e.g. tokens-vs-resolved)

## Benchmarks

### MicroBench (fast, cheap)

25 self-contained coding tasks exercising agent tool use (read/edit/bash).
No repo cloning, no Docker — runs in ~15 min for ~$1.

```bash
npm run bench:micro                          # run all 25 tasks
npm run bench:micro -- --difficulty easy      # filter by difficulty
npm run bench:micro -- --limit 5             # run first 5 only
npm run bench:micro -- --dry-run             # list tasks without running
```

**Latest results (2026-04-16, cave + gpt-5.4 high, ultra compression):**

| Difficulty | Pass Rate | Avg Cost/Task | Avg Duration |
|-----------|-----------|---------------|--------------|
| Easy | 8/8 (100%) | $0.03 | 17s |
| Medium | 6/10 (60%) | $0.04 | 33s |
| Hard | 2/7 (29%) | $0.06 | 55s |
| **Total** | **16/25 (64%)** | **$0.05** | **33s** |

Numbers above are from an older SDK-coupled run (`microbench-2026-04-16.json`) and are no longer the headline. **The current headline lives in `honest-bench-2026-05-18.{csv,json}`** — see "Cross-System Comparison" below for the live apples-to-apples vs Codex CLI.

### Terminal-Bench (head-to-head, live)

Runs cave (with gpt-5.4), Codex CLI, and Claude Code on the **same** Terminal-Bench
task set, on the **same** machine, in the **same** week — producing live token
numbers instead of relying on published leaderboard estimates.

Requires Docker (TB tasks run in containers) and Python 3.10+.

```bash
# (a) Install Terminal-Bench in a local venv + pull its base image
python3 -m venv research/evals/terminal-bench/.venv
research/evals/terminal-bench/.venv/bin/pip install -r \
  research/evals/terminal-bench/requirements.txt
docker pull ghcr.io/laude-institute/terminal-bench/tb-base:latest

# (b) 3-task smoke (~10 min, ~$2 ceiling)
npm run bench:tb -- --agents cave,codex,claude \
  --tasks research/evals/terminal-bench/task-lists/tb-core-smoke.txt \
  --limit 3 --output research/results/tb-smoke \
  --cap-wall-sec 300 --max-total-dollars 5

# (c) Headline 20-task run (~3 hr, ~$25)
npm run bench:tb -- --agents cave,codex,claude \
  --tasks research/evals/terminal-bench/task-lists/tb-core-20.txt \
  --limit 20 --cap-wall-sec 600 --max-total-dollars 50

# (d) Render head-to-head table
npm run bench:compare -- --benchmark terminal-bench
```

Results land in `research/baselines/{cave,codex,claude-code}-terminal-bench.json`
plus `research/results/terminal-bench-<date>.json` (full per-task records, iso-quality
slice, and run metadata). The combined comparison table leads with
**Tokens/resolved (iso-quality)** — the headline metric — and prints Pass /
$/Resolved / Cache / Turns / Wall as supporting columns. Rows whose token-verification
delta exceeds 2% are flagged with a `*` so the operator can fix the parser before
publishing.

Auth defaults to **subscription mode** (cave + codex on ChatGPT plan, claude-code on
Pro/Max plan); pass `--auth-mode api-key` to swap in metered keys for the audit run
(adds dollar columns + tightens token tolerance to 2%).

### SWE-bench Verified (thorough, expensive)

500 real GitHub issues from the SWE-bench Verified dataset.
Requires repo cloning + Docker evaluation harness.

```bash
npm run bench:swebench                       # run all instances
npm run bench:nightly                        # run 50-instance nightly subset
npm run bench:eval                           # evaluate patches with Docker harness
```

### Cross-System Comparison

Compare caveman-code's token efficiency against Codex and Claude Code using published baseline data.

```bash
npm run bench:compare -- --cave-results research/results/microbench-2026-04-16.json
npm run bench:compare -- --cave-results research/results/swebench-2026-04-16.json
npm run bench:compare -- --format json --output report.json
```

**Honest apples-to-apples — 25-task MicroBench, gpt-5.5, xhigh reasoning (2026-05-18):**

| Tool | Resolved | Fresh tokens (in+out) | Cost |
|------|----------|----------------------|------|
| Codex CLI | 15/25 (60%) | 1,010,185 | $0 (codex sub) |
| **Caveman Code** | **14/25 (56%)** | **524,703** | **$1.78** |

**1.93× fewer fresh tokens than Codex CLI on identical tasks, same model, same reasoning effort.** Pass rate within 1 task.

Raw artifacts: `research/results/honest-bench-2026-05-18.csv` + `.json` + per-task stdout/stderr logs under `research/results/honest-bench-2026-05-18/`.

Reproduce in one command:

```bash
npx tsx research/evals/run-honest-bench.ts --tools caveman,codex
```

Methodology: each tool is spawned as a real child process (no SDK shortcuts), each task is verified with the task-specific `verify.sh`. Token counts come from each tool's own JSONL / stdout summary.

Older numbers from the SDK-coupled `microbench-2026-04-16.json` and published-baseline comparisons are retained in `research/results/` for historical reference but are **not** the launch headline.

## Regenerating published numbers

```bash
npm run bench:micro                          # ~15 min, ~$1
npm run bench:nightly                        # ~2 hr, ~$250 (50 instances)
npm run bench:compare                        # instant, reads existing results
```

A fresh clone should regenerate every plot and number in the paper by
following the commands above. No hand-edited artifacts.

## Related

- Historical kits and impl tracking: `context/archive/cavekit/`
