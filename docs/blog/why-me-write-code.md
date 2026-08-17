# Why Me Write Code

Me Write Code is a terminal coding agent built around one idea: keep the
Claude Code-style workflow you already like, and stop wasting tokens doing it.

## The problem

Interactive coding agents are great — a TUI, file edits, tool calls, sessions,
slash commands, skills, hooks, MCP-style integrations — but they're expensive.
A lot of that cost is waste: bloated system prompts, tool output dumped verbatim
into context, the same file read three times in a session, and context that
breaks prompt caching on every turn.

You pay for that waste on every request, with every provider.

## The approach

`mewrite` keeps the workflow and attacks the waste directly:

- **Compact prompts** — the system prompt earns its tokens instead of padding
  them.
- **Compressed tool output** — budgets and truncation so a noisy command
  doesn't flood the context window.
- **Read deduplication** — the agent doesn't re-read a file it already has.
- **Prompt-cache-friendly sessions** — context is structured so the cache
  actually hits across turns.

None of this changes how you code. You still get the interactive TUI, plan mode,
subagents, MCP, and hooks. You just spend fewer tokens getting there.

## What's in the box

- **20+ providers, 5 OAuth flows** — Claude Pro, ChatGPT Plus, GitHub Copilot,
  Gemini, and every major API. One CLI, every backend.
- **Plan mode + subagents** — read-only exploration and structured plans, then
  worktree-isolated subagents to execute in parallel.
- **Session branching** — fork at any turn, navigate the tree, auto-saved as
  JSONL per working directory.
- **Live agent panes** — spawn background agents and drop into any one
  interactively, mid-run.
- **Downstream branding** — thin wrappers can rebrand the app name, config
  directory, logo/wordmark, tagline, colors, and docs links without forking
  core code.

MIT licensed, independent software, not affiliated with Anthropic or Claude
Code.

## Try it

Full docs live at [mewriteco.de](https://mewriteco.de) — start with the
[Quickstart](/getting-started/quickstart) and
[Installation](/getting-started/installation) guides.

Me write less, me do more.
