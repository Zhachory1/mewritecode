import { beforeAll, describe, expect, it } from "vitest";
import { BannerComponent } from "../src/modes/interactive/components/banner.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

describe("BannerComponent", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("renders a compact startup wordmark when the secondary wordmark is disabled", () => {
		const lines = new BannerComponent({ version: "1.2.3", showSecondaryWordmark: false }).render(80);
		const output = lines.join("\n");

		expect(lines).toHaveLength(7);
		expect(output).toContain("Any Model, Less Tokens, Code Good");
		expect(output).toContain("1.2.3");
		expect(output).not.toContain("▒██");
	});

	it("can render the full two-part startup wordmark", () => {
		const lines = new BannerComponent({ version: "1.2.3", showSecondaryWordmark: true }).render(80);
		const output = lines.join("\n");

		expect(lines).toHaveLength(17);
		expect(output).toContain("Any Model, Less Tokens, Code Good");
		expect(output).toContain("1.2.3");
		expect(output).toContain("▒██");
	});
});
