import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface AmpModeConfig {
  id: string;
  mode: string;
  expected_model: string;
  contestant_models?: string[];
}

export interface AmpTaskProvenance {
  task_id: string;
  thread_id: string;
  requested_mode: string;
  resolved_models: string[];
  prompt_sha256: string;
  started_at: string;
  finished_at: string;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

async function run(command: string, args: string[], options: { cwd: string; input?: string }): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: code,
      });
    });
    child.stdin.end(options.input);
  });
}

function streamResult(output: string): { threadId: string; result: string } {
  let threadId: string | undefined;
  let result: string | undefined;
  for (const line of output.trim().split("\n")) {
    const event = JSON.parse(line) as { type?: string; session_id?: string; subtype?: string; result?: unknown; is_error?: boolean };
    threadId ??= event.session_id;
    if (event.type === "result") {
      if (event.subtype !== "success" || event.is_error === true || typeof event.result !== "string") {
        throw new Error(`Amp returned an unsuccessful result for thread ${threadId ?? "unknown"}`);
      }
      result = event.result;
    }
  }
  if (threadId === undefined || result === undefined) throw new Error("Amp stream omitted its thread ID or final result");
  return { threadId, result };
}

function collectModels(value: unknown, models = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectModels(item, models);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "model" && typeof item === "string") models.add(item);
      else collectModels(item, models);
    }
  }
  return models;
}

export function assertExactResolvedModels(models: readonly string[], expectedModel: string, threadId: string): void {
  const normalizedExpected = expectedModel.split("/").at(-1);
  const allowedModels = new Set([expectedModel, normalizedExpected]);
  if (!models.includes(expectedModel) || models.some((model) => !allowedModels.has(model))) {
    throw new Error(`Amp thread ${threadId} resolved ${models.join(", ") || "no model"}; expected ${expectedModel}`);
  }
}

export async function runAmpTask(
  taskId: string,
  prompt: string,
  config: AmpModeConfig,
): Promise<{ response: string; provenance: AmpTaskProvenance }> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "openwiki-judge-"));
  const startedAt = new Date().toISOString();
  try {
    const execution = await run("amp", [
      "--no-ide", "--no-color", "--stream-json", "--plugin-ready-timeout", "30",
      "--mode", config.mode, "--execute",
    ], { cwd, input: prompt });
    let completed: { threadId: string; result: string };
    try {
      completed = streamResult(execution.stdout);
    } catch (error) {
      if (execution.exitCode !== 0) {
        throw new Error(`amp exited ${execution.exitCode ?? "without a status"}: ${execution.stderr.slice(-1000) || execution.stdout.slice(-1000)}`, { cause: error });
      }
      throw error;
    }
    const { threadId, result } = completed;
    const exported = await run("amp", ["threads", "export", threadId], { cwd });
    if (exported.exitCode !== 0) throw new Error(`amp export exited ${exported.exitCode ?? "without a status"}: ${exported.stderr.slice(-1000)}`);
    const models = [...collectModels(JSON.parse(exported.stdout))].sort();
    assertExactResolvedModels(models, config.expected_model, threadId);
    return {
      response: result,
      provenance: {
        task_id: taskId,
        thread_id: threadId,
        requested_mode: config.mode,
        resolved_models: models,
        prompt_sha256: createHash("sha256").update(prompt, "utf8").digest("hex"),
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      },
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
