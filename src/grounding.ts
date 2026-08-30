import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { listFiles, readJson } from "./io.js";
import type { ClaimFile, Evidence, GroundingScore } from "./schema.js";

const RANGE_VERSION_PREFIX = "repo-lines-v1:sha256:";
const FILE_VERSION_PREFIX = "repo-file-v1:sha256:";
const SHA256 = /^[a-f\d]{64}$/u;

interface ParsedResource {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface GroundingDetails {
  score: GroundingScore;
  citedFilesByPage: Map<string, Set<string>>;
  citedFiles: Set<string>;
}

export function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function splitSourceLines(source: string): string[] {
  const lines: string[] = [];
  let start = 0;
  while (start < source.length) {
    const newline = source.indexOf("\n", start);
    const end = newline === -1 ? source.length : newline + 1;
    lines.push(source.slice(start, end));
    start = end;
  }
  return lines;
}

export function parseResource(resource: string): ParsedResource | null {
  const match = /^repo:\/\/([^#]+)(?:#L([1-9]\d*)(?:-L([1-9]\d*))?)?$/u.exec(resource);
  if (!match?.[1]) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]).replaceAll("\\", "/");
  } catch {
    return null;
  }
  const normalized = path.posix.normalize(decoded).replace(/^\.\//u, "");
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized) ||
    /^(?:[a-z]:\/|\.git(?:\/|$)|openwiki(?:\/|$))/iu.test(normalized)
  ) return null;
  if (match[2] === undefined) return { path: normalized };
  const startLine = Number(match[2]);
  const endLine = Number(match[3] ?? match[2]);
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || endLine < startLine) {
    return null;
  }
  return { path: normalized, startLine, endLine };
}

async function readSafeRepoFile(repoRoot: string, relativePath: string): Promise<string | null> {
  const absolute = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  try {
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    const [physicalRoot, physicalFile] = await Promise.all([realpath(repoRoot), realpath(absolute)]);
    if (physicalFile !== path.resolve(physicalRoot, relativePath)) return null;
    return await readFile(physicalFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function versionMatches(evidence: Evidence, content: string, ranged: boolean): boolean {
  if (!ranged) return evidence.version === `${FILE_VERSION_PREFIX}${hashText(content)}`;
  const match = /^repo-lines-v1:sha256:([a-f\d]{64}):([A-Za-z\d_-]+)$/u.exec(evidence.version);
  if (!match?.[1] || !match[2] || match[1] !== hashText(content)) return false;
  try {
    const metadata = JSON.parse(Buffer.from(match[2], "base64url").toString("utf8")) as Record<string, unknown>;
    const keys = Object.keys(metadata);
    return keys.length === 7 &&
      Number.isSafeInteger(metadata.selectedLineCount) && Number(metadata.selectedLineCount) >= 1 &&
      Number.isSafeInteger(metadata.precedingContextLineCount) && Number(metadata.precedingContextLineCount) >= 0 && Number(metadata.precedingContextLineCount) <= 3 &&
      Number.isSafeInteger(metadata.followingContextLineCount) && Number(metadata.followingContextLineCount) >= 0 && Number(metadata.followingContextLineCount) <= 3 &&
      [
        metadata.firstSelectedLineHash,
        metadata.lastSelectedLineHash,
        metadata.precedingContextHash,
        metadata.followingContextHash,
      ].every((value) => typeof value === "string" && SHA256.test(value));
  } catch {
    return false;
  }
}

export async function scoreGrounding(runRoot: string, repoRoot: string): Promise<GroundingDetails> {
  const claimFiles = await listFiles(path.join(runRoot, ".claims"), ".json");
  let claims = 0;
  let evidenceCount = 0;
  let resolvable = 0;
  let inRange = 0;
  let exact = 0;
  const citedFiles = new Set<string>();
  const citedFilesByPage = new Map<string, Set<string>>();
  const sourceCache = new Map<string, Promise<string | null>>();

  for (const claimFilePath of claimFiles) {
    const claimFile = await readJson<ClaimFile>(claimFilePath);
    if (claimFile.schemaVersion !== 1 || !Array.isArray(claimFile.claims)) {
      throw new Error(`Unsupported claim schema: ${claimFilePath}`);
    }
    const page = path.relative(path.join(runRoot, ".claims"), claimFilePath).replace(/\.json$/u, "");
    const pageFiles = new Set<string>();
    citedFilesByPage.set(page, pageFiles);
    claims += claimFile.claims.length;
    for (const claim of claimFile.claims) {
      for (const evidence of claim.evidence) {
        evidenceCount += 1;
        const parsed = parseResource(evidence.resource);
        if (!parsed) continue;
        let sourcePromise = sourceCache.get(parsed.path);
        if (sourcePromise === undefined) {
          sourcePromise = readSafeRepoFile(repoRoot, parsed.path);
          sourceCache.set(parsed.path, sourcePromise);
        }
        const source = await sourcePromise;
        if (source === null) continue;
        resolvable += 1;
        citedFiles.add(parsed.path);
        pageFiles.add(parsed.path);
        if (parsed.startLine === undefined || parsed.endLine === undefined) {
          inRange += 1;
          if (versionMatches(evidence, source, false)) exact += 1;
          continue;
        }
        const lines = splitSourceLines(source);
        if (parsed.endLine > lines.length) continue;
        inRange += 1;
        const content = lines.slice(parsed.startLine - 1, parsed.endLine).join("");
        if (versionMatches(evidence, content, true)) exact += 1;
      }
    }
  }

  const pct = (value: number, total: number): number => total === 0 ? 0 : value / total;
  return {
    score: {
      claims,
      evidence: evidenceCount,
      resolvable,
      in_range: inRange,
      exact,
      resolvable_pct: pct(resolvable, evidenceCount),
      in_range_pct: pct(inRange, evidenceCount),
      exact_pct: pct(exact, evidenceCount),
      claims_per_page: pct(claims, claimFiles.length),
      evidence_per_claim: pct(evidenceCount, claims),
    },
    citedFilesByPage,
    citedFiles,
  };
}
