# Settings

Me Write Code uses JSON settings files with project settings overriding global settings.

| Location | Scope |
|----------|-------|
| `~/.mewrite/agent/settings.json` | Global (all projects) |
| `.mewrite/settings.json` | Project (current directory) |

Edit directly or use `/settings` for common options.

## All Settings

### Model & Thinking

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `defaultProvider` | string | - | Default provider (e.g., `"anthropic"`, `"openai"`) |
| `defaultModel` | string | - | Default model ID |
| `defaultThinkingLevel` | string | - | `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"` |
| `hideThinkingBlock` | boolean | `false` | Hide thinking blocks in output |
| `thinkingBudgets` | object | - | Custom token budgets per thinking level |

#### thinkingBudgets

```json
{
  "thinkingBudgets": {
    "minimal": 1024,
    "low": 4096,
    "medium": 10240,
    "high": 32768
  }
}
```

### UI & Display

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `theme` | string | `"dark"` | Theme name (`"dark"`, `"light"`, or custom) |
| `quietStartup` | boolean | `false` | Hide startup header |
| `quietResourceListing` | boolean | `true` | Hide startup resource listings while keeping diagnostics on reload and verbose startup output |
| `showChangelogOnStartup` | boolean | `false` | Automatically show changelog after updates. `/changelog` remains available manually |
| `collapseChangelog` | boolean | `false` | Show condensed startup changelog when `showChangelogOnStartup` is enabled |
| `doubleEscapeAction` | string | `"tree"` | Action for double-escape: `"tree"`, `"fork"`, or `"none"` |
| `treeFilterMode` | string | `"default"` | Default filter for `/tree`: `"default"`, `"no-tools"`, `"user-only"`, `"labeled-only"`, `"all"` |
| `editorPaddingX` | number | `0` | Horizontal padding for input editor (0-3) |
| `autocompleteMaxVisible` | number | `5` | Max visible items in autocomplete dropdown (3-20) |
| `showHardwareCursor` | boolean | `false` | Show terminal cursor |

### Compaction

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `compaction.enabled` | boolean | `true` | Enable auto-compaction |
| `compaction.reserveTokens` | number | `16384` | Tokens reserved for LLM response |
| `compaction.keepRecentTokens` | number | `20000` | Recent tokens to keep (not summarized) |

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

### Compression Mode

Compression mode is a 3-layer token compression system that reduces token usage while preserving technical accuracy.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `caveMode.enabled` | boolean | `true` | Enable communication compression |
| `caveMode.intensity` | string | `"full"` | Compression level: `"lite"`, `"full"`, or `"ultra"` |
| `caveMode.toolCompression` | boolean | `true` | Compress tool output (strip ANSI, collapse blanks, truncate long output) |

**Intensity levels:**
- **lite** — Light compression. Drops obvious filler words but preserves most natural language.
- **full** — Standard compression. Drops articles, filler, pleasantries. Leads with answers.
- **ultra** — Maximum compression. Terse technical documentation style. Uses abbreviations and symbols.

All intensity levels preserve full English for: code blocks, commit messages, PR descriptions, and security warnings.

```json
{
  "caveMode": {
    "enabled": true,
    "intensity": "full",
    "toolCompression": true
  }
}
```

Tool compression applies three steps to all tool output:
1. Strip ANSI escape codes (colors, cursor movement)
2. Collapse 3+ consecutive blank lines to a single blank line
3. Truncate output exceeding 500 lines (keeps first 200 + last 100 lines)

Use `/settings` to toggle Compression Mode, Tool compression, and intensity. Use `/mode [on|off|lite|full|ultra|stats]` for session-only changes.

### Ponytail Mode

