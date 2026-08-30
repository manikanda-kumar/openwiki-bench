import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isFile, readJson } from "./io.js";
import type { PlanSummary, RunManifest } from "./schema.js";

export const RUBRIC_AXES = [
  "taxonomy_fit",
  "code_grounding",
  "reasoning_depth",
  "change_usefulness",
  "style",
  "correctness",
] as const;

export type RubricAxis = typeof RUBRIC_AXES[number];
export type AxisScores = Record<RubricAxis, number>;

export interface JudgeTask {
  id: string;
  wiki_id: string;
  wiki_outline: string[];
  content: string;
}

export interface JudgeManifestEntry {
  task_id: string;
  wiki_id: string;
  subject: string;
  model: string;
  runtime: RunManifest["runtime"];
  seed: number;
  page_path: string;
}

export interface JudgeBatch {
  tasks: JudgeTask[];
  manifest: JudgeManifestEntry[];
}

export interface PageJudgment {
  task_id: string;
  judge_id: string;
  scores: AxisScores;
  rationale: string;
}

export interface WikiPenalty {
  completeness: number;
  coverage: number;
}

export interface JudgeAggregate {
  judges: { primary: string; secondary: string; tiebreaker: string };
  cohen_kappa: number;
  axis_kappa: Record<RubricAxis, number>;
  publishable: boolean;
  unresolved_tasks: string[];
  pages: Array<{ task_id: string; wiki_id: string; scores: AxisScores; mean: number }>;
  wikis: Array<{ wiki_id: string; page_mean: number; completeness: number; coverage: number; score: number }>;
}

export interface OpenAICompatibleJudge {
  id: string;
  model: string;
  endpoint: string;
  api_key_env: string;
  contestant_models: string[];
}

function judgmentMap(judgments: readonly PageJudgment[]): Map<string, PageJudgment> {
  const result = new Map<string, PageJudgment>();
  for (const judgment of judgments) {
    const key = `${judgment.task_id}\0${judgment.judge_id}`;
    if (result.has(key)) throw new Error(`Duplicate judgment for task ${judgment.task_id} by ${judgment.judge_id}`);
    result.set(key, judgment);
  }
  return result;
}

export function selectDisagreementTasks(
  tasks: readonly JudgeTask[],
  judgments: readonly PageJudgment[],
  primaryJudge: string,
  secondaryJudge: string,
): JudgeTask[] {
  const byTaskAndJudge = judgmentMap(judgments);
  return tasks.filter((task) => {
    const primary = byTaskAndJudge.get(`${task.id}\0${primaryJudge}`);
    const secondary = byTaskAndJudge.get(`${task.id}\0${secondaryJudge}`);
    if (!primary || !secondary) throw new Error(`Missing primary judgment for task: ${task.id}`);
    return RUBRIC_AXES.some((axis) => primary.scores[axis] !== secondary.scores[axis]);
  });
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizePlanPath(runRoot: string, planPath: string): string {
  return path.join(runRoot, planPath.replace(/^\/openwiki\//u, "").replace(/^\//u, ""));
}

function priority(pagePath: string): number {
  const normalized = pagePath.toLowerCase();
  if (/(?:^|\/)quickstart\.md$/u.test(normalized)) return 0;
  if (/(?:^|\/)(?:overview|architecture)\.md$/u.test(normalized)) return 1;
  if (/(?:^|\/)control-plane(?:-worker)?\.md$/u.test(normalized)) return 2;
  return 3;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "");
}

export async function prepareJudgeBatch(
  runRoot: string,
  manifest: RunManifest,
  pageLimit: number,
  blindSeed: string,
): Promise<JudgeBatch> {
  if (!Number.isSafeInteger(pageLimit) || pageLimit < 1) throw new RangeError("pageLimit must be a positive integer");
  const plan = await readJson<PlanSummary>(path.join(runRoot, "plan.summary.json"));
  const existing: Array<{ planPath: string; absolute: string }> = [];
  for (const page of plan.pages) {
    const absolute = normalizePlanPath(runRoot, page.path);
    if (await isFile(absolute)) existing.push({ planPath: page.path, absolute });
  }
  const ranked = existing.toSorted((left, right) => {
    const priorityDifference = priority(left.planPath) - priority(right.planPath);
    if (priorityDifference !== 0) return priorityDifference;
    return digest(`${blindSeed}\0${left.planPath}`).localeCompare(digest(`${blindSeed}\0${right.planPath}`));
  }).slice(0, pageLimit);
  const identity = `${manifest.subject}\0${manifest.model}\0${manifest.runtime}\0${manifest.seed}`;
  const wikiId = `wiki_${digest(`${blindSeed}\0${identity}`).slice(0, 24)}`;
  const wikiOutline = plan.pages.map((page) => page.title ?? path.basename(page.path, ".md"));
  const entries = await Promise.all(ranked.map(async (page) => {
    const taskId = `page_${digest(`${blindSeed}\0${identity}\0${page.planPath}`).slice(0, 24)}`;
    return {
      task: {
        id: taskId,
        wiki_id: wikiId,
        wiki_outline: wikiOutline,
        content: stripFrontmatter(await readFile(page.absolute, "utf8")),
      },
      manifest: {
        task_id: taskId,
        wiki_id: wikiId,
        subject: manifest.subject,
        model: manifest.model,
        runtime: manifest.runtime,
        seed: manifest.seed,
        page_path: page.planPath,
      },
    };
  }));
  entries.sort((left, right) => digest(`${blindSeed}\0${left.task.id}`).localeCompare(digest(`${blindSeed}\0${right.task.id}`)));
  return { tasks: entries.map((entry) => entry.task), manifest: entries.map((entry) => entry.manifest) };
}

function validateScores(value: unknown): AxisScores {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Judge scores must be an object");
  const record = value as Record<string, unknown>;
  const scores = {} as AxisScores;
  for (const axis of RUBRIC_AXES) {
    const score = record[axis];
    if (!Number.isInteger(score) || Number(score) < 0 || Number(score) > 4) throw new Error(`Invalid ${axis} score`);
    scores[axis] = Number(score);
  }
  return scores;
}

function parseJudgeResponse(content: string): { scores: AxisScores; rationale: string } {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "");
  const parsed = JSON.parse(cleaned) as { scores?: unknown; rationale?: unknown };
  return {
    scores: validateScores(parsed.scores),
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
  };
}

export async function runOpenAICompatibleJudge(
  tasks: readonly JudgeTask[],
  rubric: string,
  config: OpenAICompatibleJudge,
  onJudgment?: (judgment: PageJudgment) => Promise<void>,
): Promise<PageJudgment[]> {
  const apiKey = process.env[config.api_key_env];
  if (!apiKey) throw new Error(`Missing judge API key environment variable: ${config.api_key_env}`);
  const judgments: PageJudgment[] = [];
  for (const task of tasks) {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: rubric },
          { role: "user", content: `Anonymous wiki outline:\n${task.wiki_outline.map((title) => `- ${title}`).join("\n")}\n\nEvaluate this page:\n\n${task.content}` },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Judge ${config.id} failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (content === undefined) throw new Error(`Judge ${config.id} returned no content`);
    const judgment = { task_id: task.id, judge_id: config.id, ...parseJudgeResponse(content) };
    judgments.push(judgment);
    await onJudgment?.(judgment);
  }
  return judgments;
}

