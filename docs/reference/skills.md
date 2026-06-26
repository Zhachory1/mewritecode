---
title: Skills
description: Markdown skills loaded by description match. Claude Code-compatible.
---

# Skills

Skills are markdown files the model auto-loads when their description matches the user's intent. Slash commands are explicit (`/foo`); skills are implicit. Both share the same authoring format, frontmatter superset of Claude Code.

<CopyForLlms />

## Where skills live

| Scope | Path |
|---|---|
| Project | `.mewrite/skills/<name>/SKILL.md` |
| User | `~/.mewrite/agent/skills/<name>/SKILL.md` |
| Plugin | inside an installed plugin's `skills/` directory |

A skill directory may include attached files referenced by the skill body — e.g. example fixtures, vendored helpers.

## Authoring

`.mewrite/skills/secure-review/SKILL.md`:

```markdown
---
name: "Secure code review"
description: "Audit a diff or file for OWASP Top-10 issues. Trigger when the user mentions 'security', 'audit', 'OWASP', 'CVE', or asks to review code for vulnerabilities."
allowed-tools: [Read, Grep, Glob]
model: claude-sonnet-4
effort: medium
---

You are a security auditor. For the file or diff in `$ARGUMENTS`:

1. Identify input boundaries.
2. Walk the OWASP Top 10 in order.
3. For each finding, output: severity, file:line, exploit sketch, fix sketch.
4. End with a 3-line executive summary.

Reference: see `./checklist.md` in this skill directory.
```

The model sees the **description** in every turn (cheap — descriptions are short). The full body loads only when the description matches a turn's intent. After compaction, descriptions get re-attached up to a 5k-token cap; the shared budget across all skills is 25k tokens.

## Frontmatter

Same superset as [slash commands](/reference/slash-commands#frontmatter). Skills add:

| Key | Purpose |
|---|---|
| `name` | Display name (description is for matching, name is for UI) |
| `paths` | Auto-attach when an open file matches |
| `triggers` | Explicit phrases that should always load this skill |
| `lifecycle` | `on: SessionStart`/`on: UserPromptSubmit` etc. — like a hook |

## Hot reload

Save the file, it's live next turn. Validate with `mewrite skills lint`.

## Browsing and selection

```bash
mewrite skills list              # all skills, scope, status
mewrite skills show secure-review
mewrite skills disable secure-review   # session-wide disable
```

`/skills` opens the same view inside the TUI.

## Plugin marketplace

Me Write Code's plugin marketplace bundles skills + commands + agents + hooks + MCP into shareable archives.

```bash
mewrite plugin search security
mewrite plugin install ghost-sec/sec-pack
```

See [Plugin Marketplace](/cookbook#plugin-marketplace).

## Importing Claude Code skills

```bash
cp -r ~/.claude/skills/* ~/.mewrite/agent/skills/
```

Format-identical. Drop in. The 5k re-attach cap, the 25k shared budget, and the description-match trigger logic all match Claude Code's defaults.

## Anti-patterns

- **Long skill bodies as defaults** — they don't burn tokens until matched, but a sloppy `description` causes false matches. Be specific.
- **Skills doing what hooks should do** — skills are model-invoked; deterministic invariants belong in [hooks](/reference/hooks).
- **Skills as long workflows** — for multi-step pipelines, prefer a [recipe](/reference/recipes).
