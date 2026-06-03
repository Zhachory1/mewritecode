---
title: Cookbook
description: Working recipes — from CI integration to multi-agent code review.
---

# Cookbook

Concrete, copy-pasteable patterns. Every snippet was tested before publication.

<CopyForLlms />

## `caveman exec` in GitHub Actions

```yaml
# .github/workflows/cave-review.yml
name: Caveman Code PR review
on: [pull_request]
jobs:
    review:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - run: npm install -g @juliusbrussee/caveman-code
            - run: cave exec "review the diff vs main and post a 200-word PR comment with findings" \
                  --output-schema .github/cave-review-schema.json \
                  --skip-git-repo-check
              env:
                  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Caveman Code's stable JSON event stream on stdout is parsed by the action runner; the structured output lands in the PR comment.

## Multi-agent code review

```yaml
# .cave/recipes/parallel-review.yaml
name: "Parallel code review"
goal: |
  Review the diff vs main from three perspectives in parallel:
  Security, Performance, Code clarity. Aggregate findings.

model: claude-sonnet-4

steps:
  - "Dispatch Reviewer subagent with focus: security"
  - "Dispatch Reviewer subagent with focus: performance"
  - "Dispatch Reviewer subagent with focus: clarity"
  - "Aggregate the three summaries into a unified review"
  - "Post the review as a PR comment via gh CLI"
```

Run: `caveman run-recipe parallel-review`. Three subagents run in parallel worktrees; results stream back as 500-token summaries; the parent assembles the final review.

## Pair programming over the daemon

```bash
# laptop
caveman serve --port 39245 --token $TOKEN

# expose via cloudflared
cloudflared tunnel run caveman-tunnel

# colleague's machine
caveman attach --host https://cave.example.com:39245 --token $TOKEN
```

Both clients see the same session. Tokens stream in real-time to both.

## Auto-format on every Edit

```json
// ~/.cave/settings.json
{
    "hooks": {
        "PostToolUse": [
            {
                "matcher": { "tool": "Edit|Write" },
                "command": [
                    "bash",
                    "-lc",
                    "biome format --write \"$CAVE_HOOK_FILES\" 2>/dev/null || prettier --write \"$CAVE_HOOK_FILES\""
                ]
            }
        ]
    }
}
```

`$CAVE_HOOK_FILES` is space-separated newline-safe file paths from the tool call.

## Block writes that contain secrets

```json
{
    "hooks": {
        "PreToolUse": [
            {
                "matcher": { "tool": "Write|Edit" },
                "command": [
                    "bash",
                    "-lc",
                    "cat \"$CAVE_HOOK_FILE\" | gitleaks detect --no-git --pipe && echo ok"
                ],
                "decision": "deny-on-nonzero",
                "timeout": 10
            }
        ]
    }
}
```

Caveman Code passes the file content via `$CAVE_HOOK_FILE`. Non-zero exit denies the write and tells the model why.

## Use cave as an MCP server from Claude Desktop

```bash
caveman mcp-server --port 39250
```

Then in Claude Desktop's `claude_desktop_config.json`:

```json
{
    "mcpServers": {
        "cave": {
            "transport": "http",
            "url": "http://localhost:39250"
        }
    }
}
```

Claude Desktop now sees Caveman Code's coding tools (Read, Glob, Grep, Bash, Edit, Write).

## Plugin marketplace

Search and install:

```bash
caveman plugin search security
caveman plugin install ghost-sec/sec-pack
caveman plugin marketplace add https://plugins.example.com/marketplace.json
caveman plugin upgrade
```

Author your own:

```bash
caveman plugin scaffold my-pack
$EDITOR my-pack/.cave-plugin/plugin.json
caveman plugin publish my-pack    # publishes to the configured marketplace
```

## Architect / editor split for a tight budget

```bash
/architect set architectModel=claude-opus-4-7 editorModel=claude-haiku-4
> migrate this Express app to Fastify
```

Opus plans (one expensive model call). Haiku executes each step (cheap). Drops cost ~3-5×.

## Watch mode for IDE-style edits

```bash
caveman --watch
```

Then in your editor:

```typescript
// cave! refactor this function to use async iterators
function processLines(input: string): string[] {
    return input.split("\n").filter(Boolean);
}
```

Caveman Code detects the trailing `!`, runs an edit-class turn with the surrounding lines as context, applies the diff, removes the comment.

## Replay a session

```bash
caveman -r                                         # browse and pick
caveman --session ~/.cave/sessions/.../abc.jsonl   # load directly
```

To share a reproducible session: export to HTML (`/export session.html`) or copy the session file. Replay functionality is planned for future releases.
