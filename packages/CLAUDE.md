# Packages

TypeScript monorepo under the `@caveman-code/` scope.

## Package Map

**v2 core (load-bearing — see `context/plans/cave-v2-best-in-class.md`):**

| Dir | Package | Binary | Role |
|-----|---------|--------|------|
| `coding-agent/` | `caveman` | `caveman` | Main coding agent CLI |
| `ai/` | `@caveman-code/ai` | `pi-ai` | Multi-provider LLM unified API |
| `agent/` | `@caveman-code/agent` | — | Agent runtime: tool calling, state |
| `tui/` | `@caveman-code/tui` | — | Terminal UI: differential rendering |

**Out of scope for v2 (separate product surfaces):**

| Dir | Package | Binary | Role |
|-----|---------|--------|------|
| `web-ui/` | `@caveman-code/web-ui` | — | Web components for AI chat |
| `mom/` | `@caveman-code/mom` | `mom` | Slack bot → coding agent delegate |
| `pods/` | `@caveman-code/pods` | `cave-pods` | vLLM deployment on GPU pods |

## Conventions

- Read package-level README.md before modifying.
- Shared TypeScript config: `../tsconfig.base.json`.
- Biome for lint/format (not ESLint/Prettier).
- The active master plan is `context/plans/cave-v2-best-in-class.md`. Older
  CaveKit kits/plans/impl live in `context/archive/`.
