# Packages

TypeScript monorepo under the `@zhachory1/mewrite-*` scope on npm.

## Package Map

**v2 core (load-bearing — see `context/plans/cave-v2-best-in-class.md`):**

| Dir | Package | Binary | Role |
|-----|---------|--------|------|
| `coding-agent/` | `@zhachory1/mewrite-code` | `mewrite` / `mewritecode` | Main coding agent CLI |
| `ai/` | `@zhachory1/mewrite-ai` | `pi-ai` | Multi-provider LLM unified API |
| `agent/` | `@zhachory1/mewrite-agent` | — | Agent runtime: tool calling, state |
| `tui/` | `@zhachory1/mewrite-tui` | — | Terminal UI: differential rendering |

**Out of scope for v2 (separate product surfaces):**

| Dir | Package | Binary | Role |
|-----|---------|--------|------|
| `web-ui/` | `@zhachory1/mewrite-web-ui` | — | Web components for AI chat |
| `mom/` | `@zhachory1/mewrite-mom` | `mom` | Slack bot → coding agent delegate |
| `pods/` | `@zhachory1/mewrite-pods` | `mewrite-pods` | vLLM deployment on GPU pods |

## Conventions

- Read package-level README.md before modifying.
- Shared TypeScript config: `../tsconfig.base.json`.
- Biome for lint/format (not ESLint/Prettier).
- The active master plan is `context/plans/cave-v2-best-in-class.md`. Older
  CaveKit kits/plans/impl live in `context/archive/`.
