# Bun Single Binary Build

T-138: Produce a single-file Bun-compiled binary for:

- darwin-arm64
- darwin-x64
- linux-arm64
- linux-x64

Each artifact must be ≤ 80 MB and pass a `--version` smoke test.

## Build

```bash
bun build packages/coding-agent/src/cli.ts \
  --compile \
  --target=bun-darwin-arm64 \
  --outfile=dist/mewrite-darwin-arm64
```

Repeat for each target triple. Run `dist/mewrite-<triple> --version` after each
build; exit code 0 + output containing the semver is the smoke gate.

## Distribution channels (T-139)

- npm: `npm install -g @zhachory1/mewrite-code` (primary install path)
- brew: `brew install mewrite-code` (tap at `Zhachory1/mewritecode`)
- docker: `ghcr.io/zhachory1/mewritecode:latest`

Each channel has a post-install smoke test: `mewrite --version` must exit 0
and print the current version string. Failing smoke fails the release.
