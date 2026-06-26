---
title: Cookbook
description: Working recipes — from CI integration to multi-agent code review.
---

# Cookbook

Concrete, copy-pasteable patterns. Every snippet was tested before publication.

<CopyForLlms />

## `mewrite exec` in GitHub Actions

```yaml
# .github/workflows/mewrite-review.yml
name: Me Write Code PR review
on: [pull_request]
jobs:
    review:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - run: npm install -g @zhachory1/mewrite-code
            - run: mewrite exec "review the diff vs main and post a 200-word PR comment with findings" \
                  --output-schema .github/mewrite-review-schema.json \
                  --skip-git-repo-check
              env:
                  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Me Write Code's stable JSON event stream on stdout is parsed by the action runner; the structured output lands in the PR comment.

## Multi-agent code review

```yaml
# .mewrite/recipes/parallel-review.yaml
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

Run: `mewrite run-recipe parallel-review`. Three subagents run in parallel worktrees; results stream back as 500-token summaries; the parent assembles the final review.

## Pair programming over the daemon

```bash
# laptop
mewrite serve --port 39245 --token $TOKEN

# expose via cloudflared
cloudflared tunnel run mewrite-tunnel

# colleague's machine
mewrite sessions --host mewrite.example.com --port 39245 --token $TOKEN
mewrite attach <session-id> --host mewrite.example.com --port 39245 --token $TOKEN
```

Both clients see the same session. Tokens stream in real-time to both.

## Auto-format on every Edit

```json
// ~/.mewrite/agent/settings.json
{
    "hooks": {
        "PostToolUse": [
            {
                "matcher": { "tool": "Edit|Write" },
                "command": [
                    "bash",
                    "-lc",
                    "files=$(jq -r '[.tool_input.path, .tool_input.file_path] | map(select(.)) | @sh'); [ -z \"$files\" ] || eval biome format --write $files"
                ]
            }
        ]
    }
}
```

Hook commands receive a Claude Code-compatible JSON payload on stdin. `CAVE_PROJECT_DIR`, `CLAUDE_PROJECT_DIR`, `CAVE_SESSION_ID`, and `CAVE_HOOK_EVENT` are set in the environment.

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
                    "jq -r '.tool_input.content // empty' | gitleaks detect --no-git --pipe && echo ok"
                ],
                "decision": "deny-on-nonzero",
                "timeout": 10
            }
        ]
    }
}
```

For `Write` calls, file content is available in the hook stdin JSON. Non-zero exit denies the write and tells the model why.

## Use Me Write Code as an MCP server

```bash
mewrite mcp-server
```

Current server mode is stdio-based and exposes a minimal health tool. Use MCP client mode (`mewrite mcp add ...`) for production tool integrations today.

## Plugin marketplace

Search and install:

```bash
mewrite plugin search security
mewrite plugin install ghost-sec/sec-pack
mewrite plugin marketplace add https://plugins.example.com/marketplace.json
mewrite plugin upgrade
```

Author your own from the TUI:

```text
/plugin create
```

This invokes the bundled plugin-creator skill, which scaffolds `.cave-plugin/plugin.json` and the resource directories. Publish by pushing the plugin repo and adding it to a marketplace JSON.

## Architect / editor split for a tight budget

```bash
/architect set architectModel=claude-opus-4-7 editorModel=claude-haiku-4
> migrate this Express app to Fastify
```

Opus plans (one expensive model call). Haiku executes each step (cheap). Drops cost ~3-5×.

## Watch mode for IDE-style edits

```bash
mewrite --watch
```

Then in your editor:

```typescript
// mewrite! refactor this function to use async iterators
function processLines(input: string): string[] {
    return input.split("\n").filter(Boolean);
}
```

Me Write Code detects the trailing `!`, runs an edit-class turn with the surrounding lines as context, applies the diff, removes the comment.

## Replay a session

```bash
mewrite -r                                         # browse and pick
mewrite --session ~/.mewrite/agent/sessions/.../abc.jsonl   # load directly
```

To share a reproducible session: export to HTML (`/export session.html`) or copy the session file. Replay functionality is planned for future releases.
