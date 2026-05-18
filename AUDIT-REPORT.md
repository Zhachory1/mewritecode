# cave-cli Production-Readiness Audit

Date: 2026-04-29 · Branch: `main` (with WIP in coding-agent) · Auditor: parallel sweep across 5 subsystems

Scope: every load-bearing system — TUI, subagents/hooks, MCP, permissions/sandbox, slash-commands/skills, daemon, extensions/plugins/recipes, AI providers/models/auth/cost, build/install/onboarding, secondary packages.

Method: 5 parallel exploration agents read code; their findings were spot-verified against the actual files before promotion to BLOCKER. Where verification refuted a claim it is annotated.

---

## BLOCKERS (ship-stoppers)

### B1. Homebrew formula has literal `PLACEHOLDER_*` sha256 strings
`Formula/cave.rb:10,14,21,25` — every architecture's sha256 is the string `PLACEHOLDER_DARWIN_ARM64`/`_X64`/`LINUX_ARM64`/`LINUX_X64`. Brew will reject the formula on every install (or, worse, accept anything if a downstream tap rewrites them). The `update-homebrew.sh` script that's supposed to populate them was apparently never run before tagging v0.65.2.
*Impact:* every `brew install caveman` is broken right now.

### B2. `caveman serve` daemon: empty `--token` means open-bar
`packages/coding-agent/src/core/daemon/server.ts:159` — `if (!opts.token) return true;`. When no token is configured (the default), the authorize() function unconditionally returns true. Anyone with TCP reach to the daemon port can list/create sessions, send messages, and register workers.
*Impact:* multi-client/cloud deploy is a privilege-escalation primitive. At minimum the default must be "require token unless `--insecure` is explicitly set" or "bind 127.0.0.1 only with no token".

### B3. MCP tool calls bypass the permission system entirely
`packages/coding-agent/src/core/tools/mcp-bridge.ts:96-119` — the `mcp_tool_call` and `mcp_tool_search` AgentTools' `execute` callbacks call `hub.callNamespaced(...)` and `hub.buildToolSearchTool()` directly. No `ProposedAction` is constructed; no `PermissionSession.decide()` is invoked. Plan mode and any `bypassPermissions=false` policy do not reach MCP. Confirmed by reading the file.
*Impact:* a user in plan mode can still `mcp_tool_call` an arbitrary MCP server (filesystem, GitHub write, etc.). Sandbox enforcement is incomplete.

### B4. Settings file written without 0o600
`packages/coding-agent/src/core/settings-manager.ts:298` — `writeFileSync(path, next, "utf-8")` with no `chmodSync`. Inherits umask (typically 0o644). Auth storage correctly chmods to 0o600 (`auth-storage.ts:53,95,140`); settings does not.
*Impact:* any sensitive config (custom hooks running shell commands, telemetry keys, project-local API URLs) is world-readable on shared hosts.

### B5. TUI library calls `process.exit()` from signal/exception handlers
`packages/tui/src/terminal.ts:176, 192, 200` — `ProcessTerminal` installs handlers for SIGINT/SIGTERM/SIGHUP, uncaughtException, and unhandledRejection that all call `process.exit()`. Library code must not exit the host process.
*Impact:* any consumer of `@caveman-code/tui` (web-ui, future embedders, tests) loses the ability to handle signals or recover from rejections — the TUI swallows them and kills the process. Also: `unhandledRejection` is now lethal everywhere TUI is loaded, even from rejections originating outside the TUI.

### B6. New OpenRouter/Vercel-Gateway models reduce qwen3-235b context window 2×
`packages/ai/src/models.generated.ts` (uncommitted diff) — `alibaba/qwen3-235b-a22b-thinking` goes from `contextWindow: 262114, maxTokens: 262114` → `131072, 32768`. Existing sessions sized for 256k will silently truncate or hard-error.
*Impact:* this is a generated file; either the upstream registry corrected itself or the regen script lost data. Either way, ship-blocker until reconciled — if the model legitimately shrunk, callers need a deprecation note; if it didn't, regenerate.

