---
title: Troubleshooting
description: Fixes for the most common issues with Caveman Code.
---

# Troubleshooting

When something breaks, start here. If your issue isn't covered, [open a GitHub issue](https://github.com/JuliusBrussee/caveman-cli/issues/new) with `caveman doctor` output.

<CopyForLlms />

## Install

### `cave: command not found` after install

Restart your shell, or:

```bash
source ~/.zshrc      # zsh
source ~/.bashrc     # bash
```

If still missing, the installer printed the install path — add it to your PATH.

### `Operation not permitted` writing to `~/.cave`

Filesystem is read-only or owned by another user. Run:

```bash
ls -la ~/.cave
chown -R "$USER" ~/.cave
```

### Apple silicon: `bad CPU type in executable`

You downloaded an x86_64 binary on an ARM Mac. Re-install via npm — the package is platform-agnostic:

```bash
npm install -g caveman-code
```

## Auth

### OAuth opens browser but never completes

1. Check that the loopback port (random in 1024-65535) isn't firewalled.
2. Try device-code auth: `caveman login --device-auth`.
3. Disable VPN that intercepts loopback.

### `401 Unauthorized` on a stored token

Token expired and refresh failed. Re-login:

```bash
caveman logout <provider>
caveman login <provider>
```

### Linux libsecret not found

Install:

```bash
# Debian / Ubuntu
sudo apt install libsecret-1-0 libsecret-tools

# Arch
sudo pacman -S libsecret
```

If your distro lacks libsecret, set `CAVE_INSECURE_KEYRING=1` to fall back to a plaintext token file (warning is shown).

## Sessions

### Caveman Code hangs on launch

Stuck on context load. Kill and:

```bash
caveman -r --no-context     # browse without loading any session
```

Then identify and remove the bad session in `~/.cave/sessions/<cwd-hash>/`.

### `/tree` shows no branches

Branching is per-session. The first session in a cwd has no branches by definition. Run a few turns then `/fork` to test.

### Compaction destroyed important context

Use the shadow-git checkpoint: `/checkpoint list`, then `/rollback <N>`. Compaction itself runs a `PreCompact` hook — instrument it to write important context to disk first.

## Tools

### `Bash` tool times out

Default tool timeout is 60s. Override per call:

```
> use Bash with --timeout 600 to run the long-running migration
```

Or globally in `~/.cave/settings.json`:

```json
{
    "tools": { "bash": { "timeoutMs": 600000 } }
}
```

### `Edit` keeps applying to the wrong location

The model's view of the file is stale. After a hook writes to the file, ask cave to re-read:

```
> re-read src/foo.ts and apply the change
```

### Caveman Mode is summarizing too aggressively

Lower compression intensity:

```bash
caveman --caveman-mode lite     # default is "full"
caveman --no-caveman-mode       # turn off entirely
```

## Permissions

### Every action prompts even though I clicked "Allow always"

The allow-key is more specific than the new action. E.g. `Read packages/foo/**` won't match `Read packages/bar/baz.ts`. Add a broader allow-key with `caveman permissions add "Read **"`.

### Sandbox blocks something I need

`caveman debug sandbox` shows the active policy. To temporarily relax for one command:

```bash
caveman --sandbox=workspace_write -- some-command
```

For permanent allowlist, add to `permissions.json`:

```json
{
    "permissions": {
        "alwaysAllow": ["Bash:docker run *"]
    }
}
```

## MCP

### `caveman mcp doctor` shows server unreachable

```bash
caveman mcp logs <server>     # tails stderr of stdio server
```

Common causes: command not on PATH, env var missing, server's auth flow incomplete.

### MCP tools don't show up in the model's context

By default Caveman Code defers MCP schemas — only names are listed until the model calls `ToolSearch`. To eager-load:

```bash
caveman --eager-mcp-schemas
```

## Hooks

### Hook never fires

Check the matcher:

```bash
caveman hooks test PreToolUse --tool Edit --path src/foo.ts
```

Reports whether each hook would fire for that input. Common mistake: `paths` glob doesn't include the actual file path.

### Hook output isn't reaching the model

Only stdout is fed back to the model as a system reminder. Stderr is logged but ignored. Check that your hook prints to stdout, not stderr.

## Memory (cavemem)

### `/memory search` returns nothing

cavemem isn't running. Check:

```bash
cavemem --version
caveman mcp doctor   # should show cavemem reachable
```

If missing: `npm install -g cavemem` then `caveman init`.

### Memory injection too noisy

Lower the cap in `settings.json`:

```json
{
    "memory": { "maxInjectTokens": 1000 }
}
```

Or disable for the session: `/memory off`.

## Performance

### TUI feels laggy

Enable synchronized output (DEC mode 2026):

```bash
caveman --sync-output
```

Most modern terminals support it; cave detects and emits automatically. Override with the flag if detection fails.

### Long sessions get slow

Run `/compact` to manually compact. Or enable auto-compact at a lower threshold:

```json
{
    "session": { "autoCompactAtTokens": 80000 }
}
```

## Reporting issues

```bash
caveman doctor > /tmp/cave-doctor.txt
caveman version > /tmp/cave-version.txt
```

Attach both to a [GitHub issue](https://github.com/JuliusBrussee/caveman-cli/issues/new). Include the prompt that triggered the bug if reproducible.
