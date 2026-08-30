import { writeFile } from "node:fs/promises";
import { readJson } from "./io.js";
import type { Leaderboard } from "./leaderboard.js";
import type { RunScore, ScoresFile } from "./schema.js";

function label(run: RunScore): string {
  return `${run.model} (${run.runtime})`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function optionalPercent(value: number | null): string {
  return value === null ? "n/a" : percent(value);
}

function winners(
  runs: RunScore[],
  metric: (run: RunScore) => number,
  direction: "highest" | "lowest",
): { labels: string; value: number } | null {
  if (runs.length === 0) return null;
  const values = runs.map(metric);
  const best = direction === "highest" ? Math.max(...values) : Math.min(...values);
  return {
    labels: runs.filter((run) => metric(run) === best).map(label).join(" and "),
    value: best,
  };
}

export async function generateReport(options: { scoresPath: string; outputPath: string; leaderboardPath?: string }): Promise<string> {
  const scores = await readJson<ScoresFile>(options.scoresPath);
  const leaderboard = options.leaderboardPath === undefined ? null : await readJson<Leaderboard>(options.leaderboardPath);
  const complete = scores.runs.filter((run) => run.outcome === "complete" && run.structure.completeness === 1);
  const broadest = winners(complete, (run) => run.structure.coverage, "highest");
  const concise = winners(complete, (run) => run.structure.lines_per_page, "lowest");
  const reliableLinks = winners(complete, (run) => run.structure.link_integrity, "highest");
  const rows = scores.runs.map((run) =>
    `| ${label(run)} | ${run.outcome} | ${run.structure.completed_plan_pages}/${run.structure.plan_pages} | ${percent(run.grounding.exact_pct)} | ${percent(run.structure.link_integrity)} | ${percent(run.structure.coverage)} | ${optionalPercent(run.structure.seed_path_coverage)} | ${run.structure.lines_per_page.toFixed(1)} |`,
  );
  const recommendations = complete.length === 0
    ? "No run completed, so P0 makes no recommendation."
    : [
        `- **Coverage-first candidate:** ${broadest?.labels ?? "n/a"} (${broadest === null ? "n/a" : percent(broadest.value)} package/top-level coverage).`,
        `- **Most concise complete candidate:** ${concise?.labels ?? "n/a"} (${concise === null ? "n/a" : concise.value.toFixed(1)} lines/page).`,
        `- **Best link integrity candidate:** ${reliableLinks?.labels ?? "n/a"} (${reliableLinks === null ? "n/a" : percent(reliableLinks.value)}).`,
        leaderboard?.publishable === true
          ? `- **Overall benchmark leader:** ${leaderboard.systems[0]?.model ?? "n/a"} (${leaderboard.systems[0]?.runtime ?? "n/a"}), ranked by penalized blind-rubric score.`
          : `- **Overall model recommendation:** withheld. ${leaderboard === null ? "Correctness probes and blind rubric judging are not attached to this report." : `Publication blockers: ${leaderboard.blockers.join("; ")}.`}`,
      ].join("\n");
  const semantic = leaderboard === null ? "" : `\n## Blind semantic evaluation\n\n| Model system | Rubric score | Supported claims | Contradicted claims | Seeds/subject | Subjects |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${leaderboard.systems.map((system) => `| ${system.model} (${system.runtime}) | ${system.rubric_score === null ? "n/a" : system.rubric_score.mean.toFixed(3)} | ${system.support_rate === null ? "n/a" : percent(system.support_rate.mean)} | ${system.contradiction_rate === null ? "n/a" : percent(system.contradiction_rate.mean)} | ${system.seeds_per_subject_min} | ${system.subjects} |`).join("\n")}\n\n${leaderboard.judge_agreement === null ? "Judge agreement: n/a." : `Primary-judge agreement: κ = ${leaderboard.judge_agreement.cohen_kappa.toFixed(3)} overall (${Object.entries(leaderboard.judge_agreement.axis_kappa).map(([axis, value]) => `${axis} ${value.toFixed(3)}`).join(", ")}).`}\n\nStatus: **${leaderboard.publishable ? "publishable" : "not publishable"}**${leaderboard.blockers.length === 0 ? "." : `. Blockers: ${leaderboard.blockers.join("; ")}.`}\n`;
  const report = `# OpenWiki Bench — results\n\nSubject: \`${scores.subject.id}\` at \`${scores.subject.repo_sha}\`.\n\n| Model system | Outcome | Complete | Exact evidence | Link integrity | Repo coverage | Seed coverage | Lines/page |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows.join("\n")}\n${semantic}\n## Recommendations\n\n${recommendations}\n\n## Interpretation\n\n“Exact evidence” proves cited bytes match the pinned source; it does **not** prove that a claim logically follows from those bytes. The support/contradiction probes test that separately. Incomplete runs remain visible but are excluded from structural recommendations. Model and runtime are reported together because this benchmark evaluates the agent system, not an isolated model API.\n`;
  await writeFile(options.outputPath, report);
  return options.outputPath;
}
