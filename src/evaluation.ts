import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prepareJudgeBatch, type JudgeManifestEntry, type JudgeTask, type WikiPenalty } from "./judge.js";
import { readJson } from "./io.js";
import { prepareProbeTasks, type ProbeTask } from "./probe.js";
import type { RunManifest, ScoresFile } from "./schema.js";
import { checkoutSubject } from "./subject.js";

export interface PreparedJudgeFiles {
  tasks: JudgeTask[];
  manifest: JudgeManifestEntry[];
  penalties: Record<string, WikiPenalty>;
}

export interface PreparedProbeFiles {
  tasks: ProbeTask[];
  manifest: Array<{ task_id: string; wiki_id: string }>;
}

async function runDirectories(projectRoot: string, subjectId: string): Promise<string[]> {
  const root = path.join(projectRoot, "runs", subjectId);
  const result: string[] = [];
  for (const model of (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const modelRoot = path.join(root, model.name);
    for (const seed of (await readdir(modelRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      result.push(path.join(modelRoot, seed.name));
    }
  }
  return result;
}

export async function prepareAllJudgeTasks(options: {
  projectRoot: string;
  subjectId: string;
  pageLimit: number;
  seed: string;
  scoresPath: string;
}): Promise<PreparedJudgeFiles> {
  const scores = await readJson<ScoresFile>(options.scoresPath);
  const scoreByRun = new Map(scores.runs.map((run) => [`${run.model}\0${run.runtime}\0${run.seed}`, run]));
  const tasks: JudgeTask[] = [];
  const manifest: JudgeManifestEntry[] = [];
  const penalties: Record<string, WikiPenalty> = {};
  for (const runRoot of await runDirectories(options.projectRoot, options.subjectId)) {
    const run = await readJson<RunManifest>(path.join(runRoot, "run.json"));
    if (run.outcome !== "complete") continue;
    const batch = await prepareJudgeBatch(runRoot, run, options.pageLimit, options.seed);
    tasks.push(...batch.tasks);
    manifest.push(...batch.manifest);
    const score = scoreByRun.get(`${run.model}\0${run.runtime}\0${run.seed}`);
    if (score === undefined) throw new Error(`Missing deterministic score for ${runRoot}`);
    const wikiId = batch.tasks[0]?.wiki_id;
    if (wikiId !== undefined) penalties[wikiId] = {
      completeness: score.structure.completeness,
      coverage: score.structure.coverage,
    };
  }
  tasks.sort((left, right) => left.id.localeCompare(right.id));
  manifest.sort((left, right) => left.task_id.localeCompare(right.task_id));
  return { tasks, manifest, penalties };
}

export async function prepareAllProbeTasks(options: {
  projectRoot: string;
  subjectId: string;
  repoRoot?: string;
  claimsPerPage: number;
  seed: string;
  judgeManifest: readonly JudgeManifestEntry[];
}): Promise<PreparedProbeFiles> {
  const checkout = await checkoutSubject(options.projectRoot, options.subjectId, options.repoRoot);
  const tasks: ProbeTask[] = [];
  const manifest: PreparedProbeFiles["manifest"] = [];
  try {
    for (const runRoot of await runDirectories(options.projectRoot, options.subjectId)) {
      const run = await readJson<RunManifest>(path.join(runRoot, "run.json"));
      const entries = options.judgeManifest.filter((entry) =>
        entry.subject === run.subject && entry.model === run.model && entry.runtime === run.runtime && entry.seed === run.seed,
      );
      const wikiId = entries[0]?.wiki_id;
      if (wikiId === undefined) continue;
      const includedPages = new Set(entries.map((entry) =>
        entry.page_path.replace(/^\/openwiki\//u, "").replace(/^\//u, "").replace(/\.md$/u, ""),
      ));
      const runTasks = await prepareProbeTasks(
        runRoot,
        checkout.root,
        options.claimsPerPage,
        `${options.seed}\0${wikiId}`,
        includedPages,
      );
      tasks.push(...runTasks);
      manifest.push(...runTasks.map((task) => ({ task_id: task.id, wiki_id: wikiId })));
    }
    return { tasks, manifest };
  } finally {
    await checkout.cleanup();
  }
}

export async function writePreparedEvaluation(
  outputDirectory: string,
  judges: PreparedJudgeFiles,
  probes: PreparedProbeFiles,
): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  const write = (name: string, value: unknown) => writeFile(path.join(outputDirectory, name), `${JSON.stringify(value, null, 2)}\n`);
  await Promise.all([
    write("judge-tasks.json", judges.tasks),
    write("judge-manifest.json", { entries: judges.manifest, penalties: judges.penalties }),
    write("probe-tasks.json", probes.tasks),
    write("probe-manifest.json", probes.manifest),
  ]);
}
