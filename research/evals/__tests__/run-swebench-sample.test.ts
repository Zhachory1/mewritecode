/**
 * run-swebench-sample.test.ts — unit tests for the PURE diverse-sampling helper
 * (#33 / council change B). NO network, NO filesystem: the helper operates on an
 * in-memory array of repo-tagged instances exactly as run-swebench feeds it the
 * loaded dataset.
 */

import { describe, expect, it } from "vitest";
import { diverseSample } from "../run-swebench.js";

interface Inst {
	id: string;
	repo: string;
}

/** Build a repo-sorted (first-N-skews-to-one-repo) dataset like SWE-bench Verified. */
function dataset(): Inst[] {
	const out: Inst[] = [];
	for (let i = 0; i < 5; i++) out.push({ id: `astropy-${i}`, repo: "astropy/astropy" });
	for (let i = 0; i < 3; i++) out.push({ id: `django-${i}`, repo: "django/django" });
	for (let i = 0; i < 2; i++) out.push({ id: `flask-${i}`, repo: "pallets/flask" });
	return out;
}

describe("diverseSample", () => {
	it("round-robins across distinct repos so a small limit spreads over repos", () => {
		const out = diverseSample(dataset(), 3);
		expect(out).toHaveLength(3);
		// one from each distinct repo, in first-seen repo order
		expect(out.map((i) => i.repo)).toEqual(["astropy/astropy", "django/django", "pallets/flask"]);
		expect(out.map((i) => i.id)).toEqual(["astropy-0", "django-0", "flask-0"]);
	});

	it("contrasts with first-N: first-3 of the repo-sorted set is all one repo", () => {
		const data = dataset();
		const firstN = data.slice(0, 3); // what --sample first does
		expect(new Set(firstN.map((i) => i.repo)).size).toBe(1); // all astropy
		const diverse = diverseSample(data, 3);
		expect(new Set(diverse.map((i) => i.repo)).size).toBe(3); // spread
	});

	it("does a second pass once each repo has been sampled once", () => {
		const out = diverseSample(dataset(), 5);
		// round 1: astropy-0, django-0, flask-0 ; round 2: astropy-1, django-1
		expect(out.map((i) => i.id)).toEqual(["astropy-0", "django-0", "flask-0", "astropy-1", "django-1"]);
	});

	it("preserves within-repo order and drains exhausted repos without stalling", () => {
		// limit larger than the smallest repos forces draining of flask then django.
		const out = diverseSample(dataset(), 100);
		expect(out).toHaveLength(10); // all instances returned
		const astropyOrder = out.filter((i) => i.repo === "astropy/astropy").map((i) => i.id);
		expect(astropyOrder).toEqual(["astropy-0", "astropy-1", "astropy-2", "astropy-3", "astropy-4"]);
	});

	it("undefined/0 limit returns the full round-robin reordering (no truncation)", () => {
		expect(diverseSample(dataset()).length).toBe(10);
		expect(diverseSample(dataset(), 0).length).toBe(10);
	});

	it("limit larger than available returns everything, never loops forever", () => {
		const out = diverseSample(dataset(), 50);
		expect(out).toHaveLength(10);
	});

	it("single-repo dataset degrades to in-order first-N", () => {
		const single: Inst[] = [0, 1, 2, 3].map((i) => ({ id: `a-${i}`, repo: "a/a" }));
		expect(diverseSample(single, 2).map((i) => i.id)).toEqual(["a-0", "a-1"]);
	});
});
