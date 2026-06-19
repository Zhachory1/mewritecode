#!/usr/bin/env bash
#
# Local installer smoke test: build the host-platform tarball, serve it over
# HTTP, run install.sh against it into a temp prefix, then exercise --version.
#
# Run via: npm run smoke:install

set -euo pipefail

cd "$(dirname "$0")/.."

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
    aarch64|arm64) ARCH="arm64" ;;
    x86_64|amd64)  ARCH="x64" ;;
    *) echo "unsupported arch: $ARCH" >&2; exit 1 ;;
esac
TRIPLE="${OS}-${ARCH}"

echo "==> Building tarball for ${TRIPLE}"
./scripts/build-binaries.sh --platform "$TRIPLE"

ARCHIVES="$PWD/packages/coding-agent/binaries"
PREFIX="$(mktemp -d)/mewrite-smoke"

echo "==> Serving archives at http://localhost:8765"
( cd "$ARCHIVES" && python3 -m http.server 8765 >/tmp/mewrite-smoke-http.log 2>&1 ) &
HTTP_PID=$!
trap 'kill "$HTTP_PID" 2>/dev/null || true' EXIT
sleep 1

echo "==> Running installer (PREFIX=${PREFIX})"
MEWRITE_VERSION=smoke MEWRITE_BASE_URL=http://localhost:8765 MEWRITE_PREFIX="$PREFIX" bash install.sh

echo "==> Smoke check"
"$PREFIX/bin/mewrite" --version

echo ""
echo "OK — installed to $PREFIX"
