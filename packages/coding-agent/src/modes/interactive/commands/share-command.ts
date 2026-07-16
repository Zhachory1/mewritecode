import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getShareViewerUrl } from "../../../config.js";
import { BorderedLoader } from "../components/bordered-loader.js";
import { theme } from "../theme/theme.js";
import { exact, InteractiveSlashCommand, type InteractiveSlashCommandContext } from "./interactive-slash-command.js";

async function shareSession(context: InteractiveSlashCommandContext): Promise<void> {
	try {
		const authResult = spawnSync("gh", ["auth", "status"], { encoding: "utf-8" });
		if (authResult.status !== 0) {
			context.showError("GitHub CLI is not logged in. Run 'gh auth login' first.");
			return;
		}
	} catch {
		context.showError("GitHub CLI (gh) is not installed. Install it from https://cli.github.com/");
		return;
	}

	const tmpFile = path.join(os.tmpdir(), "session.html");
	try {
		await context.session.exportToHtml(tmpFile);
	} catch (error: unknown) {
		context.showError(`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`);
		return;
	}

	const loader = new BorderedLoader(context.ui, theme, "Creating gist...");
	context.editorContainer.clear();
	context.editorContainer.addChild(loader);
	context.ui.setFocus(loader);
	context.ui.requestRender();

	const restoreEditor = () => {
		loader.dispose();
		context.editorContainer.clear();
		context.editorContainer.addChild(context.editor);
		context.ui.setFocus(context.editor);
		try {
			fs.unlinkSync(tmpFile);
		} catch {}
	};

	let proc: ReturnType<typeof spawn> | null = null;

	loader.onAbort = () => {
		proc?.kill();
		restoreEditor();
		context.showStatus("Share cancelled");
	};

	try {
		const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
			proc = spawn("gh", ["gist", "create", "--public=false", tmpFile]);
			let stdout = "";
			let stderr = "";
			proc.stdout?.on("data", (data) => {
				stdout += data.toString();
			});
			proc.stderr?.on("data", (data) => {
				stderr += data.toString();
			});
			proc.on("close", (code) => resolve({ stdout, stderr, code }));
		});

		if (loader.signal.aborted) return;

		restoreEditor();

		if (result.code !== 0) {
			const errorMsg = result.stderr?.trim() || "Unknown error";
			context.showError(`Failed to create gist: ${errorMsg}`);
			return;
		}

		const gistUrl = result.stdout?.trim();
		const gistId = gistUrl?.split("/").pop();
		if (!gistId) {
			context.showError("Failed to parse gist ID from gh output");
			return;
		}

		const previewUrl = getShareViewerUrl(gistId);
		context.showStatus(`Share URL: ${previewUrl}\nGist: ${gistUrl}`);
	} catch (error: unknown) {
		if (!loader.signal.aborted) {
			restoreEditor();
			context.showError(`Failed to create gist: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	}
}

export class ShareCommand extends InteractiveSlashCommand {
	readonly name = "share";

	condition(text: string): boolean {
		return exact("/share", text);
	}

	async handleCommand(_text: string, context: InteractiveSlashCommandContext): Promise<void> {
		await shareSession(context);
		context.clearEditor();
	}
}
