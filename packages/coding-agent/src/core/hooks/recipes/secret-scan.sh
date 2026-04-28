#!/usr/bin/env bash
#
# cave hook recipe — secret-scan
# Wire as PreToolUse hook, matcher: "Write|Edit".
#
# Scans the proposed file content for high-confidence secret patterns and
# denies the Write/Edit if any match. A small, conservative ruleset —
# tuned for "definitely a leak" rather than "looks like one":
#
#   - AWS access key   AKIA[0-9A-Z]{16}
#   - GitHub token     ghp_[0-9A-Za-z]{36,255}
#   - GitHub fine-grain github_pat_[0-9A-Za-z_]{82,}
#   - OpenAI API key   sk-[0-9A-Za-z]{20,}T3BlbkFJ[0-9A-Za-z]{20,}
#   - Anthropic API    sk-ant-[0-9A-Za-z\-_]{80,}
#   - Slack bot token  xox[baprs]-[0-9A-Za-z\-]{10,}
#   - PEM private key  -----BEGIN .+ PRIVATE KEY-----
#
# Returns permissionDecision: "deny" with a list of matched rules.

set -u

input=$(cat)

content=$(printf '%s' "$input" | python3 -c '
import json, sys
try:
  d = json.load(sys.stdin)
  if d.get("tool_name") not in ("Write", "Edit"):
    print(""); raise SystemExit
  ti = d.get("tool_input") or {}
  if d.get("tool_name") == "Write":
    print(ti.get("content", ""))
  else:
    print(ti.get("new_string", ""))
except Exception:
  print("")
' 2>/dev/null)

if [ -z "$content" ]; then
  exit 0
fi

matches=""

scan() {
  local label="$1"
  local pattern="$2"
  if printf '%s' "$content" | grep -E -q "$pattern"; then
    matches="${matches}- ${label}\n"
  fi
}

scan "AWS access key"          'AKIA[0-9A-Z]{16}'
scan "GitHub token"            'ghp_[0-9A-Za-z]{36,255}'
scan "GitHub fine-grain PAT"   'github_pat_[0-9A-Za-z_]{82,}'
scan "OpenAI API key"          'sk-[0-9A-Za-z]{20,}T3BlbkFJ[0-9A-Za-z]{20,}'
scan "Anthropic API key"       'sk-ant-[0-9A-Za-z_-]{80,}'
scan "Slack bot token"         'xox[baprs]-[0-9A-Za-z-]{10,}'
scan "Private key (PEM)"       '-----BEGIN [A-Z ]*PRIVATE KEY-----'

if [ -z "$matches" ]; then
  exit 0
fi

reason=$(printf 'Refusing to write file: detected high-confidence secret pattern(s):\n%b' "$matches")

# JSON envelope first, then exit 2 to make the deny stick even if the
# JSON is malformed for any reason.
python3 -c "
import json, sys
print(json.dumps({
  'hookSpecificOutput': {
    'hookEventName': 'PreToolUse',
    'permissionDecision': 'deny',
    'permissionDecisionReason': '''$reason'''
  }
}))
" 2>/dev/null || cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Refusing to write file: detected high-confidence secret pattern."
  }
}
JSON

exit 2
