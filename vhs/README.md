# VHS recordings

Each `*.tape` file in this directory compiles to a GIF used in the
[README](../README.md) and the docs site.

## Prerequisite

Install [`charmbracelet/vhs`](https://github.com/charmbracelet/vhs):

```bash
brew install vhs           # macOS
go install github.com/charmbracelet/vhs@latest
```

VHS also needs `ffmpeg` and `ttyd` on your PATH. The `brew install vhs`
formula installs both.

## Re-record locally

```bash
cd vhs/
vhs install.tape           # outputs install.gif
vhs cave-mode-ab.tape
vhs plan-act.tape
vhs session-tree.tape
vhs extension-hotload.tape
```

The output GIFs land next to each tape. Move them under `docs/public/`
or `packages/coding-agent/docs/images/` as referenced.

## Re-record in CI

Tapes are re-recorded on tag push by `.github/workflows/release.yml`.
The workflow installs vhs, runs each tape, uploads the GIFs as release
artifacts, and bumps the references in `README.md` and the docs site.

## Tape inventory

| File | What it shows | Length target |
|---|---|---|
| `install.tape` | curl-bash install, first prompt | 30s |
| `cave-mode-ab.tape` | Caveman Mode vs Claude Code with token counter | 45s |
| `plan-act.tape` | `/plan` → review → `/act` flow | 40s |
| `session-tree.tape` | `/tree` and `/fork` session branching | 30s |
| `extension-hotload.tape` | Drop a skill into `.cave/skills/` and watch it load | 25s |

## Notes for tape authors

- Use `Set Shell "bash"` to keep prompts identical across machines.
- Use `Set TypingSpeed 50ms` for readability.
- Use `Set FontSize 16` for crisp rendering on retina screens.
- Wrap each scene in a comment so reviewers can scan the tape.
- Pre-set `ANTHROPIC_API_KEY=...` in the recording env via `Env`.
