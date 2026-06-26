import { Container, Text } from "@zhachory1/mewrite-tui";
import { theme } from "../theme/theme.js";
import { BannerComponent, type BannerLogo, type BannerSprite } from "./banner.js";
import { SessionPanelComponent } from "./session-panel.js";

export interface StartupHeaderOptions {
	version: string;
	instructions?: string;
	onboarding?: string;
	caveModeEnabled: boolean;
	caveModeIntensity?: string;
	model?: string;
	contextWindow?: string;
	effort?: string;
	cwd?: string;
	sprite?: BannerSprite;
	logo?: BannerLogo;
	mode?: string;
	auth?: string;
}

const MIN_ROWS_FOR_FULL_WORDMARK = 32;

function shouldShowSecondaryWordmark(): boolean {
	return (process.stdout.rows ?? 24) >= MIN_ROWS_FOR_FULL_WORDMARK;
}

export class StartupHeaderComponent extends Container {
	constructor({
		version,
		instructions: _instructions,
		onboarding: _onboarding,
		caveModeEnabled,
		caveModeIntensity,
		model,
		contextWindow,
		effort,
		cwd,
		sprite,
		logo,
		mode,
		auth,
	}: StartupHeaderOptions) {
		super();

		this.addChild(
			new BannerComponent({
				version,
				model,
				contextWindow,
				effort,
				cwd,
				sprite,
				logo,
				showSecondaryWordmark: shouldShowSecondaryWordmark(),
			}),
		);

		this.addChild(new SessionPanelComponent({ mode, auth }));

		if (caveModeEnabled) {
			const compression = caveModeIntensity ?? "enabled";
			this.addChild(new Text(theme.fg("accent", `cave mode: active | compression: ${compression}`), 1, 0));
		}
	}
}
