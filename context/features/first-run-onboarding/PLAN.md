# First-Run Onboarding Fixes — Implementation Plan (issue #11)

> **For agentic workers:** TDD. Test first, run-fail, implement, run-pass, commit. Follow local conventions (vitest for ai + coding-agent, node:test for tui; biome; tsgo strict). Conventional commits. Revert `packages/ai/src/models.generated.ts` + `package-lock.json` before any commit (network-drift artifacts). Commit signed (`-S`).

**Goal:** Fix 3 first-run trust-eroding gaps — `/login <friendly-name>`, `/help`, editor placeholder.

**Architecture:** Aliases on provider defs (packages/ai) + consumer-side resolver (coding-agent). `/help` reuses extracted hotkeys builder + wired-filtered registry index. Placeholder is display-only render-loop ghost text reusing `truncateToWidth`.

**Tech Stack:** TypeScript strict monorepo; biome; vitest + node:test.

---

## Chunk A: Login aliases

**Files:**
- Modify: `packages/ai/src/utils/oauth/types.ts:34` (add `aliases?`)
- Modify: `packages/ai/src/utils/oauth/{anthropic,openai-codex,google-gemini-cli,github-copilot}.ts` (populate `aliases`)
- Modify: `packages/coding-agent/src/modes/interactive/interactive-mode.ts` (resolver + `parseLoginCommand` sig + call site `:2465`)
- Test: `packages/coding-agent/test/interactive-mode-parse-login.test.ts` (migrate + extend)

- [ ] **A1.** Add `readonly aliases?: readonly string[];` to `OAuthProviderInterface` (types.ts:36, after `name`). Run `npx tsgo --noEmit` — expect clean (optional field).
- [ ] **A2.** Populate `aliases` on the 4 provider consts: anthropic `["claude"]`, openai-codex `["chatgpt","openai","codex"]`, google-gemini-cli `["gemini","google"]`, github-copilot `["copilot","github"]`. (antigravity: none.)
- [ ] **A3. Failing test:** migrate `interactive-mode-parse-login.test.ts` — change `valid` to provider objects `[{id:"anthropic",aliases:["claude"]},{id:"openai-codex",aliases:["chatgpt"]},{id:"github-copilot",aliases:["copilot"]}]`; add cases: `/login claude`→`{kind:"provider",provider:"anthropic"}`, `/login CHATGPT`→`openai-codex` (case-insensitive), `/login openai-codex`→`openai-codex` (raw id), `/login bogus`→`{kind:"invalid",provider:"bogus"}`, `/login`→selector, `/login  `→selector. Run → FAIL (signature mismatch / resolver absent).
- [ ] **A4. Implement:** add `resolveProviderAlias(input, providers)` (case-insensitive id-then-alias match → id|undefined) beside `parseLoginCommand`; change `parseLoginCommand` 2nd param to `ReadonlyArray<{id:string; aliases?:readonly string[]}>`, resolve via helper. Run test → PASS.
- [ ] **A5.** Update call site `:2465`: pass `authStorage.getOAuthProviders()` (drop `.map(p=>p.id)`); rewrite error to friendly names: `providers.map(p=>p.aliases?.length?\`${p.aliases[0]} (${p.id})\`:p.id).join(", ")`. Run `npx tsgo --noEmit` → clean.
- [ ] **A6. Commit:** `feat(auth): accept friendly /login names (claude/chatgpt/gemini/copilot)`

## Chunk B: /help command

**Files:**
- Modify: `packages/coding-agent/src/core/slash-commands.ts` (`wired` field + populate)
- Modify: `packages/coding-agent/src/modes/interactive/interactive-mode.ts` (extract `buildHotkeysMarkdown`, add `handleHelpCommand` + dispatch)
- Test: `packages/coding-agent/test/slash-commands-wired.test.ts` (new)

