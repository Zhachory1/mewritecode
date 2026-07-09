import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packageDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			"@zhachory1/mewrite-agent": resolve(packageDir, "../agent/src/index.ts"),
			"@zhachory1/mewrite-ai/oauth": resolve(packageDir, "../ai/src/oauth.ts"),
			"@zhachory1/mewrite-ai/registry": resolve(packageDir, "../ai/src/registry/index.ts"),
			"@zhachory1/mewrite-ai": resolve(packageDir, "../ai/src/index.ts"),
			"@zhachory1/mewrite-tui": resolve(packageDir, "../tui/src/index.ts"),
		},
	},
	test: {
		globals: true,
		environment: "node",
		// Strip provider API keys before any test module loads (defense-in-depth
		// for CI paths that bypass the root test.sh wrapper).
		setupFiles: ["./test/setup.ts"],
		testTimeout: 30000, // 30 seconds for API calls
		// One retry budget for the daemon/rpc suites: a genuine hang still fails
		// (each test has its own timeout), while a scheduling-jitter flake on a
		// loaded CI box gets a chance to pass on retry instead of reddening CI.
		retry: 2,
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"test/benchmarks/tasks/**", // Task setup files are test fixtures, not runnable tests
		],
		server: {
			deps: {
				external: [/@silvia-odwyer\/photon-node/],
			},
		},
	},
});
