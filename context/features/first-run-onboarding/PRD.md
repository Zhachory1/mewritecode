# PRD — First-Run Onboarding Fixes (issue #11)

**Priority:** P0 · **Effort:** S · **Owner:** mewrite-code · **Status:** draft → council

## 1. Problem

Docs point users at commands that silently fail on the activation path. First contact erodes trust before the product gets a chance to prove its wedge. Three concrete gaps, all verified in current code (post-issue drift noted):

1. **`/login <friendly-name>` fails.** `/login <provider>` parsing now exists (`interactive-mode.ts:290 parseLoginCommand`, routed at `:2465`), but it validates the arg against raw OAuth provider **ids** (`anthropic`, `openai-codex`, `github-copilot`, `google-gemini-cli`, `antigravity`). The docs (`docs/getting-started/auth.md`, README) instruct the friendly forms `/login claude`, `/login chatgpt`, `/login gemini`, `/login copilot` — every one except `antigravity` produces `Unknown provider "claude"`.
2. **No `/help`.** `quickstart.md` says "type `/help`". The registry (`core/slash-commands.ts:57`) has only `/hotkeys`, which shows keyboard shortcuts and *not* the command index. `/help` does not exist.
3. **No editor placeholder.** The prompt editor (`packages/tui/src/components/editor.ts`) renders nothing when empty. The entire slash surface (commands, plan mode, skills, F1) is invisible — the user must guess it exists.

## 2. Goal

First keystrokes succeed. The doc-prescribed commands work, and the slash surface announces itself. Zero new friction; autopilot/defaults unchanged.

## 3. Non-Goals

- No auth-flow redesign, no new providers.
- No new keybindings or overlay framework — reuse what exists.
- No telemetry pipeline build-out (metric is defined; wiring is out of scope unless a hook already exists).
- No doc rewrite beyond correcting the wrong command strings.

## 4. Proposed Solution

### 4.1 Login alias map (gap 1)
Add a friendly-name → provider-id alias table, applied inside `parseLoginCommand` before id validation:

| User types | Resolves to id |
|---|---|
| `claude`, `anthropic` | `anthropic` |
| `chatgpt`, `openai`, `codex` | `openai-codex` |
| `gemini`, `google` | `google-gemini-cli` |
| `copilot`, `github` | `github-copilot` |
| `antigravity` | `antigravity` |

Aliases resolve only to providers actually present in `validProviders`; an alias for an absent provider falls through to the existing `invalid` path (which lists valid ids). Raw ids continue to work unchanged. The error message lists friendly names alongside ids.

**Decision (council input wanted):** alias-map vs. simply rewrite the docs to use raw ids. Recommendation: alias-map — forgiving input is the better product, the friendly names are more memorable than `openai-codex`, and it makes the docs correct retroactively. Docs also get a light touch-up to show canonical names.

### 4.2 `/help` command (gap 2)
Add `{ name: "help", description: "Show commands and keyboard shortcuts" }` to the registry. Handler prints a **command index** (the slash registry, grouped) followed by the existing hotkeys table — reuse `handleHotkeysCommand`'s rendering. `/help` and `/hotkeys` share the keyboard-shortcut block; `/help` adds the command list on top. Single source of truth for the command list (the registry array), so it cannot drift.

### 4.3 Editor placeholder (gap 3)
Add an optional `placeholder` field to the editor component. When the buffer is empty, render the placeholder as dim ghost text with the cursor at column 0 over/before it; the placeholder never enters the buffer and disappears on first keystroke. Text: `Type a task, or / for commands · F1 help`.

## 5. Success Metrics

- **Primary:** auth-completion rate on first session (doc-prescribed `/login <name>` now succeeds → fewer dead-ends).
- **Secondary:** slash-menu opens per first session (placeholder advertises `/`).
- **Guardrail:** no regression in existing `/login <id>`, `/hotkeys`, or editor typing/cursor behavior.

(Metric *wiring* is out of scope unless a counter hook already exists; the fixes are the deliverable.)

## 6. Risks

- **Alias collisions / drift:** alias table is a second place provider names live. Mitigate: aliases resolve through `validProviders` (the live registry), so a removed provider can't be aliased to a dead id.
- **Placeholder rendering:** ghost text must not corrupt cursor math, scroll, or width calc, and must vanish the instant a char is typed. Highest-risk change; needs cursor/width tests.
- **`/help` drift:** if the command index is hand-maintained it rots. Mitigate: render directly from the registry array.

## 7. Definition of Done

- `/login claude|chatgpt|gemini|copilot` route to the right provider flow (when that provider is available); raw ids still work; unknown names list valid options.
- `/help` exists, shows command index + shortcuts, registered in autocomplete.
- Empty editor shows the placeholder; it vanishes on first keystroke; cursor/scroll/width unaffected.
- Docs corrected to canonical names.
- Tests green (vitest + node:test), `tsgo --noEmit` clean, biome clean.
