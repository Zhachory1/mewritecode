/**
 * Shared vitest setup for the coding-agent package.
 *
 * Defense-in-depth for CI: even if the suite is invoked via `npm test` directly
 * (bypassing the repo-root `test.sh` wrapper that normally unsets credentials),
 * we strip every provider API key from the environment before any test module
 * loads. A mis-gated `skipIf` must never be able to make a real network call in
 * CI. Mirrors the unset list in `../../test.sh`.
 */
const API_KEY_ENV_VARS = [
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_OAUTH_TOKEN",
	"OPENAI_API_KEY",
	"GEMINI_API_KEY",
	"GROQ_API_KEY",
	"CEREBRAS_API_KEY",
	"XAI_API_KEY",
	"OPENROUTER_API_KEY",
	"ZAI_API_KEY",
	"MISTRAL_API_KEY",
	"MINIMAX_API_KEY",
	"MINIMAX_CN_API_KEY",
	"KIMI_API_KEY",
	"HF_TOKEN",
	"AI_GATEWAY_API_KEY",
	"OPENCODE_API_KEY",
	"COPILOT_GITHUB_TOKEN",
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"GOOGLE_APPLICATION_CREDENTIALS",
	"GOOGLE_CLOUD_PROJECT",
	"GCLOUD_PROJECT",
	"GOOGLE_CLOUD_LOCATION",
	"AWS_PROFILE",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_SESSION_TOKEN",
	"AWS_REGION",
	"AWS_DEFAULT_REGION",
	"AWS_BEARER_TOKEN_BEDROCK",
	"AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
	"AWS_CONTAINER_CREDENTIALS_FULL_URI",
	"AWS_WEB_IDENTITY_TOKEN_FILE",
	"BEDROCK_EXTENSIVE_MODEL_TEST",
] as const;

// Opt out of strict unsetting only when explicitly running the credentialed
// suites locally (e.g. via test.sh, which already unsets these anyway).
if (process.env.CAVE_TEST_KEEP_API_KEYS !== "1") {
	for (const name of API_KEY_ENV_VARS) {
		delete process.env[name];
	}
	// Skip local LLM tests (ollama, lmstudio), matching test.sh.
	process.env.PI_NO_LOCAL_LLM ??= "1";
}
