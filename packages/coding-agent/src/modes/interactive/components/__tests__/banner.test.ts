/**
 * The pencil-logo wordmark must come from the branding config exports
 * (`BANNER_PRIMARY_WORDMARK` / `BANNER_SECONDARY_WORDMARK`) rather than a
 * hardcoded block, so distributions that set `branding.primaryWordmark` /
 * `secondaryWordmark` actually rebrand the interactive banner and agents view
 * (issue #194). Uses the default config values (no wrapper distribution present),
 * which are the built-in "Me Write Code" block.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { BANNER_PRIMARY_WORDMARK, BANNER_SECONDARY_WORDMARK } from "../../../../config.js";
import { initTheme } from "../../theme/theme.js";
import { renderPencilLogo } from "../banner.js";

const ANSI = /\x1b\[[0-9;]*m|\x1b\]8;;\x07/g;
const stripAnsi = (s: string): string => s.replace(ANSI, "");

beforeAll(() => {
	initTheme("dark");
});

/** The wordmark text rendered to the right of the pencil, stripped of styling. */
function renderedWordmarkRows(showSecondary: boolean): string[] {
	return (
		renderPencilLogo(200, showSecondary)
			.map((line) => stripAnsi(line))
			// Drop the pencil columns + gap; keep the wordmark tail (trimmed).
			.map((line) => line.replace(/^.{0,6}\s{3}/, "").trimEnd())
			.filter((tail) => tail.length > 0)
	);
}

describe("renderPencilLogo branding", () => {
	it("renders every primary wordmark row from the config export", () => {
		const rows = renderedWordmarkRows(false);
		for (const wm of BANNER_PRIMARY_WORDMARK) {
			if (wm.trim() === "") continue;
			expect(rows.some((r) => r.includes(wm.trimEnd()))).toBe(true);
		}
	});

	it("appends the secondary wordmark only when showSecondaryWordmark is set", () => {
		// Default distribution has an empty secondary, so this asserts the wiring
		// (primary-only vs primary+secondary length) rather than specific glyphs.
		const primaryOnly = renderPencilLogo(200, false);
		const withSecondary = renderPencilLogo(200, true);
		const expectedExtra = BANNER_SECONDARY_WORDMARK.filter((r) => r.trim() !== "").length;
		// Wordmark rows are centered within the fixed-height pencil, so adding the
		// secondary can only keep or grow the vertical span, never shrink it.
		expect(withSecondary.length).toBeGreaterThanOrEqual(primaryOnly.length);
		if (expectedExtra === 0) {
			expect(renderedWordmarkRows(true)).toEqual(renderedWordmarkRows(false));
		}
	});
});
