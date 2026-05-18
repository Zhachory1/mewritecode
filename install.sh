#!/usr/bin/env bash
#
# Cave installer (repo-root shim).
#
# The canonical installer lives at `installers/install.sh`. This shim
# preserves backward compatibility for existing CI/docs that referenced
# `install.sh` at the repository root.
#
# Webserver entrypoint: https://getcaveman.dev/install -> installers/install.sh
#
# Forwards every flag and env var verbatim.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/installers/install.sh" "$@"
