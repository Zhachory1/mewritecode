import { Container, Text, truncateToWidth } from "@juliusbrussee/caveman-tui";
import { theme } from "../theme/theme.js";

export interface StickyPromptState {
	/** Most-recent user message text that has scrolled above the viewport. */
	prompt?: string;
	/** True when the viewport is scrolled away from the bottom (user is reading history). */
	scrolledUp: boolean;
}

/**
 * Single-line dim ribbon at the top of the transcript.
 *
 * The chat container in interactive-mode does not yet drive a ScrollBuffer, so
 * this component is inert until an outside controller pushes state via
 * `setState`. It is wired now so the day cave gains scroll-state tracking only
 * needs the controller change, not a new component.
 */
export class StickyPromptTrackerComponent extends Container {
	private state: StickyPromptState = { scrolledUp: false };
	private label: Text;

	constructor() {
		super();
		this.label = new Text("", 1, 0);
		this.addChild(this.label);
	}

	setState(state: StickyPromptState): void {
		this.state = state;
		this.refresh();
	}

	render(width: number): string[] {
		this.refresh(width);
		return super.render(width);
	}

	private refresh(width?: number): void {
		if (!this.state.scrolledUp || !this.state.prompt) {
			this.label.setText("");
			return;
		}
		const cols = width ?? process.stdout.columns ?? 80;
		const budget = Math.max(10, cols - 4);
		const oneLine = this.state.prompt.replace(/\s+/g, " ").trim();
		const truncated = truncateToWidth(oneLine, budget, "…");
		this.label.setText(theme.fg("dim", `↳ ${truncated}`));
	}
}