- [ ] **B1. Refactor commit (no behavior change):** extract `private buildHotkeysMarkdown(): string` from `handleHotkeysCommand:5334` (move all `getEditorKeyDisplay`/`getAppKeyDisplay` locals + template + extension block into it, `return hotkeys`); `handleHotkeysCommand` calls it then renders. Run existing hotkeys/interactive tests + `tsgo` → green. Commit `refactor(tui): extract buildHotkeysMarkdown`.
- [ ] **B2. Failing test:** `slash-commands-wired.test.ts` — assert every `BUILTIN_SLASH_COMMANDS` entry has `typeof c.wired === "boolean"`; assert `help` present. Run → FAIL (no `wired`, no `help`).
- [ ] **B3. Implement:** add `wired: boolean` (required) to `BuiltinSlashCommand`; audit dispatch chain (`grep -nE 'text === "/' interactive-mode.ts`) and set `wired` on all entries (true if it has a dispatch branch, false otherwise); add `{name:"help", description:"Show commands and keyboard shortcuts", wired:true}`. Run test → PASS.
- [ ] **B4.** Add `handleHelpCommand()` (command index from `BUILTIN_SLASH_COMMANDS.filter(c=>c.wired)` + `buildHotkeysMarkdown()`), dispatch `if (text === "/help") { this.editor.setText(""); this.handleHelpCommand(); return; }` beside `/hotkeys` `:2437`. Run `tsgo` → clean.
- [ ] **B5. Commit:** `feat(cli): add /help (command index + shortcuts)`

## Chunk C: Editor placeholder

**Files:**
- Modify: `packages/tui/src/components/editor.ts` (`EditorOptions:205`, field, render loop `:462`)
- Modify: `packages/coding-agent/src/modes/interactive/interactive-mode.ts:506` (pass option)
- Test: `packages/tui/test/editor.test.ts` (append placeholder cases)

- [ ] **C1. Failing test** (node:test, `editor.test.ts`): construct editor with `{placeholder:"Type a task, or / for commands · F1 help"}`, set `editor.focused = true`; `render(80)` → assert output contains `\x1b[2m` (dim) AND part of placeholder text AND `\x1b[7m` (cursor). Run → FAIL.
- [ ] **C2. Implement:** add `placeholder?: string` to `EditorOptions`; store `this.placeholder` in ctor + `setPlaceholder`; in render loop `:462` add `showPlaceholder` guard (`!!this.placeholder && this.isEditorEmpty() && layoutLine.hasCursor && layoutLine.cursorPos===0 && layoutLine.text===""`) → build displayText via `truncateToWidth(this.placeholder!, contentWidth, "")`, inverse-cursor on first grapheme when focused, `\x1b[2m` dim rest; `lineVisibleWidth = visibleWidth(clipped)`; else-branch = existing cursor block unchanged. Run C1 → PASS.
- [ ] **C3. Edge tests:** widths 20/200 → no throw, line visible width ≤ content width (no negative padding); after `insertCharacter("x")` → output has NO placeholder text; `isEditorEmpty()` true while placeholder shows; unfocused (`editor.focused=false`) empty → dim placeholder, NO `\x1b[7m`. Implement any fixes. Run → PASS.
- [ ] **C4.** Wire string at `interactive-mode.ts:506`: add `placeholder: "Type a task, or / for commands · F1 help"` to `CustomEditor` options. Run `tsgo` → clean.
- [ ] **C5. Commit:** `feat(tui): editor placeholder advertises slash + help`

## Chunk D: Docs + ensureUsableModel

**Files:**
- Modify: `docs/getting-started/auth.md`, `README*`, `docs/.../quickstart.md`
- Modify: `interactive-mode.ts` (~4616 comment), Test: stash/replay data-path test

- [ ] **D1.** Docs: keep friendly `/login claude|chatgpt|gemini|copilot`; add one line "(raw ids also work: anthropic, openai-codex, google-gemini-cli, github-copilot)". Confirm quickstart `/help` reference now valid.
- [ ] **D2.** Add code comment at `ensureUsableModel` documenting the stash-`pendingPrompt`→`onLoginSuccess`-replay gate for task-first no-auth users. Add a light unit test on the stash/replay data path (no heavy mock). Run → PASS.
- [ ] **D3. Commit:** `docs(auth): correct /login names; document no-auth task-first gate`

## Chunk E: Verification

- [ ] **E1.** `git checkout -- packages/ai/src/models.generated.ts package-lock.json`
- [ ] **E2.** Root `npx tsgo --noEmit` → clean (incl. tests).
- [ ] **E3.** `npm test` across workspaces → green.
- [ ] **E4.** `npx biome check --error-on-warnings .` on touched files → clean.
- [ ] **E5.** Confirm models.generated.ts/package-lock.json not staged.
