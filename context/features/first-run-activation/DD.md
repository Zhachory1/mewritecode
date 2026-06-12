# Design Doc: Fix First-Run Activation

- Status: draft (pre-review)
- Author: Zhach Volker
- Date: 2026-06-12
- Implements: [PRD.md](./PRD.md) (closes #10 + `/login <provider>` slice of #11)

## 1. Summary

Close the keyless dead-end at every entry point by routing a no-usable-auth user into the **existing** login flow, and — critically — **selecting a model after login** so the session is actually usable. No new OAuth/auth internals; all changes are wiring + one model-select step + small UX. All seams confirmed in code (see PRD grounding).

## 2. Auth-state: the single source of truth

- "Has ANY usable model": `session.modelRegistry.getAvailable().length > 0` (`model-registry.ts:553`, filters by `hasConfiguredAuth`).
- "Has auth for a provider": `modelRegistry.hasConfiguredAuth(model)` (`model-registry.ts:567`) → `AuthStorage.hasAuth` (env key OR stored `auth.json` incl. OAuth).
- **Known limitation (red-team):** `hasConfiguredAuth` is presence-only — a *stored-but-expired* OAuth token reads as usable, so `getAvailable()` can be ≥1 while the actual call fails. F1 (start, `getAvailable()===0`) cannot catch that; **F2 catches it at call time** by routing the auth-error throw to login. We do NOT add token-liveness probing to `getAvailable()` (network in a sync hot path — out of scope); F2 is the correct safety net.

Helper to add: `private hasUsableModel(): boolean { return this.session.modelRegistry.getAvailable().length > 0; }` in `interactive-mode.ts` (one place, reused by F1/F2/F7).

## 3. Design by requirement

### F1 — keyless start opens login (`interactive-mode.ts:811-813`)
Replace the passive-only warning. After init, if `this.ui.isTTY` (or equivalent) and `!hasUsableModel()`:
- set the F7 placeholder, show a one-line hint, then `this.showOAuthSelector("login")`.
This is start-time code, so it **naturally re-fires every launch** (not gated by the onboarding-completed flag) — satisfies the "must re-catch a wizard-skip user" requirement. Non-TTY → skip (handled by print path F4).

### F2 — keyless submit routes to login, covers both throws (`interactive-mode.ts:836-844`)
In the submit handler, before `session.prompt`:
- if `!hasUsableModel()` → stash the typed text as `pendingPrompt`, show "will run after login", `showOAuthSelector("login")`, return (don't call prompt).
Also harden the existing catch (`:841-843`): if the thrown error is the no-model/auth-missing class (match on a typed error or the known messages from `agent-session.ts:1858` and `:1867-1880`), route to login + stash `pendingPrompt`, instead of only `showError`. Prefer a typed error (see §4) over string-matching.

### F6 — auto-select a model after login (load-bearing)
Single post-login hook used by ALL login completion paths (the selector `onSelect`→`showLoginDialog` success at `interactive-mode.ts:4619-4623`, the F5 direct route, and the F3 wizard-launched login):
```
private async onLoginSuccess(providerId: string) {
  await this.session.modelRegistry.refresh();
  this.updateAvailableProviderCount();
  if (!this.session.model) {
    const model = resolveDefaultModelForProvider(providerId); // defaultModelPerProvider, model-resolver.ts:155
    if (model) await this.session.setModel(model);            // existing setter used by /model
  }
  if (this.pendingPrompt && this.session.model) {
    const p = this.pendingPrompt; this.pendingPrompt = undefined;
    await this.submitPrompt(p);   // run the preserved prompt only now
  }
}
```
Replaces the current refresh-only success handling. If model-select fails (no default for provider), fall back to opening `/model` selector with a hint — never silently leave `this.model` undefined.

### F3 — wizard auth gate (`onboarding/wizard.ts:181-209`)
- `detectAvailableEnvProviders` (`:124-135`): also consult `AuthStorage` for stored OAuth, not just env, so an already-OAuth'd user shows as configured.
- No-env-key branch (`:201-205`): replace the hardcoded `auth = { type: "skip" }` with a prompt: "Configure auth now? [Y/n]". Yes → return `{ type: "launch-login" }`; No → `{ type: "skip" }` with an explicit "you'll need to log in before your first prompt" note.
- Hand-off: `main.ts` (around `:659`, after `runOnboarding`) reads the answer; if `launch-login`, set a flag passed into `InteractiveMode` so it opens `showOAuthSelector` on start **instead of** F1's auto-open (sequencing: one prompt, not two). If F3 already authed the user, F1's `getAvailable()===0` is false → F1 no-ops naturally.

### F4 — print-mode message (`main.ts:849-855`)
Append to the keyless print-mode error:
```
Run `caveman login` to authenticate (or `caveman login --device-auth` over SSH).
```
Keep env-var lines + `exit(1)`. (The `caveman login` CLI already exists and is non-TTY safe — `cli/login.ts`.)

### F5 — `/login <provider>` (`interactive-mode.ts:2394`)
Change `text === "/login"` to also handle `text.startsWith("/login ")`. Parse the provider arg; validate against `getOAuthProviders()` (`oauth-selector.ts:59`); valid → `showLoginDialog(provider)` directly (skip the selector); invalid → `showError` listing valid providers; bare `/login` → selector as today. Mirror `/compact` (`:2409`) / `/freeze` (`:2415`) arg parsing. Route success through `onLoginSuccess` (F6).

### F7 — keyless editor placeholder (`interactive-mode.ts` editor setup)
While `!hasUsableModel()`, set the editor placeholder to `no model — type /login or pick a provider`. Clear it once a model is selected. Safety net for every R3 cancel / F2 re-prompt path. Minimal — not full command help.

## 4. Typed error (avoid string-matching)
Add `class NoUsableAuthError extends Error` (or a discriminator field) thrown by `agent-session.ts:1858` and `:1867-1880` so `interactive-mode` F2 can branch on `instanceof` rather than matching message text (which would silently break if copy changes). Keep the human message identical.

## 5. Edge cases

| Case | Handling |
|------|----------|
| Authed user (env or live OAuth) | `getAvailable()>0` → F1/F2/F7 all no-op; zero behavior change |
| Stored-but-expired OAuth | `getAvailable()≥1`, F1 skips; call fails → F2 catches the auth-throw → re-login |
| Login cancelled (Esc) | return to prompt, F7 placeholder visible; do NOT auto-reopen (R3); `pendingPrompt` kept in editor, not run |
| Login fails / offline | S3 actionable message → return to F7 hint, not bare prompt; `pendingPrompt` preserved |
| Login succeeds, no default model for provider | F6 fallback → open `/model` selector with hint (never leave model undefined) |
| Wizard launched login + F1 | sequenced: wizard hand-off suppresses F1 auto-open; or F1 no-ops because auth now present |
| Non-TTY / piped | F1/F2/wizard skip (TTY-gated); F4 print path applies |
| `/login badprovider` | clear error listing valid providers; no crash |

## 6. Files touched

- `interactive-mode.ts` — `hasUsableModel()`, F1 start-open, F2 submit+catch routing, F6 `onLoginSuccess`, F5 `/login <provider>`, F7 placeholder, `pendingPrompt` field.
- `agent-session.ts` — typed `NoUsableAuthError` at the two throw sites (§4).
- `onboarding/wizard.ts` — auth gate + stored-OAuth detection (F3).
- `main.ts` — wizard `launch-login` hand-off (F3), print-mode message (F4).
- `model-resolver.ts` — export/reuse `resolveDefaultModelForProvider` (defaultModelPerProvider) if not already callable (F6).
- (read-only deps: `oauth-selector.ts`, `login-dialog.ts`, `model-registry.ts`, `auth-storage.ts`, `cli/login.ts`.)

## 7. Testing

- **Unit (vitest):**
  - `hasUsableModel()` true/false from a mock registry (env, stored-OAuth, none).
  - F6 `onLoginSuccess`: no model → selects provider default + sets it; existing model → untouched; no default → fallback path; pendingPrompt runs only when model set.
  - F5 parse: `/login`, `/login anthropic` (valid), `/login bogus` (invalid), `/login ` (trailing space).
  - Wizard F3: no-env-key → gate prompt (mock io); "configure later" → explicit skip answer; stored-OAuth detected as configured.
  - Typed `NoUsableAuthError` thrown at both `agent-session` sites.
- **Integration (interactive harness):** drive a keyless session — start opens selector (mocked); submit-while-keyless stashes prompt + opens selector, not throw-loop; simulate login success → model selected → pending prompt runs.
- **Manual smoke** (caveman linked): unset keys + clear `auth.json` → `caveman` opens login; `caveman -p "hi"` prints the `caveman login` line + exits 1.

## 8. Rollout
Single feature branch, staged commits (typed error → hasUsableModel+F1 → F2 → F6 → F5 → F7 → wizard F3 → print F4 → tests). No flag — strictly improves the keyless path; authed path unchanged. `caveman` is linked to this clone for live smoke.

## 9. Open questions for review
- OQ-A `setModel` vs a lower-level set: is there a single session method that sets model AND persists as default-for-next-time? (Want the post-login model to stick across restarts.)
- OQ-B Should F4 also fire for the "model set but auth expired" print-mode case (`main.ts` only guards `!session.model`)? Likely yes — mirror F2's broadened coverage in print mode.

---

## 10. Post-DD-review redesign (SUPERSEDES §3 where they conflict)

Two independent council reviews (architect + red-team) found §3 invents primitives and scatters logic the codebase already centralizes. This section is the authoritative design.

### 10.1 Corrected primitives (verified in code)
- **OQ-A solved:** `AgentSession.setModel(model)` (`agent-session.ts:2289-2304`) already sets `state.model`, `appendModelChange`, AND persists via `settingsManager.setDefaultModelAndProvider` (`:2298`). No new setter. It **throws if `!hasConfiguredAuth`**, so always `modelRegistry.refresh()` (sync, `:289`) BEFORE `setModel` so freshly-stored OAuth is visible.
- **No new resolver:** `resolveDefaultModelForProvider` does NOT exist. Reuse `findInitialModel` (`model-resolver.ts:474`, step-4 picker `:535-550`) which already returns a usable, auth-passing `Model` or `undefined`. `defaultModelPerProvider` (`:14`) is a `Record<provider,string>` (id, not a Model) — do not call it directly.
- **Three throw sites, not two:** no-model `agent-session.ts:1858`; expired-OAuth/no-key `:1867-1880`; **and the real call-time site `getApiKeyAndHeaders` `:478-487`** (reached via `:468`/`:2754`). The typed error must cover all three.
- **F7:** `CustomEditor` has no placeholder API. Downgrade F7 to a persistent one-line status hint via the existing `showStatus`/`showWarning` while keyless (NOT a new editor feature).
- **Submit path:** keyless pre-check goes in `onSubmit` normal-submission branch (`interactive-mode.ts:~2581`), NOT the `while` loop. The `while`-loop catch (`:841-843`) is the secondary net for the call-time throw.
- **Login success funnel:** all login completions end at `showLoginDialog` success (`:4619-4623`); wire the post-login hook there. Leave the logout refresh (`:4527-4528`) alone.

### 10.2 The single gate (replaces F1/F2/F6/F7 scatter)
```
// interactive-mode.ts — one tested function, the bug-class killer
private async ensureUsableModel(opts?: { pending?: string }): Promise<boolean> {
  if (this.session.model && this.session.modelRegistry.hasConfiguredAuth(this.session.model)) return true;
  // try to resolve a usable model from current auth (reuses the resolver)
  const m = findInitialModel({ modelRegistry: this.session.modelRegistry, /* no CLI override */ }).model;
  if (m) { await this.session.setModel(m); return true; }
  // none usable:
  if (!this.isTTY) { /* non-interactive: caller handles print path */ return false; }
  if (opts?.pending) this.pendingPrompt = opts.pending;
  this.showKeylessHint();            // F7 status hint
  this.showOAuthSelector("login");   // existing selector
  return false;
}
```
- **Start (F1):** after init (post `:834`), if `!launchLoginOnStart` → `await ensureUsableModel()`. Re-fires every launch (start-time, not onboarding-gated).
- **Submit (F2):** in `onSubmit` normal branch → `if (!(await ensureUsableModel({ pending: text }))) return;` (don't prompt). The `while`-loop catch additionally maps the typed `NoUsableAuthError` → `ensureUsableModel({pending:lastText})`.
- **Post-login (F6):** `showLoginDialog` success → `onLoginSuccess()`: `refresh()` → `updateAvailableProviderCount()` → `await ensureUsableModel()` (selects the model via the resolver) → if `pendingPrompt` and model now set, replay it via `this.session.prompt(p)` / the existing `pendingInputQueue` (there is NO `submitPrompt` method).
- **F7:** `showKeylessHint()` = one status line "no model — type /login or pick a provider"; cleared when a model is set.

### 10.3 Typed error
`class NoUsableAuthError extends Error { reason: "no-model" | "expired-oauth" | "no-key" }` thrown at all THREE sites (`:1858`, `:1867-1880`, `:478-487`). Subclass of Error, identical `.message` → no caller breaks (verified: only generic `showError` consumers). `interactive-mode` catch + print mode branch on `instanceof` / `reason`.

### 10.4 Separate surfaces (kept as-is from §3, not folded into the gate)
- **F3 wizard gate:** add `{type:"launch-login"}` to the `AuthAnswer` union (`wizard.ts:44`); the no-env-key branch (`:201-205`) prompts "configure auth now? [Y/n]"; capture `runOnboarding`'s return at `main.ts:653` (currently discarded) → thread `launchLoginOnStart` into `InteractiveMode` opts (`:877`). **Explicit guard:** `if (launchLoginOnStart) showOAuthSelector("login"); else await ensureUsableModel();` — never both (M4). Detect stored OAuth in `detectAvailableEnvProviders` (`:124-135`).
- **F4 + OQ-B print mode:** `main.ts:849` — keep `!session.model` branch, ADD `else if (session.model && !modelRegistry.hasConfiguredAuth(session.model))`; both print env-vars + `caveman login` (+`--device-auth`) and `exit(1)`. (`caveman login` CLI confirmed exists, `cli/login.ts`; implementer verify `--device-auth` flag.)
- **F5 `/login <provider>`:** `interactive-mode.ts:2394` handle `text.startsWith("/login ")`; validate against `authStorage.getOAuthProviders()`; valid → `showLoginDialog(provider)` (→ onLoginSuccess funnel); invalid → error listing providers; bare `/login` unchanged.

### 10.5 Known residual (documented, accepted v1)
Subagent/Task children spawn `caveman -p --no-session` (`task.ts:205`) → run print-mode keyless logic in the child. The F4+OQ-B print path covers the message, but a keyless spawned subagent still can't interactively log in (no TTY). Accepted: the parent gate (start) ensures auth before subagents spawn in the normal flow; the child prints the actionable `caveman login` message. Full subagent-auth inheritance is out of scope.

### 10.6 Verdict
GO on §10. One `ensureUsableModel()` (reusing `findInitialModel` + `setModel`) + the typed error across 3 sites + F3/F4/F5 as separate surfaces. Removes the invented-function and scatter risks; covers the expired-OAuth and print paths the §3 design missed.
