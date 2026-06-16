/**
 * Regression coverage for issue #5: sequential command orchestration across turns.
 *
 * The orchestrator lives in InteractiveMode (UI layer) and dispatches queued
 * commands through `defaultEditor.onSubmit` after each turn settles. The pure
 * `/then` splitter is exercised in test/command-queue.test.ts; here we drive
 * the InteractiveMode-side wiring directly with a fake `this`, mirroring the
 * existing interactive-mode-compaction.test.ts pattern.
 */

import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.js";

interface FakeInteractive {
	commandQueue: string[];
	shutdownRequested: boolean;
	session: { isStreaming: boolean; isCompacting: boolean };
	defaultEditor: { onSubmit?: (text: string) => Promise<void> | void };
	updatePendingMessagesDisplay: ReturnType<typeof vi.fn>;
	agent: { abort: ReturnType<typeof vi.fn> };
	editor: {
		getText: ReturnType<typeof vi.fn>;
		setText: ReturnType<typeof vi.fn>;
	};
	pendingMessagesContainer: { clear: ReturnType<typeof vi.fn>; addChild: ReturnType<typeof vi.fn> };
	getAllQueuedMessages: ReturnType<typeof vi.fn>;
	clearAllQueues: ReturnType<typeof vi.fn>;
	getAppKeyDisplay: ReturnType<typeof vi.fn>;
}

function makeFake(overrides: Partial<FakeInteractive> = {}): FakeInteractive {
	return {
		commandQueue: [],
		shutdownRequested: false,
		session: { isStreaming: false, isCompacting: false },
		defaultEditor: {},
		updatePendingMessagesDisplay: vi.fn(),
		agent: { abort: vi.fn() },
		editor: { getText: vi.fn(() => ""), setText: vi.fn() },
		pendingMessagesContainer: { clear: vi.fn(), addChild: vi.fn() },
		getAllQueuedMessages: vi.fn(() => ({ steering: [], followUp: [] })),
		clearAllQueues: vi.fn(() => ({ steering: [], followUp: [] })),
		getAppKeyDisplay: vi.fn(() => "Ctrl+E"),
		...overrides,
	};
}

const tryDrainCommandQueue = Reflect.get(InteractiveMode.prototype, "tryDrainCommandQueue") as (
	this: FakeInteractive,
) => void;

const restoreQueuedMessagesToEditor = Reflect.get(InteractiveMode.prototype, "restoreQueuedMessagesToEditor") as (
	this: FakeInteractive,
	options?: { abort?: boolean; currentText?: string },
) => number;

describe("issue #5 sequential command orchestration", () => {
	it("dispatches the next /then-queued command when not streaming", () => {
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		const fake = makeFake({
			commandQueue: ["/goal implement", "/savings"],
			defaultEditor: { onSubmit },
		});

		tryDrainCommandQueue.call(fake);

		expect(onSubmit).toHaveBeenCalledWith("/goal implement");
		expect(fake.commandQueue).toEqual(["/savings"]);
		expect(fake.updatePendingMessagesDisplay).toHaveBeenCalled();
	});

	it("does NOT dispatch while streaming (agent_end will re-trigger later)", () => {
		const onSubmit = vi.fn();
		const fake = makeFake({
			commandQueue: ["/goal implement"],
			session: { isStreaming: true, isCompacting: false },
			defaultEditor: { onSubmit },
		});

		tryDrainCommandQueue.call(fake);

		expect(onSubmit).not.toHaveBeenCalled();
		expect(fake.commandQueue).toEqual(["/goal implement"]);
	});

	it("does NOT dispatch while compaction is in flight", () => {
		const onSubmit = vi.fn();
		const fake = makeFake({
			commandQueue: ["/goal implement"],
			session: { isStreaming: false, isCompacting: true },
			defaultEditor: { onSubmit },
		});

		tryDrainCommandQueue.call(fake);

		expect(onSubmit).not.toHaveBeenCalled();
		expect(fake.commandQueue).toEqual(["/goal implement"]);
	});

	it("does NOT dispatch after shutdown has been requested", () => {
		const onSubmit = vi.fn();
		const fake = makeFake({
			commandQueue: ["/goal implement"],
			shutdownRequested: true,
			defaultEditor: { onSubmit },
		});

		tryDrainCommandQueue.call(fake);

		expect(onSubmit).not.toHaveBeenCalled();
		expect(fake.commandQueue).toEqual(["/goal implement"]);
	});

	it("is a no-op when the queue is empty", () => {
		const onSubmit = vi.fn();
		const fake = makeFake({ commandQueue: [], defaultEditor: { onSubmit } });

		tryDrainCommandQueue.call(fake);

		expect(onSubmit).not.toHaveBeenCalled();
		expect(fake.updatePendingMessagesDisplay).not.toHaveBeenCalled();
	});

	it("Escape (restoreQueuedMessagesToEditor) pulls /then-queued commands back into the editor", () => {
		const fake = makeFake({
			commandQueue: ["/goal implement", "/savings"],
			editor: { getText: vi.fn(() => ""), setText: vi.fn() },
		});

		const count = restoreQueuedMessagesToEditor.call(fake, { abort: true });

		expect(count).toBe(2);
		expect(fake.commandQueue).toEqual([]);
		expect(fake.editor.setText).toHaveBeenCalledWith("/goal implement\n\n/savings");
		expect(fake.agent.abort).toHaveBeenCalled();
	});

	it("Escape preserves current editor text and appends queued commands above it", () => {
		const fake = makeFake({
			commandQueue: ["/goal implement"],
			editor: { getText: vi.fn(() => "wip text"), setText: vi.fn() },
		});

		const count = restoreQueuedMessagesToEditor.call(fake);

		expect(count).toBe(1);
		expect(fake.editor.setText).toHaveBeenCalledWith("/goal implement\n\nwip text");
	});
});