Ponytail Mode is enabled by default and reduces code size by steering coding tasks toward reuse, standard library, native platform features, and the smallest correct diff. It governs what to build, not response prose.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ponytail.enabled` | boolean | `true` | Enable code-minimalism guidance |
| `ponytail.intensity` | string | `"full"` | Code-minimalism level: `"lite"`, `"full"`, or `"ultra"` |

```json
{
  "ponytail": {
    "enabled": true,
    "intensity": "full"
  }
}
```

Use `/settings` to persist Ponytail defaults. Use `/ponytail [on|off|lite|full|ultra|status]` to change Ponytail for the current session without editing settings.

### RTK (Rust Token Killer)

RTK is an optional external binary that rewrites bash commands to produce more compact output.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `rtk.enabled` | boolean | `true` | Enable RTK command rewriting (requires `rtk` binary on PATH) |

```json
{
  "rtk": {
    "enabled": true
  }
}
```

RTK is detected automatically at startup. If the `rtk` binary is not installed, the setting has no effect.

### Durable Memory

Me Write owns the durable-memory read/write lifecycle. zbrain is the default local backend. Memory writes still require explicit user intent; `/memory save` previews by default and `/memory save --yes` persists directly.

```json
{
  "memory": {
    "enabled": true,
    "backend": "zbrain",
    "workspace": "~/.zbrain",
    "capture": {
      "requirePreview": true,
      "defaultCollection": "inbox"
    },
    "retrieval": {
      "enabled": true,
      "maxResults": 5
    }
  }
}
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `memory.enabled` | boolean | `true` | Enable memory recall and save tools for the session |
| `memory.backend` | string | `"zbrain"` | Memory backend: `"zbrain"`, `"cavemem"`, or `"files"` |
| `memory.command` | string | - | Backend command override, for example a custom `zbrain` path |
| `memory.workspace` | string | `"~/.zbrain"` | zbrain workspace root |
| `memory.capture.requirePreview` | boolean | `true` | Preview `/memory save` writes before persisting |
| `memory.capture.defaultCollection` | string | `"inbox"` | zbrain subfolder for saved facts |
| `memory.retrieval.enabled` | boolean | `true` | Enable durable-memory retrieval |
| `memory.retrieval.maxResults` | number | `5` | Default retrieval result count |

Use `/memory status` to inspect backend, workspace, capture, retrieval, and index health.
Use `/memory search <query>` for explicit retrieval.
Use `/memory save <text>` to preview a durable save and `/memory save --yes <text>` to persist.

### Experimental Context Engine

The Context Engine is disabled by default. It can inject transient, lower-priority context bundles before a prompt. Context bundles are not saved into Me Write session history, exports, or compaction input, but bundle text may be sent to the configured model provider for that turn.

```json
{
  "contextEngine": {
    "enabled": true,
    "provider": "gbrain",
    "timeoutMs": 1000,
    "budgetTokens": 4000,
    "gbrain": {
      "allowAllMemory": true,
      "disallowPrefixes": ["notes"]
    }
  }
}
```

#### contextEngine

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `contextEngine.enabled` | boolean | `false` | Enable experimental context retrieval |
| `contextEngine.provider` | string | `"none"` | Context provider: `"none"`, `"codescry"`, legacy `"repo-index"`, `"gbrain"`, `"qmd"`, experimental `"stack"`, or advanced `"remote"` |
| `contextEngine.setup.hasSeenSetupPrompt` | boolean | `false` | Whether the one-time optional context setup notice has been shown or skipped |
| `contextEngine.setup.mainCodeDir` | string | - | Main code folder for Codescry/code context setup |
| `contextEngine.setup.mainDocsDir` | string | - | Main docs folder for QMD/durable-memory setup |
| `contextEngine.budgetTokens` | number | `4000` | Approximate context budget for retrieved bundles |
| `contextEngine.timeoutMs` | number | `1000` | Retrieval timeout; failures continue without context |
| `contextEngine.compression.enabled` | boolean | `false` | Enable experimental compression contract. All real provider bundles remain exact-preserve unless explicitly marked `lossy-ok`. |
| `contextEngine.compression.headroom.enabled` | boolean | `true` | Enable the built-in Headroom compressor when context compression is enabled |
| `contextEngine.compression.headroom.python` | string | - | Advanced Python runtime override for Headroom |
| `contextEngine.compression.headroom.timeoutMs` | number | `500` | Per-bundle Headroom timeout |
| `contextEngine.compression.headroom.maxInputBytes` | number | `65536` | Max bytes sent to Headroom per bundle |
| `contextEngine.compression.headroom.maxOutputBytes` | number | `131072` | Max Headroom stdout bytes |

#### contextEngine.compression.headroom

Headroom compression is experimental. The Headroom integration is built into Me Write and is on by default when `contextEngine.compression.enabled` is true. Use `/settings` or set `contextEngine.compression.headroom.enabled` to `false` to turn it off. `contextEngine.compression.headroom.python` is an advanced runtime override; normal setup should not need it.

```json
{
  "contextEngine": {
    "compression": {
      "enabled": true,
      "headroom": {
        "enabled": true,
        "timeoutMs": 500
      }
    }
  }
}
```

M4b only sends bundles explicitly marked `lossy-ok`; current real providers keep exact-preserve defaults.

