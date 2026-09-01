import type { JudgeAggregate, JudgeManifestEntry, RubricAxis } from "./judge.js";
import { RUBRIC_AXES } from "./judge.js";
import type { ProbeAggregate } from "./probe.js";
import type { RunScore, ScoresFile } from "./schema.js";

export interface Statistic {
  mean: number;
  stddev: number;
}

export interface LeaderboardSystem {
  model: string;
  runtime: RunScore["runtime"];
  runs: number;
  seeds: number;
  seeds_per_subject_min: number;
  subjects: number;
  completion_rate: number;
  exact: Statistic;
  completeness: Statistic;
  coverage: Statistic;
  link_integrity: Statistic;
  rubric_score: Statistic | null;
  rubric_axes: Record<RubricAxis, Statistic> | null;
  support_rate: Statistic | null;
  contradiction_rate: Statistic | null;
  statistically_publishable: boolean;
}

export interface Leaderboard {
  schema_version: 1;
  systems: LeaderboardSystem[];
  judge_agreement: Pick<JudgeAggregate, "cohen_kappa" | "axis_kappa" | "linear_weighted_cohen_kappa" | "axis_linear_weighted_kappa" | "exact_agreement" | "axis_exact_agreement"> | null;
  publishable: boolean;
  blockers: string[];
}

function statistic(values: readonly number[]): Statistic {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length < 2 ? 0 : values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return { mean, stddev: Math.sqrt(variance) };
}

function key(model: string, runtime: string): string {
  return `${model}\0${runtime}`;
}

export function buildLeaderboard(options: {
  scoreFiles: readonly ScoresFile[];
  judged?: JudgeAggregate & { manifest: JudgeManifestEntry[] };
  probes?: Readonly<Record<string, ProbeAggregate>>;
}): Leaderboard {
  const runs = options.scoreFiles.flatMap((file) => file.runs.map((run) => ({ ...run, subject: file.subject.id })));
  const groups = new Map<string, typeof runs>();
  for (const run of runs) {
    const groupKey = key(run.model, run.runtime);
    const group = groups.get(groupKey) ?? [];
    group.push(run);
    groups.set(groupKey, group);
  }
  const judgedIdentity = new Map<string, { model: string; runtime: string }>();
  for (const entry of options.judged?.manifest ?? []) judgedIdentity.set(entry.wiki_id, { model: entry.model, runtime: entry.runtime });
  const systems = [...groups.values()].map((group): LeaderboardSystem => {
    const first = group[0]!;
    const matchingWikis = (options.judged?.wikis ?? []).filter((wiki) => {
      const identity = judgedIdentity.get(wiki.wiki_id);
      return identity?.model === first.model && identity.runtime === first.runtime;
    });
    const matchingPages = (options.judged?.pages ?? []).filter((page) => {
      const identity = judgedIdentity.get(page.wiki_id);
      return identity?.model === first.model && identity.runtime === first.runtime;
    });
    const rubricAxes = matchingPages.length === 0 ? null : Object.fromEntries(RUBRIC_AXES.map((axis) => [
      axis,
      statistic(matchingPages.map((page) => page.scores[axis])),
    ])) as Record<RubricAxis, Statistic>;
    const contradictionRates = Object.entries(options.probes ?? {}).filter(([wikiId]) => {
      const identity = judgedIdentity.get(wikiId);
      return identity?.model === first.model && identity.runtime === first.runtime;
    }).map(([, probe]) => probe.contradiction_rate);
    const supportRates = Object.entries(options.probes ?? {}).filter(([wikiId]) => {
      const identity = judgedIdentity.get(wikiId);
      return identity?.model === first.model && identity.runtime === first.runtime;
    }).map(([, probe]) => probe.support_rate);
    const seeds = new Set(group.map((run) => run.seed)).size;
    const subjects = new Set(group.map((run) => run.subject)).size;
    const seedsPerSubject = [...new Set(group.map((run) => run.subject))].map((subject) =>
      new Set(group.filter((run) => run.subject === subject).map((run) => run.seed)).size,
    );
    const seedsPerSubjectMin = Math.min(...seedsPerSubject);
    return {
      model: first.model,
      runtime: first.runtime,
      runs: group.length,
      seeds,
      seeds_per_subject_min: seedsPerSubjectMin,
      subjects,
      completion_rate: group.filter((run) => run.outcome === "complete" && run.structure.completeness === 1).length / group.length,
      exact: statistic(group.map((run) => run.grounding.exact_pct)),
      completeness: statistic(group.map((run) => run.structure.completeness)),
      coverage: statistic(group.map((run) => run.structure.coverage)),
      link_integrity: statistic(group.map((run) => run.structure.link_integrity)),
      rubric_score: matchingWikis.length === 0 ? null : statistic(matchingWikis.map((wiki) => wiki.score)),
      rubric_axes: rubricAxes,
      support_rate: supportRates.length === 0 ? null : statistic(supportRates),
      contradiction_rate: contradictionRates.length === 0 ? null : statistic(contradictionRates),
      statistically_publishable: seedsPerSubjectMin >= 3 && subjects >= 5 && options.judged?.publishable === true,
    };
  }).sort((left, right) =>
    (right.rubric_score?.mean ?? -1) - (left.rubric_score?.mean ?? -1) ||
    right.completion_rate - left.completion_rate ||
    `${left.model}\0${left.runtime}`.localeCompare(`${right.model}\0${right.runtime}`),
  );
  const blockers: string[] = [];
  if (systems.some((system) => system.seeds_per_subject_min < 3)) blockers.push("fewer than three trials per subject for one or more systems");
  if (systems.some((system) => system.subjects < 5)) blockers.push("fewer than five subjects for one or more systems");
  if (options.judged === undefined) blockers.push("blind rubric judging has not been run");
  else {
    if (options.judged.unresolved_tasks.length > 0) blockers.push("one or more rubric judgments are unresolved");
    if (options.judged.linear_weighted_cohen_kappa < 0.6) blockers.push("primary-judge linear-weighted Cohen's kappa is below 0.6");
  }
  if (options.probes === undefined) blockers.push("correctness probes have not been run");
  return {
    schema_version: 1,
    systems,
    judge_agreement: options.judged === undefined ? null : {
      cohen_kappa: options.judged.cohen_kappa,
      axis_kappa: options.judged.axis_kappa,
      linear_weighted_cohen_kappa: options.judged.linear_weighted_cohen_kappa,
      axis_linear_weighted_kappa: options.judged.axis_linear_weighted_kappa,
      exact_agreement: options.judged.exact_agreement,
      axis_exact_agreement: options.judged.axis_exact_agreement,
    },
    publishable: blockers.length === 0 && systems.every((system) => system.statistically_publishable),
    blockers,
  };
}
