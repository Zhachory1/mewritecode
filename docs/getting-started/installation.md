---
title: Install
description: Install Me Write Code on macOS, Linux, Windows, or in Docker.
---

# Install

npm is the primary install path. Native binaries via Homebrew, Linux packages (Debian/RPM), Docker, or direct download are also available.

<CopyForLlms />

## Canonical (npm)

Requires Node.js 20+:

```bash
npm install -g @zhachory1/mewrite-code
```

The package installs `mewrite` and `mewritecode` aliases alongside `mewrite-code`. Any works.

```bash
mewrite --version
mewrite
```

Works on macOS, Linux, Windows (PowerShell + WSL). Same package on every platform.

::: tip Faster installs
pnpm, yarn, and bun all work too:

```bash
pnpm add -g @zhachory1/mewrite-code
yarn global add @zhachory1/mewrite-code
bun add -g @zhachory1/mewrite-code
```
:::

## Other paths

::: details Homebrew (macOS, Linux)

```bash
brew tap Zhachory1/mewritecode https://github.com/Zhachory1/mewritecode
brew install mewrite
```

The tap is auto-updated by the release pipeline.

:::

::: details Debian / Ubuntu

Download the `.deb` package from [GitHub releases](https://github.com/Zhachory1/mewritecode/releases/latest) and install:

```bash
curl -LO https://github.com/Zhachory1/mewritecode/releases/latest/download/mewrite-code_<version>_amd64.deb
sudo apt install ./mewrite-code_<version>_amd64.deb
```

Also available: `mewrite-code_<version>_arm64.deb` for ARM64 systems. The primary command is `mewrite`; the package also installs `mewrite-code` and `mewritecode` aliases.

**Note:** These are individual release downloads, not repository-backed apt packages. A proper apt repository is planned for a future release.

:::

::: details Fedora / RHEL / CentOS

Download the `.rpm` package from [GitHub releases](https://github.com/Zhachory1/mewritecode/releases/latest) and install:

```bash
curl -LO https://github.com/Zhachory1/mewritecode/releases/latest/download/mewrite-code-<version>-1.x86_64.rpm
sudo dnf install ./mewrite-code-<version>-1.x86_64.rpm  # or yum
```

Also available: `mewrite-code-<version>-1.aarch64.rpm` for ARM64 systems. The primary command is `mewrite`; the package also installs `mewrite-code` and `mewritecode` aliases.

**Note:** These are individual release downloads, not repository-backed dnf/yum packages. A proper RPM repository is planned for a future release.

:::

::: details Snap (tracked, not yet published)

Snap packaging metadata is tracked in `snap/snapcraft.yaml`. Once published to the Snap Store:

```bash
sudo snap install mewrite-code --classic
```

:::

::: details Docker

```bash
docker run --rm -it -v "$PWD:/work" ghcr.io/zhachory1/mewritecode:latest
```

Mounts your working directory into `/work`. The image runs as a non-root user.

:::

::: details Windows

```powershell
npm install -g @zhachory1/mewrite-code
```

The npm package works on Windows PowerShell and WSL. WSL is the supported terminal path.

:::

::: details Manual download

Grab the platform-specific tarball from the [GitHub releases page](https://github.com/Zhachory1/mewritecode/releases) and extract to a directory on your PATH.

:::

## Verify

```bash
mewrite --version
mewrite doctor
```

`mewrite doctor` reports:

- Kernel and terminal capabilities
- Sandbox availability (Seatbelt / Landlock / Restricted Tokens)
- MCP servers reachable
- Missing tooling (git, ripgrep, fzf — used optionally for fuzzy file pickers)

## Auto-update

Me Write Code checks the GitHub releases API once per 24 hours and prompts before applying. To pin a channel:

```bash
mewrite update --channel stable    # default
mewrite update --channel beta
mewrite update --channel canary
```

To update on demand:

```bash
mewrite update
```

To roll back to the previous version:

```bash
mewrite update --rollback
```

## Uninstall

```bash
rm -rf ~/.cave
# remove the mewrite-code symlink from your PATH (~/.local/bin/mewrite or /usr/local/bin/mewrite)
```

Sessions live in `~/.cave/sessions/`. Memory (cavemem) lives in `~/.cavemem/` and is **not** removed by the above — clean it explicitly if needed.

## Headless / CI install

```bash
npm install -g @zhachory1/mewrite-code@0.65.2   # pin a version for reproducible CI
```

See [`mewrite exec` mode](/cookbook) for using mewrite inside GitHub Actions.
