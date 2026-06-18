# Packages

TypeScript monorepo under the `@juliusbrussee/caveman-*` scope on npm.

## Package Map

**Core six (load-bearing — see `context/plans/cave-v2-best-in-class.md`):**

| Dir | Package | Binary | Role |
|-----|---------|--------|------|
| `coding-agent/` | `@juliusbrussee/caveman-code` | `caveman` / `caveman-code` | Main coding agent CLI |
| `ai/` | `@juliusbrussee/caveman-ai` | `pi-ai` | Multi-provider LLM unified API |
| `agent/` | `@juliusbrussee/caveman-agent` | — | Agent runtime: tool calling, state |
| `tui/` | `@juliusbrussee/caveman-tui` | — | Terminal UI: differential rendering |
| `sdk/` | `@juliusbrussee/caveman-sdk` | — | TS client for the caveman-code daemon HTTP+WS API |
| `markdown-preview/` | `@juliusbrussee/caveman-markdown-preview` | — | Markdown + LaTeX preview extension |

Core build chain: `tui → ai → agent → coding-agent → sdk`.

**Off-core (relocated to `contrib/`, unsupported):**

These three were moved out of `packages/` to `contrib/` (issue #20). They are
NOT in the `packages/*` workspace glob and are NOT built by `npm run build`.
They expand the threat model (bash + Docker, GPU deploy, web surface) for zero
core-adoption upside. The published `caveman-code` package is unaffected.

| Dir | Package | Binary | Role |
|-----|---------|--------|------|
| `contrib/web-ui/` | `@juliusbrussee/caveman-web-ui` | — | Web components for AI chat |
| `contrib/mom/` | `@juliusbrussee/caveman-mom` | `mom` | Slack bot → coding agent delegate |
| `contrib/pods/` | `@juliusbrussee/caveman-pods` | `cave-pods` | vLLM deployment on GPU pods |

## Conventions

- Read package-level README.md before modifying.
- Shared TypeScript config: `../tsconfig.base.json`.
- Biome for lint/format (not ESLint/Prettier).
- The active master plan is `context/plans/cave-v2-best-in-class.md`. Older
  CaveKit kits/plans/impl live in `context/archive/`.
