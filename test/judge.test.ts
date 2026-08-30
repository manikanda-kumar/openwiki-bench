import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import { aggregateJudgments, prepareJudgeBatch, RUBRIC_AXES, selectDisagreementTasks, type AxisScores, type PageJudgment } from "../src/judge.js";
import type { RunManifest } from "../src/schema.js";

const scores = (value: number): AxisScores => Object.fromEntries(RUBRIC_AXES.map((axis) => [axis, value])) as AxisScores;

test("prepares a stable blind stratified page batch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "judge-test-"));
  await mkdir(path.join(root, "architecture"), { recursive: true });
  await writeFile(path.join(root, "quickstart.md"), "---\ngenerated: secret-model\n---\nquick");
  await writeFile(path.join(root, "architecture", "overview.md"), "overview");
  await writeFile(path.join(root, "architecture", "other.md"), "other");
  await writeFile(path.join(root, "plan.summary.json"), JSON.stringify({ pages: [
    { path: "/openwiki/architecture/other.md" },
    { path: "/openwiki/quickstart.md" },
    { path: "/openwiki/architecture/overview.md" },
  ] }));
  const manifest = { subject: "subject", model: "secret-model", runtime: "native", seed: 0 } as RunManifest;
  try {
    const first = await prepareJudgeBatch(root, manifest, 2, "seed");
    const second = await prepareJudgeBatch(root, manifest, 2, "seed");
    assert.deepEqual(first, second);
    assert.equal(first.tasks.length, 2);
    assert.deepEqual(new Set(first.tasks.map((task) => task.content)), new Set(["quick", "overview"]));
    assert.ok(!JSON.stringify(first.tasks).includes("secret-model"));
    assert.equal(first.tasks[0]?.wiki_outline.length, 3);
    assert.equal(first.manifest.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("aggregates median tiebreak scores and gates publication on kappa", () => {
  const tasks = [{ id: "page", wiki_id: "wiki", wiki_outline: ["Page"], content: "anonymous" }];
  const judgments: PageJudgment[] = [
    { task_id: "page", judge_id: "a", scores: scores(4), rationale: "" },
    { task_id: "page", judge_id: "b", scores: scores(3), rationale: "" },
    { task_id: "page", judge_id: "c", scores: scores(3), rationale: "" },
  ];
  const aggregate = aggregateJudgments(tasks, judgments, { primary: "a", secondary: "b", tiebreaker: "c" }, {
    wiki: { completeness: 0.5, coverage: 0.5 },
  });
  assert.equal(aggregate.pages[0]?.mean, 3);
  assert.equal(aggregate.wikis[0]?.score, 0.75);
  assert.equal(aggregate.publishable, false);
  assert.ok(aggregate.cohen_kappa < 0.6);
  assert.deepEqual(Object.keys(aggregate.axis_kappa), [...RUBRIC_AXES]);
});

test("requires a tiebreak judgment only when primary judges disagree", () => {
  const tasks = [{ id: "page", wiki_id: "wiki", wiki_outline: ["Page"], content: "anonymous" }];
  const base = [
    { task_id: "page", judge_id: "a", scores: scores(4), rationale: "" },
    { task_id: "page", judge_id: "b", scores: scores(4), rationale: "" },
  ];
  assert.equal(aggregateJudgments(tasks, base, { primary: "a", secondary: "b", tiebreaker: "c" }, {
    wiki: { completeness: 1, coverage: 1 },
  }).publishable, true);
  const disagreement = [...base.slice(0, 1), { ...base[1]!, scores: scores(3) }];
  const aggregate = aggregateJudgments(tasks, disagreement, { primary: "a", secondary: "b", tiebreaker: "c" }, {
    wiki: { completeness: 1, coverage: 1 },
  });
  assert.deepEqual(aggregate.unresolved_tasks, ["page"]);
  assert.equal(aggregate.publishable, false);
  assert.deepEqual(selectDisagreementTasks(tasks, disagreement, "a", "b"), tasks);
  assert.deepEqual(selectDisagreementTasks(tasks, base, "a", "b"), []);
  assert.throws(() => aggregateJudgments(tasks, [...base, base[0]!], { primary: "a", secondary: "b", tiebreaker: "c" }, {
    wiki: { completeness: 1, coverage: 1 },
  }), /Duplicate judgment/u);
});