#### contextEngine.provider: stack

`provider: "stack"` is an experimental fanout mode. It runs Codescry and QMD in parallel, applies per-provider deadlines, and merges results under `contextEngine.budgetTokens`.

```json
{
  "contextEngine": {
    "enabled": true,
    "provider": "stack",
    "budgetTokens": 4000,
    "repoIndex": { "command": "codescry", "k": 8 },
    "qmd": { "command": "qmd", "maxResults": 5, "collections": ["docs"] }
  }
}
```

M6a has no generic provider registry. `stack` means exactly Codescry + QMD.

#### contextEngine.provider: remote

`provider: "remote"` is an advanced, opt-in team context mode. It calls a team-managed endpoint for read-only context bundles. Remote activation and endpoint/token settings are honored only from the global settings file (`~/.mewrite/agent/settings.json`), not repo-local project settings. Local context providers are not composed with remote mode in M10a: if the remote endpoint fails, Me Write continues without remote context and does not silently fall back to the local stack.

Remote mode sends constrained, best-effort-redacted query text plus selected metadata to the configured endpoint. It does not send hidden/system prompts, full transcripts, tool outputs, environment variables, prompt-template expansions, skill bodies, or full session content. Returned snippets are injected as transient untrusted evidence and may be sent to the configured model provider for that turn.

```json
{
  "contextEngine": {
    "enabled": true,
    "provider": "remote",
    "timeoutMs": 1000,
    "remote": {
      "endpoint": "https://context.example.com",
      "tokenEnv": "MEWRITE_CONTEXT_REMOTE_TOKEN",
      "requestedScope": {
        "org": "example",
        "project": "mewritecode"
      }
    }
  }
}
```

Set the token in your shell or secret manager, not in settings:

```bash
export MEWRITE_CONTEXT_REMOTE_TOKEN=...
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `contextEngine.remote.endpoint` | string | - | Team context endpoint base URL. Non-localhost endpoints must use HTTPS. |
| `contextEngine.remote.tokenEnv` | string | `"MEWRITE_CONTEXT_REMOTE_TOKEN"` | Environment variable containing the bearer token. |
| `contextEngine.remote.requestedScope` | object | `{}` | Advisory routing scope sent to the server. Server token identity/claims must remain authoritative. |
| `contextEngine.remote.allowInsecureLocalhost` | boolean | `true` | Allow `http://localhost` or `http://127.0.0.1` for local testing only. |
| `contextEngine.remote.maxRequestBytes` | number | `65536` | Max JSON request bytes. |
| `contextEngine.remote.maxResponseBytes` | number | `524288` | Max JSON response bytes. |
| `contextEngine.remote.maxBundleBytes` | number | `16384` | Max bytes kept from each returned bundle. |
| `contextEngine.remote.maxBundles` | number | `12` | Max bundles accepted from the endpoint. |
| `contextEngine.remote.failureThreshold` | number | `2` | Consecutive failures before the endpoint is skipped temporarily. |
| `contextEngine.remote.failureTtlMs` | number | `30000` | Skip window after repeated failures. |

M10a requires one server endpoint: `POST /v1/context/query`. Health endpoints, production reference server, remote writes, and local+remote composition are deferred.

Request shape:

```json
{
  "protocolVersion": 1,
  "query": {
    "text": "redacted current request text",
    "redacted": true,
    "cwdBasename": "repo",
    "explicitRefs": ["src/foo.ts"]
  },
  "requestedScope": { "org": "example", "project": "repo" },
  "budget": { "maxBundles": 12, "maxChars": 196608, "timeoutMs": 1000 },
  "client": { "name": "mewrite-code", "version": "m10a" }
}
```

Response shape:

```json
{
  "protocolVersion": 1,
  "requestId": "req-123",
  "pack": {
    "bundles": [
      {
        "id": "bundle-1",
        "source": "team-index",
        "entity": "code-chunk",
        "title": "auth.ts",
        "content": "snippet text",
        "score": 0.9,
        "provenance": {
          "provider": "team-index",
          "path": "src/auth.ts",
          "lineStart": 10,
          "lineEnd": 20
        }
      }
    ]
  }
}
```

Server contract:

- Treat remote paths, URIs, commits, and line numbers as server-asserted provenance; Me Write displays them as remote evidence, not verified local files.
- Treat bearer token identity/claims as authoritative.
- Treat `requestedScope` as advisory routing metadata only.
- Return `401`/`403` for unauthorized scopes.
- Do not log bearer tokens or snippet content.
- Honor `budget.timeoutMs`, `budget.maxBundles`, and `budget.maxChars`.
- Return no hidden instructions; Me Write will still treat bundle content as untrusted evidence.

