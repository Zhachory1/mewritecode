import { describe, expect, test, vi } from "vitest";

vi.mock("@zhachory1/mewrite-tui", () => {
	class Container {
		children: Array<{ render(width: number): string[] }> = [];
		addChild(child: { render(width: number): string[] }): void {
			this.children.push(child);
		}
		render(width: number): string[] {
			return this.children.flatMap((child) => child.render(width));
		}
		invalidate(): void {}
	}
	class Image {
		render(): string[] {
			return ["image"];
		}
		invalidate(): void {}
	}
	return {
		Container,
		Image,
		truncateToWidth: (text: string) => text,
		visibleWidth: (text: string) => text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "").length,
	};
});

describe("BannerComponent", () => {
	test("re-renders the pencil-logo brand colors from the current theme", async () => {
		const { BannerComponent } = await import("../src/modes/interactive/components/banner.js");
		const { initTheme } = await import("../src/modes/interactive/theme/theme.js");
		const banner = new BannerComponent({ version: "0.0.0" });

		initTheme("dark");
		const dark = banner.render(120).join("\n");

		initTheme("light");
		const light = banner.render(120).join("\n");

		expect(dark).not.toBe(light);
		expect(dark).toContain("Me Write Code");
		expect(light).toContain("Me Write Code");
	});
});
