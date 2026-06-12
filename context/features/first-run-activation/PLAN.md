# First-Run Activation — Implementation Plan

> Authoritative design: **DD.md §10** (single `ensureUsableModel()` gate). Implement with subagents; TDD; commit per chunk. Closes #10 + `/login <provider>` slice of #11.

**Goal:** No keyless user lands in a dead prompt loop — one gate resolves/auths a usable model; login auto-selects a model; print mode + wizard + `/login <provider>` all route to the working `caveman login`.

**Tech:** TS strict; vitest (`packages/coding-agent`); biome; build `npm run build`; verify CI-mirror `OPENAI_API_KEY= … GIT_CONFIG_GLOBAL=/dev/null`. Do NOT regenerate models.generated.ts (network — leave committed snapshot).

**Scope guard (DD §10.5):** subagent-auth inheritance out of scope; F7 = status-line hint (NOT a new editor API); reuse `findInitialModel` + `setModel` (no new resolver).

---

## Chunk A — Typed `NoUsableAuthError` (foundation; 3 throw sites)
**Files:** `packages/coding-agent/src/core/agent-session.ts` (+ a small `core/errors.ts` if none exists), tests.

- [ ] **A1 Test (failing):** in agent-session tests, assert `prompt()` with no model throws `instanceof NoUsableAuthError` with `reason: "no-model"`; and a model-without-auth path throws with `reason: "expired-oauth"|"no-key"`. (Mock registry.)
- [ ] **A2 Impl:** add `export class NoUsableAuthError extends Error { constructor(public reason: "no-model"|"expired-oauth"|"no-key", message: string){ super(message); this.name="NoUsableAuthError"; } }`. Throw it at all THREE sites: `agent-session.ts:1858` (no-model), `:1867-1880` (expired-oauth / no-key — set reason from `isUsingOAuth`), and `getApiKeyAndHeaders` `:478-487` (the call-time site — reason expired-oauth/no-key). Keep `.message` text identical.
- [ ] **A3 Verify** existing agent-session tests still pass (generic `Error` catchers unaffected — it's a subclass). `npx vitest --run` the affected files.
- [ ] **A4 Commit:** `feat(auth): typed NoUsableAuthError at the three keyless throw sites`.

## Chunk B — `ensureUsableModel()` gate + helpers
**Files:** `interactive-mode.ts`; maybe export a `provider→Model` helper isn't needed (reuse `findInitialModel`).

- [ ] **B1 Test (failing):** unit-test a small extracted pure helper `pickUsableModel(registry)` that wraps `findInitialModel({modelRegistry})` → returns Model|undefined for (env-key present, stored-oauth, none). If extraction is awkward, test `ensureUsableModel` via the interactive harness instead.
- [ ] **B2 Impl `ensureUsableModel(opts?)`** per DD §10.2:
  - if `session.model && hasConfiguredAuth(session.model)` → true.
  - else `const m = findInitialModel({ modelRegistry: this.session.modelRegistry }).model;` if `m` → `await session.setModel(m)` (refresh registry first if needed) → true.
  - else if `!isTTY` → false (caller prints F4).
  - else: stash `opts.pending` → `this.pendingPrompt`; `showKeylessHint()`; `showOAuthSelector("login")`; false.
  - Add `private pendingPrompt?: string` field; `showKeylessHint()` (one `showStatus`/`showWarning` line, cleared when model set).
- [ ] **B3 Verify** + biome.
- [ ] **B4 Commit:** `feat(interactive): add ensureUsableModel() keyless gate`.

## Chunk C — Wire the gate: start (F1) + submit (F2) + catch
**Files:** `interactive-mode.ts`.

- [ ] **C1** Start: after init (post `:834`), `if (!this.launchLoginOnStart) await this.ensureUsableModel();` (re-fires every keyless launch).
- [ ] **C2** Submit: in `onSubmit` normal-submission branch (`~:2581`), `if (!(await this.ensureUsableModel({ pending: text }))) { this.editor.setText(""); return; }` before routing to prompt.
- [ ] **C3** Catch: in the `while`-loop catch (`:841-843`), `if (err instanceof NoUsableAuthError) { this.pendingPrompt = lastInput; await this.ensureUsableModel(); } else showError(...)`.
- [ ] **C4** Integration test (harness): keyless start opens selector (mock `showOAuthSelector`); keyless submit stashes pending + opens selector, does NOT call `session.prompt`; throw in loop routes to gate.
- [ ] **C5 Commit:** `feat(interactive): route keyless start/submit/throw through the gate`.

## Chunk D — Post-login (F6) + replay pending
**Files:** `interactive-mode.ts` (`showLoginDialog` success `:4619-4623`).

- [ ] **D1 Test (failing):** `onLoginSuccess` → after a mocked successful login that makes a model auth-valid, `ensureUsableModel` selects + `setModel` is called; if `pendingPrompt` set, `session.prompt` is invoked once with it; if model still unselectable → `/model` selector opens (fallback), pending NOT run.
- [ ] **D2 Impl `onLoginSuccess()`:** `await modelRegistry.refresh(); updateAvailableProviderCount(); const ok = await ensureUsableModel(); if (ok && this.pendingPrompt) { const p=this.pendingPrompt; this.pendingPrompt=undefined; await this.session.prompt(p) (reuse the loop's try/catch) }`. Replace the refresh-only success block; clear keyless hint on success. (No `submitPrompt` — use `session.prompt`/`pendingInputQueue`.)
- [ ] **D3 Verify** + biome. **Commit:** `feat(interactive): select model after login + replay pending prompt`.

## Chunk E — `/login <provider>` (F5)
**Files:** `interactive-mode.ts:2394`.

- [ ] **E1 Test:** parse helper for `/login [provider]` → `{provider?}`; valid provider (in `authStorage.getOAuthProviders()`) routes to `showLoginDialog`; invalid → error listing providers; bare `/login` → selector.
- [ ] **E2 Impl:** `text === "/login" || text.startsWith("/login ")`; parse arg; validate; route. Success funnels through `onLoginSuccess` (D).
- [ ] **E3 Commit:** `feat(interactive): /login <provider> routes directly (closes part of #11)`.

## Chunk F — Wizard auth gate (F3)
**Files:** `onboarding/wizard.ts`, `main.ts`.

- [ ] **F1 Test (failing):** `AuthAnswer` includes `launch-login`; no-env-key branch (mock io answering "y") → returns `launch-login`; "n" → `skip` with note; `detectAvailableEnvProviders` reports a stored-OAuth provider as configured (mock AuthStorage).
- [ ] **F2 Impl:** add `{type:"launch-login"}` to `AuthAnswer` (`:44`); no-env-key branch (`:201-205`) prompts "Configure auth now? [Y/n]"; detect stored OAuth in `detectAvailableEnvProviders` (`:124-135`). `main.ts:653` capture `runOnboarding` return; thread `launchLoginOnStart: answer.auth?.type==="launch-login"` into `InteractiveMode` opts (`:877`).
- [ ] **F3 Impl guard:** in interactive start (C1), `if (launchLoginOnStart) showOAuthSelector("login"); else await ensureUsableModel();` (M4 explicit, never both).
- [ ] **F4 Verify** + commit: `feat(onboarding): wizard auth gate + launch-login hand-off`.

## Chunk G — Print mode (F4 + OQ-B)
**Files:** `main.ts:849`.

- [ ] **G1 Impl:** keep `!session.model` branch; ADD `else if (session.model && !session.modelRegistry.hasConfiguredAuth(session.model))`. Both print env-vars + `Run \`caveman login\` (or \`caveman login --device-auth\` over SSH)` + `exit(1)`. Verify `--device-auth` exists in `cli/login.ts`.
- [ ] **G2** Manual/scripted check: keyless `caveman -p "hi"` prints the login line + exits 1.
- [ ] **G3 Commit:** `feat(cli): print-mode points keyless users to caveman login (incl. expired auth)`.

## Chunk H — Full verification
- [ ] `npm run build` clean; `npm run check` clean (restore models.generated.ts after).
- [ ] Full coding-agent suite CI-mirror green.
- [ ] Manual smoke (caveman linked): clear `auth.json` + unset keys → `caveman` opens login → complete → model auto-selected → prompt runs. `/login anthropic` direct. `caveman -p` prints login line.

## Done when
All chunks committed on `fix/first-run-activation`; gate + typed error + 3 surfaces in; build/check/suite green; manual smoke confirms no keyless dead-end; authed path unchanged.