### B7. Plugin installer has no checksum / signature verification
`packages/coding-agent/src/core/plugins/installer.ts` — plugins are downloaded over `fetch(url)` and extracted without manifest hash check or signature. Combined with the marketplace concept this is a textbook supply-chain hole.
*Impact:* one CDN compromise or one MITM = arbitrary code execution in every caveman session that has the plugin enabled. Same applies to extensions loaded by `jiti.import()` from disk (`extensions/loader.ts:292-304`) — those have no verification either, but the trust boundary there is "user already wrote it to disk".

---

## HIGH

### H1. Headless permission UI auto-approves whatever the reducer's `defaultVerb` is
`packages/coding-agent/src/core/permission-prompt-headless.ts:15-19` — `chooseVerb()` returns `opts.defaultVerb` unchanged. In `caveman -p` / RPC / CI mode, prompts that *should* default to "deny" are silently allowed because the reducer's preferred verb is whatever it picked. The only signal is a stderr line.
*Impact:* automation cannot rely on permission policy; behavior diverges silently between TTY and headless. Need a "headless = always deny risky" mode or hard-fail.

### H2. Subagent inherits *no* parent permission mode
`packages/coding-agent/src/core/tools/task.ts:163` — when the Task tool spawns a subagent it passes `opts.agent.permissionMode` (from the agent definition file) but never reads the parent session's mode. Parent in plan mode → child runs in "default" with full tool access.
*Impact:* plan-mode escape hatch via `task` tool. Make-believe sandbox.

### H3. Stdio MCP transport leaks child FDs on connection failure
`packages/agent/src/mcp/transport/stdio.ts:59-108` — if `spawn()` succeeds but the child crashes before `child.once("spawn")` fires, the timeout rejects the promise without `child.kill()`. Each failed connect leaks 3 FDs. After ~900 failures: EMFILE.
*Impact:* long-running agents with flaky MCP servers degrade to unusable. Unkillable from inside the process.

### H4. MCP request timeout is per-call, not per-tool-invocation
`packages/agent/src/mcp/transport/stdio.ts:193-203` — each request has its own setTimeout, no aggregate ceiling. A pathological server that responds *just* before each timeout, but never produces useful data, can stall the agent indefinitely.
*Impact:* hung MCP server → hung agent. No graceful "give up after total N seconds".

### H5. Vercel AI Gateway models declare provider that isn't registered
`packages/ai/src/models.generated.ts` lists 164 models with `provider: "vercel-ai-gateway"` and `api: "anthropic-messages"`, but `packages/ai/src/providers/register-builtins.ts:367-421` only registers `anthropic-messages` against the Anthropic SDK. So Gateway models silently route to the Anthropic SDK with `baseUrl: https://ai-gateway.vercel.sh`. This works only if the gateway is wire-compatible with `api.anthropic.com` — undocumented and untested in this repo.
*Impact:* every Gateway model is a runtime gamble; auth headers and response shape may not match.

### H6. Skills/commands loaded from project `.cave/` with no trust boundary
`packages/coding-agent/src/core/skills.ts:534-536`, `slash-commands.ts:335-338` — disk-loaded skill/command bodies are appended to the system prompt without signature, checksum, or "source" trust tier. `git clone` of a malicious repo + `cave .` = arbitrary prompt injection. Also: skills run inline shell via `!\`cmd\`` preprocessing (`skills.ts:815-866`) at *load* time with a 5s/cmd timeout — many slow-but-non-crashing commands stack to minutes of startup latency.
*Impact:* drive-by prompt injection per cloned repo; DoS vector at startup.

### H7. Login command does not suppress echo for `--api-key`
`packages/coding-agent/src/cli/login.ts:88-96` — uses `rl.question` without raw-mode/echo-suppression. CLI args also remain in shell history.
*Impact:* API key in `~/.zsh_history`, `ps aux`, and screen-share recordings.

