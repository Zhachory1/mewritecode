import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

export class LogoutCommand extends InteractiveSlashCommand {
	readonly name = "logout";

	condition(text: string): boolean {
		return exact("/logout", text);
	}

	handleCommand(_text: string, context: InteractiveSlashCommandContext): void {
		context.showOAuthSelector("logout");
		context.clearEditor();
	}
}
