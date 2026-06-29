import { afterEach, describe, expect, test, vi } from "vitest";
import { SessionManager } from "../src/core/session-manager.js";
import { resolveSessionReference } from "../src/modes/interactive/session-reference.js";

describe("resolveSessionReference", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("treats paths as direct session paths", async () => {
		await expect(resolveSessionReference("/tmp/session.jsonl", "/repo")).resolves.toEqual({
			type: "path",
			path: "/tmp/session.jsonl",
		});
	});

	test("resolves partial IDs from local sessions first", async () => {
		vi.spyOn(SessionManager, "list").mockResolvedValue([
			{
				id: "abcdef12",
				path: "/repo/.sessions/abcdef12.jsonl",
				cwd: "/repo",
				created: new Date(0),
				modified: new Date(0),
				messageCount: 1,
				firstMessage: "hello",
				allMessagesText: "hello",
			},
		]);
		vi.spyOn(SessionManager, "listAll").mockResolvedValue([]);

		await expect(resolveSessionReference("abc", "/repo", "/repo/.sessions")).resolves.toEqual({
			type: "local",
			path: "/repo/.sessions/abcdef12.jsonl",
		});
	});

	test("falls back to global sessions", async () => {
		vi.spyOn(SessionManager, "list").mockResolvedValue([]);
		vi.spyOn(SessionManager, "listAll").mockResolvedValue([
			{
				id: "fedcba98",
				path: "/other/fedcba98.jsonl",
				cwd: "/other",
				created: new Date(0),
				modified: new Date(0),
				messageCount: 1,
				firstMessage: "hello",
				allMessagesText: "hello",
			},
		]);

		await expect(resolveSessionReference("fed", "/repo")).resolves.toEqual({
			type: "global",
			path: "/other/fedcba98.jsonl",
			cwd: "/other",
		});
	});

	test("reports not found when no session matches", async () => {
		vi.spyOn(SessionManager, "list").mockResolvedValue([]);
		vi.spyOn(SessionManager, "listAll").mockResolvedValue([]);

		await expect(resolveSessionReference("missing", "/repo")).resolves.toEqual({
			type: "not_found",
			arg: "missing",
		});
	});
});
