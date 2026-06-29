import { describe, expect, test } from "vitest";
import {
	AUTO_THEME_NAME,
	getAvailableThemes,
	getAvailableThemesWithPaths,
	getResolvedThemeColors,
	getThemeByName,
	initTheme,
	isLightTheme,
	resolveThemeName,
	setDetectedBackground,
	theme,
} from "../src/modes/interactive/theme/theme.js";

describe("auto theme", () => {
	test("exposes auto as a selectable theme", () => {
		expect(getAvailableThemes()).toContain(AUTO_THEME_NAME);
		expect(getAvailableThemesWithPaths()).toContainEqual({ name: AUTO_THEME_NAME, path: undefined });
	});

	test("resolves auto to the detected light theme", () => {
		setDetectedBackground("light");

		expect(resolveThemeName(AUTO_THEME_NAME)).toBe("light");
		expect(getThemeByName(AUTO_THEME_NAME)?.name).toBe("light");
		expect(isLightTheme(AUTO_THEME_NAME)).toBe(true);
		expect(getResolvedThemeColors(AUTO_THEME_NAME).text).toBeDefined();
	});

	test("resolves auto to the detected dark theme", () => {
		setDetectedBackground("dark");

		initTheme(AUTO_THEME_NAME);

		expect(resolveThemeName(AUTO_THEME_NAME)).toBe("dark");
		expect(theme.name).toBe("dark");
		expect(isLightTheme(AUTO_THEME_NAME)).toBe(false);
	});
});
