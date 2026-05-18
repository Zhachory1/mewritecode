/**
 * Titlebar Spinner Extension
 *
 * Shows a braille spinner animation in the terminal title while the agent is working.
 * Uses `ctx.ui.setTitle()` to update the terminal title via the extension API.
 *
 * Usage:
 *   cave --extension examples/extensions/titlebar-spinner.ts
 */

import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "caveman-code";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function getBaseTitle(api: ExtensionAPI): string {
	const cwd = path.basename(process.cwd());
	const session = api.getSessionName();
	return session ? `cave - ${session} - ${cwd}` : `cave - ${cwd}`;
}

export default function (api: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | null = null;
	let frameIndex = 0;

	function stopAnimation(ctx: ExtensionContext) {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		frameIndex = 0;
		ctx.ui.setTitle(getBaseTitle(api));
	}

	function startAnimation(ctx: ExtensionContext) {
		stopAnimation(ctx);
		timer = setInterval(() => {
			const frame = BRAILLE_FRAMES[frameIndex % BRAILLE_FRAMES.length];
			const cwd = path.basename(process.cwd());
			const session = api.getSessionName();
			const title = session ? `${frame} cave - ${session} - ${cwd}` : `${frame} cave - ${cwd}`;
			ctx.ui.setTitle(title);
			frameIndex++;
		}, 80);
	}

	api.on("agent_start", async (_event, ctx) => {
		startAnimation(ctx);
	});

	api.on("agent_end", async (_event, ctx) => {
		stopAnimation(ctx);
	});

	api.on("session_shutdown", async (_event, ctx) => {
		stopAnimation(ctx);
	});
}
