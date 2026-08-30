import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { splitSourceLines } from "./grounding.js";
import { isFile, listFiles, readJson } from "./io.js";
import type { PlanSummary, StructureScore } from "./schema.js";

const LINK_PATTERN = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;
const exec = promisify(execFile);

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / union.size;
}

function planPagePath(runRoot: string, planPath: string): string {
  return path.join(runRoot, planPath.replace(/^\/openwiki\//u, "").replace(/^\//u, ""));
}

async function resolveWikiLink(runRoot: string, sourceFile: string, target: string): Promise<boolean | null> {
  if (/^(?:[a-z][a-z\d+.-]*:|#)/iu.test(target)) return null;
  const clean = decodeURIComponent(target.split(/[?#]/u, 1)[0] ?? "");
  if (!clean) return null;
  let candidate = clean.startsWith("/openwiki/")
    ? path.join(runRoot, clean.slice("/openwiki/".length))
    : path.resolve(path.dirname(sourceFile), clean);
  const relative = path.relative(runRoot, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  if (await isFile(candidate)) return true;
  if (path.extname(candidate) === "" && await isFile(`${candidate}.md`)) return true;
  candidate = path.join(candidate, "index.md");
  return await isFile(candidate);
}

async function discoverCoverageUnits(repoRoot: string): Promise<string[]> {
  const { stdout } = await exec("git", ["ls-tree", "-d", "--name-only", "HEAD"], { cwd: repoRoot });
  const topLevel = stdout.trim().split("\n").filter((entry) => entry && !entry.startsWith("."));
  const units = topLevel.filter((entry) => entry !== "packages");
  if (topLevel.includes("packages")) {
    const packages = await exec("git", ["ls-tree", "-d", "--name-only", "HEAD:packages"], { cwd: repoRoot });
    units.push(...packages.stdout.trim().split("\n").filter(Boolean).map((entry) => `packages/${entry}`));
  }
  return units.sort();
}

export async function scoreStructure(
  runRoot: string,
  repoRoot: string,
  plan: PlanSummary,
  evidenceCount: number,
  citedFiles: Set<string>,
  citedFilesByPage: Map<string, Set<string>>,
): Promise<StructureScore> {
  const markdownFiles = (await listFiles(runRoot, ".md")).filter((file) => !file.includes(`${path.sep}.claims${path.sep}`));
  let markdownLines = 0;
  let internalLinks = 0;
  let resolvedInternalLinks = 0;
  for (const file of markdownFiles) {
    const content = await readFile(file, "utf8");
    markdownLines += splitSourceLines(content).length;
    for (const match of content.matchAll(LINK_PATTERN)) {
      const resolution = await resolveWikiLink(runRoot, file, match[1] ?? "");
      if (resolution === null) continue;
      internalLinks += 1;
      if (resolution) resolvedInternalLinks += 1;
    }
  }

  const planPages = plan.plan_page_count ?? plan.pageCount ?? plan.pages.length;
  let completedPlanPages = 0;
  for (const page of plan.pages) if (await isFile(planPagePath(runRoot, page.path))) completedPlanPages += 1;

  const hasSeedPaths = plan.pages.some((page) => page.seedPaths !== undefined);
  const seedPaths = new Set(plan.pages.flatMap((page) => page.seedPaths ?? []));
  let coveredSeedPaths = 0;
  for (const seed of seedPaths) if (citedFiles.has(seed)) coveredSeedPaths += 1;

  const coverageUnits = await discoverCoverageUnits(repoRoot);
  const coveredUnits = coverageUnits.filter((unit) =>
    [...citedFiles].some((file) => file === unit || file.startsWith(`${unit}/`)),
  ).length;

  const pageSets = [...citedFilesByPage.values()];
  const similarities: number[] = [];
  for (let left = 0; left < pageSets.length; left += 1) {
    for (let right = left + 1; right < pageSets.length; right += 1) {
      similarities.push(jaccard(pageSets[left] ?? new Set(), pageSets[right] ?? new Set()));
    }
  }
  const ratio = (value: number, total: number): number => total === 0 ? 0 : value / total;
  return {
    plan_pages: planPages,
    completed_plan_pages: completedPlanPages,
    completeness: ratio(completedPlanPages, planPages),
    markdown_pages: markdownFiles.length,
    markdown_lines: markdownLines,
    lines_per_page: ratio(markdownLines, markdownFiles.length),
    citations_per_100_lines: ratio(evidenceCount * 100, markdownLines),
    internal_links: internalLinks,
    resolved_internal_links: resolvedInternalLinks,
    link_integrity: ratio(resolvedInternalLinks, internalLinks),
    coverage_units: coverageUnits.length,
    covered_units: coveredUnits,
    coverage: ratio(coveredUnits, coverageUnits.length),
    seed_paths: hasSeedPaths ? seedPaths.size : null,
    covered_seed_paths: hasSeedPaths ? coveredSeedPaths : null,
    seed_path_coverage: hasSeedPaths ? ratio(coveredSeedPaths, seedPaths.size) : null,
    redundancy: mean(similarities),
  };
}

export async function loadPlan(runRoot: string): Promise<PlanSummary> {
  const plan = await readJson<PlanSummary>(path.join(runRoot, "plan.summary.json"));
  if (!Array.isArray(plan.pages)) throw new Error(`Invalid plan summary in ${runRoot}`);
  return plan;
}
