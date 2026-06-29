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
	};
});

describe("BannerComponent", () => {
	test("re-renders wordmark colors from the current theme", async () => {
		const { BannerComponent } = await import("../src/modes/interactive/components/banner.js");
		const { initTheme } = await import("../src/modes/interactive/theme/theme.js");
		const banner = new BannerComponent({ version: "0.0.0", showSecondaryWordmark: true });

		initTheme("dark");
		const dark = banner.render(120).join("\n");

		initTheme("light");
		const light = banner.render(120).join("\n");

		expect(dark).not.toBe(light);
		expect(dark).toContain("Any Model");
		expect(light).toContain("Any Model");
	});
});
