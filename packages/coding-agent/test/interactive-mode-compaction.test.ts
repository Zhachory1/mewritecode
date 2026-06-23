import { describe, expect, test, vi } from "vitest";
import { emptyTribalSignalState } from "../src/modes/interactive/context-drift-widgets.js";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.js";

describe("InteractiveMode compaction events", () => {
	test("rebuilds chat and appends a synthetic compaction summary at the bottom", async () => {
		const fakeThis = {
			isInitialized: true,
			footer: { invalidate: vi.fn() },
			autoCompactionEscapeHandler: undefined as (() => void) | undefined,
			autoCompactionLoader: undefined,
			defaultEditor: {},
			statusContainer: { clear: vi.fn() },
			chatContainer: { clear: vi.fn() },
			rebuildChatFromMessages: vi.fn(),
			addMessageToChat: vi.fn(),
			showError: vi.fn(),
			showStatus: vi.fn(),
			setExtensionWidget: vi.fn(),
			setExtensionStatus: vi.fn(),
			tribalSignalState: emptyTribalSignalState(),
			fireStarterState: { turnDeltas: [100], lastCompactionTime: 0 },
			flushCompactionQueue: vi.fn().mockResolvedValue(undefined),
			ui: { requestRender: vi.fn() },
		};

		const handleEvent = Reflect.get(InteractiveMode.prototype, "handleEvent") as (
			this: typeof fakeThis,
			event: {
				type: "compaction_end";
				reason: "manual" | "threshold" | "overflow";
				result: { tokensBefore: number; summary: string } | undefined;
				aborted: boolean;
				willRetry: boolean;
				errorMessage?: string;
			},
		) => Promise<void>;

		await handleEvent.call(fakeThis, {
			type: "compaction_end",
			reason: "manual",
			result: {
				tokensBefore: 123,
				summary: "summary",
			},
			aborted: false,
			willRetry: false,
		});

		// The compaction handler must NOT call chatContainer.clear() directly:
		// rebuildChatFromMessages() already disposes mounted tool rows then clears
		// internally. A caller-side clear first would empty `children` before that
		// dispose runs, leaking the live ToolExecutionComponent intervals (#17).
		expect(fakeThis.chatContainer.clear).not.toHaveBeenCalled();
		expect(fakeThis.rebuildChatFromMessages).toHaveBeenCalledTimes(1);
		expect(fakeThis.addMessageToChat).toHaveBeenCalledTimes(1);
		expect(fakeThis.addMessageToChat).toHaveBeenCalledWith(
			expect.objectContaining({
				role: "compactionSummary",
				tokensBefore: 123,
				summary: "summary",
			}),
		);
		expect(fakeThis.setExtensionWidget).toHaveBeenCalledWith("tribal-signal", undefined, {
			placement: "aboveEditor",
		});
		expect(fakeThis.setExtensionStatus).toHaveBeenCalledWith("drift", undefined);
		expect(fakeThis.flushCompactionQueue).toHaveBeenCalledWith({ willRetry: false });
	});
});
