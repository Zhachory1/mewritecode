#!/usr/bin/env bash
#
# Caveman Code tarball installer — used by the Homebrew formula and CI
# smoke tests. End users should install via npm:
#
#   npm install -g @juliusbrussee/caveman-code
#
# Extracts the full release tarball (binary + theme/, export-html/,
# photon_rs_bg.wasm, docs/, examples/) into a versioned dir and symlinks
# a shim onto PATH. The bare binary alone is not enough: cave resolves
# companions via dirname(process.execPath).
#
# Flags (all optional):
#   --version <tag>      Install a specific tag (e.g. v0.65.2)
#   --channel <chan>     stable | beta | canary (default: stable)
#   --prefix <dir>       Install prefix (default: ~/.cave for non-root, /usr/local for root)
#   --no-modify-path     Skip writing PATH export to shell rcs
#   --dry-run            Print planned actions, do not download or write
#   --help               Show this help
#
# Environment knobs (preserved for backward compatibility):
#   CAVE_VERSION   same as --version
#   CAVE_CHANNEL   same as --channel
#   CAVE_PREFIX    same as --prefix
#   CAVE_BASE_URL  override the download base (used by smoke tests)
#
# This script is idempotent: re-running it is safe and just refreshes the
# install. Older installs are pruned to KEEP_VERSIONS most recent.

set -euo pipefail

REPO="JuliusBrussee/caveman-cli"
KEEP_VERSIONS=2
CAVE_CHANNEL_DEFAULT="stable"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

err() { printf 'error: %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }
log_step() { printf '  %s\n' "$*"; }

usage() {
    sed -n '3,28p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
}

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------

DRY_RUN=0
NO_MODIFY_PATH=0
CAVE_VERSION="${CAVE_VERSION:-}"
CAVE_CHANNEL="${CAVE_CHANNEL:-$CAVE_CHANNEL_DEFAULT}"
CAVE_PREFIX="${CAVE_PREFIX:-}"

while [ $# -gt 0 ]; do
    case "$1" in
        --version)
            [ $# -ge 2 ] || err "--version requires an argument"
            CAVE_VERSION="$2"
            shift 2
            ;;
        --channel)
            [ $# -ge 2 ] || err "--channel requires an argument"
            CAVE_CHANNEL="$2"
            shift 2
            ;;
        --prefix)
            [ $# -ge 2 ] || err "--prefix requires an argument"
            CAVE_PREFIX="$2"
            shift 2
            ;;
        --no-modify-path)
            NO_MODIFY_PATH=1
            shift
            ;;
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            err "unknown flag: $1 (use --help for usage)"
            ;;
    esac
done

case "$CAVE_CHANNEL" in
    stable|beta|canary) ;;
    *) err "unknown channel: $CAVE_CHANNEL (expected stable|beta|canary)" ;;
esac

# ---------------------------------------------------------------------------
# Detect platform / arch
# ---------------------------------------------------------------------------

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$OS" in
    darwin|linux) ;;
    msys*|mingw*|cygwin*)
        err "Windows detected. Use install.ps1 in PowerShell, or install via WSL." ;;
    *) err "unsupported OS: $OS (use install.ps1 on Windows)" ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
    aarch64|arm64) ARCH="arm64" ;;
    x86_64|amd64)  ARCH="x64" ;;
    *) err "unsupported architecture: $ARCH" ;;
esac

TRIPLE="${OS}-${ARCH}"

# Tooling required to operate
require_tool() {
    command -v "$1" >/dev/null 2>&1 || err "missing required tool: $1"
}
require_tool curl
require_tool tar
require_tool uname
# sha256 verification is optional but preferred — fall back gracefully
SHA_TOOL=""
if command -v sha256sum >/dev/null 2>&1; then
    SHA_TOOL="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
    SHA_TOOL="shasum -a 256"
fi

