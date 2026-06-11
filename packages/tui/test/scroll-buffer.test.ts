import assert from "node:assert";
import { describe, it } from "node:test";
import { ScrollBuffer } from "../src/scroll-buffer.js";

function range(n: number, prefix = "line"): string[] {
	return Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);
}

describe("ScrollBuffer", () => {
	it("append in tail mode keeps viewport stuck to bottom", () => {
		const buf = new ScrollBuffer();
		buf.setViewportHeight(5);
		buf.setViewportWidth(80);
		buf.append(range(10));
		assert.strictEqual(buf.mode, "tail");
		assert.strictEqual(buf.isAtTail, true);
		const view = buf.render();
		assert.deepStrictEqual(view, ["line 6", "line 7", "line 8", "line 9", "line 10"]);
	});

	it("scrollBy transitions tail -> paused", () => {
		const buf = new ScrollBuffer();
		buf.setViewportHeight(5);
		buf.setViewportWidth(80);
		buf.append(range(20));
		buf.scrollBy(-3);
		assert.strictEqual(buf.mode, "paused");
		assert.strictEqual(buf.isAtTail, false);
	});

	it("append in paused mode retains position and counts unseen", () => {
		const buf = new ScrollBuffer();
		buf.setViewportHeight(5);
		buf.setViewportWidth(80);
		buf.append(range(20));
		buf.scrollBy(-5); // pause
		const topBefore = buf.render()[0];
		buf.append(range(4, "new"));
		assert.strictEqual(buf.mode, "paused");
		assert.strictEqual(buf.render()[0], topBefore);
		assert.strictEqual(buf.unseenCount(), 4);
	});

	it("scrollBy clamps at both ends", () => {
		const buf = new ScrollBuffer();
		buf.setViewportHeight(5);
		buf.setViewportWidth(80);
		buf.append(range(10));
		buf.scrollBy(-100);
		assert.strictEqual(buf.render()[0], "line 1");
		buf.scrollBy(100);
		assert.strictEqual(buf.render()[4], "line 10");
	});

	it("pageUp / pageDown moves by viewportHeight - 1", () => {
		const buf = new ScrollBuffer();
		buf.setViewportHeight(5); // page = 4
		buf.setViewportWidth(80);
		buf.append(range(20));
		buf.pageUp();
		assert.strictEqual(buf.render()[0], "line 12"); // 20-5=15 then -4 = 11 (0-indexed top = 11, so "line 12")
		buf.pageDown();
		assert.strictEqual(buf.render()[4], "line 20");
	});

	it("halfPageUp / halfPageDown moves by half viewport", () => {
		const buf = new ScrollBuffer();
		buf.setViewportHeight(6); // half = 3
		buf.setViewportWidth(80);
		buf.append(range(20));
		buf.halfPageUp();
		assert.strictEqual(buf.render()[0], "line 12"); // 20-6=14 then -3 = 11 -> "line 12"
	});

	it("jumpToTail returns to tail mode and scrolls to newest", () => {
		const buf = new ScrollBuffer();
		buf.setViewportHeight(5);
		buf.setViewportWidth(80);
		buf.append(range(20));
		buf.scrollBy(-10);
		buf.append(range(3, "new"));
		assert.strictEqual(buf.mode, "paused");
		buf.jumpToTail();
		assert.strictEqual(buf.mode, "tail");
		assert.strictEqual(buf.render()[4], "new 3");
		assert.strictEqual(buf.unseenCount(), 0);
	});

	it("scrolling all the way down re-enters tail mode", () => {
		const buf = new ScrollBuffer();
		buf.setViewportHeight(5);
		buf.setViewportWidth(80);
		buf.append(range(20));
		buf.scrollBy(-5);
		buf.scrollBy(100);
		assert.strictEqual(buf.mode, "tail");
		assert.strictEqual(buf.isAtTail, true);
	});

	it("width change reflows wrapped lines and preserves tail mode", () => {
		const buf = new ScrollBuffer();
		buf.setViewportHeight(4);
		buf.setViewportWidth(20);
		const longLine = "word ".repeat(10).trim(); // 49 chars
		buf.append(["short", longLine]);
		assert.strictEqual(buf.mode, "tail");
		const narrowTotal = buf.totalLines;
		assert.ok(narrowTotal > 2);
		buf.setViewportWidth(80);
		// At width 80 the long line fits on one line — total display lines drops back to 2
		assert.strictEqual(buf.totalLines, 2);
		assert.strictEqual(buf.mode, "tail");
		assert.strictEqual(buf.isAtTail, true);
	});

	it("respects visibleWidth when wrapping ANSI-styled lines", () => {
		const buf = new ScrollBuffer();
		buf.setViewportHeight(3);
		buf.setViewportWidth(10);
		// 10 visible chars worth of text but with ANSI color
		buf.append(["\x1b[31mhellohello\x1b[0m world here"]);
		const rows = buf.render();
		// Wrapped at 10 visible cols — first row should contain the red-styled text
		assert.ok(rows[0].includes("\x1b[31m"));
	});

	it("replaceTail edits the last N lines without double-appending", () => {
		const buf = new ScrollBuffer();
		buf.setViewportHeight(5);
		buf.setViewportWidth(80);
		buf.append(["a", "b", "c", "d"]);
		buf.replaceTail(2, ["C2", "D2", "E2"]);
		const view = buf.render();
		assert.deepStrictEqual(view.slice(0, 5), ["a", "b", "C2", "D2", "E2"]);
	});
});
