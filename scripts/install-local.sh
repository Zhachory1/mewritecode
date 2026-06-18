#!/usr/bin/env bash
#
# install-local.sh — build caveman-code from source and link it as global
# `caveman` / `caveman-code` / `mewrite` / `mewritecode` commands.
#
# Usage (from a checkout of this repo):
#   ./scripts/install-local.sh
#
# This installs deps, builds all packages, and `npm link`s the CLI so the
# `caveman` command points at THIS checkout. Re-run after pulling changes:
# only `npm run build` is needed once linked, but re-running this is safe.
#
# To uninstall:  npm unlink -g @juliusbrussee/caveman-code
#
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "==> npm install"
npm install

echo "==> npm run build"
npm run build

echo "==> npm link (registers 'caveman', 'caveman-code', 'mewrite', and 'mewritecode' globally)"
cd packages/coding-agent
npm link

echo
bin="$(command -v mewrite || command -v caveman || true)"
if [ -n "$bin" ]; then
	echo "Done. mewrite/caveman -> $bin"
	mewrite --version
	echo "Linked to this checkout: $repo_root"
	echo "If 'mewrite' is not found in new shells, ensure the npm global bin dir is on your PATH:"
	echo "  export PATH=\"\$(npm bin -g):\$PATH\""
else
	echo "Linked, but 'mewrite' is not on PATH. Add the npm global bin dir to PATH:"
	echo "  export PATH=\"\$(npm bin -g):\$PATH\""
fi
