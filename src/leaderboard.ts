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

export interface SubjectEvaluation {
  subject: string;
  judged: JudgeAggregate & { manifest: JudgeManifestEntry[] };
  probes: Readonly<Record<string, ProbeAggregate>>;
}

export interface CohortSubjectSystem {
  runs: number;
  completion_rate: number;
  rubric_score: number | null;
  reliability_adjusted_rubric_score: number;
  support_rate: number | null;
  contradiction_rate: number | null;
}

export interface CohortLeaderboardSystem extends LeaderboardSystem {
  reliability_adjusted_rubric_score: Statistic;
  per_subject: Record<string, CohortSubjectSystem>;
}

export interface CohortLeaderboard {
  schema_version: 2;
  cohort: { id: string; models: string[]; subjects: string[] };
  panel: { primary: string; secondary: string; tiebreaker: string; probe: string };
  systems: CohortLeaderboardSystem[];
  subject_agreement: Record<string, Leaderboard["judge_agreement"]>;
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

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Build a five-subject cohort result from independently aggregated subject evaluations.
 * Subject-level means are the statistical units so repositories with more successful runs or
 * sampled pages cannot dominate the result. Failed runs contribute zero only to the explicitly
 * reliability-adjusted rubric score; correctness rates remain conditional on generated output.
 */
export function buildCohortLeaderboard(options: {
  id: string;
  models: readonly string[];
  scoreFiles: readonly ScoresFile[];
  evaluations: readonly SubjectEvaluation[];
  panel: CohortLeaderboard["panel"];
}): CohortLeaderboard {
  const models = [...new Set(options.models)];
  if (models.length === 0) throw new Error("Cohort requires at least one model");
  const scoreBySubject = new Map<string, ScoresFile>();
  for (const file of options.scoreFiles) {
    if (scoreBySubject.has(file.subject.id)) throw new Error(`Duplicate score file for subject ${file.subject.id}`);
    scoreBySubject.set(file.subject.id, file);
  }
  const evaluationBySubject = new Map<string, SubjectEvaluation>();
  const expectedJudges = [options.panel.primary, options.panel.secondary, options.panel.tiebreaker];
  for (const evaluation of options.evaluations) {
    if (evaluationBySubject.has(evaluation.subject)) throw new Error(`Duplicate evaluation for subject ${evaluation.subject}`);
    if (!scoreBySubject.has(evaluation.subject)) throw new Error(`Evaluation has no score file for subject ${evaluation.subject}`);
    if (!sameValues([
      evaluation.judged.judges.primary,
      evaluation.judged.judges.secondary,
      evaluation.judged.judges.tiebreaker,
    ], expectedJudges)) throw new Error(`Subject ${evaluation.subject} uses a different judge panel`);
    if (evaluation.judged.manifest.some((entry) => entry.subject !== evaluation.subject)) {
      throw new Error(`Subject ${evaluation.subject} has cross-subject judge manifest entries`);
    }
    evaluationBySubject.set(evaluation.subject, evaluation);
  }
  const subjects = [...scoreBySubject.keys()].sort();
  if (!sameValues([...evaluationBySubject.keys()].sort(), subjects)) {
    throw new Error("Every cohort subject requires exactly one semantic evaluation");
  }

  const identities = new Map<string, JudgeManifestEntry>();
  for (const evaluation of options.evaluations) {
    const manifestWikis = new Set<string>();
    for (const entry of evaluation.judged.manifest) {
      if (!models.includes(entry.model)) throw new Error(`Subject ${evaluation.subject} contains model outside cohort: ${entry.model}`);
      const existing = identities.get(entry.wiki_id);
      if (existing && (existing.subject !== entry.subject || existing.model !== entry.model || existing.runtime !== entry.runtime || existing.seed !== entry.seed)) {
        throw new Error(`Conflicting identity for wiki ${entry.wiki_id}`);
      }
      identities.set(entry.wiki_id, entry);
      manifestWikis.add(entry.wiki_id);
    }
    const judgedWikis = new Set(evaluation.judged.wikis.map((wiki) => wiki.wiki_id));
    if (!sameValues([...judgedWikis].sort(), [...manifestWikis].sort())) {
      throw new Error(`Subject ${evaluation.subject} judged wiki coverage does not match its manifest`);
    }
    if (!sameValues(Object.keys(evaluation.probes).sort(), [...manifestWikis].sort())) {
      throw new Error(`Subject ${evaluation.subject} probe coverage does not match its manifest`);
    }
    const expectedComplete = new Set(
      scoreBySubject.get(evaluation.subject)!.runs
        .filter((run) => models.includes(run.model) && run.outcome === "complete" && run.structure.completeness === 1)
        .map((run) => `${run.model}\0${run.runtime}\0${run.seed}`),
    );
    const evaluated = new Set(
      [...manifestWikis].map((wikiId) => {
        const identity = identities.get(wikiId)!;
        return `${identity.model}\0${identity.runtime}\0${identity.seed}`;
      }),
    );
    if (!sameValues([...evaluated].sort(), [...expectedComplete].sort())) {
      throw new Error(`Subject ${evaluation.subject} semantic coverage does not match its completed runs`);
    }
  }

  const runs = options.scoreFiles.flatMap((file) => file.runs
    .filter((run) => models.includes(run.model))
    .map((run) => ({ ...run, subject: file.subject.id })));
  const groups = new Map<string, typeof runs>();
  for (const run of runs) {
    const groupKey = key(run.model, run.runtime);
    const group = groups.get(groupKey) ?? [];
    group.push(run);
    groups.set(groupKey, group);
  }
  for (const model of models) {
    if (!runs.some((run) => run.model === model)) throw new Error(`Cohort score files contain no runs for model ${model}`);
  }
  for (const group of groups.values()) {
    const first = group[0]!;
    for (const subject of subjects) {
      if (!group.some((run) => run.subject === subject)) {
        throw new Error(`Cohort is missing ${first.model} (${first.runtime}) runs for subject ${subject}`);
      }
    }
  }
  const allEvaluationsPublishable = options.evaluations.every((evaluation) => evaluation.judged.publishable);
  const systems = [...groups.values()].map((group): CohortLeaderboardSystem => {
    const first = group[0]!;
    const perSubject = Object.fromEntries(subjects.map((subject): [string, CohortSubjectSystem] => {
      const subjectRuns = group.filter((run) => run.subject === subject);
      const evaluation = evaluationBySubject.get(subject)!;
      const wikiIds = new Set(evaluation.judged.manifest
        .filter((entry) => entry.model === first.model && entry.runtime === first.runtime)
        .map((entry) => entry.wiki_id));
      const wikis = evaluation.judged.wikis.filter((wiki) => wikiIds.has(wiki.wiki_id));
      const probes = Object.entries(evaluation.probes).filter(([wikiId]) => wikiIds.has(wikiId)).map(([, probe]) => probe);
      return [subject, {
        runs: subjectRuns.length,
        completion_rate: subjectRuns.filter((run) => run.outcome === "complete" && run.structure.completeness === 1).length / subjectRuns.length,
        rubric_score: wikis.length === 0 ? null : mean(wikis.map((wiki) => wiki.score)),
        reliability_adjusted_rubric_score: wikis.reduce((sum, wiki) => sum + wiki.score, 0) / subjectRuns.length,
        support_rate: probes.length === 0 ? null : mean(probes.map((probe) => probe.support_rate)),
        contradiction_rate: probes.length === 0 ? null : mean(probes.map((probe) => probe.contradiction_rate)),
      }];
    }));
    const rubricBySubject = Object.values(perSubject).flatMap((value) => value.rubric_score === null ? [] : [value.rubric_score]);
    const supportBySubject = Object.values(perSubject).flatMap((value) => value.support_rate === null ? [] : [value.support_rate]);
    const contradictionBySubject = Object.values(perSubject).flatMap((value) => value.contradiction_rate === null ? [] : [value.contradiction_rate]);
    const pageAxes = Object.fromEntries(RUBRIC_AXES.map((axis) => [axis, subjects.flatMap((subject) => {
      const evaluation = evaluationBySubject.get(subject)!;
      const wikiIds = new Set(evaluation.judged.manifest
        .filter((entry) => entry.model === first.model && entry.runtime === first.runtime)
        .map((entry) => entry.wiki_id));
      const values = evaluation.judged.pages.filter((page) => wikiIds.has(page.wiki_id)).map((page) => page.scores[axis]);
      return values.length === 0 ? [] : [mean(values)];
    })])) as Record<RubricAxis, number[]>;
    const seedsPerSubject = subjects.map((subject) => new Set(group.filter((run) => run.subject === subject).map((run) => run.seed)).size);
    return {
      model: first.model,
      runtime: first.runtime,
      runs: group.length,
      seeds: new Set(group.map((run) => run.seed)).size,
      seeds_per_subject_min: Math.min(...seedsPerSubject),
      subjects: new Set(group.map((run) => run.subject)).size,
      completion_rate: mean(Object.values(perSubject).map((value) => value.completion_rate)),
      exact: statistic(subjects.map((subject) => mean(group.filter((run) => run.subject === subject).map((run) => run.grounding.exact_pct)))),
      completeness: statistic(subjects.map((subject) => mean(group.filter((run) => run.subject === subject).map((run) => run.structure.completeness)))),
      coverage: statistic(subjects.map((subject) => mean(group.filter((run) => run.subject === subject).map((run) => run.structure.coverage)))),
      link_integrity: statistic(subjects.map((subject) => mean(group.filter((run) => run.subject === subject).map((run) => run.structure.link_integrity)))),
      rubric_score: rubricBySubject.length === 0 ? null : statistic(rubricBySubject),
      rubric_axes: Object.values(pageAxes).some((values) => values.length === 0) ? null : Object.fromEntries(RUBRIC_AXES.map((axis) => [axis, statistic(pageAxes[axis])])) as Record<RubricAxis, Statistic>,
      reliability_adjusted_rubric_score: statistic(Object.values(perSubject).map((value) => value.reliability_adjusted_rubric_score)),
      support_rate: supportBySubject.length === 0 ? null : statistic(supportBySubject),
      contradiction_rate: contradictionBySubject.length === 0 ? null : statistic(contradictionBySubject),
      statistically_publishable: Math.min(...seedsPerSubject) >= 3 && new Set(group.map((run) => run.subject)).size >= 5 && allEvaluationsPublishable,
      per_subject: perSubject,
    };
  });
  const blockers: string[] = [];
  if (systems.some((system) => system.seeds_per_subject_min < 3)) blockers.push("fewer than three trials per subject for one or more systems");
  if (systems.some((system) => system.subjects < 5)) blockers.push("fewer than five subjects for one or more systems");
  for (const evaluation of options.evaluations) {
    if (evaluation.judged.unresolved_tasks.length > 0) blockers.push(`${evaluation.subject}: one or more rubric judgments are unresolved`);
    if (evaluation.judged.linear_weighted_cohen_kappa < 0.6) blockers.push(`${evaluation.subject}: primary-judge linear-weighted Cohen's kappa is below 0.6`);
  }
  const publishable = blockers.length === 0 && systems.every((system) => system.statistically_publishable);
  systems.sort((left, right) => publishable
    ? right.reliability_adjusted_rubric_score.mean - left.reliability_adjusted_rubric_score.mean || `${left.model}\0${left.runtime}`.localeCompare(`${right.model}\0${right.runtime}`)
    : `${left.model}\0${left.runtime}`.localeCompare(`${right.model}\0${right.runtime}`));
  return {
    schema_version: 2,
    cohort: { id: options.id, models, subjects },
    panel: options.panel,
    systems,
    subject_agreement: Object.fromEntries(options.evaluations.map((evaluation) => [evaluation.subject, {
      cohen_kappa: evaluation.judged.cohen_kappa,
      axis_kappa: evaluation.judged.axis_kappa,
      linear_weighted_cohen_kappa: evaluation.judged.linear_weighted_cohen_kappa,
      axis_linear_weighted_kappa: evaluation.judged.axis_linear_weighted_kappa,
      exact_agreement: evaluation.judged.exact_agreement,
      axis_exact_agreement: evaluation.judged.axis_exact_agreement,
    }])),
    publishable,
    blockers,
  };
}
