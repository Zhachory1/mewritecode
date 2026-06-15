# PRD — Push caveman prose output-token cut ~19% → ~40% (prompt tuning)

**Priority:** P1 (differentiator) · **Effort:** M (iterative tuning) · **Status:** draft → council

## 1. Problem / goal
Caveman **full** mode currently cuts single-turn response tokens **~19% median** (measured by `bench:prose`, gpt-4o-mini n=5: 9.8–30%). The goal: get that to **~40% median output reduction** — primarily by **tuning `buildCaveModePrompt`** (`system-prompt.ts`) — **without losing substance** (the terse answer must still convey the same information; 40% achieved by omitting content is a FAILURE, not a win).

## 2. Why this matters
Output-prose compression is the visible, attributable caveman lever on a single turn (the agentic bench #33 showed no quality harm; real-usage cost is #36). Doubling the per-response cut materially improves the cost story for chat/Q&A-heavy use.

## 3. Non-goals
- Not touching tool-output compression, ML compression, or cache (separate levers).
- Not changing the agentic loop or scoring.
- Not gaming the metric: NOT truncating, NOT dropping required info, NOT refusing detail. Substance parity is a hard gate.
- Not regressing the EXCEPTIONS (code blocks, commit msgs/PRs, security/destructive confirmations, genuine ambiguity stay normal English).

## 4. Approach
Iterative, measurement-driven prompt tuning with `bench:prose` as the feedback loop (cheap — ~10 single-turn calls/run, pennies, ~2 min):
1. Rewrite the **`full`** cave-mode communication block to drive harder compression: e.g. mandate bullet/fragment form over prose, ban meta-scaffolding ("Overview:", "In essence:", restating the question, summary-of-summary), cap explanatory padding, prefer dense structured lists, drop hedging/transitions — while keeping the answer COMPLETE.
2. After each edit, run `bench:prose` → read median output reduction **and** eyeball `responses.md` for substance parity. Iterate.
3. Consider also tuning `ultra` (and whether the headline should cite `full` or `ultra`), but `full` is the default and the target.
4. Stop when median reduction is **~40%** (≥~35% acceptable "close") with substance preserved.

## 5. Success metrics
- **Primary:** `bench:prose` median output-token reduction (off→full) **≈40%** (≥35% = close), gpt-4o-mini.
- **Guardrail (hard):** substance parity — for each prompt, the full-mode answer still conveys the same key points as off-mode (manual/structured check on `responses.md`). No metric credit for omission.
- **Stability:** the gain holds on a 2nd model (e.g. sonnet) and isn't a one-prompt fluke (report per-prompt, not just median).
- **No regression** to EXCEPTIONS (code/commits/security/ambiguity untouched).

## 6. Risks
- **Over-compression → substance/quality loss** (the #9 concern). The bench measures only tokens; a more-aggressive prompt can hit 40% by dropping content. Mitigate: pair every measurement with a substance check; consider a lightweight "did the answer keep the key points" rubric.
- **Single-model / n=5 overfitting** — tuning the prompt to gpt-4o-mini's quirks. Mitigate: validate on a 2nd model + enough prompts; prefer general directives over model-specific tricks.
- **Style bleed into EXCEPTIONS** — aggressive rules leaking into code/commits. Mitigate: keep + strengthen the exceptions.
- **Diminishing returns / wall** — prose may not compress 40% without harming readability for some content types. If so, surface the honest ceiling rather than gaming it.

## 7. Definition of done
- `buildCaveModePrompt` `full` (and possibly `ultra`) revised; `bench:prose` median output reduction ≈40% (≥35%) on gpt-4o-mini, corroborated on a 2nd model.
- Substance parity verified on `responses.md` (key points preserved every prompt) — documented.
- EXCEPTIONS intact; no code/commit/security style regression.
- Existing prompt/system-prompt tests + tsgo + biome green; the tuning + final numbers written to a short report.