Redacted status categories include `missing-token`, `insecure-endpoint`, `auth-failed`, `rate-limited`, `remote-unavailable`, `schema-mismatch`, `oversize-response`, `timeout`, and `circuit-open`.

#### contextEngine.repoIndex / codescry

The code context provider is powered by Codescry (formerly `repo-index-mcp`). Use `contextEngine.provider: "codescry"`. The settings key remains `repoIndex` for now.

```json
{
  "contextEngine": {
    "enabled": true,
    "provider": "codescry",
    "repoIndex": {
      "command": "codescry",
      "k": 8
    }
  }
}
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `contextEngine.repoIndex.command` | string | `"codescry"` | Codescry executable |
| `contextEngine.repoIndex.dbPath` | string | - | Optional index database path |
| `contextEngine.repoIndex.k` | number | `8` | Maximum code results to request |

#### contextEngine.qmd

QMD is the recommended local durable-memory provider. QMD searches a local SQLite index, but retrieved snippets may still be sent to the configured model provider as transient Me Write context.

Before enabling it, install/configure QMD and verify it returns JSON:

```bash
qmd collection list
qmd query "test" --json -n 1 --no-rerank
```

```json
{
  "contextEngine": {
    "enabled": true,
    "provider": "qmd",
    "qmd": {
      "command": "qmd",
      "maxResults": 5,
      "collections": ["notes", "docs"]
    }
  }
}
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `contextEngine.qmd.command` | string | `"qmd"` | QMD executable |
| `contextEngine.qmd.maxResults` | number | `5` | Maximum QMD results to request |
| `contextEngine.qmd.collections` | string[] | `[]` | Optional QMD collection names; passed as repeated `-c` filters |

M3b uses `qmd query --json --no-rerank` for predictable latency and maps snippets only. Use `/context status`, `/context doctor`, or `/context memory status` to inspect current state. Use `/context learn --preview` to preview learnable session context; save durable facts explicitly with `/memory save <fact>`.

#### contextEngine.gbrain

The gbrain provider calls `gbrain call query` and lets gbrain update its own local diagnostics/read-tracking state, such as `last_retrieved_at`. gbrain remains supported for existing users, but QMD is the recommended durable-memory provider going forward. Me Write still treats returned snippets as transient context for the active model request.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `contextEngine.gbrain.command` | string | `"gbrain"` | gbrain executable |
| `contextEngine.gbrain.maxResults` | number | `5` | Maximum raw gbrain results to request |
| `contextEngine.gbrain.allowAllMemory` | boolean | `true` | Allow all gbrain slugs except denied prefixes |
| `contextEngine.gbrain.allowedPrefixes` | string[] | `[]` | Allowed slug prefixes when scoped mode is used |
| `contextEngine.gbrain.disallowPrefixes` | string[] | `["notes"]` | Denied slug prefixes; applied before allowed-prefix filtering |
| `contextEngine.gbrain.project` | string | - | Optional project slug; currently restricts to `projects/<slug>` |

Default gbrain behavior is broad memory retrieval with `notes/...` excluded. To require explicit scopes, set `allowAllMemory` to `false` and provide `allowedPrefixes`:

```json
{
  "contextEngine": {
    "enabled": true,
    "provider": "gbrain",
    "gbrain": {
      "allowAllMemory": false,
      "allowedPrefixes": ["projects/mewritecode", "concepts/context-engine"],
      "disallowPrefixes": ["notes"]
    }
  }
}
```

Use `/context status` or `/context memory status` to inspect current state and effective gbrain scope.

### Branch Summary

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `branchSummary.reserveTokens` | number | `16384` | Tokens reserved for branch summarization |
| `branchSummary.skipPrompt` | boolean | `false` | Skip "Summarize branch?" prompt on `/tree` navigation (defaults to no summary) |

### Retry

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `retry.enabled` | boolean | `true` | Enable automatic retry on transient errors |
| `retry.maxRetries` | number | `3` | Maximum retry attempts |
| `retry.baseDelayMs` | number | `2000` | Base delay for exponential backoff (2s, 4s, 8s) |
| `retry.maxDelayMs` | number | `60000` | Max server-requested delay before failing (60s) |