function cohenKappa(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  const observed = left.filter((value, index) => value === right[index]).length / left.length;
  const expected = [0, 1, 2, 3, 4].reduce((sum, category) => {
    const leftRate = left.filter((value) => value === category).length / left.length;
    const rightRate = right.filter((value) => value === category).length / right.length;
    return sum + leftRate * rightRate;
  }, 0);
  return expected === 1 ? (observed === 1 ? 1 : 0) : (observed - expected) / (1 - expected);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function aggregateJudgments(
  tasks: readonly JudgeTask[],
  judgments: readonly PageJudgment[],
  judges: { primary: string; secondary: string; tiebreaker: string },
  penalties: Readonly<Record<string, WikiPenalty>>,
): JudgeAggregate {
  const byTaskAndJudge = judgmentMap(judgments);
  const left: number[] = [];
  const right: number[] = [];
  const byAxis = Object.fromEntries(RUBRIC_AXES.map((axis) => [axis, { left: [] as number[], right: [] as number[] }])) as Record<RubricAxis, { left: number[]; right: number[] }>;
  const unresolved: string[] = [];
  const pages: JudgeAggregate["pages"] = [];
  for (const task of tasks) {
    const primary = byTaskAndJudge.get(`${task.id}\0${judges.primary}`);
    const secondary = byTaskAndJudge.get(`${task.id}\0${judges.secondary}`);
    if (!primary || !secondary) {
      unresolved.push(task.id);
      continue;
    }
    const scores = {} as AxisScores;
    let needsTiebreak = false;
    for (const axis of RUBRIC_AXES) {
      left.push(primary.scores[axis]);
      right.push(secondary.scores[axis]);
      byAxis[axis].left.push(primary.scores[axis]);
      byAxis[axis].right.push(secondary.scores[axis]);
      if (primary.scores[axis] !== secondary.scores[axis]) needsTiebreak = true;
    }
    const tiebreaker = byTaskAndJudge.get(`${task.id}\0${judges.tiebreaker}`);
    if (needsTiebreak && !tiebreaker) {
      unresolved.push(task.id);
      continue;
    }
    for (const axis of RUBRIC_AXES) {
      const values = [primary.scores[axis], secondary.scores[axis], ...(tiebreaker ? [tiebreaker.scores[axis]] : [])]
        .toSorted((a, b) => a - b);
      scores[axis] = values[Math.floor(values.length / 2)] ?? 0;
    }
    pages.push({ task_id: task.id, wiki_id: task.wiki_id, scores, mean: mean(Object.values(scores)) });
  }
  const wikiIds = [...new Set(tasks.map((task) => task.wiki_id))].sort();
  const wikis = wikiIds.flatMap((wikiId) => {
    const wikiPages = pages.filter((page) => page.wiki_id === wikiId);
    const penalty = penalties[wikiId];
    if (wikiPages.length === 0 || penalty === undefined) return [];
    const pageMean = mean(wikiPages.map((page) => page.mean));
    return [{
      wiki_id: wikiId,
      page_mean: pageMean,
      completeness: penalty.completeness,
      coverage: penalty.coverage,
      score: pageMean * penalty.completeness * penalty.coverage,
    }];
  });
  const kappa = cohenKappa(left, right);
  return {
    judges,
    cohen_kappa: kappa,
    axis_kappa: Object.fromEntries(RUBRIC_AXES.map((axis) => [axis, cohenKappa(byAxis[axis].left, byAxis[axis].right)])) as Record<RubricAxis, number>,
    publishable: unresolved.length === 0 && kappa >= 0.6,
    unresolved_tasks: unresolved.sort(),
    pages,
    wikis,
  };
}
