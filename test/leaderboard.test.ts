import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLeaderboard } from "../src/leaderboard.js";
import type { RunScore, ScoresFile } from "../src/schema.js";

const run = (seed: number, subject: string): RunScore => ({
  subject,
  model: "model",
  runtime: "native",
  seed,
  outcome: "complete",
  grounding: { claims: 1, evidence: 1, resolvable: 1, in_range: 1, exact: 1, resolvable_pct: 1, in_range_pct: 1, exact_pct: 1, claims_per_page: 1, evidence_per_claim: 1 },
  structure: { plan_pages: 1, completed_plan_pages: 1, completeness: 1, markdown_pages: 1, markdown_lines: 1, lines_per_page: 1, citations_per_100_lines: 100, internal_links: 0, resolved_internal_links: 0, link_integrity: 0, coverage_units: 1, covered_units: 1, coverage: 1, seed_paths: null, covered_seed_paths: null, seed_path_coverage: null, redundancy: 0 },
});

test("requires three trials, five subjects, judges, and probes before publication", () => {
  const files: ScoresFile[] = ["one", "two", "three", "four", "five"].map((subject, index) => ({
    schema_version: 1,
    subject: { id: subject, repo_sha: String(index) },
    runs: [run(0, subject), run(1, subject), run(2, subject)],
  }));
  const incomplete = buildLeaderboard({ scoreFiles: files });
  assert.equal(incomplete.publishable, false);
  assert.ok(incomplete.blockers.includes("blind rubric judging has not been run"));
  assert.equal(incomplete.systems[0]?.seeds, 3);
  assert.equal(incomplete.systems[0]?.seeds_per_subject_min, 3);
  assert.equal(incomplete.systems[0]?.subjects, 5);
});
