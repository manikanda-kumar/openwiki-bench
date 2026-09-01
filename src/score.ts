import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { scoreGrounding } from "./grounding.js";
import { readJson } from "./io.js";
import { loadPlan, scoreStructure } from "./structure.js";
import type { RunManifest, RunScore, ScoresFile } from "./schema.js";
import { checkoutSubject } from "./subject.js";

export async function scoreAll(options: {
  projectRoot: string;
  subjectId: string;
  repoRoot?: string;
  output?: string;
}): Promise<ScoresFile> {
  const checkout = await checkoutSubject(options.projectRoot, options.subjectId, options.repoRoot);
  const { subject, root: repoRoot } = checkout;
  try {
    const runsRoot = path.join(options.projectRoot, "runs", subject.id);
    const modelDirectories = (await readdir(runsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const runs: RunScore[] = [];
    for (const modelDirectory of modelDirectories) {
      const seedsRoot = path.join(runsRoot, modelDirectory);
      const seeds = (await readdir(seedsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      for (const seed of seeds) {
        const runRoot = path.join(seedsRoot, seed);
        const [manifest, plan, grounding] = await Promise.all([
          readJson<RunManifest>(path.join(runRoot, "run.json")),
          loadPlan(runRoot),
          scoreGrounding(runRoot, repoRoot),
        ]);
        if (manifest.repo_sha !== subject.repo_sha || manifest.subject !== subject.id) {
          throw new Error(`Run manifest does not match subject: ${runRoot}`);
        }
        runs.push({
          subject: manifest.subject,
          model: manifest.model,
          runtime: manifest.runtime,
          seed: manifest.seed,
          outcome: manifest.outcome,
          grounding: grounding.score,
          structure: await scoreStructure(
            runRoot,
            repoRoot,
            plan,
            grounding.score.evidence,
            grounding.citedFiles,
            grounding.citedFilesByPage,
          ),
        });
      }
    }
    const scores: ScoresFile = {
      schema_version: 1,
      subject: { id: subject.id, repo_sha: subject.repo_sha },
      runs,
    };
    const output = path.resolve(options.output ?? path.join(options.projectRoot, "results", "scores.json"));
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(scores, null, 2)}\n`);
    return scores;
  } finally {
    await checkout.cleanup();
  }
}
