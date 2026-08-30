import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readJson } from "./io.js";
import type { SubjectManifest } from "./schema.js";

const exec = promisify(execFile);

export interface SubjectCheckout {
  subject: SubjectManifest;
  root: string;
  cleanup: () => Promise<void>;
}

export async function assertRepoSha(repoRoot: string, expected: string): Promise<void> {
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  if (stdout.trim() !== expected) throw new Error(`Subject checkout is ${stdout.trim()}, expected ${expected}`);
}

export async function checkoutSubject(
  projectRoot: string,
  subjectId: string,
  existingRoot?: string,
): Promise<SubjectCheckout> {
  const subject = await readJson<SubjectManifest>(path.join(projectRoot, "subjects", `${subjectId}.json`));
  if (existingRoot !== undefined) {
    const root = path.resolve(existingRoot);
    await assertRepoSha(root, subject.repo_sha);
    return { subject, root, cleanup: async () => undefined };
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "openwiki-bench-"));
  try {
    await exec("git", ["clone", "--quiet", "--filter=blob:none", "--no-checkout", subject.repo_url, root]);
    await exec("git", ["checkout", "--quiet", "--detach", subject.repo_sha], { cwd: root });
    return { subject, root, cleanup: () => rm(root, { recursive: true, force: true }) };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
