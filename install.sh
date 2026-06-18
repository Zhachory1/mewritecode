#!/usr/bin/env bash
#
# Me Write Code tarball installer (repo-root shim).
#
# End users: install via npm — `npm install -g @zhachory1/mewrite-code`.
#
# This shell installer is used by the Homebrew formula and CI smoke tests
# to verify the release tarball. The canonical script lives at
# `installers/install.sh`; this shim forwards every flag and env var.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/installers/install.sh" "$@"
