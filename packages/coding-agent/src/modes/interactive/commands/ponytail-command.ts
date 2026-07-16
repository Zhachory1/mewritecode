import { Spacer, Text } from "@zhachory1/mewrite-tui";
import { theme } from "../theme/theme.js";
import {
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class PonytailCommand extends InteractiveSlashCommand {
	readonly name = "ponytail";

	condition(text: string): boolean {
		return exactOrArg("/ponytail", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, () => {
			const commandArg = text
				.replace(/^\/ponytail\s*/, "")
				.trim()
				.toLowerCase();

			if (!commandArg || commandArg === "status") {
				const state = context.session.getPonytailSessionState();
				const status = state.enabled ? `on (intensity: ${state.intensity})` : "off";
				context.chatContainer.addChild(new Spacer(1));
				context.chatContainer.addChild(new Text(theme.fg("muted", `Ponytail: ${status}`), 1, 0));
				context.ui.requestRender();
				return;
			}

			if (commandArg === "on") {
				context.session.setPonytailSessionIntensity(context.settingsManager.getPonytailIntensity());
				context.chatContainer.addChild(new Spacer(1));
				context.chatContainer.addChild(new Text(theme.fg("muted", "Ponytail: on (session)"), 1, 0));
				context.ui.requestRender();
				return;
			}

			if (commandArg === "off" || commandArg === "stop") {
				context.session.setPonytailSessionDisabled();
				context.chatContainer.addChild(new Spacer(1));
				context.chatContainer.addChild(new Text(theme.fg("muted", "Ponytail: off (session)"), 1, 0));
				context.ui.requestRender();
				return;
			}

			if (commandArg === "lite" || commandArg === "full" || commandArg === "ultra") {
				context.session.setPonytailSessionIntensity(commandArg);
				context.chatContainer.addChild(new Spacer(1));
				context.chatContainer.addChild(
					new Text(theme.fg("muted", `Ponytail: on, intensity set to ${commandArg} (session)`), 1, 0),
				);
				context.ui.requestRender();
				return;
			}

			context.showWarning(
				`/ponytail: unknown argument '${commandArg}'. Usage: /ponytail [on|off|lite|full|ultra|status]`,
			);
		});
	}
}
