import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { redactSensitiveText, runSystem } from "../src/run.js";

const exec = promisify(execFile);

test("redacts Google OAuth credentials from retained raw artifacts", () => {
  const input = "123456789012-example.apps.googleusercontent.com GOCSPX-example_secret";
  assert.equal(redactSensitiveText(input), "REDACTED_GOOGLE_OAUTH_CLIENT_ID REDACTED_GOOGLE_OAUTH_CLIENT_SECRET");
});

test("runs a configured system in a pinned isolated checkout and captures artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "run-test-"));
  const subject = path.join(root, "subject");
  await mkdir(subject);
  await exec("git", ["init", "-q"], { cwd: subject });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: subject });
  await exec("git", ["config", "user.name", "Test"], { cwd: subject });
  await writeFile(path.join(subject, "AGENTS.md"), "instructions");
  await exec("git", ["add", "."], { cwd: subject });
  await exec("git", ["commit", "-qm", "subject"], { cwd: subject });
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: subject });
  await mkdir(path.join(root, "subjects"));
  await writeFile(path.join(root, "subjects", "subject.json"), JSON.stringify({
    id: "subject", repo_url: subject, repo_sha: stdout.trim(), contamination: "test", notes: null,
  }));
  const prompt = path.join(root, "prompt.txt");
  const config = path.join(root, "system.json");
  await writeFile(prompt, "do work");
  const command = [
    "const fs = require('fs')",
    "fs.mkdirSync('openwiki', {recursive:true})",
    "fs.writeFileSync('openwiki/index.md', process.env.OPENWIKI_BENCH_SEED)",
    "fs.writeFileSync('openwiki/.run.json', JSON.stringify({plan:{pages:[{path:'/openwiki/page.md',status:'pending'}],deletePages:[]}}))",
    "setTimeout(() => fs.unlinkSync('openwiki/.run.json'), 250)",
  ].join(";");
  await writeFile(config, JSON.stringify({
    id: "fake", model: "fake-model", runtime: "native", openwiki_version: "test",
    command: [process.execPath, "-e", command], env_passthrough: [], env: {}, output_directory: "openwiki",
  }));
  try {
    const result = await runSystem({ projectRoot: root, subjectId: "subject", configPath: config, seed: 2, promptPath: prompt });
    assert.equal(await readFile(path.join(result.directory, "index.md"), "utf8"), "2");
    assert.equal(result.manifest.outcome, "complete");
    assert.equal(result.manifest.seed, 2);
    const plan = JSON.parse(await readFile(path.join(result.directory, "plan.summary.json"), "utf8")) as { plan_page_count: number; statuses: Record<string, number> };
    assert.equal(plan.plan_page_count, 1);
    assert.deepEqual(plan.statuses, { pending: 1 });
    await assert.rejects(runSystem({ projectRoot: root, subjectId: "subject", configPath: config, seed: 2, promptPath: prompt }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
