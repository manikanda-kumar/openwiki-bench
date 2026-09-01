import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseResource, splitSourceLines } from "./grounding.js";
import { listFiles, readJson } from "./io.js";
import type { ClaimFile } from "./schema.js";

export type ProbeLabel = "supported" | "unsupported" | "contradicted";

/** The deliberately blind portion of a probe. It is safe to send to a judge. */
export interface ProbeTask {
  id: string;
  statement: string;
  sources: string[];
}

export interface ImportedProbeLabel {
  id: string;
  label: ProbeLabel;
  rationale?: string;
}

export interface OpenAICompatibleProbeJudge {
  id: string;
  model: string;
  endpoint: string;
  api_key_env: string;
}

export interface ProbeAggregate {
  total: number;
  counts: Record<ProbeLabel, number>;
  support_rate: number;
  unsupported_rate: number;
  contradiction_rate: number;
  contradiction_rate_95_wilson: { low: number; high: number };
}

export function parseProbeResponse(content: string): Omit<ImportedProbeLabel, "id"> {
  const parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "")) as { label?: unknown; rationale?: unknown };
  if (parsed.label !== "supported" && parsed.label !== "unsupported" && parsed.label !== "contradicted") {
    throw new Error("Probe judge returned an invalid label");
  }
  return { label: parsed.label, ...(typeof parsed.rationale === "string" ? { rationale: parsed.rationale } : {}) };
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function rank(seed: string, page: string, claimId: string): string {
  return digest(`${seed}\0${page}\0${claimId}`);
}

function opaqueId(seed: string, page: string, claimId: string): string {
  return `probe_${digest(`id\0${seed}\0${page}\0${claimId}`).slice(0, 32)}`;
}

async function citedLines(repoRoot: string, resource: string, version: string): Promise<string> {
  const parsed = parseResource(resource);
  if (parsed === null) throw new Error(`Probe evidence has an invalid resource: ${resource}`);
  const absolute = path.resolve(repoRoot, parsed.path);
  const relative = path.relative(path.resolve(repoRoot), absolute);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("Probe evidence escapes the repository");
  }
  const source = await readFile(absolute, "utf8");
  if (parsed.startLine === undefined || parsed.endLine === undefined) {
    if (version !== `repo-file-v1:sha256:${digest(source)}`) {
      throw new Error(`Probe evidence does not match its pinned version: ${resource}`);
    }
    return source;
  }
  const lines = splitSourceLines(source);
  if (parsed.endLine > lines.length) throw new Error(`Probe evidence is out of range: ${resource}`);
  const selected = lines.slice(parsed.startLine - 1, parsed.endLine).join("");
  const versionMatch = /^repo-lines-v1:sha256:([a-f\d]{64}):[A-Za-z\d_-]+$/u.exec(version);
  if (versionMatch?.[1] !== digest(selected)) {
    throw new Error(`Probe evidence does not match its pinned version: ${resource}`);
  }
  return selected;
}

/**
 * Samples at most k claims independently from every page. The returned objects contain no
 * page, repository, claim, run, or model identifiers.
 */
export async function prepareProbeTasks(
  runRoot: string,
  repoRoot: string,
  k: number,
  seed: string | number,
  includedPages?: ReadonlySet<string>,
): Promise<ProbeTask[]> {
  if (!Number.isSafeInteger(k) || k < 0) throw new RangeError("k must be a non-negative integer");
  const seedText = String(seed);
  const claimsRoot = path.join(runRoot, ".claims");
  const files = await listFiles(claimsRoot, ".json");
  const tasks: ProbeTask[] = [];

  for (const file of files) {
    const claimFile = await readJson<ClaimFile>(file);
    if (claimFile.schemaVersion !== 1 || !Array.isArray(claimFile.claims)) {
      throw new Error(`Unsupported claim schema: ${file}`);
    }
    const page = path.relative(claimsRoot, file).replaceAll(path.sep, "/").replace(/\.json$/u, "");
    if (includedPages !== undefined && !includedPages.has(page)) continue;
    const selected = [...claimFile.claims]
      .sort((a, b) => rank(seedText, page, a.id).localeCompare(rank(seedText, page, b.id)) || a.id.localeCompare(b.id))
      .slice(0, k);
    for (const claim of selected) {
      const sources = await Promise.all(claim.evidence.map((item) => citedLines(repoRoot, item.resource, item.version)));
      tasks.push({ id: opaqueId(seedText, page, claim.id), statement: claim.statement, sources });
    }
  }
  return tasks;
}

export async function runOpenAIProbeJudge(
  tasks: readonly ProbeTask[],
  config: OpenAICompatibleProbeJudge,
  onLabel?: (label: ImportedProbeLabel) => Promise<void>,
): Promise<ImportedProbeLabel[]> {
  const apiKey = process.env[config.api_key_env];
  if (!apiKey) throw new Error(`Missing probe API key environment variable: ${config.api_key_env}`);
  const labels: ImportedProbeLabel[] = [];
  for (const task of tasks) {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Decide whether the statement follows from only the supplied source excerpts. Label supported when the excerpts establish it, unsupported when they do not establish it, and contradicted only when they establish the opposite. Return JSON: {\"label\":\"supported|unsupported|contradicted\",\"rationale\":\"brief explanation\"}.",
          },
          { role: "user", content: `Statement:\n${task.statement}\n\nSource excerpts:\n${task.sources.map((source, index) => `--- source ${index + 1} ---\n${source}`).join("\n")}` },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Probe judge ${config.id} failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (content === undefined) throw new Error(`Probe judge ${config.id} returned no content`);
    const label: ImportedProbeLabel = { id: task.id, ...parseProbeResponse(content) };
    labels.push(label);
    await onLabel?.(label);
  }
  return labels;
}

export function wilsonInterval(successes: number, total: number): { low: number; high: number } {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(successes) || successes < 0 || successes > total) {
    throw new RangeError("Wilson counts must be non-negative integers with successes <= total");
  }
  if (total === 0) return { low: 0, high: 0 };
  const z = 1.959963984540054;
  const proportion = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (proportion + z2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((proportion * (1 - proportion) + z2 / (4 * total)) / total) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export function aggregateProbeLabels(labels: readonly ImportedProbeLabel[]): ProbeAggregate {
  const counts: Record<ProbeLabel, number> = { supported: 0, unsupported: 0, contradicted: 0 };
  const seen = new Set<string>();
  for (const item of labels) {
    if (seen.has(item.id)) throw new Error(`Duplicate probe label id: ${item.id}`);
    seen.add(item.id);
    if (!(item.label in counts)) throw new Error(`Invalid probe label: ${String(item.label)}`);
    counts[item.label] += 1;
  }
  const total = labels.length;
  return {
    total,
    counts,
    support_rate: total === 0 ? 0 : counts.supported / total,
    unsupported_rate: total === 0 ? 0 : counts.unsupported / total,
    contradiction_rate: total === 0 ? 0 : counts.contradicted / total,
    contradiction_rate_95_wilson: wilsonInterval(counts.contradicted, total),
  };
}
