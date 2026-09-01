import { readFile } from "node:fs/promises";
import path from "node:path";

export type TelemetrySource = "proxy" | "langsmith" | "opencode";

export interface NormalizedTelemetryEvent {
  schema_version: 1;
  run_id: string | null;
  source: TelemetrySource;
  type: "model_call" | "tool_call" | "page_finished" | "run_metrics";
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  tool_name: string | null;
  tool_success: boolean | null;
  file_path: string | null;
  page_path: string | null;
  plan_pages: number | null;
  verified_claims: number | null;
}

export interface TelemetryAggregate {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  usd: number | null;
  latency_ms: number | null;
  model_calls: number;
  tool_calls: number;
  failed_tool_calls: number;
  failed_tool_pct: number | null;
  redundant_reads: number;
  finished_pages: number;
  plan_pages: number | null;
  verified_claims: number | null;
  usd_per_finished_page: number | null;
  usd_per_verified_claim: number | null;
  tokens_per_plan_page: number | null;
}

type RecordValue = Record<string, unknown>;

const object = (value: unknown): RecordValue | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null;

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const text = (value: unknown): string | null => typeof value === "string" ? value : null;

function firstNumber(record: RecordValue | null, keys: readonly string[]): number | null {
  if (record === null) return null;
  for (const key of keys) {
    const value = finite(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function blank(source: TelemetrySource, type: NormalizedTelemetryEvent["type"], runId: string | null): NormalizedTelemetryEvent {
  return { schema_version: 1, run_id: runId, source, type, input_tokens: null, output_tokens: null,
    cost_usd: null, latency_ms: null, tool_name: null, tool_success: null, file_path: null,
    page_path: null, plan_pages: null, verified_claims: null };
}

/** Parse the documented normalized proxy event format, rejecting unrelated records. */
export function parseNormalizedEvent(value: unknown): NormalizedTelemetryEvent | null {
  const record = object(value);
  const type = record?.type;
  if (record === null || record.schema_version !== 1 || (record.source !== "proxy" && record.source !== "opencode") ||
      (type !== "model_call" && type !== "tool_call" && type !== "page_finished" && type !== "run_metrics")) return null;
  const event = blank(record.source, type, text(record.run_id));
  event.input_tokens = finite(record.input_tokens);
  event.output_tokens = finite(record.output_tokens);
  event.cost_usd = finite(record.cost_usd);
  event.latency_ms = finite(record.latency_ms);
  event.tool_name = text(record.tool_name);
  event.tool_success = typeof record.tool_success === "boolean" ? record.tool_success : null;
  event.file_path = text(record.file_path);
  event.page_path = text(record.page_path);
  event.plan_pages = finite(record.plan_pages);
  event.verified_claims = finite(record.verified_claims);
  return event;
}

/** Normalize one `opencode export` session while retaining its raw export separately. */
export function importOpenCodeSession(value: unknown, runId: string): NormalizedTelemetryEvent[] {
  const root = object(value);
  const messages = Array.isArray(root?.messages) ? root.messages : [];
  const events: NormalizedTelemetryEvent[] = [];
  for (const value of messages) {
    const message = object(value);
    const info = object(message?.info);
    if (info?.role !== "assistant") continue;
    const tokens = object(info.tokens);
    const total = finite(tokens?.total);
    const output = finite(tokens?.output);
    const reasoning = finite(tokens?.reasoning) ?? 0;
    const model = blank("opencode", "model_call", runId);
    model.input_tokens = total === null || output === null ? null : Math.max(0, total - output - reasoning);
    model.output_tokens = output;
    model.cost_usd = finite(info.cost);
    const time = object(info.time);
    const created = finite(time?.created);
    const completed = finite(time?.completed);
    model.latency_ms = created === null || completed === null || completed < created ? null : completed - created;
    events.push(model);
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    for (const partValue of parts) {
      const part = object(partValue);
      if (part?.type !== "tool") continue;
      const state = object(part.state);
      const input = object(state?.input);
      const tool = blank("opencode", "tool_call", runId);
      tool.tool_name = text(part.tool);
      tool.tool_success = state?.status === "completed" ? true : state?.status === "error" ? false : null;
      tool.file_path = text(input?.filePath) ?? text(input?.file_path) ?? text(input?.path);
      const toolTime = object(state?.time);
      const start = finite(toolTime?.start);
      const end = finite(toolTime?.end);
      tool.latency_ms = start === null || end === null || end < start ? null : end - start;
      events.push(tool);
      if (tool.tool_success && part.tool === "openwiki_openwiki_submit_page") {
        try {
          const result = object(JSON.parse(text(state?.output) ?? "null"));
          const page = text(result?.page);
          if (result?.status === "complete" && page !== null) {
            const finished = blank("opencode", "page_finished", runId);
            finished.page_path = page;
            events.push(finished);
          }
        } catch {
          // The raw export remains authoritative when a tool returns non-JSON output.
        }
      }
    }
  }
  return events;
}

function usageFor(run: RecordValue): RecordValue | null {
  const extra = object(run.extra);
  const outputs = object(run.outputs);
  const llmOutput = object(outputs?.llm_output);
  // Use one usage object only: exports frequently repeat identical usage in several places.
  return object(run.usage_metadata) ?? object(extra?.usage_metadata) ?? object(outputs?.usage_metadata) ??
    object(run.token_usage) ?? object(extra?.token_usage) ?? object(outputs?.token_usage) ?? object(llmOutput?.token_usage);
}

/** Convert a LangSmith runs JSON export (an array or {runs/data: []}) to normalized events. */
export function importLangSmith(value: unknown): NormalizedTelemetryEvent[] {
  const root = object(value);
  const runs = Array.isArray(value) ? value : Array.isArray(root?.runs) ? root.runs : Array.isArray(root?.data) ? root.data : [value];
  const result: NormalizedTelemetryEvent[] = [];
  for (const item of runs) {
    const run = object(item);
    if (run === null) continue;
    const runType = text(run.run_type) ?? text(run.run_type_name);
    const isTool = runType === "tool";
    const isModel = runType === "llm" || runType === "chat_model";
    if (!isTool && !isModel) continue;
    const event = blank("langsmith", isTool ? "tool_call" : "model_call", text(run.trace_id) ?? text(run.id));
    if (isModel) {
      const usage = usageFor(run);
      event.input_tokens = firstNumber(usage, ["input_tokens", "prompt_tokens"]);
      event.output_tokens = firstNumber(usage, ["output_tokens", "completion_tokens"]);
      event.cost_usd = firstNumber(run, ["total_cost", "cost_usd"]);
      const duration = finite(run.latency_ms);
      const start = Date.parse(text(run.start_time) ?? "");
      const end = Date.parse(text(run.end_time) ?? "");
      event.latency_ms = duration ?? (Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null);
    } else {
      event.tool_name = text(run.name);
      event.tool_success = run.error === null ? true : run.error === undefined ? null : false;
      const inputs = object(run.inputs);
      event.file_path = text(inputs?.file_path) ?? text(inputs?.path);
    }
    result.push(event);
  }
  return result;
}

export function parseTelemetry(records: unknown): NormalizedTelemetryEvent[] {
  const values = Array.isArray(records) ? records : [records];
  const normalized = values.map(parseNormalizedEvent).filter((event): event is NormalizedTelemetryEvent => event !== null);
  return normalized.length > 0 ? normalized : importLangSmith(records);
}

export async function readTelemetry(file: string): Promise<NormalizedTelemetryEvent[]> {
  const body = await readFile(file, "utf8");
  if (file.endsWith(".jsonl")) {
    const records = body.split(/\r?\n/u).filter(line => line.trim() !== "").map((line, index) => {
      try { return JSON.parse(line) as unknown; } catch { throw new SyntaxError(`Invalid JSONL at line ${index + 1}`); }
    });
    return parseTelemetry(records);
  }
  return parseTelemetry(JSON.parse(body) as unknown);
}

function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
}

function sumComplete(values: Array<number | null>): number | null {
  return values.length === 0 || values.some(value => value === null) ? null :
    (values as number[]).reduce((sum, value) => sum + value, 0);
}

function normalizedPath(value: string): string {
  return path.posix.normalize(value.replaceAll("\\", "/")).replace(/^\.\//u, "");
}

export function aggregateTelemetry(events: readonly NormalizedTelemetryEvent[]): TelemetryAggregate {
  const models = events.filter(event => event.type === "model_call");
  const tools = events.filter(event => event.type === "tool_call");
  const input = sumComplete(models.map(event => event.input_tokens));
  const output = sumComplete(models.map(event => event.output_tokens));
  const tokens = input === null || output === null ? null : input + output;
  const usd = sumComplete(models.map(event => event.cost_usd));
  const knownTools = tools.filter(event => event.tool_success !== null);
  const failed = knownTools.filter(event => event.tool_success === false).length;
  const readCounts = new Map<string, number>();
  for (const event of tools) if (event.file_path !== null && /^(read|read_file|cat)$/iu.test(event.tool_name ?? "")) {
    const file = normalizedPath(event.file_path);
    readCounts.set(file, (readCounts.get(file) ?? 0) + 1);
  }
  const finishedPages = new Set(events.filter(event => event.type === "page_finished").map(event => event.page_path).filter((p): p is string => p !== null)).size;
  const planPages = sumKnown(events.filter(event => event.type === "run_metrics").map(event => event.plan_pages));
  const claims = sumKnown(events.filter(event => event.type === "run_metrics").map(event => event.verified_claims));
  return {
    input_tokens: input, output_tokens: output, total_tokens: tokens, usd,
    latency_ms: sumComplete(models.map(event => event.latency_ms)), model_calls: models.length,
    tool_calls: tools.length, failed_tool_calls: failed,
    failed_tool_pct: knownTools.length === 0 ? null : failed / knownTools.length,
    redundant_reads: [...readCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 2), 0),
    finished_pages: finishedPages, plan_pages: planPages, verified_claims: claims,
    usd_per_finished_page: usd === null || finishedPages === 0 ? null : usd / finishedPages,
    usd_per_verified_claim: usd === null || claims === null || claims === 0 ? null : usd / claims,
    tokens_per_plan_page: tokens === null || planPages === null || planPages === 0 ? null : tokens / planPages,
  };
}

export async function aggregateTelemetrySource(source: string | unknown): Promise<TelemetryAggregate> {
  return aggregateTelemetry(typeof source === "string" ? await readTelemetry(source) : parseTelemetry(source));
}

export function aggregateTelemetryByRun(
  events: readonly NormalizedTelemetryEvent[],
): Record<string, TelemetryAggregate> {
  const grouped = new Map<string, NormalizedTelemetryEvent[]>();
  for (const event of events) {
    const runId = event.run_id ?? "unknown";
    const group = grouped.get(runId) ?? [];
    group.push(event);
    grouped.set(runId, group);
  }
  return Object.fromEntries(
    [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([runId, runEvents]) => [runId, aggregateTelemetry(runEvents)]),
  );
}
