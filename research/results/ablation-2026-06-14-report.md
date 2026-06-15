# Caveman 2×2 ablation — real scored run (2026-06-15)

> **⚠ SCOPE: this measures TASK QUALITY (+ per-task cost), NOT real-usage cost.** It runs a FRESH
> single-task session per SWE-bench instance, so it is **structurally blind to caveman's main cost
> lever** — tool-output compression + prompt-cache reuse that **amortize over long multi-turn
> sessions** (hundreds of tool calls, repeated big-file reads). Real production usage shows
> **~30–50% cheaper over 2 months while doing more work** — the per-task numbers below do NOT
> capture that, and should not be read as "caveman's cost effect." Measuring real-usage cost the
> right way (savings-meter aggregate / long-session replay) is tracked in **#36**. This run's solid
> contribution is the **quality** result (no prose-harm), not a usage-cost verdict.
>
> **Real SWE-bench scoring** (patches applied + test suites run; Docker eval local via Rosetta on
> Apple Silicon). n=20 **diverse** SWE-bench Verified instances (round-robin across ~14 repos —
> django, matplotlib, flask, requests, xarray, pylint, pytest, scikit-learn, sympy, sphinx, seaborn,
> astropy, …), **1 seed**, 2 models. Spend: **$81.25 / 160 runs**. Per-instance 900s wall-clock
> timeout (≈3 stalled turns aborted + excluded). **Directional, not powered** — n=20 single-seed,
> CIs are wide and several span 0. Supersedes the earlier proxy/cost-only report.

## Design (council-driven)
2 factors varied **independently** (the compression gate was decoupled from the prose flag so the
full 2×2 is reachable): **prose** ∈ {off, full} × **tool-compression** ∈ {on, off}. Models: a strong
resolver (`claude-sonnet-4-6`) and a mid one (`gpt-4.1`), held fixed within each 2×2. Cost via a
single dated price table (verify before publishing). Primary cost metric = **$/attempt** (defined
even at 0 resolves); $/resolved secondary. Pass-rate = real resolved/attempted via the shared
SWE-bench scorer. Effects are **within-model, paired** (matched task,seed), with percentile-bootstrap
/ McNemar-style 95% CIs.

## Results

### claude-sonnet-4-6 (n=20)
| prose | comp | pass-rate | $/attempt | $/resolved |
|---|---|---|---|---|
| off | on | 0.60 | $0.410 | $0.308 |
| off | off | 0.55 | $0.482 | $0.299 |
| full | on | 0.60 | $0.371 | $0.324 |
| full | off | 0.50 | $0.342 | $0.255 |

- **Prose effect (full − off), paired:** comp-on **0.00** (CI [0, 0]); comp-off **−0.05** (CI [−0.15, 0]). Cost ratio ≈ 1.00 (CI 0.84–1.15).
- **Compression effect (on − off), paired:** prose-off **+0.05** (CI [0, 0.15]); prose-full **+0.10** (CI [0, 0.25]).

### gpt-4.1 (n=20)
| prose | comp | pass-rate | $/attempt | $/resolved |
|---|---|---|---|---|
| off | on | 0.30 | $0.341 | $0.272 |
| off | off | 0.20 | $0.264 | $0.249 |
| full | on | 0.25 | $0.471 | $0.472 |
| full | off | 0.35 | $0.319 | $0.257 |

- **Prose effect (full − off), paired:** comp-on **−0.05** (CI [−0.20, 0.10]); comp-off **+0.15** (CI [0, 0.35]) — opposite signs across compression = noise at this n.
- **Compression effect (on − off), paired:** prose-off **+0.10** (CI [0, 0.25]); prose-full **−0.10** (CI [−0.35, 0.15]) — also sign-flipped.

## Findings (preliminary)
1. **No evidence caveman PROSE degrades task quality.** Both models: prose full−off deltas are small (0, ±0.05–0.15) and **every CI includes 0**. The #9 "fragmented-reasoning hurts quality" fear is **not supported** here. (Strongest single cell: sonnet comp-on prose effect = exactly 0, CI [0,0], n=20.)
2. **Per-task cost effect (NOT real-usage cost — see scope note + #36):** on sonnet, caveman is ~neutral to **~15–25% cheaper** per attempt ($0.34–0.37 full vs $0.41–0.48 off); on gpt-4.1, caveman `full,on` is the priciest cell ($0.47) — but that's caveman making it run **more tools / persevere** (more work done), not wasted tokens. The "model-dependent" framing is about THIS isolated-task metric. It does **not** measure the long-session compression + cache-reuse savings that drive real usage (operator: ~30–50% cheaper over 2 months) — the bench can't see that mechanism. A blanket "saves ~2× tokens *per task*" isn't supportable here; the real-usage cost question is open (#36).
3. **Compression effect is inconclusive** — small, sign-flips across prose, CIs span 0.

## Caveats (do not over-read)
- **Underpowered:** n=20, **1 seed**. CIs are wide; most touch/span 0. No claim is statistically firm — this is a directional read + a working harness, not a publishable frontier. A powered run needs a pre-registered MDE (~≥30 paired both-resolved tasks) and ≥3 seeds.
- **2 models, 1 corpus.** Diverse repos (good) but still SWE-bench Verified only.
- **Rosetta-scored:** Docker eval ran under x86 emulation on Apple Silicon. For astropy-style numerical/Cython tasks, x86-emulated test results *could* differ from canonical x86 — **spot-check a sample of "resolved" patches on a real x86 host before publishing any pass-rate.**
- **Pricing table** (`run-cave-ablation.ts PRICING_TABLE`) is dated 2026-06; verify before quoting $.
- ~3 instances hit the 900s timeout and were excluded (recorded as errors, not counted as failures).

## Reproduce
```
npx tsx research/evals/run-cave-ablation.ts --prose off,full --compression on,off \
  --provider <p> --model <m> --limit 20 --sample diverse --cap 2 --score
```
Raw per-condition manifests committed alongside this report; bulky per-instance traces were not.
