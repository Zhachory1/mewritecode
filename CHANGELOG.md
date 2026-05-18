# Changelog

All notable changes to Caveman Code are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release notes from `v0.30.0` onwards are auto-generated from
[Conventional Commits](https://www.conventionalcommits.org/) on tag push.

## [Unreleased]

### Added

- **Docs site** — VitePress source under `docs/` (deploy target:
  `getcaveman.dev`). Sections: Quickstart, Install, Auth, Models,
  Tools, Slash Commands, Skills, Subagents, Memory (cavemem), MCP, Hooks,
  Permissions, Plan Mode, Daemon, Recipes, Migration (Claude Code / Codex
  / Aider), Cookbook, Comparison, Troubleshooting, API.
- **`llms.txt`** — root-level LLM-friendly index of the documentation, with a
  per-page "Copy for LLMs" button that strips chrome and reports an estimated
  token count.
- **VHS tape files** — five `vhs/*.tape` recordings for the README and docs:
  install + first prompt, Caveman Mode A/B, plan/act flow, session branching,
  extension hot-load.
- **Comparison page** — Caveman Code vs Claude Code / Codex / Aider / Crush /
  opencode, sourced from the v2 master plan §3.
- **Migration guides** — zero-migration playbooks for Claude Code, Codex,
  and Aider users.
- **README rewrite** — single canonical install (`npm install -g caveman-code`),
  "I want to..." router, link to comparison, link to Discord, monorepo table
  at the bottom.

### Changed

- README install section consolidated to a single canonical line; alternate
  installers (Homebrew, npm, Docker, manual) live behind a disclosure.

### Removed

- Astro Starlight scaffold under `docs/src/` and `docs/astro.config.mjs` —
  superseded by the VitePress structure.

## [0.30.2] — 2026-04-26

(Auto-generated from conventional commits at release time.)

### Added

- Token-blend ambient theme with terminal-blend transparent background.
- Fullscreen viewport bounds (Tier 0 primitives).

### Fixed

- `token-verifier.ts` rebrand cleanup.

## [0.30.1] — 2026-04-13

### Changed

- Rebrand `pi` → `caveman`. Models and tests updated.

## [0.30.0] — 2026-04-08

### Added

- Release pipeline, installers (`install.sh`, `install.ps1`), Homebrew
  formula, GitHub Actions release workflow.
- Initial monorepo layout: `caveman`, `@caveman-code/ai`, `@caveman-code/agent`, `@caveman-code/tui`,
  `@caveman-code/web-ui`, `@caveman-code/mom`, `@caveman-code/pods`.

[Unreleased]: https://github.com/JuliusBrussee/caveman-cli/compare/v0.30.2...HEAD
[0.30.2]: https://github.com/JuliusBrussee/caveman-cli/compare/v0.30.1...v0.30.2
[0.30.1]: https://github.com/JuliusBrussee/caveman-cli/compare/v0.30.0...v0.30.1
[0.30.0]: https://github.com/JuliusBrussee/caveman-cli/releases/tag/v0.30.0
