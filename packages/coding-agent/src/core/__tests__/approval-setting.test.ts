/**
 * Tests for the OPT-IN approval-mode setting (#14): SettingsManager getter/setter
 * (default false, env fallback, env mirroring) + the pure /approval slash command.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../settings-manager.js";
import { runApprovalCommand } from "../slash-commands/approval.js";

describe("SettingsManager.approvalMode", () => {
	const prev = process.env.CAVE_APPROVAL_MODE;
	beforeEach(() => {
		delete process.env.CAVE_APPROVAL_MODE;
	});
	afterEach(() => {
		if (prev === undefined) delete process.env.CAVE_APPROVAL_MODE;
		else process.env.CAVE_APPROVAL_MODE = prev;
	});

	it("defaults to false (autopilot)", () => {
		const sm = SettingsManager.inMemory();
		expect(sm.getApprovalMode()).toBe(false);
	});

	it("explicit setting wins over env", () => {
		process.env.CAVE_APPROVAL_MODE = "1";
		const sm = SettingsManager.inMemory({ approvalMode: false });
		expect(sm.getApprovalMode()).toBe(false);
	});

	it("env enables when setting unset", () => {
		process.env.CAVE_APPROVAL_MODE = "1";
		expect(SettingsManager.inMemory().getApprovalMode()).toBe(true);
		process.env.CAVE_APPROVAL_MODE = "true";
		expect(SettingsManager.inMemory().getApprovalMode()).toBe(true);
		process.env.CAVE_APPROVAL_MODE = "0";
		expect(SettingsManager.inMemory().getApprovalMode()).toBe(false);
	});

	it("setApprovalMode(true) mirrors into process env for subagent inheritance", () => {
		const sm = SettingsManager.inMemory();
		sm.setApprovalMode(true);
		expect(sm.getApprovalMode()).toBe(true);
		expect(process.env.CAVE_APPROVAL_MODE).toBe("1");
		sm.setApprovalMode(false);
		expect(sm.getApprovalMode()).toBe(false);
		expect(process.env.CAVE_APPROVAL_MODE).toBeUndefined();
	});
});

describe("runApprovalCommand", () => {
	function makeIO(initial: boolean) {
		let state = initial;
		return {
			io: {
				getApprovalMode: () => state,
				setApprovalMode: (v: boolean) => {
					state = v;
				},
			},
			get: () => state,
		};
	}

	it("toggles when given no arg", () => {
		const { io, get } = makeIO(false);
		const r = runApprovalCommand("", io);
		expect(get()).toBe(true);
		expect(r.exitCode).toBe(0);
		expect(r.output).toContain("NOT a security perimeter");
	});

	it("on / off are explicit", () => {
		const { io, get } = makeIO(false);
		runApprovalCommand("on", io);
		expect(get()).toBe(true);
		runApprovalCommand("off", io);
		expect(get()).toBe(false);
	});

	it("status reports without mutating", () => {
		const { io, get } = makeIO(true);
		const r = runApprovalCommand("status", io);
		expect(get()).toBe(true);
		expect(r.output).toContain("Approval mode: on");
	});

	it("rejects unknown arg without mutating", () => {
		const { io, get } = makeIO(false);
		const r = runApprovalCommand("maybe", io);
		expect(r.exitCode).toBe(1);
		expect(get()).toBe(false);
	});
});
