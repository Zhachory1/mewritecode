import { describe, expect, it } from "vitest";
import { buildHotkeysMarkdown, formatKeyDisplay } from "../src/modes/interactive/hotkeys-markdown.js";

describe("hotkeys markdown", () => {
	it("formats slash-command hotkeys sections", () => {
		const markdown = buildHotkeysMarkdown({ platform: "win32" });

		expect(markdown).toContain("**Navigation**");
		expect(markdown).toContain("**Editing**");
		expect(markdown).toContain("New line (Ctrl+Enter on Windows Terminal)");
		expect(markdown).toContain("**Other**");
		expect(markdown).toContain("Cancel autocomplete / abort streaming");
		expect(markdown).toContain("`/` | Slash commands");
	});

	it("includes extension shortcuts when provided", () => {
		const markdown = buildHotkeysMarkdown({
			extensionShortcuts: new Map([
				["ctrl+shift+p", { description: "Run project action", extensionPath: "/ext/project" }],
				["alt+x", { extensionPath: "/ext/fallback" }],
			]),
			platform: "darwin",
		});

		expect(markdown).toContain("**Extensions**");
		expect(markdown).toContain("| `Ctrl+Shift+P` | Run project action |");
		expect(markdown).toContain("| `Alt+X` | /ext/fallback |");
	});

	it("capitalizes composite key display strings", () => {
		expect(formatKeyDisplay("ctrl+c/ctrl+d")).toBe("Ctrl+C/Ctrl+D");
		expect(formatKeyDisplay("shift+enter")).toBe("Shift+Enter");
	});
});