When a provider requests a retry delay longer than `maxDelayMs` (e.g., Google's "quota will reset after 5h"), the request fails immediately with an informative error instead of waiting silently. Set to `0` to disable the cap.

```json
{
  "retry": {
    "enabled": true,
    "maxRetries": 3,
    "baseDelayMs": 2000,
    "maxDelayMs": 60000
  }
}
```

### Message Delivery

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `steeringMode` | string | `"one-at-a-time"` | How steering messages are sent: `"all"` or `"one-at-a-time"` |
| `followUpMode` | string | `"one-at-a-time"` | How follow-up messages are sent: `"all"` or `"one-at-a-time"` |
| `transport` | string | `"sse"` | Preferred transport for providers that support multiple transports: `"sse"`, `"websocket"`, or `"auto"` |

### Terminal & Images

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `terminal.showImages` | boolean | `true` | Show images in terminal (if supported) |
| `terminal.clearOnShrink` | boolean | `false` | Clear empty rows when content shrinks (can cause flicker) |
| `images.autoResize` | boolean | `true` | Resize images to 2000x2000 max |
| `images.blockImages` | boolean | `false` | Block all images from being sent to LLM |

### Shell

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `shellPath` | string | - | Custom shell path (e.g., for Cygwin on Windows) |
| `shellCommandPrefix` | string | - | Prefix for every bash command (e.g., `"shopt -s expand_aliases"`) |
| `npmCommand` | string[] | - | Command argv used for npm package lookup/install operations (e.g., `["mise", "exec", "node@20", "--", "npm"]`) |

```json
{
  "npmCommand": ["mise", "exec", "node@20", "--", "npm"]
}
```

`npmCommand` is used for all npm package-manager operations, including `npm root -g`, installs, uninstalls, and `npm install` inside git packages. Use argv-style entries exactly as the process should be launched.

### Sessions

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `sessionDir` | string | - | Directory where session files are stored. Accepts absolute or relative paths. |

```json
{ "sessionDir": ".mewrite/sessions" }
```

When multiple sources specify a session directory, `--session-dir` CLI flag takes precedence over `sessionDir` in settings.json.

### Model Cycling

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabledModels` | string[] | - | Model patterns for Ctrl+P cycling (same format as `--models` CLI flag) |

```json
{
  "enabledModels": ["claude-*", "gpt-4o", "gemini-2*"]
}
```

### Markdown

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `markdown.codeBlockIndent` | string | `"  "` | Indentation for code blocks |

### Resources

These settings define where to load extensions, skills, prompts, and themes from.

Paths in `~/.mewrite/agent/settings.json` resolve relative to `~/.mewrite/agent`. Paths in `.mewrite/settings.json` resolve relative to `.mewrite`. Absolute paths and `~` are supported.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `packages` | array | `[]` | npm/git packages to load resources from |
| `extensions` | string[] | `[]` | Local extension file paths or directories |
| `skills` | string[] | `[]` | Local skill file paths or directories |
| `prompts` | string[] | `[]` | Local prompt template paths or directories |
| `themes` | string[] | `[]` | Local theme file paths or directories |
| `enableSkillCommands` | boolean | `true` | Register skills as `/skill:name` commands |

Arrays support glob patterns and exclusions. Use `!pattern` to exclude. Use `+path` to force-include an exact path and `-path` to force-exclude an exact path.

#### packages

String form loads all resources from a package:

```json
{
  "packages": ["@org/team-skills", "@org/my-extension"]
}
```

Object form filters which resources to load:

```json
{
  "packages": [
    {
      "source": "@org/team-skills",
      "skills": ["brave-search", "transcribe"],
      "extensions": []
    }
  ]
}
```

See [packages.md](packages.md) for package management details.

## Example

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "theme": "dark",
  "caveMode": {
    "enabled": true,
    "intensity": "full",
    "toolCompression": true
  },
  "rtk": {
    "enabled": true
  },
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  },
  "retry": {
    "enabled": true,
    "maxRetries": 3
  },
  "enabledModels": ["claude-*", "gpt-4o"],
  "packages": ["@org/team-skills"]
}
```

## Project Overrides

Project settings (`.mewrite/settings.json`) override global settings. Nested objects are merged:

```json
// ~/.mewrite/agent/settings.json (global)
{
  "theme": "dark",
  "compaction": { "enabled": true, "reserveTokens": 16384 }
}

// .mewrite/settings.json (project)
{
  "compaction": { "reserveTokens": 8192 }
}

// Result
{
  "theme": "dark",
  "compaction": { "enabled": true, "reserveTokens": 8192 }
}
```
