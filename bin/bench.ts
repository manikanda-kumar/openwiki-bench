#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAmpTask, type AmpModeConfig, type AmpTaskProvenance } from "../src/amp.js";
import { aggregateTelemetryByRun, readTelemetry } from "../src/cost.js";
import { prepareAllJudgeTasks, prepareAllProbeTasks, writePreparedEvaluation } from "../src/evaluation.js";
import { aggregateJudgments, parseJudgeResponse, runOpenAICompatibleJudge, selectDisagreementTasks, type JudgeManifestEntry, type JudgeTask, type OpenAICompatibleJudge, type PageJudgment, type WikiPenalty } from "../src/judge.js";
import { buildLeaderboard } from "../src/leaderboard.js";
import { aggregateProbeLabels, parseProbeResponse, runOpenAIProbeJudge, type ImportedProbeLabel, type OpenAICompatibleProbeJudge, type ProbeTask } from "../src/probe.js";
import { generateReport } from "../src/report.js";
import { runSystem } from "../src/run.js";
import { scoreAll } from "../src/score.js";
import type { JudgeAggregate } from "../src/judge.js";
import type { ProbeAggregate } from "../src/probe.js";
import type { ScoresFile } from "../src/schema.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function integerOption(args: string[], name: string, fallback: number): number {
  const value = option(args, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

async function json<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(path.resolve(file), "utf8")) as T;
}

