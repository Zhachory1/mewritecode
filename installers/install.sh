#!/usr/bin/env bash
#
# Me Write Code installer — used by the Homebrew formula and CI
# smoke tests. End users can also install via npm:
#
#   npm install -g @zhachory1/mewrite-code
#
# Extracts the full release tarball (binary + theme/, export-html/,
# photon_rs_bg.wasm, docs/, examples/) into a versioned dir and symlinks
# shims onto PATH. The bare binary alone is not enough: mewrite resolves
# companions via dirname(process.execPath).
#
# Flags (all optional):
#   --version <tag>      Install a specific tag (e.g. v0.65.2)
#   --channel <chan>     stable | beta | canary (default: stable)
#   --prefix <dir>       Install prefix (default: ~/.mewrite for non-root, /usr/local for root)
#   --no-modify-path     Skip writing PATH export to shell rcs
#   --dry-run            Print planned actions, do not download or write
#   --help               Show this help
#
# Environment knobs:
#   MEWRITE_VERSION   same as --version
#   MEWRITE_CHANNEL   same as --channel
#   MEWRITE_PREFIX    same as --prefix
#   MEWRITE_BASE_URL  override the download base (used by smoke tests)
#
# This script is idempotent: re-running it is safe and just refreshes the
# install. Older installs are pruned to KEEP_VERSIONS most recent.

set -euo pipefail

REPO="Zhachory1/mewritecode"
KEEP_VERSIONS=2
MEWRITE_CHANNEL_DEFAULT="stable"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

err() { printf 'error: %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }
log_step() { printf '  %s\n' "$*"; }

usage() {
    awk 'NR >= 3 && NR <= 28 { sub(/^# ?/, ""); print }' "$0"
    exit 0
}

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------

DRY_RUN=0
NO_MODIFY_PATH=0
MEWRITE_VERSION="${MEWRITE_VERSION:-}"
MEWRITE_CHANNEL="${MEWRITE_CHANNEL:-$MEWRITE_CHANNEL_DEFAULT}"
MEWRITE_PREFIX="${MEWRITE_PREFIX:-}"

while [ $# -gt 0 ]; do
    case "$1" in
        --version)
            [ $# -ge 2 ] || err "--version requires an argument"
            MEWRITE_VERSION="$2"
            shift 2
            ;;
        --channel)
            [ $# -ge 2 ] || err "--channel requires an argument"
            MEWRITE_CHANNEL="$2"
            shift 2
            ;;
        --prefix)
            [ $# -ge 2 ] || err "--prefix requires an argument"
            MEWRITE_PREFIX="$2"
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

case "$MEWRITE_CHANNEL" in
    stable|beta|canary) ;;
    *) err "unknown channel: $MEWRITE_CHANNEL (expected stable|beta|canary)" ;;
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
    case "$MEWRITE_CHANNEL" in
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
                | grep -E "${MEWRITE_CHANNEL}|rc|pre" \
                | head -1
            ;;
    esac
}

if [ -z "$MEWRITE_VERSION" ]; then
    MEWRITE_VERSION="$(resolve_version_for_channel || true)"
    if [ -z "$MEWRITE_VERSION" ] && [ "$MEWRITE_CHANNEL" != "stable" ]; then
        info "no ${MEWRITE_CHANNEL} release found; falling back to stable"
        MEWRITE_CHANNEL="stable"
        MEWRITE_VERSION="$(resolve_version_for_channel || true)"
    fi
    [ -n "$MEWRITE_VERSION" ] || err "could not resolve a release tag from GitHub"
fi

# ---------------------------------------------------------------------------
# Resolve prefix and paths
# ---------------------------------------------------------------------------

if [ -z "$MEWRITE_PREFIX" ]; then
    if [ "$(id -u)" = 0 ]; then
        MEWRITE_PREFIX="/usr/local"
    else
        MEWRITE_PREFIX="${HOME}/.mewrite"
    fi
fi

BASE_URL="${MEWRITE_BASE_URL:-https://github.com/${REPO}/releases/download/${MEWRITE_VERSION}}"
TARBALL="mewrite-${TRIPLE}.tar.gz"
URL="${BASE_URL}/${TARBALL}"
SUMS_URL="${BASE_URL}/SHA256SUMS"

LIB_DIR="${MEWRITE_PREFIX}/lib/mewrite"
BIN_DIR="${MEWRITE_PREFIX}/bin"
VER_DIR="${LIB_DIR}/${MEWRITE_VERSION}"

# ---------------------------------------------------------------------------
# Print plan (and exit if dry-run)
# ---------------------------------------------------------------------------

info "Me Write Code installer plan"
log_step "channel       : ${MEWRITE_CHANNEL}"
log_step "version       : ${MEWRITE_VERSION}"
log_step "platform      : ${TRIPLE}"
log_step "prefix        : ${MEWRITE_PREFIX}"
log_step "tarball       : ${URL}"
log_step "checksum file : ${SUMS_URL}"
log_step "install dir   : ${VER_DIR}"
log_step "shim          : ${BIN_DIR}/mewrite (aliases: ${BIN_DIR}/mewrite-code, ${BIN_DIR}/mewritecode)"
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

if [ -x "${VER_DIR}/mewrite" ] && [ -L "${BIN_DIR}/mewrite" ] && [ -L "${BIN_DIR}/mewrite-code" ] && [ -L "${BIN_DIR}/mewritecode" ]; then
    EXISTING="$("${VER_DIR}/mewrite" --version 2>/dev/null || true)"
    if [ -n "$EXISTING" ]; then
        info "mewrite ${MEWRITE_VERSION} already installed at ${VER_DIR}"
        info "run: mewrite update    to fetch newer releases"
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
info "Installing mewrite ${MEWRITE_VERSION} (${TRIPLE}) into ${MEWRITE_PREFIX}"

log_step "downloading ${URL}"
curl -fsSL "$URL" -o "${TMP}/${TARBALL}" || err "download failed: ${URL}"

# Optional: verify checksum if SHA256SUMS is published in the release.
if [ -n "$SHA_TOOL" ]; then
    if curl -fsSL "$SUMS_URL" -o "${TMP}/SHA256SUMS" 2>/dev/null; then
        log_step "verifying checksum"
        EXPECTED="$(awk -v file="$TARBALL" '$2 == file { print $1; exit }' "${TMP}/SHA256SUMS")"
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
[ -d "${TMP}/mewrite" ] || err "tarball missing top-level mewrite/ dir"

# Atomic-ish replace: remove old VER_DIR (if any) then move into place.
rm -rf "$VER_DIR"
mv "${TMP}/mewrite" "$VER_DIR"
chmod +x "${VER_DIR}/mewrite"

ln -sfn "${VER_DIR}/mewrite" "${BIN_DIR}/mewrite"
ln -sfn "${VER_DIR}/mewrite" "${BIN_DIR}/mewrite-code"
ln -sfn "${VER_DIR}/mewrite" "${BIN_DIR}/mewritecode"

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
    SENTINEL="# added by mewrite installer"
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
"${BIN_DIR}/mewrite" --version
