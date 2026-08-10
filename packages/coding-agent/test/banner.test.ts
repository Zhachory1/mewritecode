import { beforeAll, describe, expect, it } from "vitest";
import { BannerComponent } from "../src/modes/interactive/components/banner.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

describe("BannerComponent", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("renders the pencil logo with brand text and the version info line", () => {
		const lines = new BannerComponent({ version: "1.2.3" }).render(80);
		const output = lines.join("\n");

		// 13 pencil rows + 1 info line.
		expect(lines).toHaveLength(14);
		expect(output).toContain("Me Write Code");
		expect(output).toContain("me write less,");
		expect(output).toContain("me do more");
		expect(output).toContain("1.2.3");
		// The old ASCII wordmark is gone.
		expect(output).not.toContain("▒██");
	});

	it("places a blank line between the brand title and the taglines", () => {
		const lines = new BannerComponent({ version: "1.2.3" }).render(80).map((l) => l.replace(/\u001b\[[0-9;]*m/g, ""));
		const titleIdx = lines.findIndex((l) => l.includes("Me Write Code"));
		const taglineIdx = lines.findIndex((l) => l.includes("me write less,"));
		expect(titleIdx).toBeGreaterThanOrEqual(0);
		// One row between title and taglines. The logo still occupies the left of that
		// row, but its text column carries neither the title nor the tagline.
		expect(taglineIdx).toBe(titleIdx + 2);
		expect(lines[titleIdx + 1]).not.toContain("Me Write Code");
		expect(lines[titleIdx + 1]).not.toContain("me write less,");
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
