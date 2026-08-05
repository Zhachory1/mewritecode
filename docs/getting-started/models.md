---
title: Models
description: Select and configure the LLM behind Me Write Code.
---

# Models

Me Write Code runs against any model your provider exposes. The defaults are chosen per provider and re-evaluated on each release based on the [proof-bench eval harness](https://github.com/Zhachory1/mewritecode/tree/main/research/evals).

<CopyForLlms />

## Default models per provider

| Provider | Default model |
|---|---|
| Anthropic | `claude-opus-4-6` |
| OpenAI | `gpt-5.4` |
| Google | `gemini-2.5-pro` |
| OpenRouter | `openai/gpt-5.1-codex` |
| Groq | `openai/gpt-oss-120b` |
| Cerebras | `zai-glm-4.7` |

Override per session:

```bash
mewrite --model claude-opus-4-7
mewrite --model openai/gpt-5
mewrite --model claude-sonnet-4:high   # thinking level high
```

Inside the TUI, `/model` opens the picker.

## Thinking levels

Models that support extended thinking accept a suffix:

| Level | Use case |
|---|---|
| `:off` | Fastest, lowest cost. Default. |
| `:minimal` | Light reasoning. Routine edits. |
| `:low` | Default thinking budget for most providers. |
| `:medium` | Multi-file refactors. |
| `:high` | Cross-cutting concerns, architectural changes. |
| `:xhigh` | Hard debugging, complex algorithms. |

Cycle in TUI with `Shift+Tab`.

## Architect / editor split

Use a strong model to plan, a cheaper model to execute. Drops cost ~3-5× on long sessions.

```bash
/architect set architectModel=claude-opus-4-7 editorModel=claude-haiku-4
```

Or in `~/.mewrite/agent/settings.json`:

```json
{
    "model": "claude-sonnet-4",
    "modes": {
        "architect": { "model": "claude-opus-4-7" },
        "editor": { "model": "claude-haiku-4" }
    }
}
```

## Per-subagent models

Each [subagent](/reference/subagents) declares its own model:

```yaml
---
description: "Run unit tests and report failures"
model: "claude-haiku-4"   # cheap, since it just shells out
tools: [Bash, Read]
---
```

Subagent results are summarized to ≤500 tokens before re-entering the parent's context — letting you spend on Haiku instead of Opus for repetitive subtasks.

### Capability tiers

Instead of a concrete model id, a subagent can request a **capability tier** — `tier:fast`, `tier:normal`, or `tier:strong`:

```yaml
---
description: "Run unit tests and report failures"
model: "tier:fast"   # cheap model of whatever provider you're on
tools: [Bash, Read]
---
```

A tier resolves to a curated model **within your current provider**, so the same agent definition works whether you're authed to Anthropic, OpenAI, Google, or Bedrock — no provider-specific id to hardcode.

- `tier:fast` — cheap/small model. High-volume, repeatable, small tasks.
- `tier:normal` — the everyday model. Editing, testing, implementation.
- `tier:strong` — the top model. Orchestration and planning.

If a tier has no curated model for your provider (e.g. a router or a custom provider), the subagent falls back to the provider's `normal`, then to the parent's model with a warning. Tiers are best-effort and not pinned to an exact model — the curated mapping can change between releases.

Set a default tier for all subagents that don't pin a model via the `subagentModel` setting in `settings.json`:

```json
{ "subagentModel": "tier:fast" }
```

## Model registry

Provider/model definitions ship with Me Write Code and can be refreshed without upgrading the CLI:

```bash
mewrite models update
```

Override per-machine in `~/.mewrite/agent/registry.json`. See [Provider Registry](/reference/tools#registry) for schema.

## Cost-aware defaults

Me Write Code's first-run wizard suggests Haiku/Flash for the default model on free OAuth accounts to avoid surprise bills. Upgrade with `/model` once you've validated the workflow.
