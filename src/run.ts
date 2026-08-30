import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, cp, lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isFile, readJson } from "./io.js";
import type { RunManifest } from "./schema.js";
import { checkoutSubject } from "./subject.js";

export interface SystemConfig {
  id: string;
  model: string;
  runtime: RunManifest["runtime"];
  openwiki_version: string;
  command: string[];
  env_passthrough: string[];
  env_aliases?: Record<string, string>;
  env: Record<string, string>;
  output_directory: string;
  plan_summary_path?: string;
  run_state_path?: string;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function substitute(value: string, replacements: Record<string, string>): string {
  return value.replace(/\{(model|prompt|seed)\}/gu, (_, key: string) => replacements[key] ?? "");
}

function containedPath(repoRoot: string, relativePath: string): string {
  const absolute = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Configured path escapes the subject checkout: ${relativePath}`);
  }
  return absolute;
}

async function captureRunState(source: string, destination: string): Promise<boolean> {
  if (!await isFile(source)) return false;
  const state = JSON.parse(await readFile(source, "utf8")) as { plan?: { pages?: unknown[]; deletePages?: unknown[] } };
  if (!Array.isArray(state.plan?.pages)) return false;
  const statuses: Record<string, number> = {};
  for (const page of state.plan.pages) {
    if (typeof page === "object" && page !== null && typeof (page as { status?: unknown }).status === "string") {
      const status = (page as { status: string }).status;
      statuses[status] = (statuses[status] ?? 0) + 1;
    }
  }
  await writeFile(destination, `${JSON.stringify({
    plan_page_count: state.plan.pages.length,
    deletePages: Array.isArray(state.plan.deletePages) ? state.plan.deletePages : [],
    statuses,
    pages: state.plan.pages,
  }, null, 2)}\n`);
  return true;
}

async function replaceClaudeSymlink(repoRoot: string): Promise<void> {
  const claude = path.join(repoRoot, "CLAUDE.md");
  try {
    if ((await lstat(claude)).isSymbolicLink()) {
      await unlink(claude);
      await copyFile(path.join(repoRoot, "AGENTS.md"), claude);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function execute(command: string[], cwd: string, env: NodeJS.ProcessEnv, logFile: string): Promise<number> {
  if (command.length === 0 || !command[0]) throw new Error("System command cannot be empty");
  return await new Promise((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", async (code) => {
      await writeFile(logFile, Buffer.concat(chunks));
      resolve(code ?? 1);
    });
  });
}

export async function runSystem(options: {
  projectRoot: string;
  subjectId: string;
  configPath: string;
  seed: number;
  promptPath: string;
  ignorePath?: string;
}): Promise<{ directory: string; manifest: RunManifest }> {
  if (!Number.isSafeInteger(options.seed) || options.seed < 0) throw new Error("seed must be a non-negative integer");
  const config = await readJson<SystemConfig>(options.configPath);
  const prompt = await readFile(options.promptPath, "utf8");
  const ignore = options.ignorePath === undefined ? null : await readFile(options.ignorePath, "utf8");
  const target = path.join(options.projectRoot, "runs", options.subjectId, config.id, `seed-${options.seed}`);
  if (await isFile(path.join(target, "run.json"))) throw new Error(`Run already exists: ${target}`);
  await mkdir(target, { recursive: true });
  const checkout = await checkoutSubject(options.projectRoot, options.subjectId);
  const started = new Date();
  let exitCode = 1;
  let capturedOutput = false;
  let capturedPlan = false;
  try {
    await replaceClaudeSymlink(checkout.root);
    if (ignore !== null) await writeFile(path.join(checkout.root, ".openwikiignore"), ignore);
    await mkdir(path.join(checkout.root, "openwiki"), { recursive: true });
    await writeFile(path.join(checkout.root, "openwiki", "INSTRUCTIONS.md"), prompt);
    const replacements = { model: config.model, prompt, seed: String(options.seed) };
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "HOME", "TMPDIR", ...config.env_passthrough]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    for (const [targetKey, sourceKey] of Object.entries(config.env_aliases ?? {})) {
      if (process.env[sourceKey] === undefined) throw new Error(`Missing system credential environment variable: ${sourceKey}`);
      env[targetKey] = process.env[sourceKey];
    }
    for (const [key, value] of Object.entries(config.env)) env[key] = substitute(value, replacements);
    env.OPENWIKI_BENCH_SEED = String(options.seed);
    env.LANGSMITH_TRACING = env.LANGSMITH_TRACING ?? "true";
    env.LANGCHAIN_TRACING_V2 = env.LANGCHAIN_TRACING_V2 ?? "true";
    env.LANGSMITH_PROJECT = env.LANGSMITH_PROJECT ?? `openwiki-bench-${options.subjectId}-${config.id}-seed-${options.seed}`;
    const command = config.command.map((part) => substitute(part, replacements));
    const capturedPlanPath = path.join(target, "plan.summary.json");
    const runStatePath = containedPath(checkout.root, config.run_state_path ?? path.join(config.output_directory, ".run.json"));
    let captureInFlight = Promise.resolve(false);
    const capture = (): void => {
      captureInFlight = captureInFlight.then(() => captureRunState(runStatePath, capturedPlanPath));
    };
    const timer = setInterval(capture, 100);
    try {
      exitCode = await execute(command, checkout.root, env, path.join(target, "run.log"));
    } finally {
      clearInterval(timer);
      capture();
      await captureInFlight;
    }
    const output = containedPath(checkout.root, config.output_directory);
    if (await isFile(path.join(output, ".last-update.json")) || await isFile(path.join(output, "index.md"))) {
      await cp(output, target, { recursive: true, force: true });
      capturedOutput = true;
    }
    const planSummary = config.plan_summary_path === undefined ? null : containedPath(checkout.root, config.plan_summary_path);
    if (planSummary !== null && await isFile(planSummary)) {
      await copyFile(planSummary, path.join(target, "plan.summary.json"));
      capturedPlan = true;
    }
    capturedPlan ||= await isFile(capturedPlanPath);
  } finally {
    await checkout.cleanup();
  }
  const finished = new Date();
  const manifest: RunManifest = {
    subject: options.subjectId,
    repo_sha: checkout.subject.repo_sha,
    model: config.model,
    runtime: config.runtime,
    openwiki_version: config.openwiki_version,
    seed: options.seed,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    wall_seconds: Math.round((finished.getTime() - started.getTime()) / 1000),
    outcome: exitCode === 0 && capturedOutput && capturedPlan ? "complete" : exitCode === 0 ? "incomplete" : "died",
    deaths: exitCode === 0 ? [] : [{ phase: "run", error: `exit ${exitCode}`, at: finished.toISOString() }],
    resumes: 0,
    env: {
      provider: config.env.OPENWIKI_PROVIDER ?? config.runtime,
      base_url: config.env.OPENAI_COMPATIBLE_BASE_URL ?? null,
      streaming: config.env.OPENWIKI_STREAMING === undefined ? null : config.env.OPENWIKI_STREAMING === "true",
      headers_timeout_ms: config.env.OPENWIKI_HEADERS_TIMEOUT_MS === undefined ? null : Number(config.env.OPENWIKI_HEADERS_TIMEOUT_MS),
    },
    prompt_sha: sha256(prompt),
    ignore_sha: ignore === null ? null : sha256(ignore),
    cost: { input_tokens: null, output_tokens: null, usd: null, source: "none" },
  };
  await writeFile(path.join(target, "run.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (exitCode !== 0) throw new Error(`Run failed with exit ${exitCode}; artifacts preserved at ${target}`);
  if (!capturedOutput || !capturedPlan) {
    throw new Error(`Run exited successfully but did not produce both wiki output and plan summary; artifacts preserved at ${target}`);
  }
  return { directory: target, manifest };
}
