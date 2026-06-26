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

## Model registry

Provider/model definitions ship with Me Write Code and can be refreshed without upgrading the CLI:

```bash
mewrite models update
```

Override per-machine in `~/.mewrite/agent/registry.json`. See [Provider Registry](/reference/tools#registry) for schema.

## Cost-aware defaults

Me Write Code's first-run wizard suggests Haiku/Flash for the default model on free OAuth accounts to avoid surprise bills. Upgrade with `/model` once you've validated the workflow.
