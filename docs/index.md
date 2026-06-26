---
layout: home

hero:
  name: "Me Write Code"
  text: "Same model. Same task. Token efficiency under revalidation — see #8."
  tagline: "Terminal coding agent with token-saving defaults, 20+ providers, 5 OAuth flows, plan mode, subagents, MCP, hooks, and MIT license."
  image:
    src: /logo.svg
    alt: Me Write Code
  actions:
    - theme: brand
      text: Quickstart
      link: /getting-started/quickstart
    - theme: alt
      text: Install
      link: /getting-started/installation
    - theme: alt
      text: View on GitHub
      link: https://github.com/Zhachory1/mewritecode

features:
  - icon: 📦
    title: Token-efficient sessions
    details: Caveman Mode, tool-output budgets, read deduplication, and prompt-cache-friendly context reduce token waste without changing the coding workflow.
    link: /reference/tools
    linkText: How it works
  - icon: 🔑
    title: 20+ providers, 5 OAuth flows
    details: Claude Pro, ChatGPT Plus, GitHub Copilot, Gemini, Antigravity, plus every major API. One CLI, every backend.
    link: /getting-started/auth
    linkText: Authenticate
  - icon: 🌳
    title: Session branching
    details: Fork at any turn, navigate the tree, never lose context. Auto-save JSONL sessions per cwd.
    link: /reference/slash-commands
    linkText: /tree, /fork
  - icon: 🧠
    title: Plan mode + subagents
    details: Read-only exploration, structured plans, then 7 parallel worktree-isolated subagents to execute.
    link: /reference/plan-mode
    linkText: Plan and act
  - icon: 🛡️
    title: Safety controls
    details: Plan mode, approval mode, checkpoints, and beta OS sandbox diagnostics. Verify sandbox availability with mewrite doctor.
    link: /reference/permissions
    linkText: Permission profiles
  - icon: 🔌
    title: MCP everywhere
    details: stdio and in-process MCP clients today; Streamable HTTP is tracked separately. ToolSearch defers schemas. Server mode currently exposes a minimal health tool.
    link: /reference/mcp
    linkText: MCP servers
  - icon: 🪝
    title: Hooks (Claude Code-compatible)
    details: 12 lifecycle events with the exact settings.json schema as Claude Code. Paste your config and it Just Works.
    link: /reference/hooks
    linkText: Hook reference
  - icon: 💾
    title: Memory via cavemem
    details: Native integration with cavemem. Episodic→semantic consolidation. Bridges Claude Code's MEMORY.md.
    link: /reference/memory
    linkText: Memory layer
  - icon: 🆓
    title: MIT, open source
    details: No telemetry by default. No vendor lock-in. Self-host the daemon. MIT-licensed terminal coding agent.
    link: /comparison
    linkText: vs the field
---

<div class="install-block">

## Install

```bash
brew tap Zhachory1/mewritecode https://github.com/Zhachory1/mewritecode
brew install mewrite
```

Other options: [npm, Linux packages (Debian/RPM/Snap), Docker, manual](/getting-started/installation).

</div>

<div class="quick-router">

## I want to…

- **Migrate from Claude Code** → [zero-migration guide](/migration/from-claude-code)
- **Reduce token waste** → [tool compression reference](/reference/tools)
- **Use my ChatGPT Plus subscription for coding** → [OAuth providers](/getting-started/auth)
- **Run mewrite headless in CI** → [exec mode](/cookbook#mewrite-exec-in-github-actions)
- **Add my own slash command** → [Skills & Commands](/reference/skills)
- **Read everything as one file** → [llms.txt](/llms.txt)

</div>

<style>
.install-block, .quick-router {
    max-width: 760px;
    margin: 2rem auto;
}
.install-block pre {
    font-size: 1.1rem;
}
</style>
