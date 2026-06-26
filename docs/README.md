# Me Write Code Docs

VitePress source for the configured Me Write Code docs site.

## Local dev

```bash
cd docs/
npm install
npm run dev          # http://localhost:5173/docs/
```

## Build

```bash
npm run build        # outputs to docs/.vitepress/dist/
npm run preview      # serves the built site
```

## Structure

| Path | Purpose |
|---|---|
| `index.md` | Homepage |
| `getting-started/` | Quickstart, Install, Auth, Models |
| `reference/` | Tools, Slash Commands, Skills, Subagents, Memory, MCP, Hooks, Permissions, Plan Mode, Daemon, Recipes |
| `migration/` | Claude Code, Codex, Aider migration guides |
| `comparison.md` | Me Write Code vs the field |
| `cookbook.md` | Working recipes (CI, multi-agent review, daemon) |
| `troubleshooting.md` | Common issues and fixes |
| `api.md` | SDK, JSON-RPC, OpenAPI, extension API |
| `public/llms.txt` | Mirror of root `/llms.txt` for the deployed site |
| `.vitepress/config.ts` | VitePress configuration |
| `.vitepress/theme/` | Custom theme + `<CopyForLlms />` button |

## Authoring conventions

- Drop `<CopyForLlms />` near the top of every reference page (after the H1, before the first H2).
- Heading depth caps at H3 — H4+ does not appear in the sidebar.
- Frontmatter `title` and `description` are required.
- Code fences declare language: ` ```bash `, ` ```typescript `, ` ```json `.
- Migration guides use the "TL;DR" pattern: a copy-paste block that gets the user 80% there, then differences.

## Deploy

The site builds to `docs/.vitepress/dist/`. Branding and deploy URLs are configured in `.vitepress/config.ts` via `DOCS_SITE_TITLE`, `DOCS_SITE_URL`, `DOCS_BASE`, `DOCS_GITHUB_URL`, and `DOCS_DISCORD_URL`.

A GitHub Actions workflow rebuilds the site on push to `main` and uploads to GitHub Pages or the configured static host. See `.github/workflows/docs.yml` (out of scope for this initial scaffold; track via WS11 release pipeline).

## llms.txt

`/llms.txt` is the LLM-friendly entry point. The canonical copy is at the repo root (`/llms.txt`). `docs/public/llms.txt` is a mirror so the deployed site exposes it at `/docs/llms.txt`.

When sections are added or renamed, update both copies. The `Copy for LLMs` button on each page is plain-text article extraction — no manual mirroring needed for individual pages.
