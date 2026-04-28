#!/usr/bin/env bash
#
# cave hook recipe — conventional-commit-gate
# Wire as PreToolUse hook, matcher: "Bash".
#
# Inspects bash commands the agent is about to run and blocks
# non-conventional commits via permissionDecision: "deny".
#
# Conventional Commits 1.0.0 prefixes:
#   feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
#
# Anything matching `git commit -m "<message>"` (including --amend / -am)
# is parsed; if the first line of <message> doesn't begin with one of the
# allowed prefixes (or `<prefix>(scope):` / `<prefix>!:`), the hook denies.

set -u

input=$(cat)

cmd=$(printf '%s' "$input" | python3 -c '
import json, sys
try:
  d = json.load(sys.stdin)
  if d.get("tool_name") != "Bash":
    print(""); raise SystemExit
  print((d.get("tool_input") or {}).get("command", ""))
except Exception:
  print("")
' 2>/dev/null)

if [ -z "$cmd" ]; then
  exit 0
fi

# Only inspect git-commit invocations.
if ! printf '%s' "$cmd" | grep -qE '(^|[[:space:]])git[[:space:]]+(commit|c)[[:space:]]'; then
  exit 0
fi

# Extract the message body from -m "..." or -am "...".
msg=$(printf '%s' "$cmd" | python3 -c '
import re, sys
s = sys.stdin.read()
m = re.search(r"""-(?:a)?m\s+(\"([^\"\\\\]*(?:\\\\.[^\"\\\\]*)*)\"|\x27([^\x27]*)\x27)""", s)
if not m:
  print(""); raise SystemExit
print(m.group(2) or m.group(3) or "")
' 2>/dev/null)

if [ -z "$msg" ]; then
  # No message yet (interactive editor) — let it through; nothing to inspect.
  exit 0
fi

first_line=$(printf '%s' "$msg" | head -n 1)

if printf '%s' "$first_line" | grep -qE '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?:[[:space:]]'; then
  # Pass — message is conventional.
  exit 0
fi

cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Commit message does not follow Conventional Commits 1.0.0. Use a `<type>(scope?): <subject>` prefix where type ∈ {feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert}."
  }
}
JSON
exit 2
