import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { copyFile, cp, lstat, mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { finished } from "node:stream/promises";
import { promisify } from "node:util";
import { aggregateTelemetry, importOpenCodeSession, type NormalizedTelemetryEvent } from "./cost.js";
import { isFile, listFiles, readJson } from "./io.js";
import type { RunManifest } from "./schema.js";
import { checkoutSubject } from "./subject.js";

const exec = promisify(execFile);

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
  timeout_seconds?: number;
  telemetry?: "opencode-jsonl";
  agent?: string;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function redactSensitiveText(content: string): string {
  return content
    .replace(/[0-9]{6,}-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com/gu, "REDACTED_GOOGLE_OAUTH_CLIENT_ID")
    .replace(/GOCSPX-[A-Za-z0-9_-]+/gu, "REDACTED_GOOGLE_OAUTH_CLIENT_SECRET");
}

class RedactingLines extends Transform {
  private pending = "";

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.pending += chunk.toString("utf8");
    const lines = this.pending.split("\n");
    this.pending = lines.pop() ?? "";
    callback(null, lines.map((line) => `${redactSensitiveText(line)}\n`).join(""));
  }

  override _flush(callback: TransformCallback): void {
    callback(null, redactSensitiveText(this.pending));
  }
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

async function execute(
  command: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  stdoutFile: string,
  stderrFile: string,
  timeoutSeconds: number,
  rejectSubagents = false,
): Promise<{ exitCode: number; timedOut: boolean; contractError: string | null }> {
  if (command.length === 0 || !command[0]) throw new Error("System command cannot be empty");
  return await new Promise((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = createWriteStream(stdoutFile);
    const stderr = createWriteStream(stderrFile);
    const redactedStdout = child.stdout.pipe(new RedactingLines());
    const redactedStderr = child.stderr.pipe(new RedactingLines());
    redactedStdout.pipe(stdout);
    redactedStderr.pipe(stderr);
    let timedOut = false;
    let contractError: string | null = null;
    let pending = "";
    const terminate = (): void => {
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* process already exited */ }
      setTimeout(() => {
        try { process.kill(-child.pid!, "SIGKILL"); } catch { /* process already exited */ }
      }, 10_000).unref();
    };
    if (rejectSubagents) child.stdout.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      const lines = pending.split(/\r?\n/u);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as { type?: unknown; part?: { tool?: unknown } };
          if (event.type === "tool_use" && event.part?.tool === "task") {
            contractError = "forbidden subagent task";
            terminate();
            break;
          }
        } catch { /* non-JSON output is retained for post-run validation */ }
      }
    });
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutSeconds * 1000);
    child.on("error", reject);
    child.on("close", async (code) => {
      clearTimeout(timer);
      await Promise.all([finished(redactedStdout), finished(redactedStderr), finished(stdout), finished(stderr)]);
      resolve({ exitCode: timedOut ? 124 : contractError === null ? code ?? 1 : 1, timedOut, contractError });
    });
  });
}

async function exportOpenCodeSession(
  sessionId: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  sessionPath: string,
  stderrPath: string,
): Promise<unknown> {
  let lastError = "unknown export error";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stdout = await open(sessionPath, "w");
    const stderr = await open(stderrPath, "w");
    try {
      const exitCode = await new Promise<number>((resolve, reject) => {
        const child = spawn("opencode", ["export", sessionId], {
          cwd, env, stdio: ["ignore", stdout.fd, stderr.fd],
        });
        const timer = setTimeout(() => child.kill("SIGTERM"), 60_000);
        child.on("error", reject);
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve(code ?? 1);
        });
      });
      if (exitCode !== 0) throw new Error(`exit ${exitCode}`);
      const raw = await readFile(sessionPath, "utf8");
      const session = JSON.parse(raw) as unknown;
      await writeFile(sessionPath, redactSensitiveText(raw));
      return session;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      await Promise.all([stdout.close(), stderr.close()]);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`OpenCode session export failed after 3 attempts: ${lastError}`);
}

function opencodeSessionIds(events: string): string[] {
  const ids = new Set<string>();
  for (const line of events.split(/\r?\n/u)) {
    if (line.trim() === "") continue;
    const value = JSON.parse(line) as { sessionID?: unknown };
    if (typeof value.sessionID === "string") ids.add(value.sessionID);
  }
  return [...ids];
}

function opencodeFailure(events: string): string | null {
  let result: string | null = null;
  for (const line of events.split(/\r?\n/u)) {
    if (line.trim() === "") continue;
    try {
      const value = JSON.parse(line) as { type?: unknown; error?: { data?: { message?: unknown }; message?: unknown } };
      if (value.type === "error") {
        const message = value.error?.data?.message ?? value.error?.message;
        if (typeof message === "string") result = message;
      }
    } catch { /* malformed raw output is diagnosed by session finalization */ }
  }
  return result;
}

