# mewrite exec — CI / Non-Interactive Mode

`mewrite exec` runs a single agent prompt without a terminal UI and exits. It is designed for use in GitHub Actions, GitLab CI, shell scripts, and other automation contexts.

## Basic Usage

```bash
mewrite exec "List all TypeScript files in src/"
```

The assistant response is written to stdout and the process exits when done.

## Flags

| Flag | Description |
|------|-------------|
| `--json` | Emit a stable JSONL event stream on stdout instead of plain text |
| `--output-schema <file>` | Validate the final message against a JSON Schema (exit 2 on mismatch) |
| `--ephemeral` | Ignore `~/.mewrite/agent/settings.json` and project `.mewrite/settings.json`; use only CLI args and env |
| `--skip-git-repo-check` | Skip the git repository presence check |
| `--output-last-message <file>` | Write the final assistant text to a file atomically |
| `--cwd <dir>` | Working directory for the agent session (default: `$PWD`) |
| `--model <pattern>` | Model pattern, e.g. `anthropic/claude-sonnet-4-5` (same format as `mewrite --model`) |
| `--profile <name>` | Named profile from settings (deferred — emits a warning and continues) |
| `--timeout <ms>` | Timeout in milliseconds; exits with code 5 if the agent does not complete in time |
| `--help`, `-h` | Show help |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Generic / unclassified error |
| 2 | `--output-schema` validation failed: final message does not match the schema |
| 3 | Sandbox denied a tool call |
| 4 | Model error (API error, context-length exceeded, etc.) |
| 5 | Timeout (`--timeout <ms>`) |
| 6 | User-config error (bad settings file, model not found, etc.) |

## JSON Event Stream (`--json`)

When `--json` is passed, each event is written as a single JSON line (JSONL) to stdout. The schema is stable — CI scripts may rely on it.

### Event Types

```jsonc
// Session lifecycle
{"type":"session.start","session_id":"<uuid>","cwd":"/path/to/project"}
{"type":"session.end","exit":0,"cost":{"input_tokens":100,"output_tokens":50,"total_cost_usd":0.001}}

// Messages
{"type":"message.user","content":"List all TypeScript files"}
{"type":"message.assistant","content":"Here are the TypeScript files...","cost":{...}}

// Tool calls
{"type":"tool.call","name":"bash","input":{"command":"find src -name '*.ts'"},"id":"call-1"}
{"type":"tool.result","id":"call-1","ok":true,"output":"src/index.ts\nsrc/main.ts"}

// Errors
{"type":"error","code":"model_error","message":"Rate limit exceeded"}
```

### Happy-Path Order

A minimal happy-path emits these event types in sequence:

1. `session.start`
2. `message.user`
3. `tool.call` (zero or more)
4. `tool.result` (one per `tool.call`)
5. `message.assistant`
6. `session.end`

Intermediate streaming events (`message_update`, token deltas) are suppressed to keep CI logs readable.

## Output Schema Validation (`--output-schema`)

Provide a JSON Schema file to validate the final assistant message. If the message is valid JSON, it is validated directly. Otherwise it is wrapped as `{ "text": "<message>" }` before validation, enabling schemas that match plain-text responses too.

**Exit code 2** is returned when validation fails.

```bash
# Ensure the model returns JSON with a "result" field
cat > /tmp/schema.json <<'EOF'
{
  "type": "object",
  "required": ["result"],
  "properties": {
    "result": { "type": "string" }
  }
}
EOF

mewrite exec --json --output-schema /tmp/schema.json \
  'Return JSON: {"result": "your answer here"}'
```

## Atomic File Output (`--output-last-message`)

The final assistant text is written to the given file atomically (write to a temp file, then `rename(2)`). Downstream CI steps can safely read the file without race conditions.

```bash
mewrite exec --output-last-message /tmp/answer.txt "What is 2+2?"
cat /tmp/answer.txt
```

## Ephemeral Mode (`--ephemeral`)

In ephemeral mode, `mewrite exec` ignores all user and project config files:

- `~/.mewrite/agent/settings.json` is not loaded
- `.mewrite/settings.json` in the project root is not loaded
- Extension and skill auto-discovery is disabled

This is useful for reproducible CI runs that must not be affected by a developer's local settings.

```bash
mewrite exec --ephemeral \
  --model anthropic/claude-haiku-4-5 \
  "Summarize the recent git log"
```

## Examples

```bash
# Basic single-shot run
mewrite exec "List all .ts files in src/"

# JSON mode piped to jq to extract the final answer
mewrite exec --json "What is the purpose of this codebase?" \
  | jq -r 'select(.type == "message.assistant") | .content'

# Validate structured JSON output
mewrite exec --json \
  --output-schema ./schemas/analysis.json \
  "Analyse the API surface and return JSON"

# Write result to file for downstream CI steps
mewrite exec \
  --output-last-message ./ci/analysis.txt \
  "Summarize the changes in src/"

# Completely isolated ephemeral run
mewrite exec \
  --ephemeral \
  --model anthropic/claude-haiku-4-5 \
  --timeout 60000 \
  "Hello, are you working?"

# GitHub Actions example
- name: Run mewrite exec
  run: |
    mewrite exec \
      --json \
      --output-last-message ${{ runner.temp }}/mewrite-result.txt \
      --ephemeral \
      "Review the changed files and summarise"
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Relationship to `mewrite --print` / `mewrite --mode json`

`mewrite exec` is a thin wrapper over the existing print-mode (`mewrite -p`). The key additions are:

- A cleaner subcommand surface (`mewrite exec` vs `mewrite -p`)
- Stable JSONL event schema with `session.start` / `session.end` bookends
- `--output-schema` validation with exit code 2
- `--output-last-message` atomic file write
- `--ephemeral` isolation flag
- Documented exit codes for CI error handling

The underlying agent runtime and tool set are the same.
