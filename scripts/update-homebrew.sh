#!/usr/bin/env bash
#
# Rewrite Homebrew formulas with version + sha256s for the four unix tarballs.
#
# Usage:
#   ./scripts/update-homebrew.sh <version> <dir-with-tarballs>
#
#   <version>            e.g. v0.65.3 or 0.65.3 (leading v is stripped)
#   <dir-with-tarballs>  directory containing cave-{darwin-arm64,darwin-x64,linux-x64,linux-arm64}.tar.gz

set -euo pipefail

VERSION="${1:?version required}"
TAR_DIR="${2:?tarball dir required}"
VERSION="${VERSION#v}"

cd "$(dirname "$0")/.."
FORMULAS=(Formula/mewrite.rb Formula/cave.rb)

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

DARWIN_ARM64_SHA="$(sha256_of "${TAR_DIR}/cave-darwin-arm64.tar.gz")"
DARWIN_X64_SHA="$(sha256_of "${TAR_DIR}/cave-darwin-x64.tar.gz")"
LINUX_ARM64_SHA="$(sha256_of "${TAR_DIR}/cave-linux-arm64.tar.gz")"
LINUX_X64_SHA="$(sha256_of "${TAR_DIR}/cave-linux-x64.tar.gz")"

# macOS/BSD sed differs from GNU sed on -i; handle both.
sed_inplace() {
    if sed --version >/dev/null 2>&1; then
        sed -i "$@"
    else
        sed -i '' "$@"
    fi
}

for formula in "${FORMULAS[@]}"; do
    sed_inplace -E "s/^(  version )\".*\"/\\1\"${VERSION}\"/" "$formula"

    # Each on_arm/on_intel block has exactly one sha256 line — replace by matching the
    # preceding url line's triple.
    python3 - "$formula" "$DARWIN_ARM64_SHA" "$DARWIN_X64_SHA" "$LINUX_ARM64_SHA" "$LINUX_X64_SHA" <<'PY'
import re, sys
path, da, dx, la, lx = sys.argv[1:]
src = open(path).read()
mapping = {
    "cave-darwin-arm64.tar.gz": da,
    "cave-darwin-x64.tar.gz":   dx,
    "cave-linux-arm64.tar.gz":  la,
    "cave-linux-x64.tar.gz":    lx,
}
pat = re.compile(r'(url ".*?/(cave-[a-z0-9-]+\.tar\.gz)"\s*\n\s*sha256 ")[^"]*(")', re.M)
def repl(m):
    tri = m.group(2)
    return m.group(1) + mapping[tri] + m.group(3)
new = pat.sub(repl, src)
if new == src:
    sys.exit("no sha256 lines rewritten — formula may have drifted")
open(path, "w").write(new)
PY

    echo "Updated ${formula} to version ${VERSION}"
    grep -E '^(  version|      sha256)' "$formula"
done