# ---------------------------------------------------------------------------
# Resolve version (channel-aware)
# ---------------------------------------------------------------------------

resolve_version_for_channel() {
    case "$CAVE_CHANNEL" in
        stable)
            curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
                | grep '"tag_name"' | head -1 | cut -d'"' -f4
            ;;
        beta|canary)
            # Pre-releases: pick newest tag whose name contains the channel.
            # GitHub lists newest first.
            curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=20" \
                | grep '"tag_name"' \
                | cut -d'"' -f4 \
                | grep -E "${CAVE_CHANNEL}|rc|pre" \
                | head -1
            ;;
    esac
}

if [ -z "$CAVE_VERSION" ]; then
    CAVE_VERSION="$(resolve_version_for_channel || true)"
    if [ -z "$CAVE_VERSION" ] && [ "$CAVE_CHANNEL" != "stable" ]; then
        info "no ${CAVE_CHANNEL} release found; falling back to stable"
        CAVE_CHANNEL="stable"
        CAVE_VERSION="$(resolve_version_for_channel || true)"
    fi
    [ -n "$CAVE_VERSION" ] || err "could not resolve a release tag from GitHub"
fi

# ---------------------------------------------------------------------------
# Resolve prefix and paths
# ---------------------------------------------------------------------------

if [ -z "$CAVE_PREFIX" ]; then
    if [ "$(id -u)" = 0 ]; then
        CAVE_PREFIX="/usr/local"
    else
        CAVE_PREFIX="${HOME}/.cave"
    fi
fi

BASE_URL="${CAVE_BASE_URL:-https://github.com/${REPO}/releases/download/${CAVE_VERSION}}"
TARBALL="cave-${TRIPLE}.tar.gz"
URL="${BASE_URL}/${TARBALL}"
SUMS_URL="${BASE_URL}/SHA256SUMS"

LIB_DIR="${CAVE_PREFIX}/lib/cave"
BIN_DIR="${CAVE_PREFIX}/bin"
VER_DIR="${LIB_DIR}/${CAVE_VERSION}"

# ---------------------------------------------------------------------------
# Print plan (and exit if dry-run)
# ---------------------------------------------------------------------------

info "Cave installer plan"
log_step "channel       : ${CAVE_CHANNEL}"
log_step "version       : ${CAVE_VERSION}"
log_step "platform      : ${TRIPLE}"
log_step "prefix        : ${CAVE_PREFIX}"
log_step "tarball       : ${URL}"
log_step "checksum file : ${SUMS_URL}"
log_step "install dir   : ${VER_DIR}"
log_step "shim          : ${BIN_DIR}/cave (aliases: ${BIN_DIR}/caveman, ${BIN_DIR}/mewrite, ${BIN_DIR}/mewritecode)"
log_step "modify PATH   : $([ "$NO_MODIFY_PATH" = 1 ] && echo no || echo yes)"
log_step "checksum tool : ${SHA_TOOL:-(none — verification will be skipped)}"

if [ "$DRY_RUN" = 1 ]; then
    info ""
    info "[dry-run] no files will be downloaded or written."
    exit 0
fi

# ---------------------------------------------------------------------------
# Idempotency: short-circuit if VER_DIR already has the binary
# ---------------------------------------------------------------------------

if [ -x "${VER_DIR}/cave" ] && [ -L "${BIN_DIR}/cave" ] && [ -L "${BIN_DIR}/caveman" ] && [ -L "${BIN_DIR}/mewrite" ] && [ -L "${BIN_DIR}/mewritecode" ]; then
    EXISTING="$("${VER_DIR}/cave" --version 2>/dev/null || true)"
    if [ -n "$EXISTING" ]; then
        info "cave ${CAVE_VERSION} already installed at ${VER_DIR}"
        info "run: cave update    to fetch newer releases"
        exit 0
    fi
fi

# ---------------------------------------------------------------------------
# Download + verify + install
# ---------------------------------------------------------------------------

