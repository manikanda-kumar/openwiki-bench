import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import { hashText, parseResource, scoreGrounding, splitSourceLines } from "../src/grounding.js";

test("splitSourceLines preserves terminators without a phantom line", () => {
  assert.deepEqual(splitSourceLines("one\r\ntwo\n"), ["one\r\n", "two\n"]);
  assert.deepEqual(splitSourceLines(""), []);
});

test("hashText matches the repo-lines-v1 sha256 definition", () => {
  assert.equal(hashText("hello\n"), "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03");
});

test("parseResource accepts canonical evidence and rejects escapes", () => {
  assert.deepEqual(parseResource("repo://src/a.ts#L2-L4"), { path: "src/a.ts", startLine: 2, endLine: 4 });
  assert.equal(parseResource("repo://../secret#L1"), null);
  assert.equal(parseResource("repo://openwiki/page.md#L1"), null);
});

test("scoreGrounding separates resolution, range validity, and exact versions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "grounding-test-"));
  const repo = path.join(root, "repo");
  const run = path.join(root, "run");
  await Promise.all([mkdir(repo), mkdir(path.join(run, ".claims"), { recursive: true })]);
  const source = "one\ntwo\n";
  await writeFile(path.join(repo, "source.ts"), source);
  const emptyHash = hashText("");
  const metadata = Buffer.from(JSON.stringify({
    selectedLineCount: 1,
    firstSelectedLineHash: hashText("one\n"),
    lastSelectedLineHash: hashText("one\n"),
    precedingContextLineCount: 0,
    precedingContextHash: emptyHash,
    followingContextLineCount: 1,
    followingContextHash: hashText("two\n"),
  })).toString("base64url");
  await writeFile(path.join(run, ".claims", "page.json"), JSON.stringify({
    schemaVersion: 1,
    claims: [{
      id: "claim_1",
      statement: "test",
      evidence: [
        { resource: "repo://source.ts#L1-L1", version: `repo-lines-v1:sha256:${hashText("one\n")}:${metadata}` },
        { resource: "repo://source.ts#L2-L2", version: `repo-lines-v1:sha256:${hashText("two\n")}` },
        { resource: "repo://source.ts#L3-L3", version: "invalid" },
      ],
    }],
  }));
  try {
    const { score } = await scoreGrounding(run, repo);
    assert.deepEqual(
      { evidence: score.evidence, resolvable: score.resolvable, inRange: score.in_range, exact: score.exact },
      { evidence: 3, resolvable: 3, inRange: 2, exact: 1 },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