function assertOpenCodeSession(session: unknown, expectedModel: string, expectedAgent: string): string {
  if (typeof session !== "object" || session === null) throw new Error("OpenCode session export is not an object");
  const root = session as { info?: { model?: { id?: unknown; providerID?: unknown }; agent?: unknown; version?: unknown }; messages?: Array<{ info?: { role?: unknown; modelID?: unknown; providerID?: unknown } }> };
  const info = root.info;
  if (info === undefined) throw new Error("OpenCode session export has no session metadata");
  const resolvedModel = info.model;
  const [provider, model] = expectedModel.split("/", 2);
  if (resolvedModel?.providerID !== provider || resolvedModel?.id !== model) {
    throw new Error(`OpenCode resolved ${String(resolvedModel?.providerID)}/${String(resolvedModel?.id)}, expected ${expectedModel}`);
  }
  if (info.agent !== expectedAgent) throw new Error(`OpenCode resolved agent ${String(info.agent)}, expected ${expectedAgent}`);
  const substituted = (root.messages ?? []).find((message) => message.info?.role === "assistant" &&
    (message.info.providerID !== provider || message.info.modelID !== model));
  if (substituted !== undefined) throw new Error(`OpenCode substituted model during session: ${String(substituted.info?.providerID)}/${String(substituted.info?.modelID)}`);
  const delegated = (root.messages ?? []).flatMap((message) => {
    const parts = (message as { parts?: unknown[] }).parts;
    return Array.isArray(parts) ? parts : [];
  }).find((part) => typeof part === "object" && part !== null &&
    (part as { type?: unknown; tool?: unknown }).type === "tool" && (part as { tool?: unknown }).tool === "task");
  if (delegated !== undefined) throw new Error("OpenCode session used a forbidden subagent task");
  if (typeof info.version !== "string") throw new Error("OpenCode session export has no runtime version");
  return info.version;
}

async function claimCount(outputRoot: string): Promise<number> {
  const files = await listFiles(path.join(outputRoot, ".claims"), ".json");
  let count = 0;
  for (const file of files) {
    const value = JSON.parse(await readFile(file, "utf8")) as { claims?: unknown[] };
    count += Array.isArray(value.claims) ? value.claims.length : 0;
  }
  return count;
}

