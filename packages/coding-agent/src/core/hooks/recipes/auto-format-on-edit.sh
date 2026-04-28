#!/usr/bin/env bash
#
# cave hook recipe — auto-format-on-edit
# Wire as PostToolUse hook, matcher: "Edit|Write".
#
# Reads the standard cave/Claude Code stdin payload, extracts the touched
# file_path, and runs the appropriate formatter:
#   *.{ts,tsx,js,jsx,json,css,md} → biome (cave's house formatter)
#   *.py                          → ruff format
#   *.go                          → gofmt -w
#   *.rs                          → rustfmt
#   anything else                 → no-op
#
# Exit 0 always. Stdout is treated as additional context by cave.

set -u

input=$(cat)
file_path=$(printf '%s' "$input" | python3 -c '
import json, sys
try:
  d = json.load(sys.stdin)
  print((d.get("tool_input") or {}).get("file_path", ""))
except Exception:
  pass
' 2>/dev/null)

if [ -z "$file_path" ] || [ ! -f "$file_path" ]; then
  exit 0
fi

case "$file_path" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.css|*.md)
    if command -v biome >/dev/null 2>&1; then
      biome format --write "$file_path" >/dev/null 2>&1 || true
      echo "[cave] biome formatted ${file_path}"
    elif command -v prettier >/dev/null 2>&1; then
      prettier --write "$file_path" >/dev/null 2>&1 || true
      echo "[cave] prettier formatted ${file_path}"
    fi
    ;;
  *.py)
    if command -v ruff >/dev/null 2>&1; then
      ruff format "$file_path" >/dev/null 2>&1 || true
      echo "[cave] ruff formatted ${file_path}"
    elif command -v black >/dev/null 2>&1; then
      black -q "$file_path" >/dev/null 2>&1 || true
      echo "[cave] black formatted ${file_path}"
    fi
    ;;
  *.go)
    command -v gofmt >/dev/null 2>&1 && gofmt -w "$file_path" >/dev/null 2>&1 && echo "[cave] gofmt ${file_path}"
    ;;
  *.rs)
    command -v rustfmt >/dev/null 2>&1 && rustfmt --quiet "$file_path" >/dev/null 2>&1 && echo "[cave] rustfmt ${file_path}"
    ;;
esac

exit 0
