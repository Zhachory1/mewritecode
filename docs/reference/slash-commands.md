---
title: Slash Commands
description: Built-in slash commands and how to author your own as Markdown files.
---

# Slash Commands

Inside the TUI, type `/` to open the command palette. Me Write Code ships 10 built-in commands and reads user-authored markdown commands from `~/.cave/commands/` and project-local `.cave/commands/`.

<CopyForLlms />

## Built-in commands

| Command | What it does |
|---|---|
| `/login` `/logout` | OAuth flow for any provider |
| `/model` | Switch model mid-session, transcript reformatted in place |
| `/provider` | List/switch active provider |
| `/settings` | Edit `~/.cave/settings.json` in your `$EDITOR` |
| `/new` `/resume` `/tree` `/fork` | Session lifecycle and branching |
| `/compact` | Manual context compaction (auto on overflow) |
| `/copy` `/export` `/share` | Copy transcript / export JSON / share link |
| `/plan` `/act` | Switch between plan and edit modes |
| `/tokens` | Live token / cost breakdown |
| `/repomap` | Show the current repo map (PageRank-ranked symbols) |
| `/architect` | Architect/editor split mode |
| `/checkpoint` `/rollback N` | Shadow-git snapshots |
| `/memory` | cavemem queries: `search`, `save`, `consolidate`, `sync` |
| `/help` `/hotkeys` `/changelog` | Self-explanatory |

## Default user commands shipped with Me Write Code

These ship in `~/.cave/commands/` after first run. You can edit or delete any of them.

| Command | What it does |
|---|---|
| `/commit` | Stage changes, propose a conventional-commit message, commit |
| `/test` | Run the test suite, summarize failures |
| `/review` | Read the diff vs `main` and produce a code-review summary |
| `/explain` | Explain the file/symbol under cursor |
| `/fix-types` | Walk type errors and propose fixes |
| `/perf` | Profile the cwd app and suggest optimizations |
| `/sec-review` | Run a security audit pass on the diff |
| `/clean` | Delete dead imports, unused vars |
| `/log` | Append a session note to `CHANGELOG.md` |
| `/migrate` | Run a recipe from `.cave/recipes/` |

## Authoring a slash command

Create `~/.cave/commands/my-cmd.md`:

```markdown
---
description: "Run prettier on the staged files and re-stage"
argument-hint: "[--all]"
allowed-tools: [Bash, Edit]
model: claude-haiku-4
---

You are a code-formatter. Run prettier on every file in `$ARGUMENTS` (default
to staged files: `!`git diff --cached --name-only``). Re-stage the changes.
```

Frontmatter keys (full list — superset of Claude Code):

| Key | Purpose |
|---|---|
| `description` | Auto-loaded into the command palette |
| `argument-hint` | Shown next to the command name |
| `arguments` | Typed arg schema (validated before run) |
| `allowed-tools` | Tool allowlist for this command |
| `disallowed-tools` | Tool denylist |
| `disable-model-invocation` | Hide from auto-suggestion |
| `user-invocable` | Default `true` |
| `model` | Override session model for this command |
| `effort` | `low`/`medium`/`high` thinking |
| `context: fork` | Fork into a sub-session |
| `agent` | Dispatch to a named subagent |
| `hooks` | Inline hook overrides |
| `paths` | Limit the command to certain glob paths |
| `shell` | Inline shell preprocessing language |

### Substitutions

- `$ARGUMENTS` — full argv after the command
- `$0`, `$1`, ... — positional args
- `${CAVE_SESSION_ID}`, `${CAVE_SKILL_DIR}`, `${CAVE_EFFORT}` — session vars
- `` !`cmd` `` — runs `cmd` at command-load time, substitutes stdout

### Hot reload

Me Write Code watches `~/.cave/commands/` and `.cave/commands/` for changes. Save the file, the new version is live on the next `/`.

## Project vs user vs plugin scope

| Scope | Path | When to use |
|---|---|---|
| Project | `.cave/commands/*.md` | Lives in repo; team shares it |
| User | `~/.cave/commands/*.md` | Personal preferences |
| Plugin | `node_modules/<plugin>/commands/*.md` | Installed via `mewrite plugin install` |

User overrides project overrides plugin. Conflicts surface in `mewrite doctor`.

## Importing from Claude Code

```bash
cp ~/.claude/commands/*.md ~/.cave/commands/
```

The frontmatter formats are identical. Paste-and-go.
