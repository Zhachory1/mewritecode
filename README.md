# Me Write Code

<p align="center">
  <img src="docs/public/logo.svg" alt="Me Write Code logo" width="96" height="96">
</p>

<p align="center"><strong>me write less, me do more</strong></p>

<p align="center">
  <a href="https://github.com/Zhachory1/mewritecode/actions/workflows/ci.yml"><img src="https://github.com/Zhachory1/mewritecode/actions/workflows/ci.yml/badge.svg" alt="CI / tests"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

**A low-token Claude Code alternative for terminal-based coding agents.**

Me Write Code is the `mewrite` CLI: a terminal coding agent that keeps the Claude Code-style workflow (interactive TUI, file editing, tool calls, sessions, slash commands, skills, hooks, MCP-style integrations) while aggressively reducing token waste through compact prompts, compressed tool output, read deduplication, and prompt-cache-friendly session structure.

The product name is **Me Write Code**. The primary command is **`mewrite`**. User config lives under **`~/.mewrite/`**.

> Me Write Code is independent software and is not affiliated with Anthropic or Claude Code.

---

## Why use it

Claude Code-style tools are powerful, but long sessions can burn tokens quickly because every turn re-sends tool output, file reads, system instructions, and conversation history. Me Write Code is built around reducing that overhead without changing the core terminal coding workflow.

| Need | Me Write Code approach |
|---|---|
| Lower token usage | Caveman Mode compression, tool-output budgets, read deduplication, cache-stable prompts |
| Terminal-first coding | Interactive TUI, print mode, JSON/RPC modes, shell dispatch, file references |
| Multi-provider models | Anthropic, OpenAI, Gemini, Vertex, Bedrock, Mistral, Groq, xAI, OpenRouter, Copilot, OpenCode, and compatible endpoints |
| Agent extensibility | Skills, prompt templates, extensions, custom tools, hooks, themes, MCP/server workflows |
| Safer iteration | Plan mode, session branching, checkpoints/rollback, goal loop, resumable sessions |
| Package-manager installs | npm, Homebrew, APT, Yum/DNF, release tarballs, Docker, Snap metadata |

---

## Install

### npm

```bash
npm install -g @zhachory1/mewrite-code
mewrite
```

### Homebrew

```bash
brew tap Zhachory1/mewritecode https://github.com/Zhachory1/mewritecode
brew install mewrite
mewrite
```

### Debian / Ubuntu

```bash
echo "deb [trusted=yes] https://raw.githubusercontent.com/Zhachory1/mewritecode/gh-pages/apt ./" | sudo tee /etc/apt/sources.list.d/mewrite.list
sudo apt update
sudo apt install mewrite-code
mewrite
```

### Fedora / RHEL / CentOS

```bash
sudo curl -fsSL https://raw.githubusercontent.com/Zhachory1/mewritecode/gh-pages/yum/mewrite.repo -o /etc/yum.repos.d/mewrite.repo
sudo dnf install mewrite-code  # or yum
mewrite
```

### Docker

```bash
docker run --rm -it -v "$PWD:/work" ghcr.io/zhachory1/mewritecode:latest
```

The package installs these aliases:

- `mewrite` primary command
- `mewrite-code`
- `mewritecode`

---

## Quick start

```bash
# API key auth
export ANTHROPIC_API_KEY=sk-ant-...
mewrite

# Or use an OAuth subscription flow inside the TUI
mewrite
/login
```

Common commands:

```bash
mewrite                              # interactive TUI
mewrite "explain this codebase"      # start interactive mode with a prompt
mewrite -p "summarize README.md"     # one-shot print mode
cat error.log | mewrite -p "debug"   # pipe stdin
mewrite -c                           # continue latest session
mewrite -r                           # browse and resume sessions
mewrite --mode json "inspect repo"   # structured output
mewrite goal start "ship feature X"  # autonomous goal loop
```

Inside the TUI:

- Type `/` for slash commands.
- Use `@path` to attach or reference files.
- Prefix with `!` to run a shell command and add output to context.
- Prefix with `!!` to run a shell command without adding output to context.
- Use `/plan` for read-only planning, then `/act` to execute.
- Use `/model` to switch providers/models.
- Use `/settings` to adjust behavior.

---

## Token-saving design

Me Write Code reduces token usage at the places that usually dominate long coding sessions.

### 1. Compact assistant style

Caveman Mode trims filler from responses and favors dense technical answers. The point is not novelty prose; it is fewer output tokens while keeping the answer useful.

### 2. Tool-output compression

Large shell output, diffs, searches, package trees, and test logs are compressed before they enter the model context. The system keeps useful head/tail slices, strips ANSI noise, collapses blank lines, and applies per-tool budgets.

### 3. Read deduplication

Repeated reads of unchanged files do not need to resend the whole file. Me Write Code fingerprints reads in-session and can replace repeat reads with compact stubs.

