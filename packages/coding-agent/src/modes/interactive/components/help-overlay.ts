import {
	Container,
	getKeybindings,
	type Keybinding,
	type OverlayHandle,
	Spacer,
	Text,
	type TUI,
	truncateToWidth,
} from "@zhachory1/mewrite-tui";
import { KEYBINDINGS } from "../../../core/keybindings.js";
import { theme } from "../theme/theme.js";

interface HelpRow {
	keys: string;
	description: string;
}

interface HelpGroup {
	label: string;
	rows: HelpRow[];
}

const GROUPS: { label: string; prefix: string }[] = [
	{ label: "Editor", prefix: "tui.editor." },
	{ label: "Input", prefix: "tui.input." },
	{ label: "Selection", prefix: "tui.select." },
	{ label: "App", prefix: "app." },
];

function formatKeys(keys: readonly string[]): string {
	if (keys.length === 0) return theme.fg("dim", "(unbound)");
	if (keys.length === 1) return keys[0]!;
	return keys.join(" / ");
}

function buildGroups(): HelpGroup[] {
	const kb = getKeybindings();
	const groups: HelpGroup[] = GROUPS.map((g) => ({ label: g.label, rows: [] }));
	for (const id of Object.keys(KEYBINDINGS)) {
		const def = KEYBINDINGS[id as Keybinding];
		const keys = kb.getKeys(id as Keybinding);
		const row: HelpRow = {
			keys: formatKeys(keys),
			description: def.description ?? id,
		};
		for (let i = 0; i < GROUPS.length; i++) {
			if (id.startsWith(GROUPS[i]!.prefix)) {
				groups[i]!.rows.push(row);
				break;
			}
		}
	}
	return groups.filter((g) => g.rows.length > 0);
}

export class HelpOverlayComponent extends Container {
	constructor(private readonly onClose: () => void) {
		super();
		this.refresh();
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (
			kb.matches(data, "app.help") ||
			kb.matches(data, "tui.select.cancel") ||
			data === "\x03" ||
			data === "q" ||
			data === "Q"
		) {
			this.onClose();
		}
	}

	private refresh(): void {
		this.clear();
		const cols = process.stdout.columns ?? 80;
		const width = Math.min(80, Math.max(50, cols - 8));
		this.addChild(new Text(theme.bold(theme.fg("accent", "Keyboard help")), 1, 0));
		this.addChild(new Spacer(1));

		const groups = buildGroups();
		const keyCol = Math.min(
			28,
			Math.max(
				10,
				groups.flatMap((g) => g.rows).reduce((acc, r) => Math.max(acc, r.keys.length), 10),
			),
		);

		for (let i = 0; i < groups.length; i++) {
			const group = groups[i]!;
			this.addChild(new Text(theme.fg("muted", group.label), 1, 0));
			for (const row of group.rows) {
				const padded = row.keys.padEnd(keyCol, " ");
				const line = `  ${theme.fg("dim", padded)}  ${theme.fg("text", row.description)}`;
				this.addChild(new Text(truncateToWidth(line, width, "…"), 1, 0));
			}
			if (i < groups.length - 1) this.addChild(new Spacer(1));
		}

		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", "F1 / Esc / q close"), 1, 0));
	}
}

export function showHelpOverlay(tui: TUI, onClosed: () => void): OverlayHandle {
	let handle: OverlayHandle | null = null;
	const component = new HelpOverlayComponent(() => {
		handle?.hide();
		onClosed();
	});
	handle = tui.showOverlay(component, { anchor: "center", width: "80%", maxHeight: "80%" });
	handle.focus();
	return handle;
}