async function optionalJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return await json<T>(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const output = path.resolve(file);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`);
}

function required(args: string[], name: string): string {
  const value = option(args, name);
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const evaluationRoot = path.join(projectRoot, "results", option(args, "--subject") ?? "", "evaluation");
  if (command === "prepare") {
    const subjectId = option(args, "--subject") ?? "background-agents";
    const judgeFiles = await prepareAllJudgeTasks({
      projectRoot,
      subjectId,
      pageLimit: integerOption(args, "--pages", 8),
      seed: option(args, "--seed") ?? "openwiki-bench-v1",
      scoresPath: path.resolve(option(args, "--scores") ?? path.join(projectRoot, "results", "scores.json")),
    });
    const repoRoot = option(args, "--repo");
    const probeFiles = await prepareAllProbeTasks({
      projectRoot,
      subjectId,
      ...(repoRoot === undefined ? {} : { repoRoot }),
      claimsPerPage: integerOption(args, "--claims", 2),
      seed: option(args, "--seed") ?? "openwiki-bench-v1",
      judgeManifest: judgeFiles.manifest,
    });
    const output = path.resolve(option(args, "--output") ?? evaluationRoot);
    await writePreparedEvaluation(output, judgeFiles, probeFiles);
    process.stdout.write(`Prepared ${judgeFiles.tasks.length} blind page tasks and ${probeFiles.tasks.length} contradiction probes -> ${output}\n`);
    return;
  }
  if (command === "run") {
    const ignorePath = option(args, "--ignore");
    const result = await runSystem({
      projectRoot,
      subjectId: option(args, "--subject") ?? "background-agents",
      configPath: path.resolve(required(args, "--system")),
      seed: integerOption(args, "--seed", 0),
      promptPath: path.resolve(required(args, "--prompt")),
      ...(ignorePath === undefined ? {} : { ignorePath: path.resolve(ignorePath) }),
    });
    process.stdout.write(`Completed run -> ${result.directory}\n`);
    return;
  }
  if (command === "judge" && args[1] === "run") {
    const config = await json<OpenAICompatibleJudge>(required(args, "--config"));
    const tasks = await json<JudgeTask[]>(option(args, "--tasks") ?? path.join(evaluationRoot, "judge-tasks.json"));
    const privateManifest = await json<{ entries: JudgeManifestEntry[] }>(option(args, "--manifest") ?? path.join(evaluationRoot, "judge-manifest.json"));
    const conflicts = [...new Set(privateManifest.entries.filter((entry) => config.contestant_models.includes(entry.model)).map((entry) => entry.model))];
    if (conflicts.length > 0) throw new Error(`Judge ${config.id} is excluded from contestant model(s): ${conflicts.join(", ")}`);
    const output = option(args, "--output") ?? path.join(evaluationRoot, `judgments-${config.id}.json`);
    const existing = await optionalJson<PageJudgment[]>(output, []);
    const completed = new Set(existing.filter((judgment) => judgment.judge_id === config.id).map((judgment) => judgment.task_id));
    const pending = tasks.filter((task) => !completed.has(task.id));
    await runOpenAICompatibleJudge(pending, await readFile(path.join(projectRoot, "rubric.md"), "utf8"), config, async (judgment) => {
      existing.push(judgment);
      await writeJson(output, existing);
    });
    process.stdout.write(`Recorded ${existing.length} judgments (${pending.length} new) -> ${output}\n`);
    return;
  }
  if (command === "judge" && args[1] === "run-amp") {
    const config = await json<AmpModeConfig>(required(args, "--config"));
    const tasks = await json<JudgeTask[]>(option(args, "--tasks") ?? path.join(evaluationRoot, "judge-tasks.json"));
    const privateManifest = await json<{ entries: JudgeManifestEntry[] }>(option(args, "--manifest") ?? path.join(evaluationRoot, "judge-manifest.json"));
    const conflicts = [...new Set(privateManifest.entries.filter((entry) => config.contestant_models?.includes(entry.model)).map((entry) => entry.model))];
    if (conflicts.length > 0) throw new Error(`Judge ${config.id} is excluded from contestant model(s): ${conflicts.join(", ")}`);
    const output = option(args, "--output") ?? path.join(evaluationRoot, `judgments-${config.id}.json`);
    const provenanceOutput = option(args, "--provenance") ?? path.join(evaluationRoot, `judge-provenance-${config.id}.json`);
    const existing = await optionalJson<PageJudgment[]>(output, []);
    const provenance = await optionalJson<AmpTaskProvenance[]>(provenanceOutput, []);
    const completed = new Set(existing.filter((judgment) => judgment.judge_id === config.id).map((judgment) => judgment.task_id));
    const limit = integerOption(args, "--limit", Number.MAX_SAFE_INTEGER);
    const pending = tasks.filter((task) => !completed.has(task.id)).slice(0, limit);
    const rubric = await readFile(path.join(projectRoot, "rubric.md"), "utf8");
    for (const task of pending) {
      const prompt = `${rubric}\n\nAnonymous wiki outline:\n${task.wiki_outline.map((title) => `- ${title}`).join("\n")}\n\nEvaluate this page:\n\n${task.content}`;
      const result = await runAmpTask(task.id, prompt, config);
      existing.push({ task_id: task.id, judge_id: config.id, ...parseJudgeResponse(result.response) });
      provenance.push(result.provenance);
      await Promise.all([writeJson(output, existing), writeJson(provenanceOutput, provenance)]);
      process.stdout.write(`Recorded ${config.id} judgment ${existing.length}/${tasks.length} (${task.id})\n`);
    }
    return;
  }
  if (command === "judge" && args[1] === "disagreements") {
    const tasks = await json<JudgeTask[]>(option(args, "--tasks") ?? path.join(evaluationRoot, "judge-tasks.json"));
    const primary = required(args, "--primary");
    const secondary = required(args, "--secondary");
    const primaryJudgments = await json<PageJudgment[]>(required(args, "--primary-judgments"));
    const secondaryJudgments = await json<PageJudgment[]>(required(args, "--secondary-judgments"));
    const selected = selectDisagreementTasks(tasks, [...primaryJudgments, ...secondaryJudgments], primary, secondary);
    const output = option(args, "--output") ?? path.join(evaluationRoot, "judge-tiebreak-tasks.json");
    await writeJson(output, selected);
    process.stdout.write(`Selected ${selected.length} disagreement tasks -> ${output}\n`);
    return;
  }
  if (command === "judge" && args[1] === "aggregate") {
    const tasks = await json<JudgeTask[]>(option(args, "--tasks") ?? path.join(evaluationRoot, "judge-tasks.json"));
    const privateManifest = await json<{ entries: JudgeManifestEntry[]; penalties: Record<string, WikiPenalty> }>(option(args, "--manifest") ?? path.join(evaluationRoot, "judge-manifest.json"));
    const judgmentFiles = required(args, "--judgments").split(",");
    const judgments = (await Promise.all(judgmentFiles.map((file) => json<PageJudgment[]>(file)))).flat();
    const judgeIds = required(args, "--judges").split(",");
    if (judgeIds.length !== 3 || judgeIds.some((id) => !id)) throw new Error("--judges requires primary,secondary,tiebreaker");
    const aggregate = aggregateJudgments(tasks, judgments, {
      primary: judgeIds[0]!, secondary: judgeIds[1]!, tiebreaker: judgeIds[2]!,
    }, privateManifest.penalties);
    const output = option(args, "--output") ?? path.join(evaluationRoot, "judged-scores.json");
    await writeJson(output, { ...aggregate, manifest: privateManifest.entries });
    process.stdout.write(`Aggregated judgments (weighted-kappa=${aggregate.linear_weighted_cohen_kappa.toFixed(3)}, exact=${aggregate.exact_agreement.toFixed(3)}, publishable=${aggregate.publishable}) -> ${output}\n`);
    return;
  }
  if (command === "probe" && args[1] === "run") {
    const config = await json<OpenAICompatibleProbeJudge>(required(args, "--config"));
    const tasks = await json<ProbeTask[]>(option(args, "--tasks") ?? path.join(evaluationRoot, "probe-tasks.json"));
    const output = option(args, "--output") ?? path.join(evaluationRoot, `probe-labels-${config.id}.json`);
    const existing = await optionalJson<ImportedProbeLabel[]>(output, []);
    const completed = new Set(existing.map((label) => label.id));
    const pending = tasks.filter((task) => !completed.has(task.id));
    await runOpenAIProbeJudge(pending, config, async (label) => {
      existing.push(label);
      await writeJson(output, existing);
    });
    process.stdout.write(`Recorded ${existing.length} probe labels (${pending.length} new) -> ${output}\n`);
    return;
  }
  if (command === "probe" && args[1] === "run-amp") {
    const config = await json<AmpModeConfig>(required(args, "--config"));
    const tasks = await json<ProbeTask[]>(option(args, "--tasks") ?? path.join(evaluationRoot, "probe-tasks.json"));
    const output = option(args, "--output") ?? path.join(evaluationRoot, `probe-labels-${config.id}.json`);
    const provenanceOutput = option(args, "--provenance") ?? path.join(evaluationRoot, `probe-provenance-${config.id}.json`);
    const existing = await optionalJson<ImportedProbeLabel[]>(output, []);
    const provenance = await optionalJson<AmpTaskProvenance[]>(provenanceOutput, []);
    const completed = new Set(existing.map((label) => label.id));
    const limit = integerOption(args, "--limit", Number.MAX_SAFE_INTEGER);
    const pending = tasks.filter((task) => !completed.has(task.id)).slice(0, limit);
    for (const task of pending) {
      const prompt = `Decide whether the statement follows from only the supplied source excerpts. Label supported when the excerpts establish it, unsupported when they do not establish it, and contradicted only when they establish the opposite. Return one JSON object and nothing else: {"label":"supported|unsupported|contradicted","rationale":"brief explanation"}.\n\nStatement:\n${task.statement}\n\nSource excerpts:\n${task.sources.map((source, index) => `--- source ${index + 1} ---\n${source}`).join("\n")}`;
      const result = await runAmpTask(task.id, prompt, config);
      existing.push({ id: task.id, ...parseProbeResponse(result.response) });
      provenance.push(result.provenance);
      await Promise.all([writeJson(output, existing), writeJson(provenanceOutput, provenance)]);
      process.stdout.write(`Recorded ${config.id} probe ${existing.length}/${tasks.length} (${task.id})\n`);
    }
    return;
  }
  if (command === "probe" && args[1] === "aggregate") {
    const labels = await json<ImportedProbeLabel[]>(required(args, "--labels"));
    const manifest = await json<Array<{ task_id: string; wiki_id: string }>>(option(args, "--manifest") ?? path.join(evaluationRoot, "probe-manifest.json"));
    const labelsById = new Map(labels.map((label) => [label.id, label]));
    if (labelsById.size !== labels.length) throw new Error("Probe labels contain duplicate task ids");
    const missing = manifest.filter((entry) => !labelsById.has(entry.task_id)).map((entry) => entry.task_id);
    if (missing.length > 0) throw new Error(`Missing ${missing.length} probe label(s): ${missing.slice(0, 5).join(", ")}`);
    const manifestIds = new Set(manifest.map((entry) => entry.task_id));
    const unknown = labels.filter((label) => !manifestIds.has(label.id));
    if (unknown.length > 0) throw new Error(`Unknown probe label id: ${unknown[0]!.id}`);
    const wikiIds = [...new Set(manifest.map((entry) => entry.wiki_id))].sort();
    const aggregate = Object.fromEntries(wikiIds.map((wikiId) => [wikiId, aggregateProbeLabels(
      manifest.filter((entry) => entry.wiki_id === wikiId).map((entry) => labelsById.get(entry.task_id)).filter((label): label is ImportedProbeLabel => label !== undefined),
    )]));
    const output = option(args, "--output") ?? path.join(evaluationRoot, "probe-scores.json");
    await writeJson(output, aggregate);
    process.stdout.write(`Aggregated contradiction probes -> ${output}\n`);
    return;
  }
  if (command === "cost") {
    const events = await readTelemetry(required(args, "--input"));
    const output = option(args, "--output") ?? path.join(projectRoot, "results", "costs.json");
    await writeJson(output, aggregateTelemetryByRun(events));
    process.stdout.write(`Aggregated ${events.length} telemetry events -> ${output}\n`);
    return;
  }
  if (command === "leaderboard") {
    const scoreFiles = await Promise.all(required(args, "--scores").split(",").map((file) => json<ScoresFile>(file)));
    const judgedPath = option(args, "--judged");
    const probesPath = option(args, "--probes");
    const leaderboard = buildLeaderboard({
      scoreFiles,
      ...(judgedPath === undefined ? {} : { judged: await json<JudgeAggregate & { manifest: JudgeManifestEntry[] }>(judgedPath) }),
      ...(probesPath === undefined ? {} : { probes: await json<Record<string, ProbeAggregate>>(probesPath) }),
    });
    const output = option(args, "--output") ?? path.join(projectRoot, "results", "leaderboard.json");
    await writeJson(output, leaderboard);
    process.stdout.write(`Generated leaderboard (publishable=${leaderboard.publishable}) -> ${output}\n`);
    return;
  }
  if (command === "report") {
    const leaderboardPath = option(args, "--leaderboard") ?? path.join(projectRoot, "results", "leaderboard.json");
    const output = await generateReport({
      scoresPath: path.resolve(option(args, "--scores") ?? path.join(projectRoot, "results", "scores.json")),
      outputPath: path.resolve(option(args, "--output") ?? path.join(projectRoot, "results", "REPORT.md")),
      leaderboardPath: path.resolve(leaderboardPath),
    });
    process.stdout.write(`Generated ${output}\n`);
    return;
  }
  if (command !== "score") {
    process.stderr.write("Usage: openwiki-bench run|score|prepare|report|cost|leaderboard ...\n       openwiki-bench judge run|run-amp|disagreements|aggregate ...\n       openwiki-bench probe run|run-amp|aggregate ...\n");
    process.exitCode = 2;
    return;
  }
  const repoRoot = option(args, "--repo");
  const output = option(args, "--output");
  const scores = await scoreAll({
    projectRoot,
    subjectId: option(args, "--subject") ?? "background-agents",
    ...(repoRoot === undefined ? {} : { repoRoot }),
    ...(output === undefined ? {} : { output }),
  });
  process.stdout.write(`Scored ${scores.runs.length} runs -> ${output ?? "results/scores.json"}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