### 4. Cache-friendly prompts

Stable prompt prefixes and session structure are designed to work well with provider prompt caching, so long sessions benefit from cheaper cached context reads where providers support them.

### 5. Plan/act split

Plan mode keeps exploration read-only and avoids unnecessary edits/tool loops. Architect/editor workflows let you use stronger models for planning and cheaper models for execution.

---

## Features

### Coding agent core

- Interactive terminal UI with streaming responses
- Built-in `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls` tools
- Multi-file edits with exact replacement semantics
- Print mode for scripts and CI
- JSON/RPC modes for automation
- Session persistence, resume, fork, and tree navigation
- HTML export for session review

### Low-token workflow

- Caveman Mode compression levels: `lite`, `full`, `ultra`, `off`
- Tool-output truncation and compression
- Read deduplication
- Optional RTK integration for additional shell-output reduction
- Prompt-cache-aware session behavior
- Context compaction for long conversations

### Safety and control

- Plan mode for read-only investigation
- Configurable approval mode for writes/bash
- Checkpoints and rollback
- Goal loop with progress tracking
- Session branching without overwriting history
- Configurable keybindings instead of hardcoded shortcuts

### Extensibility

- Skills: reusable instruction packs
- Prompt templates: reusable slash-command prompts
- Extensions: TypeScript modules that register tools, commands, UI, hooks, events, providers, and shortcuts
- Themes: built-in and custom TUI themes
- Custom model/provider definitions
- MCP/server-style workflows and integrations

### Distribution

- npm package: `@zhachory1/mewrite-code`
- Homebrew formula: `mewrite`
- Debian package: `mewrite-code`
- RPM package: `mewrite-code`
- Docker image: `ghcr.io/zhachory1/mewritecode`
- Snap metadata tracked in `snap/snapcraft.yaml`
- Release binaries for macOS, Linux, and Windows

---

## Configuration

Primary config directory:

```text
~/.mewrite/agent/
```

Useful paths:

| Path | Purpose |
|---|---|
| `~/.mewrite/agent/settings.json` | User settings |
| `~/.mewrite/agent/auth.json` | API/OAuth credential storage |
| `~/.mewrite/agent/models.json` | Custom models/providers |
| `~/.mewrite/agent/sessions/` | Session history |
| `~/.mewrite/agent/prompts/` | User prompt templates |
| `~/.mewrite/agent/skills/` | User skills |
| `~/.mewrite/agent/themes/` | User themes |
| `.mewrite/` | Project-local config/resources |

Common environment variables:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `AWS_PROFILE`, `AWS_REGION` | Amazon Bedrock auth/region |
| `MEWRITE_CODING_AGENT_DIR` | Override `~/.mewrite/agent` |
| `MEWRITE_PACKAGE_DIR` | Override package asset directory |
| `MEWRITE_SKIP_VERSION_CHECK` | Skip startup update checks |
| `MEWRITE_CACHE_RETENTION=long` | Request extended prompt cache where supported |

Provider-specific setup is documented in `packages/coding-agent/docs/providers.md`.

---

## Repository layout

This repository is a TypeScript monorepo.

| Package | Purpose |
|---|---|
| `packages/coding-agent` | `mewrite` CLI, TUI app, tools, sessions, extensions, release packaging |
| `packages/ai` | Provider abstraction, streaming APIs, model catalogs |
| `packages/agent` | Agent loop, tool-call orchestration, message model |
| `packages/tui` | Terminal UI primitives and rendering |
| `packages/sdk` | Programmatic SDK for embedding agent sessions |
| `packages/markdown-preview` | Markdown preview support |

Other useful directories:

| Path | Purpose |
|---|---|
| `Formula/` | Homebrew formula |
| `scripts/` | Release, binary, package, and repo-generation scripts |
| `.github/workflows/` | CI, smoke install, release workflows |
| `snap/` | Snapcraft metadata |
| `research/` | Token/compression benchmarks and evaluation scripts |
| `docs/` | Project documentation index and supporting docs |

---

## Development

Install dependencies:

```bash
npm install
```

Run checks:

```bash
npm run check
```

Build all packages:

```bash
npm run build
```

Useful package docs:

- `packages/coding-agent/README.md`
- `packages/ai/README.md`
- `packages/agent/README.md`
- `packages/tui/README.md`
- `packages/sdk/README.md`

---

## Status

Me Write Code is actively being rebranded and hardened around the `mewrite` CLI and `.mewrite` config directory. Some internal module names and historical changelog entries may still mention upstream or older branding while the user-facing CLI, packaging, install paths, and primary docs move to Me Write Code.

---

## Acknowledgements

Me Write Code builds on substantial upstream work by Mario Zechner and contributors. It also learns from terminal coding agents and developer tools including Claude Code, Codex, Aider, OpenCode, RTK, and Biome.

---

## License

MIT
