# PRD: Fix First-Run Activation (no more keyless dead-end)

- Status: draft
- Author: Zhachory Volker
- Date: 2026-06-12
- Closes: #10 (and the `/login <provider>` slice of #11)
- Surface: `packages/coding-agent` interactive mode, onboarding wizard, print mode

## 1. Problem

New dev installs caveman (sold by token-savings README), runs `caveman`, no API key set. What happen:
- Interactive: passive yellow warning only (`interactive-mode.ts:811`). Type prompt → throws `No model selected` (`agent-session.ts:1860`) → caught → error shown → retry forever. **No login ever opens.** Dead-end.
- Print mode (`-p`): stderr msg (env vars only, no mention of `caveman login`) + `exit(1)` (`main.ts:849`).
- Onboarding wizard: no-env-key branch **auto-skips auth** (`wizard.ts:205`), drops user straight into the dead-end. Env-key branch offers "configure later" skip too. Never hands off to login.
- Docs say `/login claude`; handler only matches bare `/login` (`interactive-mode.ts:2394`) → arg silently ignored.

User never reach "wow." Biggest activation cliff (council P0). All confirmed in code.

## 2. Goal

**No keyless user can land in a dead prompt loop.** A user without usable auth is actively guided into the existing login flow (which already works — OAuth + API-key, TUI + non-TTY `caveman login`). Make the first run end in either a working session or a clear, actionable login step — never a silent dead-end.

## 3. Users & use cases

- **U1 first-run, no key:** install → `caveman` → immediately prompted to log in (selector opens), picks provider, OAuth, working session. (Primary.)
- **U2 first-run, skipped auth in wizard:** wizard ends with explicit "configure auth now? [Y/n]" — no silent skip into dead-end.
- **U3 headless / `-p`:** keyless `caveman -p "..."` prints a copy-paste `caveman login` instruction (+ `--device-auth` for SSH), exit non-zero. No dead silence.
- **U4 doc-follower:** types `/login anthropic` (as docs say) → routes straight to that provider.

## 4. Requirements

### Must
- **F1 Keyless empty-state opens login.** On interactive start (TTY) with no usable auth (`modelRegistry.getAvailable().length === 0`), auto-open the existing OAuth/login selector instead of only a passive warning. **Re-fires on EVERY keyless launch** — not gated to first-run-only (the wizard is a one-shot; a user who skipped auth must still be caught next launch).
- **F2 No dead prompt loop — covers BOTH throws.** If a user submits a prompt while keyless, route to login instead of throwing. Cover **both** failure throws: `No model selected` (`agent-session.ts:1858`, no model) **and** the auth-missing/expired-OAuth throw (`agent-session.ts:1867-1880`). The latter is the real-world case red-team flagged: `hasConfiguredAuth` returns true for a *stored-but-expired* OAuth token, so `getAvailable()` is 1, F1 never fires, and the failure surfaces only at call time — route that to re-login too.
- **F3 Wizard auth gate.** Wizard must NOT complete in a no-auth state silently. No-env-key branch ends with "configure auth now? [Y/n]" → launches login; "configure later" stays allowed but explicit + warns. Detect stored OAuth via `AuthStorage` (not just env) so authed users aren't re-prompted. Sequence so the user never sees the wizard gate AND the F1 auto-open back-to-back (one login prompt, not two).
- **F4 Print-mode points to `caveman login`.** Keyless `-p` message includes the working `caveman login` command (and `--device-auth` for non-TTY/SSH), not just env-var names. Keep exit(1).
- **F5 `/login <provider>` routes directly.** Parse the arg (mirror `/compact`/`/freeze`), validate against `getOAuthProviders()`, route to `showLoginDialog(provider)`; bare `/login` unchanged.
- **F6 Auto-select a model after login (THE load-bearing fix — council, both reviewers).** On successful login (any path), if no model is selected, pick the newly-authed provider's default (`defaultModelPerProvider`, `model-resolver.ts:155`) and `setModel` it, then refresh registry + provider count. Without this, login succeeds but `this.model` stays undefined → the next submit throws `No model selected` again and the dead-end just moves one keystroke downstream.
- **F7 Persistent empty-state affordance (safety net).** While keyless, the empty editor shows a one-line hint/placeholder (e.g. `no model — type /login or pick a provider`). This is the catch-all for every cancel/Esc path (R3) and the F2 re-prompt trap, so a user who dismisses the selector is never left guessing. (Minimal placeholder only — full `/help` stays out of scope.)

### Should
- **S1** After login+model-select succeed, drop into a ready session without restart.
- **S2** Empty-state + wizard copy is short, friendly, names the cheapest path (OAuth one-liner).
- **S3** OAuth failure / offline: show an actionable message (retry · use API key · `--device-auth`) and return to the empty-state hint (F7), not a bare prompt.

### Won't (this cycle)
- Not rebuilding OAuth/login internals (they work).
- Not adding `/help` or full command discovery (rest of #11 — next cycle); F7 is only a one-line keyless placeholder.
- Not adding new providers/auth methods. No telemetry changes.

### Resolved (was OQ, post-council)
- **OQ1** Preserve the typed prompt; auto-run it after login **only if login AND model-select (F6) both succeed**; on cancel/failure keep the text in the editor, don't run, show "will run after login" beforehand.
- **OQ2** Wizard gate uses the in-TUI `showOAuthSelector` (consistent with F1/F2; avoids cross-process model-select hand-off).
- **OQ3** Auto-open the selector; Esc returns to prompt (R3) backed by the F7 placeholder.

## 5. Success criteria

- Fresh install, no key: `caveman` opens a login prompt within the first screen; completing it yields a working session — zero raw `No model selected` errors seen by the user.
- Submitting a prompt while keyless opens login, never loops on the error.
- Wizard cannot finish in a silent no-auth state; a user who has OAuth stored isn't re-prompted.
- `caveman -p` keyless prints a runnable `caveman login` line + exits non-zero.
- `/login anthropic` (and other valid providers) routes directly; invalid arg shows a clear error; bare `/login` unchanged.
- Existing authed users see no behavior change.

## 6. Metric

Time-to-first-successful-prompt (install → first model call). Secondary: % of first sessions reaching ≥1 model call; bounce-after-keyless rate.

## 7. Risks

- **R1 Annoying authed users:** auto-open must trigger ONLY when truly no usable auth (use `getAvailable().length===0` / `hasConfiguredAuth`), incl. stored OAuth — not just env. Mitigate with the right check + tests.
- **R2 Non-TTY/headless:** auto-opening a TUI selector is wrong when not a TTY. Gate F1/F2 to interactive TTY; non-TTY uses the F4 print path.
- **R3 Login-cancel loop:** if user cancels the auto-opened selector, don't immediately re-open (infinite). Cancel → return to prompt with the hint; re-open only on explicit `/login` or next submit.

## 8. Open questions (for design doc)
- OQ1 On F2 (keyless submit), open the selector and discard the typed prompt, or queue it to run after login succeeds? (Lean: preserve the prompt, run after auth.)
- OQ2 Wizard gate: launch the in-TUI `showOAuthSelector` vs the CLI `runLogin` flow? (Lean: in-TUI, consistent with interactive.)
- OQ3 Should F1 auto-open, or show a one-keystroke "press Enter to log in" prompt (less jarring)? (Lean: auto-open selector; Esc returns to prompt per R3.)
