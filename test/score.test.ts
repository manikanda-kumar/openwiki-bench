import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { scoreAll } from "../src/score.js";

const exec = promisify(execFile);

test("scores an early failed run without a plan summary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "score-test-"));
  const subject = path.join(root, "subject");
  await mkdir(subject);
  await exec("git", ["init", "-q"], { cwd: subject });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: subject });
  await exec("git", ["config", "user.name", "Test"], { cwd: subject });
  await writeFile(path.join(subject, "README.md"), "subject\n");
  await exec("git", ["add", "."], { cwd: subject });
  await exec("git", ["commit", "-qm", "subject"], { cwd: subject });
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: subject });
  const repoSha = stdout.trim();
  const runRoot = path.join(root, "runs", "subject", "model", "seed-0");
  await mkdir(path.join(root, "subjects"));
  await mkdir(runRoot, { recursive: true });
  await writeFile(path.join(root, "subjects", "subject.json"), JSON.stringify({
    id: "subject", repo_url: subject, repo_sha: repoSha, contamination: "test", notes: null,
  }));
  await writeFile(path.join(runRoot, "run.json"), JSON.stringify({
    subject: "subject", repo_sha: repoSha, model: "model", runtime: "host-opencode",
    openwiki_version: "test", seed: 0, started_at: null, finished_at: null, wall_seconds: 1,
    outcome: "died", deaths: [{ phase: "contract", error: "forbidden subagent task", at: null }],
    resumes: 0, env: { provider: "test", base_url: null, streaming: null, headers_timeout_ms: null },
    prompt_sha: null, ignore_sha: null, cost: { input_tokens: null, output_tokens: null, usd: null, source: "none" },
  }));
  try {
    const scores = await scoreAll({ projectRoot: root, subjectId: "subject", repoRoot: subject });
    assert.equal(scores.runs.length, 1);
    assert.equal(scores.runs[0]?.outcome, "died");
    assert.equal(scores.runs[0]?.structure.plan_pages, 0);
    assert.equal(scores.runs[0]?.structure.completeness, 0);
    assert.equal(scores.runs[0]?.structure.coverage, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
