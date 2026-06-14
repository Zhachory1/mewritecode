# DD — First-Run Onboarding Fixes (issue #11)

**Status:** PRD-council unanimous SHIP-WITH-CHANGES; DD-council split (severity-only — all 3 agree design is sound; red-team BLOCKed on unacknowledged TS-compile omissions, now fixed). All resolutions baked in. Ready for plan.

## -1. DD-council fixes (round 2, authoritative)

7 more binding fixes from the DD review:
- **resolveProviderAlias lives in coding-agent**, NOT packages/ai. The `aliases` FIELD on `OAuthProviderInterface` stays in packages/ai (domain data); the resolver fn is consumer-side (sole caller = interactive-mode). Put it next to `parseLoginCommand`.
- **Migrate existing test** `packages/coding-agent/test/interactive-mode-parse-login.test.ts` — it passes `string[]` and WILL break on the new signature (TS strict). Explicit DoD item.
- **EditorOptions `placeholder` field is MANDATORY** (not "verify") — `new CustomEditor(...,{placeholder})` is a guaranteed compile error until added. CustomEditor (`custom-editor.ts:18` `super(tui,theme,options)`) forwards clean — NO CustomEditor change needed (verified).
- **Reuse `truncateToWidth`** (already imported editor.ts:7, def utils.ts:795, grapheme+ANSI aware, tested) — do NOT write `clipToVisibleWidth`. Call `truncateToWidth(ph, contentWidth, "")`.
- **`/help` wired-filter = `wired: boolean` required field on `BuiltinSlashCommand`** (single source at definition site), test asserts every entry has it; filter `c.wired`. Drop `WIRED_SLASH_COMMANDS` set. (`isUnwiredBuiltinSlash:4969` is NOT a static wired-map — returns true for any registered builtin; can't filter with it.)
- **`ensureUsableModel` already works** (stash `pendingPrompt` ~4616, replay in `onLoginSuccess`) — downgrade to: add code comment + a light unit test on the stash/replay DATA path only (no heavy InteractiveMode mock).
- **Sequence the refactor**: extract `buildHotkeysMarkdown()` as a standalone no-behavior-change commit FIRST, then wire `/help` (keeps diff reviewable on the 6.1k-LOC file).

## 0. Council resolutions (authoritative)

Council verified key fact: `AuthStorage.getOAuthProviders()` (`auth-storage.ts:500-502`) delegate to static `BUILT_IN_OAUTH_PROVIDERS` — no auth filter. So `validProviders` always hold all 5 ids, even fresh user. Alias map enough; no deeper bug.

Six binding decisions:
1. Aliases live **on provider definitions** (`packages/ai/.../oauth`), NOT inline table in interactive-mode. Single source, correct package boundary.
2. Placeholder render in **editor render loop** (display-only), NOT in `layoutText`. `isEditorEmpty()` stay true. Width math stay clean.
3. Placeholder **string injected** from `InteractiveMode` via `EditorOptions` — TUI primitive stay generic.
4. `/login` error message → friendly names. DoD + test.
5. `/help` → call hotkeys render as subroutine + command index from registry; filter to wired commands (no lying surface).
6. Verify+document `ensureUsableModel` gate catch task-first no-auth user. DoD + test.

## 1. Change 1 — Login aliases (gap 1)

### 1.1 Interface (packages/ai)
Add optional `aliases` to provider interface. `types.ts:34`:

```ts
export interface OAuthProviderInterface {
	readonly id: OAuthProviderId;
	readonly name: string;
	/** Friendly alternate names a user may type, e.g. ["claude"] for "anthropic". Lowercase. */
	readonly aliases?: readonly string[];
	// ...rest unchanged
}
```

### 1.2 Populate each provider def
| File | id | add `aliases` |
|---|---|---|
| `anthropic.ts:381` | `anthropic` | `["claude"]` |
| `openai-codex.ts` | `openai-codex` | `["chatgpt", "openai", "codex"]` |
| `google-gemini-cli.ts` | `google-gemini-cli` | `["gemini", "google"]` |
| `github-copilot.ts` | `github-copilot` | `["copilot", "github"]` |
| `google-antigravity.ts` | `antigravity` | (none — id already friendly; drop identity row) |

Each: add `aliases: [...]` field to the exported `OAuthProviderInterface` const.

### 1.3 Resolver (coding-agent — next to parseLoginCommand, NOT packages/ai)
Add pure helper in `interactive-mode.ts` beside `parseLoginCommand` (consumer-side; sole caller):

```ts
/** Resolve a user-typed provider name (id or alias) to a canonical id, or undefined. Case-insensitive. */
export function resolveProviderAlias(
	input: string,
	providers: ReadonlyArray<{ id: string; aliases?: readonly string[] }>,
): string | undefined {
	const q = input.trim().toLowerCase();
	for (const p of providers) {
		if (p.id.toLowerCase() === q) return p.id;
		if (p.aliases?.some((a) => a.toLowerCase() === q)) return p.id;
	}
	return undefined;
}
```

### 1.4 parseLoginCommand change (interactive-mode.ts:290)
Signature change: take full provider objects (id+aliases), not `string[]`. Resolve via helper.

```ts
export function parseLoginCommand(
	text: string,
	providers: ReadonlyArray<{ id: string; aliases?: readonly string[] }>,
):
	| { kind: "selector" }
	| { kind: "provider"; provider: string }
	| { kind: "invalid"; provider: string } {
	const arg = text.startsWith("/login ") ? text.slice("/login ".length).trim() : "";
	if (arg === "") return { kind: "selector" };
	const id = resolveProviderAlias(arg, providers);
	if (id) return { kind: "provider", provider: id };
	return { kind: "invalid", provider: arg };
}
```

### 1.5 Call site (interactive-mode.ts:2465-2477)
Pass full provider objects; rewrite error message to friendly names:

```ts
if (text === "/login" || text.startsWith("/login ")) {
	this.editor.setText("");
	const providers = this.session.modelRegistry.authStorage.getOAuthProviders();
	const parsed = parseLoginCommand(text, providers);
	if (parsed.kind === "selector") {
		await this.showOAuthSelector("login");
	} else if (parsed.kind === "provider") {
		await this.showLoginDialog(parsed.provider);
	} else {
		const names = providers
			.map((p) => (p.aliases?.length ? `${p.aliases[0]} (${p.id})` : p.id))
			.join(", ");
		this.showError(`Unknown provider "${parsed.provider}". Try: ${names || "(none)"}`);
	}
	return;
}
```

`getOAuthProviders()` already return full `OAuthProviderInterface[]` — `.map(p=>p.id)` was the only narrowing; drop it.

## 2. Change 2 — /help command (gap 2)

### 2.1 Registry (slash-commands.ts)
Add after `hotkeys` row (`:19`):

```ts
{ name: "help", description: "Show commands and keyboard shortcuts" },
```

### 2.2 Refactor hotkeys render → returnable string
`handleHotkeysCommand` (`interactive-mode.ts:5334`) build local `hotkeys` markdown then render to chatContainer. Extract builder so `/help` reuse it:

```ts
/** Build the keyboard-shortcuts markdown (shared by /hotkeys and /help). */
private buildHotkeysMarkdown(): string { /* moved body that assembles `hotkeys` string, return it */ }

private handleHotkeysCommand(): void {
	const md = this.buildHotkeysMarkdown();
	this.chatContainer.addChild(new Spacer(1));
	this.chatContainer.addChild(new DynamicBorder());
	this.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "Keyboard Shortcuts")), 1, 0));
	this.chatContainer.addChild(new Spacer(1));
	this.chatContainer.addChild(new Markdown(md.trim(), 1, 1, this.getMarkdownThemeWithSettings()));
	this.chatContainer.addChild(new DynamicBorder());
	this.ui.requestRender();
}
```

### 2.3 /help handler
Command index from registry (single source) + reuse hotkeys block. **Filter to wired commands** — registry hold commands not wired this build (`:2608` "registered but not wired"). DECISION (DD-council): add **required** `wired: boolean` to `BuiltinSlashCommand`; mark every entry by auditing the dispatch chain (`grep 'text === "/<name>"'` + arg-form branches); a test asserts every registry entry has `wired` set so new commands force the decision. `/help` filters `c.wired`. (`isUnwiredBuiltinSlash:4969` is NOT a static map — returns true for any registered builtin regardless of wiring; unusable as a filter.)

```ts
// slash-commands.ts: interface BuiltinSlashCommand { name: string; description: string; wired: boolean; }
private handleHelpCommand(): void {
	const cmds = BUILTIN_SLASH_COMMANDS.filter((c) => c.wired);
	let md = "**Commands**\n\n| Command | Description |\n|-----|--------|\n";
	for (const c of cmds) md += `| \`/${c.name}\` | ${c.description} |\n`;
	md += `\n${this.buildHotkeysMarkdown()}`;
	this.chatContainer.addChild(new Spacer(1));
	this.chatContainer.addChild(new DynamicBorder());
	this.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "Help")), 1, 0));
	this.chatContainer.addChild(new Spacer(1));
	this.chatContainer.addChild(new Markdown(md.trim(), 1, 1, this.getMarkdownThemeWithSettings()));
	this.chatContainer.addChild(new DynamicBorder());
	this.ui.requestRender();
}
```

Dispatch: beside `/hotkeys` (`:2437`):

```ts
if (text === "/help") { this.editor.setText(""); this.handleHelpCommand(); return; }
```

## 3. Change 3 — Editor placeholder (gap 3)

### 3.1 Option + field (packages/tui/src/components/editor.ts)
`EditorOptions:205` add `placeholder?: string;`. Constructor (`:281`) store `this.placeholder = options.placeholder;`. Add field + setter:

```ts
private placeholder?: string;
setPlaceholder(text?: string): void { this.placeholder = text; }
```

### 3.2 Render (NOT layoutText)
Render loop `:462-502`. Placeholder display-only, when buffer empty + this is the cursor line at col 0. Insert BEFORE existing cursor block:

```ts
for (const layoutLine of visibleLines) {
	let displayText = layoutLine.text;
	let lineVisibleWidth = visibleWidth(layoutLine.text);
	let cursorInPadding = false;

	const showPlaceholder =
		!!this.placeholder &&
		this.isEditorEmpty() &&
		layoutLine.hasCursor &&
		layoutLine.cursorPos === 0 &&
		layoutLine.text === "";

	if (showPlaceholder) {
		// Clip to content width so padding math stays correct; never overflow.
		// REUSE existing util (editor.ts:7 import, def utils.ts:795) — no new helper.
		const clipped = truncateToWidth(this.placeholder!, contentWidth, "");
		const marker = emitCursorMarker ? CURSOR_MARKER : "";
		const graphemes = [...this.segment(clipped)];
		const first = graphemes[0]?.segment ?? " ";
		const rest = clipped.slice(first.length);
		// Focused: inverse cursor over first grapheme, dim rest. Unfocused: all dim.
		const head = emitCursorMarker ? `${marker}\x1b[7m${first}\x1b[0m` : `\x1b[2m${first}\x1b[0m`;
		displayText = `${head}\x1b[2m${rest}\x1b[0m`;
		lineVisibleWidth = visibleWidth(clipped);
	} else if (layoutLine.hasCursor && layoutLine.cursorPos !== undefined) {
		// ...existing cursor block UNCHANGED...
	}
	// ...existing padding + push UNCHANGED...
}
```

**Invariants (must hold):**
- `isEditorEmpty()` (`:346`) untouched → history-nav, autocomplete, submit-gate behave same.
- Placeholder never enter `this.state.lines`. Vanish on first `insertCharacter` (buffer non-empty → `showPlaceholder` false).
- Width: `lineVisibleWidth = visibleWidth(clipped) ≤ contentWidth`, so padding non-negative, no `cursorInPadding`.

### 3.3 Wire string from InteractiveMode
`interactive-mode.ts:506` — pass option to default editor:

```ts
this.defaultEditor = new CustomEditor(this.ui, getEditorTheme(), this.keybindings, {
	// ...existing opts,
	placeholder: "Type a task, or / for commands · F1 help",
});
```

`CustomEditor` (`custom-editor.ts:18`) does `super(tui, theme, options)` — forwards `EditorOptions` unchanged, no whitelist. **Verified: no CustomEditor change needed** once `EditorOptions` gains `placeholder`. (`focused` is a public field on `Editor` — tests set `editor.focused = false` directly for the unfocused case.)

## 4. Change 4 — Docs (gap 4)

- `docs/getting-started/auth.md` + README: keep friendly names (`/login claude|chatgpt|gemini|copilot`), add one line "(raw ids also work: anthropic, openai-codex, …)".
- `quickstart.md`: `/help` now real — no change needed beyond confirming it works.

## 5. No-auth task-first gate (council BLOCKER 6)

Verify `ensureUsableModel` (`interactive-mode.ts:~326`) intercept a first prompt with no model: stash prompt, open login selector, replay after auth. Add a test asserting: submit prompt with no usable model → login flow opens, prompt not lost, no silent error. Document the flow in a code comment. If it does NOT work, that becomes its own finding (out of this PR's happy path — but must be reported).

## 6. Test plan

**packages/ai (vitest)** — `resolveProviderAlias`:
- `claude`→`anthropic`; `CHATGPT`→`openai-codex` (case-insensitive); `gemini`→`google-gemini-cli`; `copilot`→`github-copilot`.
- raw id `openai-codex`→`openai-codex`; unknown `gpt`→`undefined`; alias for absent provider (pass providers list w/o it)→`undefined`.

**packages/coding-agent (vitest)** — `parseLoginCommand` (pure, exported):
- **MIGRATE existing** `test/interactive-mode-parse-login.test.ts` — it passes `string[]`; rewrite to provider-object shape `[{id:"anthropic", aliases:["claude"]}, …]` (breaks compile otherwise).
- `/login`→selector; `/login claude`→`{provider:"anthropic"}`; `/login openai-codex`→`{provider:"openai-codex"}`; `/login bogus`→`{invalid:"bogus"}`; trailing space `/login  `→selector.
- **`/help` wired test**: assert every `BUILTIN_SLASH_COMMANDS` entry has `wired` set (boolean); assert `/help` not in unwired set.
- **ensureUsableModel** (light): unit-test the stash/replay data path only (set pending, simulate login success, assert prompt replayed) — no full InteractiveMode mock.

**packages/tui (node:test)** — editor placeholder:
- empty + focused, width 80 → `render()` output contain dim escape `\x1b[2m` + (clipped) placeholder text + cursor marker.
- widths 20, 80, 200 → no negative padding / no throw; line width ≤ content width.
- after `insertCharacter("x")` → output contain NO placeholder text.
- `isEditorEmpty()` true while placeholder showing.
- unfocused empty → placeholder dim, no inverse-cursor escape `\x1b[7m`.

**Guardrails:** existing `/login <id>`, `/hotkeys`, editor typing/cursor/history tests stay green.

## 7. Definition of Done
- `/login claude|chatgpt|gemini|copilot` route correctly; raw ids still work; unknown → friendly-name list. Error message tested.
- `/help` registered + dispatched; shows wired command index + shortcuts; wired-set asserted vs registry in a test.
- Empty editor show placeholder; vanish on first keystroke; widths 20/80/200 safe; `isEditorEmpty()` semantics unchanged.
- ensureUsableModel task-first gate verified + tested + commented.
- Docs corrected.
- vitest + node:test green, root `tsgo --noEmit` clean, biome clean.