async function unexpectedSourceChanges(repoRoot: string, outputDirectory: string): Promise<string[]> {
  const { stdout } = await exec("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 });
  const allowedFiles = new Set([".openwikiignore", "AGENTS.md", "CLAUDE.md", ".github/workflows/openwiki-update.yml"]);
  const outputPrefix = `${outputDirectory.replace(/\/+$/u, "")}/`;
  return stdout.split(/\r?\n/u).filter(Boolean).map((line) => line.slice(3)).filter((file) =>
    !allowedFiles.has(file) && file !== outputDirectory && !file.startsWith(outputPrefix));
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
  const configBody = await readFile(options.configPath, "utf8");
  const prompt = await readFile(options.promptPath, "utf8");
  const ignore = options.ignorePath === undefined ? null : await readFile(options.ignorePath, "utf8");
  const target = path.join(options.projectRoot, "runs", options.subjectId, config.id, `seed-${options.seed}`);
  if (await isFile(path.join(target, "run.json"))) throw new Error(`Run already exists: ${target}`);
  await mkdir(target, { recursive: true });
  const checkout = await checkoutSubject(options.projectRoot, options.subjectId);
  const started = new Date();
  let exitCode = 1;
  let errorDetail: string | null = null;
  let capturedOutput = false;
  let capturedPlan = false;
  let opencodeVersion: string | null = null;
  let sessionIds: string[] = [];
  let telemetry: NormalizedTelemetryEvent[] = [];
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
    const timeoutSeconds = config.timeout_seconds ?? 10_800;
    const capturedPlanPath = path.join(target, "plan.summary.json");
    const runStatePath = containedPath(checkout.root, config.run_state_path ?? path.join(config.output_directory, ".run.json"));
    let captureInFlight = Promise.resolve(false);
    const capture = (): void => {
      captureInFlight = captureInFlight.then(() => captureRunState(runStatePath, capturedPlanPath));
    };
    const timer = setInterval(capture, 100);
    try {
      const execution = await execute(
        command,
        checkout.root,
        env,
        path.join(target, config.telemetry === "opencode-jsonl" ? "opencode-events.jsonl" : "run.stdout.log"),
        path.join(target, "run.stderr.log"),
        timeoutSeconds,
        config.telemetry === "opencode-jsonl",
      );
      exitCode = execution.exitCode;
      if (execution.timedOut) errorDetail = `timeout after ${timeoutSeconds}s`;
      if (execution.contractError !== null) errorDetail = execution.contractError;
      if (exitCode !== 0 && errorDetail === null && config.telemetry === "opencode-jsonl") {
        errorDetail = opencodeFailure(await readFile(path.join(target, "opencode-events.jsonl"), "utf8"));
      }
      const sourceChanges = await unexpectedSourceChanges(checkout.root, config.output_directory);
      if (sourceChanges.length > 0) {
        errorDetail = `agent modified source path(s): ${sourceChanges.slice(0, 10).join(", ")}`;
        exitCode = 1;
      }
    } finally {
      clearInterval(timer);
      capture();
      await captureInFlight;
    }
    const output = containedPath(checkout.root, config.output_directory);
    if (await isFile(path.join(output, ".run.json")) || await isFile(path.join(output, ".last-update.json")) || await isFile(path.join(output, "index.md"))) {
      await cp(output, target, { recursive: true, force: true });
      capturedOutput = true;
    }
    const planSummary = config.plan_summary_path === undefined ? null : containedPath(checkout.root, config.plan_summary_path);
    if (planSummary !== null && await isFile(planSummary)) {
      await copyFile(planSummary, path.join(target, "plan.summary.json"));
      capturedPlan = true;
    }
    capturedPlan ||= await isFile(capturedPlanPath);
    if (config.telemetry === "opencode-jsonl") {
      try {
        const eventsPath = path.join(target, "opencode-events.jsonl");
        sessionIds = opencodeSessionIds(await readFile(eventsPath, "utf8"));
        if (sessionIds.length !== 1) throw new Error(`Expected exactly one OpenCode session, found ${sessionIds.length}`);
        const sessionPath = path.join(target, "opencode-session.json");
        const session = await exportOpenCodeSession(sessionIds[0]!, checkout.root, env, sessionPath, path.join(target, "opencode-export.stderr.log"));
        opencodeVersion = assertOpenCodeSession(session, config.model, config.agent ?? "build");
        const runId = `${options.subjectId}/${config.id}/seed-${options.seed}`;
        telemetry = importOpenCodeSession(session, runId);
        const plan = capturedPlan ? JSON.parse(await readFile(capturedPlanPath, "utf8")) as { plan_page_count?: unknown; pages?: unknown[] } : null;
        const metrics: NormalizedTelemetryEvent = {
          schema_version: 1, run_id: runId, source: "opencode", type: "run_metrics",
          input_tokens: null, output_tokens: null, cost_usd: null, latency_ms: null,
          tool_name: null, tool_success: null, file_path: null, page_path: null,
          plan_pages: typeof plan?.plan_page_count === "number" ? plan.plan_page_count : Array.isArray(plan?.pages) ? plan.pages.length : null,
          verified_claims: capturedOutput ? await claimCount(target) : null,
        };
        telemetry.push(metrics);
        await writeFile(path.join(target, "telemetry.jsonl"), `${telemetry.map((event) => JSON.stringify(event)).join("\n")}\n`);
      } catch (error) {
        errorDetail = error instanceof Error ? error.message : String(error);
        exitCode = 1;
      }
    }
  } finally {
    await checkout.cleanup();
  }
  const finished = new Date();
  const aggregate = aggregateTelemetry(telemetry);
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
    deaths: exitCode === 0 ? [] : [{ phase: "run", error: errorDetail ?? `exit ${exitCode}`, at: finished.toISOString() }],
    resumes: 0,
    env: {
      provider: config.env.OPENWIKI_PROVIDER ?? config.runtime,
      base_url: config.env.OPENAI_COMPATIBLE_BASE_URL ?? null,
      streaming: config.env.OPENWIKI_STREAMING === undefined ? null : config.env.OPENWIKI_STREAMING === "true",
      headers_timeout_ms: config.env.OPENWIKI_HEADERS_TIMEOUT_MS === undefined ? null : Number(config.env.OPENWIKI_HEADERS_TIMEOUT_MS),
    },
    prompt_sha: sha256(prompt),
    ignore_sha: ignore === null ? null : sha256(ignore),
    system_sha: sha256(configBody),
    ...(config.telemetry === "opencode-jsonl" && opencodeVersion !== null ? { execution: {
      agent: config.agent ?? "build",
      opencode_version: opencodeVersion,
      session_ids: sessionIds,
      timeout_seconds: config.timeout_seconds ?? 10_800,
      telemetry_file: "telemetry.jsonl",
    } } : {}),
    cost: {
      input_tokens: aggregate.input_tokens,
      output_tokens: aggregate.output_tokens,
      usd: aggregate.usd,
      source: telemetry.length === 0 ? "none" : "opencode",
    },
  };
  await writeFile(path.join(target, "run.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (exitCode !== 0) throw new Error(`Run failed with exit ${exitCode}; artifacts preserved at ${target}`);
  if (!capturedOutput || !capturedPlan) {
    throw new Error(`Run exited successfully but did not produce both wiki output and plan summary; artifacts preserved at ${target}`);
  }
  return { directory: target, manifest };
}
