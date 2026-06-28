<h1 align="center">Me Write Code</h1>
<p align="center">Terminal coding harness with token-saving Caveman Mode</p>
<p align="center">
  <a href="https://discord.com/invite/nKXTsAcmbT"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@zhachory1/mewrite-code"><img alt="npm" src="https://img.shields.io/npm/v/%40zhachory1%2Fmewrite-code?style=flat-square" /></a>
  <a href="https://github.com/Zhachory1/mewritecode/actions/workflows/ci.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/Zhachory1/mewritecode/ci.yml?style=flat-square&branch=main" /></a>
</p>

Me Write Code is the `mewrite` CLI package in [Zhachory1/mewritecode](https://github.com/Zhachory1/mewritecode).

Me Write Code is a terminal coding agent that is provider-agnostic, terminal-native, extensible, and downstream-brandable. Use it interactively, run it in print or JSON mode, embed it through the SDK, extend it with TypeScript modules, skills, prompt templates, and themes, or wrap it as a branded distribution without forking core code.

---

## Install

### npm (current package)

```bash
npm install -g @zhachory1/mewrite-code
mewrite
```

### Homebrew (macOS, Linux)

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

The package supports amd64 and arm64 systems. It installs `mewrite` plus `mewrite-code` and `mewritecode` aliases.

### Fedora / RHEL / CentOS

```bash
sudo curl -fsSL https://raw.githubusercontent.com/Zhachory1/mewritecode/gh-pages/yum/mewrite.repo -o /etc/yum.repos.d/mewrite.repo
sudo dnf install mewrite-code  # or yum
mewrite
```

The package supports x86_64 and aarch64 systems. It installs `mewrite` plus `mewrite-code` and `mewritecode` aliases.

### Snap (tracked, not yet published)

Snap packaging metadata is tracked in `snap/snapcraft.yaml`. Once published:

```bash
sudo snap install mewrite-code --classic
mewrite-code
```

Requirements:
- Node.js 20+ (npm install path only)
- API key or active subscription for at least one supported provider

---

## Quick Start

### Authenticate

```bash
# API key
export ANTHROPIC_API_KEY=sk-ant-...
mewrite

# Or sign in with an existing subscription
mewrite
/login
```

### Use

```bash
mewrite                              # interactive mode
mewrite "explain this codebase"      # start with prompt
mewrite -p "summarize this file"     # print mode
cat README.md | mewrite -p "review"  # pipe stdin
mewrite -c                           # continue last session
mewrite -r                           # browse sessions
mewrite goal start "<text>"          # autonomous goal loop
```

Success looks like this:
- interactive TUI opens with active model + status footer
- `/login` or API key auth succeeds
- model can call built-in tools like `read`, `bash`, `edit`, and `write`

Platform notes: [Windows](docs/windows.md) · [Termux](docs/termux.md) · [tmux](docs/tmux.md) · [Terminal setup](docs/terminal-setup.md) · [Shell aliases](docs/shell-aliases.md)

---

## What Me Write Code Adds

Me Write Code combines the core terminal coding workflow with token-saving defaults and broad provider support.

| Area | Me Write Code |
|------|------|
| Multi-provider coding agent | Built in |
| Caveman Mode | 3-layer token compression |
| RTK integration | Optional bash command rewriting + output reduction |
| Package ecosystem | Install prompts, skills, themes, and extensions via npm or git |
| Brandable wrappers | Change app name, logo/wordmark, colors, docs links, watch markers, MCP policy, and update links from package metadata |
| SDK + RPC | Embed in apps or automate from other runtimes |

---

## Supported Providers

### OAuth subscriptions
Claude Pro/Max · ChatGPT Plus/Pro · GitHub Copilot · Google Gemini · Google Antigravity

### API keys
Anthropic · OpenAI · Azure OpenAI · Google Gemini · Google Vertex · Amazon Bedrock · Mistral · Groq · Cerebras · xAI · OpenRouter · Vercel AI Gateway · Hugging Face · Kimi · MiniMax · ZAI · OpenCode

### Custom providers
Add any OpenAI-, Anthropic-, or Google-compatible endpoint via `~/.mewrite/agent/models.json`, or build a custom provider with [Extensions](docs/extensions.md) and [Custom Provider docs](docs/custom-provider.md).

Provider setup details: [docs/providers.md](docs/providers.md)

---

## Modes

| Mode | Command | Use case |
|------|---------|----------|
| Interactive | `mewrite` | Full TUI with history, editor, tool calls, and status UI |
| Print | `mewrite -p "..."` | One-shot scripting |
| JSON | `mewrite --mode json "..."` | Structured automation |
| RPC | `mewrite --mode rpc` | Stdin/stdout process integration |
| SDK | `createAgentSession()` | Embed Me Write Code in Node.js apps |

---

## Interactive Mode

<p align="center"><img src="docs/images/interactive-mode.png" alt="Interactive Mode" width="600"></p>

Main UI regions:
- **Startup header** — version, shortcuts, loaded context, skills, prompts, extensions
- **Messages** — prompts, assistant output, tool calls/results, notifications, extension UI
- **Editor** — input area, file picker, slash commands, shell dispatch
- **Footer** — cwd, session name, token/cache usage, cost, context usage, model

### Editor Features

| Feature | How |
|---------|-----|
| File reference | `@` fuzzy-searches project files |
| Path completion | `Tab` |
| Multi-line input | `Shift+Enter` |
| Paste images | `Ctrl+V` |
| Shell commands | `!cmd` sends output to model · `!!cmd` runs silently |
| Thinking level | `Shift+Tab` cycles levels |
| Model switcher | `Ctrl+L` |
| Collapse tool output | `Ctrl+O` |
| Collapse thinking | `Ctrl+T` |

### Slash Commands

| Command | Description |
|---------|-------------|
| `/login`, `/logout` | OAuth auth |
| `/model` | Switch models |
| `/settings` | Theme, thinking, delivery, transport, compaction |
| `/resume` | Pick prior session |
| `/new` | New session |
| `/tree` | Browse + branch session history |
| `/fork` | Create session from branch point |
| `/compact [prompt]` | Manual compaction |
| `/copy` | Copy last assistant message |
| `/export [file]` | Export session to HTML |
| `/share` | Upload session as private gist |
| `/reload` | Reload extensions, prompts, skills, keybindings, context |
| `/hotkeys` | Show shortcuts |
| `/changelog` | Show version history |

Keyboard shortcut details: [docs/keybindings.md](docs/keybindings.md)

---

## Sessions

Sessions auto-save to `~/.mewrite/agent/sessions/` and keep full tree history in JSONL format.

```bash
mewrite -c                    # continue most recent session
mewrite -r                    # browse sessions
mewrite --session <path|id>   # open specific session
mewrite --fork <path|id>      # fork into new session
mewrite --no-session          # ephemeral mode
```

### Branching

Use `/tree` to search, branch, label bookmarks, and revisit earlier points without overwriting history.

### Compaction

Compaction summarizes older context while keeping recent turns active:
- automatic on overflow or near-limit conditions
- manual via `/compact`
- full history always remains in session file

Session format details: [docs/session.md](docs/session.md) · Compaction details: [docs/compaction.md](docs/compaction.md)

---

## Caveman Mode

Caveman Mode is enabled by default and reduces token waste without changing workflow.

### Layer 1: prompt compression
- `lite` — brief responses
- `full` — default terse mode
- `ultra` — maximum brevity

### Layer 2: tool output compression
- strips ANSI noise
- applies per-tool budgets
- truncates with head/tail slices instead of hard cuts
- compresses structured bash output where possible

### Layer 3: read deduplication
- fingerprints reads within session
- returns stub when unchanged file is re-read
- reduces repeated context injection during refactors

Change level with `/cave [lite|full|ultra|off]`.

Settings reference: [docs/settings.md](docs/settings.md)

### Benchmarks

Token-efficiency claims are under revalidation. Run `npm run bench:offline` for local compression analysis on fixture data.

#### Tool Output Compression

```
                         0%        25%        50%        75%       100%
                         |          |          |          |          |
  git diff (901 lines)   [##################################################] -94.0%
  npm ls (701 lines)     [################################################  ] -91.6%
  ls recursive (601 ln)  [###############################################   ] -90.3%
  grep results (801 ln)  [##############################################    ] -89.3%
  test output (501 ln)   [############################################      ] -87.6%
  XML/pom.xml (382 ln)   [########################################          ] -78.7%
  docker inspect (258)   [##################################                ] -67.9%
  ANSI colored (97 ln)   [#########################                         ] -50.0%
  read file (429 lines)  [################                                  ] -32.0%
  build output (19 ln)   [#########                                         ] -18.0%
                         |          |          |          |          |
  AGGREGATE              [###########################################       ] -85.9%
```

**~72,400 tokens saved** across 337K chars of tool output. Larger outputs compress more aggressively.

#### Compression Pipeline Layers

| Layer | What it does | Biggest impact on |
|-------|-------------|-------------------|
| **Flint Chipper** | Per-tool line budgets (bash: 80, read: 300, grep: 120) | Large outputs (-67% to -92%) |
| **ANSI Strip** | Removes escape codes from colored output | Terminal output (-20% to -40%) |
| **Stone Tablet** | Semantic JSON/XML key extraction | Structured bash output |
| **Blank Collapse** | Collapses 3+ blank lines | Sparse output |
| **General Truncation** | 500-line cap with head+tail preservation | Very long outputs |

#### Read Deduplication

```
  First read (429-line file)   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  ~2,966 tokens
  Second read (unchanged)      ~                                            ~22 tokens
                                                                      99.3% savings
```

#### System Prompt Overhead vs Savings

| Intensity | Prompt Cost | Break-even | Net per 15-turn session |
|-----------|------------|------------|------------------------|
| lite | +120 tokens | 1 tool call | **+567K tokens saved** |
| full | +175 tokens | 1 tool call | **+567K tokens saved** |
| ultra | +195 tokens | 1 tool call | **+566K tokens saved** |

Break-even depends on prompt size, model, provider pricing, and tool output volume.

#### Session Replay (real sessions)

4 sessions analyzed from `~/.mewrite/agent/sessions/`:

| Metric | Value |
|--------|-------|
| Total tool calls | 78 |
| Actual API input tokens | 105,105 |
| Cache read tokens | 1,314,699 |
| Tool types | bash (19), read (31), write (28) |

Note: These sessions had small tool outputs (all under budget thresholds). Compression savings scale with output size -- the offline benchmarks above show the full range on realistic large outputs.

Run benchmarks yourself:

```bash
npm run bench:offline   # Compression analysis (free, <1s)
npm run bench:replay    # Analyze your real sessions (free)
npm run bench:live      # A/B comparison with LLM calls (needs API key, ~$1-2)
npm run bench           # All tiers
```

---

## RTK Integration

RTK (Rust Token Killer) is an optional external binary. When installed, Me Write Code can rewrite bash commands through `rtk rewrite` before execution, then still apply Caveman Mode compression afterward.

### Install check

```bash
rtk --version
```

### Disable globally

```json
// ~/.mewrite/agent/settings.json
{
  "rtk": { "enabled": false }
}
```

More: [docs/settings.md](docs/settings.md)

---

## Customization

### Prompt Templates
Reusable Markdown prompts in:
- `~/.mewrite/agent/prompts/`
- `.mewrite/prompts/`

Docs: [docs/prompt-templates.md](docs/prompt-templates.md)

### Skills
On-demand capability packs in:
- `~/.mewrite/agent/skills/`
- `~/.agents/skills/`
- `.mewrite/skills/`
- `.agents/skills/`

Docs: [docs/skills.md](docs/skills.md)

### Extensions
TypeScript modules can register tools, commands, event handlers, keybindings, UI, sub-agents, permission gates, MCP integrations, providers, and more.

```typescript
export default function (api: ExtensionAPI) {
  api.registerTool({ name: "deploy", ... });
  api.registerCommand("stats", { ... });
  api.on("tool_call", async (event, ctx) => { ... });
}
```

Extension docs: [docs/extensions.md](docs/extensions.md) · Examples: [examples/extensions/](examples/extensions/)

### Themes
Built-in: `dark`, `light`. Custom themes live in:
- `~/.mewrite/agent/themes/`
- `.mewrite/themes/`

Docs: [docs/themes.md](docs/themes.md)

### Downstream branding
Thin wrappers can rebrand Me Write Code through `mewriteConfig` in their package metadata. Supported knobs include app/display name, config dir, startup wordmark/tagline, default theme and theme files, watch comment markers, docs/community/changelog URLs, update policy, and MCP discovery policy. See [Downstream branded wrappers](#downstream-branded-wrappers).

### Me Write Code Packages
Bundle and share extensions, skills, prompts, and themes via npm or git.

```bash
mewrite install npm:@foo/mewrite-tools
mewrite install git:github.com/user/repo
mewrite remove npm:@foo/mewrite-tools
mewrite list
mewrite update
mewrite config
```

Package docs: [docs/packages.md](docs/packages.md)

---

## Programmatic Usage

### SDK

```typescript
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@zhachory1/mewrite-code";

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
});

await session.prompt("What files are in the current directory?");
```

Advanced API docs: [docs/sdk.md](docs/sdk.md) · Examples: [examples/sdk/](examples/sdk/)

### RPC Mode

```bash
mewrite --mode rpc
```

Protocol details: [docs/rpc.md](docs/rpc.md)

### Downstream branded wrappers

Thin downstream packages can depend on `@zhachory1/mewrite-code` and set package metadata instead of copying the monorepo. Add `mewriteConfig` to the wrapper package and point `CODING_AGENT_PACKAGE_DIR` at that package before importing the CLI:

```json
{
  "name": "@example/examplecode",
  "bin": { "examplecode": "dist/cli.js" },
  "mewriteConfig": {
    "name": "examplecode",
    "displayName": "Example Code",
    "configDir": ".examplecode",
    "packageDirEnv": "EXAMPLECODE_PACKAGE_DIR",
    "branding": {
      "logoPath": "./assets/logo.png",
      "logoMaxWidthCells": 48,
      "tagline": "Example Code for Example teams",
      "watchMarker": "examplecode",
      "docsUrl": "https://docs.example.com/examplecode",
      "githubUrl": "https://github.com/example/examplecode",
      "discordUrl": "https://discord.gg/examplecode",
      "changelogUrl": "https://github.com/example/examplecode/blob/main/CHANGELOG.md",
      "primaryWordmark": ["EXAMPLE CODE"],
      "secondaryWordmark": []
    },
    "theme": {
      "default": "example-dark",
      "paths": ["./themes/example-dark.json"]
    },
    "resources": {
      "extensions": ["./extensions"],
      "skills": ["./skills"],
      "prompts": ["./prompts"],
      "themes": ["./themes"],
      "agents": ["./agents"],
      "mcp": ["./mcp/defaults.json"]
    },
    "mcp": {
      "includeRootProjectConfig": false,
      "includeProjectConfigDir": false,
      "includeUserConfigDir": false,
      "legacyConfigDirNames": [],
      "includeClaudeConfig": false,
      "includeCodexConfig": false
    },
    "selfUpdate": { "enabled": false }
  }
}
```

`CODING_AGENT_PACKAGE_DIR` is the bootstrap override used before package metadata is loaded. Once metadata is loaded, the package-specific env named by `packageDirEnv` is honored for asset lookup. User config then defaults to `~/.examplecode/agent`, project config to `.examplecode/`, and lower-level storage paths can derive from the same config dir. The `branding` block controls startup image logo or wordmark, tagline, watch comment marker (`// examplecode!`, `// examplecode?`), docs/community links, and update changelog links. `logoPath` resolves relative to the wrapper package and supports PNG, JPEG, GIF, and WebP; when set and loadable, it replaces the ASCII wordmark. The `theme.default` value selects a theme by name when the user has not chosen one; `theme.paths` loads wrapper-shipped theme files relative to the wrapper package. The `resources` block loads wrapper-shipped extensions, skills, prompts, themes, agents, and MCP config files relative to the wrapper package, so a branded distribution can ship its default behavior without copying files into user config. Wrapper resources load below user/project resources, so users can override them. The `mcp` block reads `PACKAGE_DIR/.mcp.json` plus any `resources.mcp` files by default and can disable project, user, legacy `.cave`, Claude Code, and Codex compatibility paths when a downstream distribution needs isolated MCP configuration.

For non-upstream distributions, self-update is disabled unless the wrapper explicitly provides a complete `selfUpdate` configuration.

---

## CLI Reference

```bash
mewrite [options] [@files...] [messages...]
```

### Subcommands

| Command | Description |
|---------|-------------|
| `mewrite goal start "<text>" [flags]` | Autonomous Ralph-style goal loop |
| `mewrite goal resume [id] [--force]` | Resume a paused goal |
| `mewrite goal status [id]` | Show goal state and ledger |
| `mewrite goal cancel [id]` | Cancel a running goal |
| `mewrite goal list` | List all goals |
| `mewrite mcp <subcmd>` | Manage MCP servers |
| `mewrite watch [paths]` | File watcher for `// mewrite!` triggers |
| `mewrite exec [flags] "<prompt>"` | Non-interactive CI mode |
| `mewrite plugin <subcmd>` | Plugin marketplace |
| `mewrite run-recipe <name>` | Run YAML workflows |
| `mewrite rollback N` | Revert to checkpoint N |
| `mewrite models <subcmd>` | Manage model registry |
| `mewrite serve` / `attach` | Daemon mode |

### Core options

| Option | Description |
|--------|-------------|
| `-c`, `--continue` | Continue most recent session |
| `-r`, `--resume` | Browse and select session |
| `-p`, `--print` | Print response and exit |
| `--mode json\|rpc` | Structured output modes |
| `--provider <name>` | Provider (`anthropic`, `openai`, `google`, ... ) |
| `--model <pattern>` | Model ID or pattern |
| `--thinking <level>` | `off` · `minimal` · `low` · `medium` · `high` · `xhigh` |
| `--tools <list>` | Enable specific built-in tools |
| `--no-tools` | Disable built-in tools |
| `--no-extensions` | Disable extension discovery |
| `-e`, `--extension <src>` | Load explicit extension |
| `--api-key <key>` | Override env var auth |
| `-v`, `--version` | Show version |
| `-h`, `--help` | Show help |

### Slash commands (in TUI)

| Command | Description |
|---------|-------------|
| `/plan` | Toggle plan mode (read-only exploration) |
| `/act` | Execute a saved plan |
| `/cave [level]` | Adjust token compression |
| `/login`, `/logout` | OAuth authentication |
| `/model` | Switch models |
| `/settings` | Configure settings |
| `/resume` | Browse sessions |
| `/tree` | Navigate session history |

Built-in tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`

### Environment variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `MEWRITE_CODING_AGENT_DIR` | Override config directory (default: `~/.mewrite/agent`) |
| `MEWRITE_PACKAGE_DIR` | Override package directory |
| `MEWRITE_SKIP_VERSION_CHECK` | Skip version check at startup |
| `MEWRITE_CACHE_RETENTION` | Set to `long` for extended prompt cache |
| `VISUAL`, `EDITOR` | External editor for Ctrl+G |

---

## Contributing

Contribution guide: [../../CONTRIBUTING.md](../../CONTRIBUTING.md)

Development docs:
- [docs/development.md](docs/development.md)
- [docs/settings.md](docs/settings.md)
- [docs/models.md](docs/models.md)
- [docs/custom-provider.md](docs/custom-provider.md)

---

## Plugin Marketplace

Me Write Code supports a plugin ecosystem. Plugins bundle commands, skills, agents, themes, hooks, and MCP server configs.

```bash
mewrite plugin search [query]           # Search all configured marketplaces
mewrite plugin install <owner/name>     # Install a plugin from GitHub or a URL
mewrite plugin list                     # Show installed plugins
mewrite plugin upgrade                  # Upgrade all installed plugins
mewrite plugin marketplace add <url>    # Register a remote marketplace
mewrite plugin marketplace list         # Show configured marketplace sources
```

Marketplaces are resolved in order: repo (`.mewrite/plugins/marketplace.json`), personal (`~/.mewrite/plugins/marketplace.json`), and remote URLs. Plugins install into `~/.mewrite/plugins/<owner>/<name>/`. To scaffold a new plugin, use `/plugin create` in interactive mode (invokes the `plugin-creator` skill).

---

## License

MIT
