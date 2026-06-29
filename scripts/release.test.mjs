import assert from "node:assert/strict";
import { test } from "node:test";
import { finalizeChangelogContent } from "./release.mjs";

test("finalizeChangelogContent preserves Unreleased and inserts release below it", () => {
	const input = "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Thing\n\n## [0.1.0] - 2026-01-01\n";
	const result = finalizeChangelogContent(input, "0.2.0", "2026-06-29");

	assert.equal(result.updated, true);
	assert.match(result.content, /^# Changelog\n\n## \[Unreleased\]\n\n## \[0\.2\.0\] - 2026-06-29/m);
	assert.match(result.content, /### Fixed\n\n- Thing/);
});

test("finalizeChangelogContent leaves changelog without Unreleased unchanged", () => {
	const input = "# Changelog\n\n## [0.1.0] - 2026-01-01\n";
	const result = finalizeChangelogContent(input, "0.2.0", "2026-06-29");

	assert.equal(result.updated, false);
	assert.equal(result.content, input);
});
