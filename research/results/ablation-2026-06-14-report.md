# Caveman ablation — preliminary run report (2026-06-14)

> **STATUS: COST ONLY. NOT a quality result.** Real SWE-bench pass-rate was **not obtained**
> on this machine — the scoring harness OOM-failed (see §4). The "performance" column below is a
> **patch-produced proxy** (did the model emit a non-empty patch), NOT a verified resolve. Treat
> nothing here as a published claim. n=5, single seed, hard astropy slice → **feasibility-grade**.

## 1. What ran
- Harness: `research/evals/run-cave-ablation.ts` (issue #33) → per-condition `run-swebench.ts`.
- Corpus: SWE-bench Verified, first **5** instances (all `astropy`, hard).
- Factor: caveman **prose** ∈ {off, full}, tool-compression = on, seeds = 1, per-instance cap $2.
- Models (machine: Apple Silicon / ARM):
  - OpenAI (API key): `gpt-4o-mini` (complete), `gpt-4.1` (complete), `gpt-4o` (not started — stopped before).
  - Anthropic (OAuth): `claude-haiku-4-5` (complete), `claude-sonnet-4-6` / `claude-opus-4-7` (stopped before — opus skipped to avoid spend).
- Spend: ≈ **$5–7** total.

## 2. Real cost/token data (the valid part)

Per condition, n=5, mean per run. Cost is real (priced via the committed table). "patch" = non-empty
patch emitted (proxy, **not** resolved).

| model | prose | patch/5 (proxy) | $/run | fresh input/run | cacheRead/run |
|---|---|---|---|---|---|
| gpt-4o-mini | off | 0 | $0.0323 | 64,729 | 255,027 |
| gpt-4o-mini | full | 1 | **$0.0195** | 29,890 | 165,273 |
| claude-haiku-4-5 | off | 5 | $0.2767 | 393 | 1,132,262 |
| claude-haiku-4-5 | full | 5 | **$0.2088** | 319 | 790,625 |
| gpt-4.1 | off | 4 | **$0.2879** | 50,047 | 339,430 |
| gpt-4.1 | full | 4 | $0.5251 | 100,059 | 614,937 |

## 3. The finding (cost) — caveman's effect is MODEL-DEPENDENT
Caveman ON (prose full + compression) vs OFF, cost delta:

| model | Δ cost (off → full) |
|---|---|
| gpt-4o-mini | **−40%** (cheaper) |
| claude-haiku-4-5 | **−25%** (cheaper) |
| gpt-4.1 | **+82%** (MORE expensive) |

- On the cheap/weak models, OFF burned ~2× the fresh input + more cacheRead → caveman compression saved cost.
- On `gpt-4.1`, caveman ON ran *longer* (≈2× input + cacheRead) → cost more.
- **This refutes a blanket "caveman saves ~2× tokens" claim** — the effect depends on the model/agent
  behavior. Exactly the nuance the #8 councils predicted. (n=5, noisy — directional, not powered.)

## 4. Why there is no real pass-rate (scoring blocker)
`evaluate-patches.sh` → `swebench.harness.run_evaluation` failed on **every** patch-producing condition:
```
swebench.harness.docker_build.BuildImageError: Error building image
sweb.env.py.x86_64...:latest: ... returned a non-zero code: 137
```
- Exit **137 = OOM** building the **x86_64** SWE-bench env image under **QEMU emulation on Apple Silicon**.
- Dataset loaded fine (500 instances); empty-patch conditions correctly reported "empty patches".
- This is an **architecture limit, not a code bug** — real scoring needs an **x86 Linux** host.

## 5. How to get the real performance axis
Run the same grid on x86 (images pull **prebuilt** → no OOM):
- **CI:** `.github/workflows/cave-ablation.yml` (manual `workflow_dispatch`; needs `OPENAI_API_KEY` +
  `ANTHROPIC_API_KEY` repo secrets — CI is headless so Claude needs an API key, not OAuth).
- **Any x86 box:** `pip install swebench` then
  `npx tsx research/evals/run-cave-ablation.ts --prose off,full --provider <p> --model <m> --limit N --cap C --score`.
- A *powered* claim needs the council's pre-registered MDE (~≥30 paired both-resolved tasks), not n=5.

## 6. Provenance
Raw per-run artifacts were generated under `research/results/grid/` then cleaned (throwaway); the cost
numbers above were aggregated from those traces during the run. Re-run to regenerate. Pricing table:
`research/evals/run-cave-ablation.ts` (`PRICING_TABLE`, dated 2026-06, verify before publishing).
