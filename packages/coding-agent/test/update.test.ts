import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareVersions, maybeNotifyUpdateAvailable, resolveRemoteRelease } from "../src/cli/update.js";
import { SettingsManager } from "../src/core/settings-manager.js";

describe("WS11 self-update logic", () => {
	const testDir = join(process.cwd(), "test-update-tmp");
	const agentDir = join(testDir, "agent");
	const projectDir = join(testDir, "project");

	beforeEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(projectDir, ".cave"), { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
	});

	function settings() {
		return SettingsManager.create(projectDir, agentDir);
	}

	describe("compareVersions", () => {
		it("orders semver-like tags correctly", () => {
			expect(compareVersions("v1.2.3", "v1.2.2")).toBe(1);
			expect(compareVersions("v1.2.3", "v1.2.3")).toBe(0);
			expect(compareVersions("v1.2.2", "v1.2.3")).toBe(-1);
			expect(compareVersions("v0.65.2", "v0.65.1")).toBe(1);
			expect(compareVersions("v2.0.0", "v1.99.99")).toBe(1);
		});

		it("strips leading 'v' and handles missing components", () => {
			expect(compareVersions("1.2.3", "v1.2.3")).toBe(0);
			expect(compareVersions("v1.0", "v1.0.0")).toBe(-1); // shorter < longer
		});
	});

	describe("resolveRemoteRelease", () => {
		it("returns the tag for stable channel from /releases/latest", async () => {
			const fakeFetch = async (url: string) => {
				expect(url).toContain("/releases/latest");
				return new Response(JSON.stringify({ tag_name: "v1.0.0", published_at: "2026-01-01T00:00:00Z" }), {
					status: 200,
				});
			};
			const release = await resolveRemoteRelease(
				"stable",
				"https://api.github.com",
				fakeFetch as unknown as typeof fetch,
			);
			expect(release?.tag).toBe("v1.0.0");
		});

		it("returns undefined when API call fails", async () => {
			const fakeFetch = async () => new Response("err", { status: 500 });
			const r = await resolveRemoteRelease("stable", "https://api.github.com", fakeFetch as unknown as typeof fetch);
			expect(r).toBeUndefined();
		});

		it("picks beta tag from a list of releases", async () => {
			const fakeFetch = async (url: string) => {
				expect(url).toContain("/releases?per_page=20");
				return new Response(
					JSON.stringify([
						{ tag_name: "v1.0.0", prerelease: false },
						{ tag_name: "v1.1.0-beta.1", prerelease: true },
					]),
					{ status: 200 },
				);
			};
			const release = await resolveRemoteRelease(
				"beta",
				"https://api.github.com",
				fakeFetch as unknown as typeof fetch,
			);
			expect(release?.tag).toBe("v1.1.0-beta.1");
		});
	});

	describe("maybeNotifyUpdateAvailable", () => {
		it("does nothing if autoCheck is off", async () => {
			const s = settings();
			s.setUpdateAutoCheck(false);
			const fakeFetch = async () => {
				throw new Error("should not be called");
			};
			const r = await maybeNotifyUpdateAvailable(s, { fetchImpl: fakeFetch as unknown as typeof fetch });
			expect(r).toBeUndefined();
		});

		it("does nothing within 24h since last check", async () => {
			const s = settings();
			const recent = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1h ago
			s.setUpdateLastCheckedAt(recent);
			const fakeFetch = async () => {
				throw new Error("should not be called");
			};
			const r = await maybeNotifyUpdateAvailable(s, { fetchImpl: fakeFetch as unknown as typeof fetch });
			expect(r).toBeUndefined();
		});

		it("queries when last check is older than 24h", async () => {
			const s = settings();
			const old = new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(); // 2d ago
			s.setUpdateLastCheckedAt(old);
			let called = 0;
			const fakeFetch = async () => {
				called++;
				return new Response(JSON.stringify({ tag_name: "v999.0.0" }), { status: 200 });
			};
			const r = await maybeNotifyUpdateAvailable(s, { fetchImpl: fakeFetch as unknown as typeof fetch });
			expect(called).toBe(1);
			expect(r).toBe("v999.0.0");
			expect(s.getUpdateLastCheckedAt()).toBeDefined();
			expect(s.getUpdateLastNotifiedVersion()).toBe("v999.0.0");
		});

		it("does not re-notify the same version", async () => {
			const s = settings();
			s.setUpdateLastCheckedAt(new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString());
			s.setUpdateLastNotifiedVersion("v999.0.0");
			const fakeFetch = async () => new Response(JSON.stringify({ tag_name: "v999.0.0" }), { status: 200 });
			const r = await maybeNotifyUpdateAvailable(s, { fetchImpl: fakeFetch as unknown as typeof fetch });
			expect(r).toBeUndefined();
		});

		it("respects the configured disable-update env", async () => {
			const s = settings();
			const prev = process.env.MEWRITE_DISABLE_UPDATE_CHECK;
			process.env.MEWRITE_DISABLE_UPDATE_CHECK = "1";
			const fakeFetch = async () => {
				throw new Error("should not be called");
			};
			try {
				const r = await maybeNotifyUpdateAvailable(s, { fetchImpl: fakeFetch as unknown as typeof fetch });
				expect(r).toBeUndefined();
			} finally {
				if (prev === undefined) delete process.env.MEWRITE_DISABLE_UPDATE_CHECK;
				else process.env.MEWRITE_DISABLE_UPDATE_CHECK = prev;
			}
		});
	});
});
