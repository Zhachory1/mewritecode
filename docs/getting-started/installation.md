---
title: Install
description: Install Caveman Code on macOS, Linux, Windows, or in Docker.
---

# Install

The canonical install is the curl-bash one-liner. Everything else is a fallback for users who can't or won't run it.

<CopyForLlms />

## Canonical

```bash
curl -fsSL https://cave.sh/install | bash
```

This:

1. Detects your OS and architecture (macOS Intel / ARM, Linux x86_64 / ARM64).
2. Downloads the latest release tarball from GitHub releases.
3. Extracts to `~/.cave/versions/<tag>/` (or `/usr/local/lib/cave/<tag>/` for root installs).
4. Symlinks the `caveman` binary onto your PATH.
5. Keeps the **last 2 versions** so you can `caveman update --rollback`.

The script is idempotent — running it again upgrades in place.

## Other paths

::: details Homebrew (macOS, Linux)

```bash
brew tap juliusbrussee/cave https://github.com/JuliusBrussee/caveman-cli
brew install caveman
```

The tap is auto-updated by the release pipeline.

:::

::: details npm (any platform with Node 20+)

```bash
npm install -g caveman-code
```

This installs Caveman Code as an npm package. Useful in CI where Node is already available.

:::

::: details Docker

```bash
docker run --rm -it -v "$PWD:/work" ghcr.io/juliusbrussee/caveman-cli:latest
```

Mounts your working directory into `/work`. The image runs as a non-root user.

:::

::: details Windows (PowerShell)

```powershell
irm https://cave.sh/install.ps1 | iex
```

Native Windows support is a preview. WSL is the supported path; the PS installer covers basic terminal usage.

:::

::: details Manual download

Grab the platform-specific tarball from the [GitHub releases page](https://github.com/JuliusBrussee/caveman-cli/releases) and extract to a directory on your PATH.

:::

## Verify

```bash
caveman --version
caveman doctor
```

`caveman doctor` reports:

- Kernel and terminal capabilities
- Sandbox availability (Seatbelt / Landlock / Restricted Tokens)
- MCP servers reachable
- Missing tooling (git, ripgrep, fzf — used optionally for fuzzy file pickers)

## Auto-update

Caveman Code checks the GitHub releases API once per 24 hours and prompts before applying. To pin a channel:

```bash
caveman update --channel stable    # default
caveman update --channel beta
caveman update --channel canary
```

To update on demand:

```bash
caveman update
```

To roll back to the previous version:

```bash
caveman update --rollback
```

## Uninstall

```bash
rm -rf ~/.cave
# remove the caveman-code symlink from your PATH (~/.local/bin/cave or /usr/local/bin/cave)
```

Sessions live in `~/.cave/sessions/`. Memory (cavemem) lives in `~/.cavemem/` and is **not** removed by the above — clean it explicitly if needed.

## Headless / CI install

```bash
curl -fsSL https://cave.sh/install | CAVE_VERSION=v0.30.2 CAVE_NO_PROMPT=1 bash
```

Pin the version for reproducible CI. See [`caveman exec` mode](/cookbook#cave-exec-in-github-actions) for using caveman inside GitHub Actions.
