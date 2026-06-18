# Packages

TypeScript monorepo under the `@zhachory1/mewrite-*` scope on npm.

## Package Map

**Core six (load-bearing — see `context/plans/cave-v2-best-in-class.md`):**

| Dir | Package | Binary | Role |
|-----|---------|--------|------|
| `coding-agent/` | `@zhachory1/mewrite-code` | `caveman` / `caveman-code` | Main coding agent CLI |
| `ai/` | `@zhachory1/mewrite-ai` | `pi-ai` | Multi-provider LLM unified API |
| `agent/` | `@zhachory1/mewrite-agent` | — | Agent runtime: tool calling, state |
| `tui/` | `@zhachory1/mewrite-tui` | — | Terminal UI: differential rendering |
| `sdk/` | `@zhachory1/mewrite-sdk` | — | TS client for the caveman-code daemon HTTP+WS API |
| `markdown-preview/` | `@zhachory1/mewrite-markdown-preview` | — | Markdown + LaTeX preview extension |

Core build chain: `tui → ai → agent → coding-agent → sdk`.

**Off-core (relocated to `contrib/`, unsupported):**

These three were moved out of `packages/` to `contrib/` (issue #20). They are
NOT in the `packages/*` workspace glob and are NOT built by `npm run build`.
They expand the threat model (bash + Docker, GPU deploy, web surface) for zero
core-adoption upside. The published `caveman-code` package is unaffected.

| Dir | Package | Binary | Role |
|-----|---------|--------|------|
| `contrib/web-ui/` | `@zhachory1/mewrite-web-ui` | — | Web components for AI chat |
| `contrib/mom/` | `@zhachory1/mewrite-mom` | `mom` | Slack bot → coding agent delegate |
| `contrib/pods/` | `@zhachory1/mewrite-pods` | `cave-pods` | vLLM deployment on GPU pods |

## Conventions

- Read package-level README.md before modifying.
- Shared TypeScript config: `../tsconfig.base.json`.
- Biome for lint/format (not ESLint/Prettier).
- The active master plan is `context/plans/cave-v2-best-in-class.md`. Older
  CaveKit kits/plans/impl live in `context/archive/`.