### H8. Build script chains `cd && npm run build` per package — silent failure modes
`package.json:15` (root) — sequential `cd packages/X && npm run build && cd ../Y && ...`. If any step exits 0 without producing output (e.g. a `tsgo --watch` that returns immediately), the next package builds with stale dependencies. Also: per-package `prepublishOnly` hooks won't fire when `npm publish -ws` is invoked from root.
*Impact:* publishable artefacts can lag by one commit without anyone noticing. Mom v0.65.2 may already ship stale code.

### H9. Recipe runner injects user-supplied env vars without sanitization
`packages/coding-agent/src/core/recipes/runner.ts:94-100` — `process.env[k] = v` for recipe-provided env. If a child process is later spawned with `shell: true`, values containing `$(...)` can be evaluated.
*Impact:* recipe-author → shell on host, depending on what spawns later in the run.

---

## MEDIUM

### M1. Permissions store silently drops to empty on parse error
`permission-prompt.ts:42-48` — `JSON.parse` failure returns empty store with no diagnostic. User's "always allow git push" rule disappears after a corrupted write.

### M2. Skill `paths` glob-gating frontmatter is loaded but never enforced
`skills.ts:108,134` — the `paths?: string[]` field on a skill is parsed but no code consults it when deciding whether to inject the skill. Documented feature, missing implementation.

### M3. MCP server-name collisions silently overwrite (`@caveman-code/agent` mcp/client.ts:127)
Last-wins in a `Map<string, server>`. Two configs with the same name → second wins, no warning.

### M4. Slash-command/skill name collisions are diagnostic-only
`slash-commands.ts:352-368`, `skills.ts:514-530` — the loader records a collision diagnostic but still registers both. Callers that ignore diagnostics get ambiguous behavior.

### M5. `expandMarkdownCommand` is exported but no caller invokes it
`slash-commands.ts:379-393` — variable substitution in command bodies (`$ARGUMENTS`, `${CAVE_SESSION_ID}`) is implemented but unused. Either dead code or every command handler needs to call it manually and currently doesn't.

### M6. OAuth callback ports hardcoded across 4 providers, no fallback on EADDRINUSE
- Anthropic 53692 (`oauth/anthropic.ts:32`)
- OpenAI Codex 1455
- Google Gemini CLI 8085
- Google Antigravity 51121

Any port conflict → silent crash during login. Two simultaneous logins on the same machine collide.

### M7. Anthropic OAuth reuses PKCE `code_verifier` as the OAuth `state`
`oauth/anthropic.ts:252` — `state: verifier`. Functionally OK (both random), but conflates two secrets — leaking one leaks both.

### M8. Migrations leave `oauth.json.migrated` on disk forever
`migrations.ts:41` — old OAuth tokens renamed but never deleted. Indefinite stale-token-on-disk.

### M9. Session DB / log files have no rotation policy
`daemon/server.ts` + `store.ts` — sessions accumulate in SQLite without TTL; long-running daemons grow unbounded.

### M10. Daemon `setTimeout` for token-flush isn't `.unref()`'d
`daemon/server.ts:112` — keeps event loop alive; `caveman serve` cannot gracefully shutdown if any client attached.

### M11. Daemon has no concurrency limit on runners
`daemon/server.ts:100-156` — every new session spawns a runner; no cap. Trivial DoS.

### M12. Color-depth detection cached on first call, ignores env mutation
`packages/tui/src/color-depth.ts:13-38` — first detection wins forever; tests and dynamic envs see stale palette.

### M13. install.sh continues with a quiet warning when `SHA256SUMS` 404s
`installers/install.sh:237-255` — log_step prefix looks identical to normal progress; no abort, no big red warning.

### M14. Race between settings reads and `.cave/permissions.json` writes
Lock acquired for settings (`settings-manager.ts:296`) but permission store has its own write path with no lock — two cave processes can clobber each other's allow-rules.

### M15. Compaction error mode for unmatched tool_use/tool_result blocks
`compaction.ts:727-799` — Anthropic strict-pairing means a compaction that drops a `tool_use` whose `tool_result` was retained (or vice-versa) hard-errors on the next turn. Worth a regression test.

---

## LOW / Polish

