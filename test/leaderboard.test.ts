import assert from "node:assert/strict";
import { test } from "node:test";
import { RUBRIC_AXES, type AxisScores, type JudgeAggregate, type JudgeManifestEntry } from "../src/judge.js";
import { buildCohortLeaderboard, buildLeaderboard, type SubjectEvaluation } from "../src/leaderboard.js";
import type { ProbeAggregate } from "../src/probe.js";
import type { RunScore, ScoresFile } from "../src/schema.js";

const run = (seed: number, subject: string, outcome: RunScore["outcome"] = "complete"): RunScore => ({
  subject,
  model: "model",
  runtime: "native",
  seed,
  outcome,
  grounding: { claims: 1, evidence: 1, resolvable: 1, in_range: 1, exact: 1, resolvable_pct: 1, in_range_pct: 1, exact_pct: 1, claims_per_page: 1, evidence_per_claim: 1 },
  structure: { plan_pages: 1, completed_plan_pages: outcome === "complete" ? 1 : 0, completeness: outcome === "complete" ? 1 : 0, markdown_pages: outcome === "complete" ? 1 : 0, markdown_lines: 1, lines_per_page: 1, citations_per_100_lines: 100, internal_links: 0, resolved_internal_links: 0, link_integrity: 0, coverage_units: 1, covered_units: outcome === "complete" ? 1 : 0, coverage: outcome === "complete" ? 1 : 0, seed_paths: null, covered_seed_paths: null, seed_path_coverage: null, redundancy: 0 },
});

const axisScores = (score: number): AxisScores => Object.fromEntries(RUBRIC_AXES.map((axis) => [axis, score])) as AxisScores;

function evaluation(file: ScoresFile, score: number, secondary = "secondary"): SubjectEvaluation {
  const entries: JudgeManifestEntry[] = [];
  const pages: JudgeAggregate["pages"] = [];
  const wikis: JudgeAggregate["wikis"] = [];
  const probes: Record<string, ProbeAggregate> = {};
  for (const item of file.runs.filter((candidate) => candidate.outcome === "complete")) {
    const wikiId = `wiki-${file.subject.id}-${item.seed}`;
    const taskId = `task-${file.subject.id}-${item.seed}`;
    entries.push({ task_id: taskId, wiki_id: wikiId, subject: file.subject.id, model: item.model, runtime: item.runtime, seed: item.seed, page_path: "page.md" });
    pages.push({ task_id: taskId, wiki_id: wikiId, scores: axisScores(score), mean: score });
    wikis.push({ wiki_id: wikiId, page_mean: score, completeness: 1, coverage: 1, score });
    probes[wikiId] = { total: 1, counts: { supported: 1, unsupported: 0, contradicted: 0 }, support_rate: 1, unsupported_rate: 0, contradiction_rate: 0, contradiction_rate_95_wilson: { low: 0, high: 0.8 } };
  }
  return {
    subject: file.subject.id,
    judged: {
      judges: { primary: "primary", secondary, tiebreaker: "tiebreaker" },
      cohen_kappa: 0.8,
      axis_kappa: axisScores(0.8),
      linear_weighted_cohen_kappa: 0.8,
      axis_linear_weighted_kappa: axisScores(0.8),
      exact_agreement: 0.8,
      axis_exact_agreement: axisScores(0.8),
      publishable: true,
      unresolved_tasks: [],
      pages,
      wikis,
      manifest: entries,
    },
    probes,
  };
}

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

test("cohort aggregation weights subjects equally and penalizes failed trials separately", () => {
  const files: ScoresFile[] = ["one", "two", "three", "four", "five"].map((subject, index) => ({
    schema_version: 1,
    subject: { id: subject, repo_sha: String(index) },
    runs: index === 0
      ? [run(0, subject), run(1, subject), run(2, subject)]
      : [run(0, subject), run(1, subject, "died"), run(2, subject, "died")],
  }));
  const result = buildCohortLeaderboard({
    id: "original-45",
    models: ["model"],
    scoreFiles: files,
    evaluations: files.map((file, index) => evaluation(file, index === 0 ? 4 : 0)),
    panel: { primary: "primary", secondary: "secondary", tiebreaker: "tiebreaker", probe: "probe" },
  });
  assert.equal(result.publishable, true);
  assert.equal(result.systems[0]?.rubric_score?.mean, 0.8);
  assert.equal(result.systems[0]?.reliability_adjusted_rubric_score.mean, 0.8);
  assert.equal(result.systems[0]?.completion_rate, (1 + 4 / 3) / 5);
  assert.deepEqual(result.cohort.models, ["model"]);
});

test("cohort aggregation rejects mixed judge panels and incomplete probe coverage", () => {
  const files: ScoresFile[] = ["one", "two", "three", "four", "five"].map((subject, index) => ({
    schema_version: 1,
    subject: { id: subject, repo_sha: String(index) },
    runs: [run(0, subject), run(1, subject), run(2, subject)],
  }));
  const panel = { primary: "primary", secondary: "secondary", tiebreaker: "tiebreaker", probe: "probe" };
  const mixed = files.map((file, index) => evaluation(file, 2, index === 1 ? "opus" : "secondary"));
  assert.throws(() => buildCohortLeaderboard({ id: "mixed", models: ["model"], scoreFiles: files, evaluations: mixed, panel }), /different judge panel/u);
  const incomplete = files.map((file) => evaluation(file, 2));
  delete (incomplete[0]!.probes as Record<string, unknown>)[Object.keys(incomplete[0]!.probes)[0]!];
  assert.throws(() => buildCohortLeaderboard({ id: "incomplete", models: ["model"], scoreFiles: files, evaluations: incomplete, panel }), /probe coverage/u);
});
