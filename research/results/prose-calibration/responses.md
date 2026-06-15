# Prose Microbench — responses (off vs candidate)

## code-explain-roles (code-explain / tune)

### prose=off (329 mean output tokens)

## What it does

`roles.ts` enforces that every outbound LLM call from the agent is tagged with exactly one of four semantic roles: `plan`, `edit`, `explore`, or `verify`.

## Design summary

**Role taxonomy** — The four roles model the agent's cognitive phases: planning what to do, editing code, exploring the codebase, and verifying results. This mirrors a typical agentic loop.

**Type-safe union** — `Role` is a string literal union, so TypeScript catches invalid roles at compile time. `ROLES` is a `readonly` tuple used for runtime membership checks.

**Runtime guard** — `isRole` is a type predicate that validates unknown values (e.g. from deserialized data or dynamic construction) against the known set.

**Enforcement wrapper** — `requireRole` is the enforcement point: it takes a partially-typed object (role may be absent or wrong) and either returns a fully-typed `RoleTagged<T>` or throws. The throw makes missing/invalid roles a hard failure rather than a silent gap — the comment notes these are "test-visible failures," meaning tests assert on the error.

**Generic payload** — `RoleTagged<T>` is generic so the same wrapper works for any call shape without losing payload type information.

**Minimal surface** — No dependencies, no framework coupling. Pure types + two functions. Easy to test and import anywhere in the agent.

### prose=full (235 mean output tokens)

Four-value enum (`plan | edit | explore | verify`) tagging every outbound LLM call.

- `Role` / `ROLES` — the closed set; `isRole` is a type-guard against it.
- `RoleTagged<T>` — wrapper pairing a role with an arbitrary payload.
- `requireRole` — runtime enforcement: throws if `role` is absent or not in the set, otherwise narrows to `RoleTagged<T>`. Designed to be called at the call-site boundary so test harnesses can assert every outbound call is tagged.

Design notes:
- `ROLES as const` keeps the array readonly and the union derivable from it.
- Generic `T` on `RoleTagged` / `requireRole` keeps the payload typed without coupling to any specific call shape.
- No default role, no fallback — missing role is always a hard failure (per the T-009/T-010 ticket constraint).

## code-explain-honest-metrics (code-explain / tune)

### prose=off (509 mean output tokens)

## What it does

`honest-metrics.ts` is a **pure accounting and statistics library** for an ablation study comparing different "cave mode" levels (off / lite / full / ultra / codex) on coding tasks. It has no side effects — no I/O, no clock, no external deps — making it fully unit-testable with deterministic outputs.

---

## Design summary

### Token/cost accounting

- `Usage` holds four token classes: `input`, `output`, `cacheRead`, `cacheWrite`.
- `computeCost` is the **single source of truth** for dollar figures. It takes a `Usage`, a shared price table (`Record<string, PricingRow>`), and a model name, then returns `(tokens × rate) / 1_000_000`. Returns `null` for unknown models so unpriced runs are explicitly excluded rather than silently treated as free.
- Parsers upstream return `Usage + model` only — never a dollar amount. This enforces one pricing path.

### Run record

`Run` is the atomic data unit:
- `level` — which ablation arm (`"off" | "lite" | "full" | "ultra" | "codex"`)
- `model`, `task`, `seed` — identity fields
- `resolved: boolean` — ground truth from an external scorer, never from the tool's own exit code
- `usage: Usage | null` + `parseStatus` — token data may be absent if parsing failed

### Statistical layer (truncated, but implied by the header)

The module provides pure statistical helpers over slices of `Run[]`, likely including:
- Pass rate (resolve rate) per level
- Cost-per-resolved-task comparisons
- Bootstrap confidence intervals with a seeded PRNG for reproducibility

### Key design principles

| Principle | Implementation |
|---|---|
| Single pricing source | `computeCost` only; parsers never emit dollars |
| External ground truth | `resolved` is set upstream, treated as opaque boolean here |
| Pure/deterministic | No I/O; seeded PRNG for bootstrap |
| Explicit over silent | `null` cost for unknown models, `parseStatus` field for failures |