- **L1.** Stale `.cavekit/` directory at repo root — leftover from retired CaveKit. Confirm in `.gitignore` or remove.
- **L2.** Root has an unrelated 440 KB session HTML committed: `cave-session-2026-04-11T17-25-44-134Z_*.html`. Either move to `logs/` or delete.
- **L3.** `cavemem-installer-patch.diff` at repo root looks like a stray work artifact.
- **L4.** Sync-output wraps with DEC 2026 escapes even on non-VT terminals (`tui/src/sync-output.ts:106-109`). Harmless bytes in pipes.
- **L5.** Debug logs for MCP write untrusted server stderr unescaped to `process.stderr` — log injection vector for fake-warning attacks.
- **L6.** Shift+Tab cycles directly into `bypassPermissions` mode — a single misclick from "default" to "no prompts ever".
- **L7.** Homebrew `test do` only checks `--version`; doesn't verify theme/wasm assets exist alongside the binary.
- **L8.** `copy-assets` uses `shx cp src/.../*.json` — empty glob silently produces an empty dist dir.
- **L9.** `auth-storage.ts` chmods after write (correct), but `writeFileSync` then `chmodSync` has a TOCTOU window where the file exists at umask permissions for ~1ms.

---

## Refuted / non-findings

The first audit pass flagged these as BLOCKERs/HIGHs; verification refuted them — listed for posterity so they don't reappear in a future audit:

- **"Hooks not wired to extension event bus"** — *Refuted.* `createHooksExtension()` (`hooks/index.ts:229-249`) internally calls `subscribeHooksToExtensionEvents(adapter, manager)` against an adapter that fills the `handlers` Map; the extension runner reads that map. Wiring is structurally correct. (Open question — needs spot-check, *not* a blocker: are the event names emitted by the runner — `session_start`, `tool_call`, etc. — exactly the strings `subscribeHooksToExtensionEvents` listens for? If a refactor renamed any, hooks for that event silently no-op.)
- **"Compaction can recurse infinitely"** — *Refuted.* `generateSummary()` returns a string, not messages; no self-feeding loop exists in the code as written.
- **"Cost-persistence input/output token swap"** — *Refuted.* `addPeriodTotal()` field mapping is correct.

---

## Cross-cutting themes

1. **Permission enforcement has gaps.** MCP (B3), subagents (H2), and headless mode (H1) all bypass the reducer in different ways. The sandbox IR is good infrastructure; not all callers route through it.
2. **Trust boundaries for disk-loaded code are missing.** Plugins (B7), extensions, skills, and slash-commands all read code/prompt content from disk without signature/checksum/trust tier. This is the same hole repeated four times.
3. **No CI guard against the regressions found.** Every blocker is testable: settings perms (`stat -f%Lp`), Homebrew sha256s (regex for `PLACEHOLDER_`), MCP-through-permissions (one mock test), daemon-no-token-rejects (one HTTP test), TUI-no-process.exit (lint rule). A pre-publish CI step covering these would have caught all of B1–B5.
4. **The "wiring of hooks + subagents" WIP looks structurally correct** for the cases it covers (test file passes, args.ts → sdk.ts → AgentSession is end-to-end wired) but doesn't yet cover plan-mode-inheritance into spawned subagents.

---

## Recommended order of operations (smallest blast radius first)

1. **B1 Homebrew placeholders** — 5-minute fix; just run `update-homebrew.sh` against real release artifacts before tagging.
2. **B4 Settings perms** — add `chmodSync(path, 0o600)` after the write at `settings-manager.ts:298`. One line.
3. **B5 TUI `process.exit`** — replace with event emission + opt-in handler installed by app, not library.
4. **B2 Daemon auth** — default to 127.0.0.1-only or require `--insecure` flag to start without token.
5. **B3 MCP→permissions** — wrap MCP `execute` in the same permission decide() flow as bash/edit/write.
6. **B6 qwen3-235b** — reconcile with upstream registry; if it really shrunk, add a deprecation log when context > new max.
7. **B7 Plugin checksums** — require manifest sha256 in marketplace responses; verify before extract.
8. **H1–H9** — sweep over a sprint.
9. **M*** — backlog with owners.
