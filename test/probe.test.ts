import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import { hashText } from "../src/grounding.js";
import { aggregateProbeLabels, prepareProbeTasks, wilsonInterval } from "../src/probe.js";

function evidence(resource: string, text: string): { resource: string; version: string } {
  return { resource, version: `repo-lines-v1:sha256:${hashText(text)}:e30` };
}

test("prepares deterministic, blind, per-page samples and handles short pages", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "probe-test-"));
  const repo = path.join(root, "repo");
  const run = path.join(root, "run");
  await mkdir(repo);
  await mkdir(path.join(run, ".claims", "nested"), { recursive: true });
  await writeFile(path.join(repo, "secret.ts"), "alpha\nbeta\ngamma\n");
  const makeClaim = (id: string, line: number, text: string) => ({
    id, statement: `statement ${id}`, evidence: [evidence(`repo://secret.ts#L${line}-L${line}`, `${text}\n`)],
  });
  await writeFile(path.join(run, ".claims", "many.json"), JSON.stringify({
    schemaVersion: 1, claims: [makeClaim("a", 1, "alpha"), makeClaim("b", 2, "beta"), makeClaim("c", 3, "gamma")],
  }));
  await writeFile(path.join(run, ".claims", "nested", "short.json"), JSON.stringify({
    schemaVersion: 1, claims: [makeClaim("only", 1, "alpha")],
  }));
  try {
    const first = await prepareProbeTasks(run, repo, 2, "caller-seed");
    const second = await prepareProbeTasks(run, repo, 2, "caller-seed");
    assert.deepEqual(first, second);
    assert.equal(first.length, 3);
    assert.ok(first.every((task) => task.id.startsWith("probe_") && !JSON.stringify(task).includes("secret.ts")));
    assert.ok(first.every((task) => Object.keys(task).sort().join(",") === "id,sources,statement"));
    assert.ok(first.every((task) => task.sources.every((source) => /^(?:alpha|beta|gamma)\n$/u.test(source))));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("aggregates labels and computes the 95% Wilson interval", () => {
  const result = aggregateProbeLabels([
    { id: "a", label: "supported" },
    { id: "b", label: "unsupported" },
    { id: "c", label: "contradicted" },
    { id: "d", label: "contradicted" },
  ]);
  assert.deepEqual(result.counts, { supported: 1, unsupported: 1, contradicted: 2 });
  assert.equal(result.support_rate, 0.25);
  assert.equal(result.unsupported_rate, 0.25);
  assert.equal(result.contradiction_rate, 0.5);
  assert.ok(Math.abs(result.contradiction_rate_95_wilson.low - 0.15003899) < 1e-6);
  assert.ok(Math.abs(result.contradiction_rate_95_wilson.high - 0.84996101) < 1e-6);
  assert.deepEqual(wilsonInterval(0, 0), { low: 0, high: 0 });
  assert.throws(() => aggregateProbeLabels([{ id: "x", label: "supported" }, { id: "x", label: "contradicted" }]));
});
