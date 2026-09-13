import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import { RUBRIC_AXES, type AxisScores } from "../src/judge.js";
import type { CohortLeaderboard } from "../src/leaderboard.js";
import { generateCohortReport } from "../src/report.js";

const axes = Object.fromEntries(RUBRIC_AXES.map((axis) => [axis, 0.5])) as AxisScores;
const statistic = { mean: 0.5, stddev: 0.1 };

function cohort(id: string, models: string[]): CohortLeaderboard {
  return {
    schema_version: 2,
    cohort: { id, models, subjects: ["subject"] },
    panel: { primary: "primary", secondary: "secondary", tiebreaker: "tiebreaker", probe: "probe" },
    systems: [{
      model: models[0]!,
      runtime: "host-opencode",
      runs: 3,
      seeds: 3,
      seeds_per_subject_min: 3,
      subjects: 1,
      completion_rate: 0.5,
      exact: statistic,
      completeness: statistic,
      coverage: statistic,
      link_integrity: statistic,
      rubric_score: statistic,
      rubric_axes: Object.fromEntries(RUBRIC_AXES.map((axis) => [axis, statistic])) as Record<keyof AxisScores, typeof statistic>,
      reliability_adjusted_rubric_score: statistic,
      support_rate: statistic,
      contradiction_rate: statistic,
      statistically_publishable: false,
      per_subject: { subject: { runs: 3, completion_rate: 0.5, rubric_score: 0.5, reliability_adjusted_rubric_score: 0.5, support_rate: 0.5, contradiction_rate: 0.5 } },
    }],
    subject_agreement: { subject: { cohen_kappa: 0.5, axis_kappa: axes, linear_weighted_cohen_kappa: 0.5, axis_linear_weighted_kappa: axes, exact_agreement: 0.5, axis_exact_agreement: axes } },
    publishable: false,
    blockers: ["subject: primary-judge linear-weighted Cohen's kappa is below 0.6"],
  };
}

test("final cohort report withholds recommendations when publication is blocked", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cohort-report-"));
  const original = path.join(root, "original.json");
  const amended = path.join(root, "amended.json");
  const output = path.join(root, "report.md");
  try {
    await Promise.all([
      writeFile(original, JSON.stringify(cohort("original-45", ["model"]))),
      writeFile(amended, JSON.stringify(cohort("amended-60", ["model", "smaug"]))),
    ]);
    await generateCohortReport({ originalPath: original, amendedPath: amended, outputPath: output });
    const report = await readFile(output, "utf8");
    assert.equal(report.match(/\*\*Recommendation:\*\* Withheld\./gu)?.length, 2);
    assert.equal(report.match(/\| Exact grounding \|/gu)?.length, 2);
    assert.equal(report.match(/\| Subject \| Weighted κ \|/gu)?.length, 2);
    assert.match(report, /No table order is a ranking unless its cohort passes every publication gate/u);
    assert.match(report, /coding-specialization hypothesis cannot be accepted or rejected/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