The module is described as the "unit-tested foundation" consumed by a live ablation runner (issue #33).

### prose=full (430 mean output tokens)

`honest-metrics.ts` is a **pure accounting + statistics library** for a Cave-mode ablation study (ON vs OFF, issue #8). No I/O, no side effects, deterministic given inputs.

---

## What it does

**Token/cost accounting**
- `Usage` — four token buckets: `input`, `output`, `cacheRead`, `cacheWrite`
- `PricingRow` — per-Mtok dollar rates for each bucket
- `computeCost(u, table, model)` — single source of truth for dollar cost; returns `null` for unpriced models (prevents silent zero-costing)
- `totalProcessed` — diagnostic sum, explicitly not a headline metric

**Run record**
- `Run` — one benchmark execution: `level` (off/lite/full/ultra/codex), `model`, `task`, `seed`, `resolved` (set by external scorer, never by tool exit code), `usage`, `parseStatus`

**Statistics helpers (pure)**
- Likely: mean/median/CI over `Run[]` arrays, grouped by level or model
- Bootstrap CI uses a seeded PRNG for reproducibility
- Aggregation functions that filter/group runs, compute resolve rates, cost-per-resolved, etc.

---

## Design principles

| Principle | Mechanism |
|---|---|
| Single pricing source | `computeCost` only; parsers return tokens + model, never dollars |
| `resolved` is ground truth | Treated as opaque input from upstream scorer |
| Reproducible stats | Seeded PRNG for bootstrap |
| Testable in isolation | Zero external deps, no I/O — pure functions all the way down |
| Explicit missing data | `null` usage, `null` cost, `parseStatus` field — no silent defaults |

The live ablation runner (issue #33) consumes this as a dependency; this file is the unit-tested foundation it builds on.

## tradeoff-median-vs-mean (trade-off / tune)

### prose=off (427 mean output tokens)

**Median** when costs are skewed; **mean** when you care about total budget.

## The core trade-off

Cost distributions in agent benchmarks are almost always right-skewed: most tasks complete cheaply, but a tail of hard/looping tasks burns disproportionate tokens. That skew is the crux of the choice.

### Report the median when:

- You want to characterize **typical task cost** — what a user running one task should expect to pay
- The distribution has a long right tail (a few runaway tasks inflate the mean)
- You're comparing two systems where one has better tail behavior but similar typical cost — the mean would obscure the comparison
- The benchmark includes tasks of varying difficulty and you don't want hard outliers to dominate the headline

### Report the mean when:

- You care about **total budget** — if you run N tasks, `N × mean` is your actual spend; `N × median` is not
- Costs are roughly symmetric or you've already trimmed outliers
- You're making a procurement or capacity-planning argument ("this will cost $X to run the full eval suite")
- Stakeholders need to reason about aggregate cost, not per-task experience

## The right answer in practice

Report **both**, with the mean as the budget figure and the median as the typical-task figure. If they diverge significantly, that divergence is itself informative — it tells you the tail is expensive and worth investigating separately (e.g., report p95 or max alongside).

For a headline in a paper or README: use **median** if you're making a "this model is cheaper" claim, because it's more robust to a few catastrophic runs. Use **mean** if you're making a "this costs $X to operate" claim.

### prose=full (352 mean output tokens)

**Median** when cost distribution is skewed (long tail of expensive tasks); **mean** when you care about total budget.

**The core trade-off:**

- Mean = sum / n. Sensitive to outliers. One runaway task (e.g., 50× normal cost) inflates it significantly.
- Median = middle value. Robust to outliers. Reflects the "typical" task cost regardless of tail behavior.

**Use median as headline when:**
- Distribution is right-skewed (most tasks cheap, a few very expensive) — common in agentic benchmarks where some tasks spiral into long tool-call chains
- Reporting "what does a typical task cost?" for capacity planning or user-facing pricing
- Comparing two systems where one has heavier tails — mean would unfairly penalize the one with occasional hard tasks

**Use mean as headline when:**
- Reporting total budget impact: `mean × n_tasks = total spend`, median doesn't give you this
- Distribution is roughly symmetric / low variance — mean and median converge anyway
- Comparing systems that will run the *same* task distribution at scale, where total cost is the decision variable

**In practice for a prose bench like yours:**
Report both. Lead with median for "typical task cost" (the number users care about), include mean in a footnote for budget projection. If mean >> median, call out the skew explicitly — it's a signal that a subset of tasks is pathological and worth investigating separately.
