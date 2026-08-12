import { beforeAll, describe, expect, it } from "vitest";
import { BANNER_PRIMARY_WORDMARK } from "../src/config.js";
import { BannerComponent } from "../src/modes/interactive/components/banner.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, "");

describe("BannerComponent", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("renders the pencil logo with the block wordmark and the version info line", () => {
		const lines = new BannerComponent({ version: "1.2.3" }).render(80);
		const output = stripAnsi(lines.join("\n"));

		// 12 pencil rows + 1 info line.
		expect(lines).toHaveLength(13);
		expect(output).toContain("1.2.3");
		// The default block wordmark ("Me Write Code") renders beside the pencil.
		for (const row of BANNER_PRIMARY_WORDMARK) {
			if (row.trim() === "") continue;
			expect(output).toContain(row.trimEnd());
		}
		// The old fancy ASCII wordmark is gone.
		expect(output).not.toContain("▒██");
	});

	it("places the wordmark to the right of the pencil, not over it", () => {
		const lines = new BannerComponent({ version: "1.2.3" }).render(80).map(stripAnsi);
		// The pencil occupies the left ~6 columns on every logo row.
		const pencilRow = lines.findIndex((l) => l.includes("╭┴──┴╮"));
		expect(pencilRow).toBeGreaterThanOrEqual(0);
		// A wordmark row sits to the right of the pencil body (after the gap).
		const wordmarkRow = lines.find((l) => l.includes("█▖▄▖█"));
		expect(wordmarkRow).toBeDefined();
		expect(wordmarkRow?.indexOf("█▖▄▖█")).toBeGreaterThan(6);
	});

	it("uses a configured image logo instead of the text wordmark", () => {
		const lines = new BannerComponent({
			version: "1.2.3",
			showSecondaryWordmark: true,
			logo: {
				base64Data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
				mimeType: "image/png",
				filename: "logo.png",
				maxWidthCells: 20,
			},
		}).render(80);
		const output = lines.join("\n");

		expect(output).toContain("logo.png");
		expect(output).toContain("Any Model, Less Tokens, Code Good");
		expect(output).toContain("1.2.3");
		expect(output).not.toContain("▒██");
	});
});
