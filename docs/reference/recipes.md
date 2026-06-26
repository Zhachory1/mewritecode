---
title: Recipes
description: YAML pipelines for repeatable agent workflows.
---

# Recipes

A recipe is a YAML file at `.mewrite/recipes/<name>.yaml` that pins a goal, model, tool allowlist, and optional sub-recipes. Goose-style schema.

<CopyForLlms />

## Schema

```yaml
# .mewrite/recipes/migrate-to-biome.yaml
name: "Migrate to Biome"
goal: |
  Replace ESLint + Prettier with Biome 2.x. Update CI. Remove old configs.
  Re-run the test suite. Commit when green.

model: claude-sonnet-4
effort: medium

tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - Bash

env:
  BIOME_VERSION: 2.3.5

include:
  - bump-deps   # re-uses .mewrite/recipes/bump-deps.yaml

steps:
  - "Audit current ESLint/Prettier config"
  - "Generate biome.json from existing rules"
  - "Replace package.json scripts"
  - "Update CI workflow"
  - "Run biome check, fix violations"
  - "Run tests, ensure green"
  - "Commit with conventional-commit message"
```

Run:

```bash
mewrite run-recipe migrate-to-biome
mewrite run-recipe migrate-to-biome --dry-run    # plan-mode-only
```

## Built-in recipes

Me Write Code ships 10 default recipes you can copy or extend:

| Recipe | Purpose |
|---|---|
| `migrate-deps` | Bump major dependencies, fix breakage |
| `add-feature-flag` | Wire a new feature flag end-to-end |
| `port-to-typescript` | JS → TS port |
| `add-tests` | Increase test coverage on a file or directory |
| `bump-deps` | Patch/minor dependency bumps |
| `extract-component` | Pull a chunk of a file into its own component |
| `seo-audit` | SEO audit of a static site |
| `accessibility-audit` | a11y audit, WCAG 2.1 AA |
| `migrate-to-biome` | ESLint+Prettier → Biome |
| `release` | Bump version, generate changelog, tag, push |

List:

```bash
mewrite recipes list
mewrite recipes show migrate-to-biome
```

## include: subrecipes

A recipe can include other recipes. They run before the parent's steps unless `include-after: true`.

```yaml
include:
  - bump-deps      # runs first
  - audit-bundle:  # runs after this recipe's steps
      include-after: true
```

## Composition with hooks

Hooks fire during recipe execution like any other session. Useful pairing:

- A recipe that runs `npm test` + a `Stop` hook that comments on the PR with the test summary.
- A recipe that does dependency bumps + a `PreToolUse Bash:git push` hook that runs the full test suite.

## Authoring

The fastest path is copying a built-in:

```bash
cp ~/.mewrite/agent/recipes/release.yaml .mewrite/recipes/release-rc.yaml
$EDITOR .mewrite/recipes/release-rc.yaml
```

Validate:

```bash
mewrite recipes lint .mewrite/recipes/release-rc.yaml
```

The linter checks: required keys, model exists in the registry, tools are valid, includes resolve.

## Recipes vs commands vs skills

| Construct | Trigger | When to use |
|---|---|---|
| Skill | model-invoked by description match | knowledge / how-to |
| Slash command | user-invoked by `/foo` | one-shot tasks |
| Recipe | user-invoked by `mewrite run-recipe` | multi-step pipelines, sub-tasks, env vars |

A recipe can dispatch slash commands as steps. A slash command can dispatch a recipe. Don't overcomplicate — pick the simplest construct that fits.
