/**
 * #158 — `mewrite attach` transcript history + role framing.
 *
 * roleHeader is the pure labeler used both to print transcript history and to
 * frame the live token stream by role. The streaming/history behavior itself is a
 * live-daemon REPL and is verified end-to-end, not here.
 */

import { describe, expect, it } from "vitest";
import { roleHeader } from "../../../src/cli/attach.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("#158 attach roleHeader", () => {
	it("labels known roles and falls back to the raw role name", () => {
		expect(stripAnsi(roleHeader("user"))).toBe("you");
		expect(stripAnsi(roleHeader("assistant"))).toBe("agent");
		expect(stripAnsi(roleHeader("tool"))).toBe("tool");
		expect(stripAnsi(roleHeader("toolResult"))).toBe("tool");
		expect(stripAnsi(roleHeader("system"))).toBe("system");
		expect(stripAnsi(roleHeader("mystery"))).toBe("mystery");
	});
});