mkdir -p "$LIB_DIR" "$BIN_DIR"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

info ""
info "Installing cave ${CAVE_VERSION} (${TRIPLE}) into ${CAVE_PREFIX}"

log_step "downloading ${URL}"
curl -fsSL "$URL" -o "${TMP}/${TARBALL}" || err "download failed: ${URL}"

# Optional: verify checksum if SHA256SUMS is published in the release.
if [ -n "$SHA_TOOL" ]; then
    if curl -fsSL "$SUMS_URL" -o "${TMP}/SHA256SUMS" 2>/dev/null; then
        log_step "verifying checksum"
        EXPECTED="$(grep " \+${TARBALL}\$" "${TMP}/SHA256SUMS" | awk '{print $1}' | head -1)"
        if [ -z "$EXPECTED" ]; then
            log_step "warning: ${TARBALL} not listed in SHA256SUMS — skipping verification"
        else
            ACTUAL="$( ($SHA_TOOL "${TMP}/${TARBALL}" 2>/dev/null) | awk '{print $1}')"
            if [ "$EXPECTED" != "$ACTUAL" ]; then
                err "checksum mismatch for ${TARBALL}: expected ${EXPECTED}, got ${ACTUAL}"
            fi
            log_step "checksum ok"
        fi
    else
        log_step "warning: no SHA256SUMS published for this release — skipping verification"
    fi
else
    log_step "warning: no sha256 tool available — skipping verification"
fi

log_step "extracting"
tar -xzf "${TMP}/${TARBALL}" -C "$TMP"
[ -d "${TMP}/cave" ] || err "tarball missing top-level cave/ dir"

# Atomic-ish replace: remove old VER_DIR (if any) then move into place.
rm -rf "$VER_DIR"
mv "${TMP}/cave" "$VER_DIR"
chmod +x "${VER_DIR}/cave"

ln -sfn "${VER_DIR}/cave" "${BIN_DIR}/cave"
ln -sfn "${VER_DIR}/cave" "${BIN_DIR}/caveman"
ln -sfn "${VER_DIR}/cave" "${BIN_DIR}/mewrite"
ln -sfn "${VER_DIR}/cave" "${BIN_DIR}/mewritecode"

# Prune older versions, keep most recent KEEP_VERSIONS (the one we just wrote
# stays via mtime).
if [ -d "$LIB_DIR" ]; then
    # shellcheck disable=SC2012
    ls -1t "$LIB_DIR" 2>/dev/null | tail -n +"$((KEEP_VERSIONS + 1))" | while read -r old; do
        log_step "pruning old version: $old"
        rm -rf "${LIB_DIR:?}/${old}"
    done
fi

# ---------------------------------------------------------------------------
# PATH update (non-root, idempotent)
# ---------------------------------------------------------------------------

if [ "$NO_MODIFY_PATH" = 0 ] && [ "$BIN_DIR" != "/usr/local/bin" ] \
        && ! printf '%s' "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
    SENTINEL="# added by cave installer"
    LINE="export PATH=\"${BIN_DIR}:\$PATH\""
    UPDATED=""
    for rc in "${HOME}/.zshrc" "${HOME}/.bashrc" "${HOME}/.profile"; do
        [ -f "$rc" ] || continue
        if ! grep -Fqx "$SENTINEL" "$rc"; then
            printf '\n%s\n%s\n' "$SENTINEL" "$LINE" >> "$rc"
            UPDATED="${UPDATED} ${rc}"
        fi
    done
    if [ -n "$UPDATED" ]; then
        info ""
        info "Added ${BIN_DIR} to PATH in:${UPDATED}"
        info "Open a new shell or run: ${LINE}"
    else
        info ""
        info "Add ${BIN_DIR} to your PATH:"
        info "  ${LINE}"
    fi
fi

info ""
info "Installed: ${VER_DIR}"
"${BIN_DIR}/cave" --version
