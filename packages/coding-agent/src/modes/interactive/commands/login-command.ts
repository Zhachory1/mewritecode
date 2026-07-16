import { formatProviderChoices, parseLoginCommand } from "../activity-helpers.js";
import {
	clearAnd,
	exactOrArg,
	InteractiveSlashCommand,
	type InteractiveSlashCommandContext,
} from "./interactive-slash-command.js";

export class LoginCommand extends InteractiveSlashCommand {
	readonly name = "login";

	condition(text: string): boolean {
		return exactOrArg("/login", text);
	}

	async handleCommand(text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await clearAnd(context, async () => {
			const providers = context.session.modelRegistry.authStorage.getOAuthProviders();
			const parsed = parseLoginCommand(text, providers);
			if (parsed.kind === "selector") {
				await context.showOAuthSelector("login");
			} else if (parsed.kind === "provider") {
				await context.showLoginDialog(parsed.provider);
			} else {
				const names = formatProviderChoices(providers);
				context.showError(`Unknown provider "${parsed.provider}". Try: ${names || "(none)"}`);
			}
		});
	}
}
