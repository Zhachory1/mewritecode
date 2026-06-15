/**
 * MED-2: the "Approve for session" choice must be HONEST about its coarse
 * semantics. Approving for session unlocks ALL future calls of that tool for the
 * rest of the session (e.g. every future bash call, including `rm -rf`), not just
 * the call in front of the user. The label must say so.
 */

import { describe, expect, it } from "vitest";
import { buildChoices } from "../approval-prompt.js";

describe("approval prompt choices — honest session label (MED-2)", () => {
	it("says 'all bash calls' for bash (the rm -rf foot-gun)", () => {
		const choices = buildChoices("bash");
		const session = choices.find((c) => c.value === "session");
		expect(session?.label).toBe("Approve for session (all bash calls)");
	});

	it("names the tool for any tool so the coarse scope is explicit", () => {
		const session = buildChoices("write").find((c) => c.value === "session");
		expect(session?.label).toBe("Approve for session (all write calls)");
	});

	it("keeps 'Approve once' and 'Deny' unchanged", () => {
		const choices = buildChoices("bash");
		expect(choices.find((c) => c.value === "once")?.label).toBe("Approve once");
		expect(choices.find((c) => c.value === "deny")?.label).toBe("Deny");
	});
});
