---
title: Auth & Providers
description: Authenticate Me Write Code with 20+ LLM providers via OAuth or API key.
---

# Auth & Providers

Me Write Code supports **20+ providers** and **5 built-in OAuth flows**. You can mix and match — set an Anthropic key for primary work and a Groq key for the editor model in an `/architect` split, for example.

<CopyForLlms />

## OAuth subscriptions (recommended for individuals)

Use your existing paid subscription. No API key needed.

| Provider | Subscription | Login command |
|---|---|---|
| Anthropic Claude | Claude Pro / Max | `mewrite` then `/login claude` |
| OpenAI ChatGPT | ChatGPT Plus / Pro | `/login chatgpt` |
| GitHub Copilot | Copilot | `/login copilot` |
| Google Gemini | Gemini Advanced | `/login gemini` |
| Google Antigravity | Antigravity preview | `/login antigravity` |

The raw provider ids also work: `anthropic`, `openai-codex`, `google-gemini-cli`, `github-copilot`, `antigravity`.

OAuth and API credentials are stored in `~/.mewrite/agent/auth.json` with user-only file permissions (`0600`). Use environment variables for CI and other shared machines.

## API keys

Set any of these env vars and Me Write Code picks them up automatically:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_API_KEY=...
export AZURE_OPENAI_API_KEY=...
export GROQ_API_KEY=...
export CEREBRAS_API_KEY=...
export XAI_API_KEY=...
export OPENROUTER_API_KEY=...
export MISTRAL_API_KEY=...
export DEEPSEEK_API_KEY=...
# ... and more
```

Full list: Anthropic, OpenAI, Azure OpenAI, Google Vertex, AWS Bedrock, Mistral, Groq, Cerebras, xAI, OpenRouter, Vercel AI Gateway, Hugging Face, Kimi, MiniMax, ZAI, OpenCode, DeepSeek.

## Custom endpoints

Any OpenAI-, Anthropic-, or Google-compatible endpoint works. Add an entry to `~/.mewrite/agent/models.json`:

```json
{
    "providers": {
        "my-vllm": {
            "api": "openai-completions",
            "baseUrl": "https://vllm.internal.example.com/v1",
            "apiKey": "...",
            "models": [
                { "id": "llama-3-70b-instruct" },
                { "id": "qwen-2.5-coder" }
            ]
        }
    }
}
```

Then:

```bash
mewrite --provider my-vllm --model llama-3-70b-instruct
```

For Anthropic-style routing (e.g. an internal Bedrock proxy), set `api` to the matching API identifier used by `@zhachory1/mewrite-ai`.

## Headless / CI auth

OAuth doesn't work without a browser. In CI use API keys:

```yaml
# GitHub Actions
- run: mewrite exec "lint and fix typescript errors" --output-schema ./schema.json
  env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

For machines without env vars, use OAuth interactively in the TUI or provide API keys through environment variables/secrets.

## Switching providers per request

| Flag | Example |
|---|---|
| `--provider` | `mewrite --provider anthropic` |
| `--model` | `mewrite --model gpt-5-codex` |
| `provider/model` | `mewrite --model anthropic/claude-sonnet-4` |
| Thinking suffix | `mewrite --model claude-sonnet-4:high` |

Inside the TUI, `/model` lists available models and `Ctrl+L` cycles your favourites.

## Cost tracking

Me Write Code reports per-message cost inline (e.g. `$0.0042 (cached: $0.0001)`) and writes daily/weekly totals under `~/.mewrite/agent/`. See [Cost Transparency](/reference/tools#cost-transparency).

## Troubleshooting

- **OAuth opens browser but never returns** — check that the loopback port (random in 1024-65535) isn't firewalled. If needed, use API-key auth for that provider.
- **`401 Unauthorized` from a stored token** — token expired. Use `/logout <provider>` in the TUI, then re-login. Refresh tokens are handled automatically when valid.
- **Linux libsecret missing** — install `libsecret-tools` on Debian/Ubuntu, `libsecret` on Arch. Prefer API keys in CI or other non-interactive environments.
