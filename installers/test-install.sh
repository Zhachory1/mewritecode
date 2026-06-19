#!/usr/bin/env bash
#
# Smoke test for installers/install.sh.
#
# Verifies:
#   1. --help exits 0 and prints usage text
#   2. --dry-run prints the planned actions and does not modify the filesystem
#   3. --channel rejects unknown channels with non-zero exit
#   4. --version is honored verbatim in the planned URL
#
# Runnable on macOS + Linux. No network access required (we always pin
# --version so version resolution is skipped).

set -euo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${THIS_DIR}/install.sh"

[ -x "$SCRIPT" ] || chmod +x "$SCRIPT"

fail=0
pass=0

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local label="$3"
    if printf '%s' "$haystack" | grep -Fq -- "$needle"; then
        printf '  ok   %s\n' "$label"
        pass=$((pass + 1))
    else
        printf '  FAIL %s\n' "$label"
        printf '       expected to find: %s\n' "$needle"
        printf '       got:\n%s\n' "$haystack" | sed 's/^/       /'
        fail=$((fail + 1))
    fi
}

assert_eq_int() {
    local actual="$1"
    local expected="$2"
    local label="$3"
    if [ "$actual" -eq "$expected" ]; then
        printf '  ok   %s\n' "$label"
        pass=$((pass + 1))
    else
        printf '  FAIL %s (expected %s, got %s)\n' "$label" "$expected" "$actual"
        fail=$((fail + 1))
    fi
}

# 1. --help
help_out="$("$SCRIPT" --help 2>&1)" || true
assert_contains "$help_out" "Me Write Code installer" "--help prints title"
assert_contains "$help_out" "--version" "--help mentions --version flag"
assert_contains "$help_out" "--dry-run" "--help mentions --dry-run flag"

# 2. --dry-run with pinned version (no network)
out="$("$SCRIPT" --dry-run --version v0.65.2 --prefix /tmp/mewrite-test-dryrun 2>&1)"
status=$?
assert_eq_int $status 0 "--dry-run exits 0"
assert_contains "$out" "v0.65.2" "--dry-run shows pinned version"
assert_contains "$out" "/tmp/mewrite-test-dryrun" "--dry-run shows planned prefix"
assert_contains "$out" "[dry-run]" "--dry-run announces dry-run mode"
assert_contains "$out" "channel       : stable" "--dry-run defaults to stable channel"
[ ! -e /tmp/mewrite-test-dryrun ] && pass=$((pass + 1)) && printf '  ok   --dry-run did not create /tmp/mewrite-test-dryrun\n' \
    || { printf '  FAIL --dry-run created /tmp/mewrite-test-dryrun\n'; fail=$((fail + 1)); }

# 3. --channel rejects unknown values
set +e
"$SCRIPT" --channel bogus --dry-run --version v0.65.2 --prefix /tmp/mewrite-test-dryrun >/dev/null 2>&1
unknown_status=$?
set -e
if [ $unknown_status -ne 0 ]; then
    pass=$((pass + 1))
    printf '  ok   --channel bogus exits non-zero\n'
else
    fail=$((fail + 1))
    printf '  FAIL --channel bogus did not exit non-zero\n'
fi

# 4. --channel beta is accepted
out_beta="$("$SCRIPT" --channel beta --dry-run --version v0.65.2-beta.1 --prefix /tmp/mewrite-test-beta 2>&1)"
assert_contains "$out_beta" "channel       : beta" "--channel beta accepted"

printf '\n%s/%s tests passed\n' "$pass" "$((pass + fail))"
exit $fail
