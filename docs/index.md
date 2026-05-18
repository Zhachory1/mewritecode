---
layout: home

hero:
  name: "Caveman Code"
  text: "Same model. Same task. 2× fewer tokens."
  tagline: "Terminal coding agent that compresses at every layer. 20+ provider OAuth. Plan mode, subagents, MCP, sandbox, hooks. MIT."
  image:
    src: /logo.svg
    alt: Caveman Code
  actions:
    - theme: brand
      text: Quickstart
      link: /getting-started/quickstart
    - theme: alt
      text: Install
      link: /getting-started/installation
    - theme: alt
      text: View on GitHub
      link: https://github.com/JuliusBrussee/caveman-cli

features:
  - icon: 📦
    title: Caveman Mode compression
    details: 3-layer compression of prompts, tool output, and file reads. ~85% reduction on tool output. $1.70–$6.92 saved per session vs Claude Code.
    link: /reference/tools
    linkText: How it works
  - icon: 🔑
    title: 20+ providers, 6 OAuth flows
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
    title: Native sandbox
    details: macOS Seatbelt, Linux Landlock, Windows Restricted Tokens. Permission modes cycle on Shift+Tab.
    link: /reference/permissions
    linkText: Permission profiles
  - icon: 🔌
    title: MCP everywhere
    details: stdio + Streamable HTTP + in-process. ToolSearch defers schemas. caveman-code can also serve as an MCP server.
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
    details: No telemetry by default. No vendor lock-in. Self-host the daemon. Beat Claude Code on cost in a single binary.
    link: /comparison
    linkText: vs the field
---

<div class="install-block">

## Install

```bash
curl -fsSL https://cave.sh/install | bash
```

Other options: [Homebrew, npm, Docker, manual](/getting-started/installation).

</div>

<div class="quick-router">

## I want to…

- **Migrate from Claude Code** → [zero-migration guide](/migration/from-claude-code)
- **Cut my Claude bill in half** → [Caveman Mode reference](/reference/tools)
- **Use my ChatGPT Plus subscription for coding** → [OAuth providers](/getting-started/auth)
- **Run cave headless in CI** → [exec mode](/cookbook#cave-exec-in-github-actions)
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
