#!/usr/bin/env bash
#
# cave hook recipe — auto-test-on-stop
# Wire as Stop hook (no matcher).
#
# Runs the project's test command at the end of a turn and feeds the
# output back to the assistant via stdout-as-context. Detects:
#   - npm: package.json with "test" script
#   - cargo: Cargo.toml
#   - pytest: pyproject.toml or tests/ directory
#   - go test: go.mod
# Skips silently when no test command is detected.

set -u

cd "${CAVE_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$PWD}}" || exit 0

run() {
  echo "[cave auto-test-on-stop] $*"
  out=$("$@" 2>&1)
  ec=$?
  if [ $ec -eq 0 ]; then
    # Trim noisy passing output.
    echo "$out" | tail -n 5
  else
    # Fail loud — assistant gets the full failing output as context.
    echo "$out"
    # exit 0 still — auto-test is advisory, not blocking.
  fi
}

if [ -f package.json ] && grep -q '"test"' package.json 2>/dev/null; then
  run npm test --silent --if-present
  exit 0
fi
if [ -f Cargo.toml ]; then
  run cargo test --quiet
  exit 0
fi
if [ -f pyproject.toml ] || [ -d tests ]; then
  if command -v pytest >/dev/null 2>&1; then
    run pytest -q
    exit 0
  fi
fi
if [ -f go.mod ]; then
  run go test ./...
  exit 0
fi

# Nothing to run — stay silent.
exit 0
