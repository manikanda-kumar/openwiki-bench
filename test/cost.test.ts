import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import { aggregateTelemetry, aggregateTelemetryByRun, aggregateTelemetrySource, importLangSmith, importOpenCodeSession, parseTelemetry } from "../src/cost.js";

const proxy = (type: string, extra: Record<string, unknown> = {}) => ({ schema_version: 1, source: "proxy", type, ...extra });

test("missing costs remain null rather than being guessed", () => {
  const aggregate = aggregateTelemetry(parseTelemetry([proxy("model_call", { input_tokens: 12, output_tokens: 3 })]));
  assert.equal(aggregate.usd, null);
  assert.equal(aggregate.usd_per_finished_page, null);
  assert.equal(aggregate.total_tokens, 15);
});

test("counts failed tools and normalized redundant reads", () => {
  const events = parseTelemetry([
    proxy("tool_call", { tool_name: "read_file", tool_success: true, file_path: "./src/a.ts" }),
    proxy("tool_call", { tool_name: "read_file", tool_success: false, file_path: "src\\a.ts" }),
    proxy("tool_call", { tool_name: "read_file", tool_success: true, file_path: "src/x/../a.ts" }),
    proxy("tool_call", { tool_name: "write", tool_success: null, file_path: "src/a.ts" }),
  ]);
  const aggregate = aggregateTelemetry(events);
  assert.equal(aggregate.tool_calls, 4);
  assert.equal(aggregate.failed_tool_calls, 1);
  assert.ok(Math.abs((aggregate.failed_tool_pct ?? 0) - 1 / 3) < 1e-12);
  assert.equal(aggregate.redundant_reads, 1);
});

test("extracts LangSmith usage_metadata and token_usage without double counting", () => {
  const events = importLangSmith({ runs: [
    { id: "a", trace_id: "trace", run_type: "llm", usage_metadata: { input_tokens: 20, output_tokens: 5 }, token_usage: { prompt_tokens: 999 } },
    { id: "b", trace_id: "trace", run_type: "chat_model", outputs: { llm_output: { token_usage: { prompt_tokens: 7, completion_tokens: 2 } } } },
  ] });
  const aggregate = aggregateTelemetry(events);
  assert.equal(aggregate.input_tokens, 27);
  assert.equal(aggregate.output_tokens, 7);
  assert.equal(aggregate.model_calls, 2);
  assert.deepEqual(Object.keys(aggregateTelemetryByRun(events)), ["trace"]);
});

test("reads normalized JSONL and computes derived metrics", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cost-test-"));
  const file = path.join(directory, "events.jsonl");
  await writeFile(file, [
    proxy("model_call", { input_tokens: 8, output_tokens: 4, cost_usd: 1.5, latency_ms: 10 }),
    proxy("page_finished", { page_path: "one.md" }),
    proxy("run_metrics", { plan_pages: 3, verified_claims: 6 }),
  ].map(value => JSON.stringify(value)).join("\n"));
  try {
    const aggregate = await aggregateTelemetrySource(file);
    assert.equal(aggregate.usd_per_finished_page, 1.5);
    assert.equal(aggregate.usd_per_verified_claim, 0.25);
    assert.equal(aggregate.tokens_per_plan_page, 4);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("normalizes OpenCode model, tool, and completed-page events", () => {
  const events = importOpenCodeSession({ messages: [{
    info: {
      role: "assistant", cost: 0.25,
      tokens: { total: 120, output: 20, reasoning: 5 },
      time: { created: 1_000, completed: 1_250 },
    },
    parts: [
      { type: "tool", tool: "read", state: { status: "completed", input: { filePath: "src/a.ts" }, time: { start: 1_050, end: 1_060 } } },
      { type: "tool", tool: "openwiki_openwiki_submit_page", state: { status: "completed", input: {}, output: JSON.stringify({ status: "complete", page: "/openwiki/a.md" }) } },
      { type: "tool", tool: "write", state: { status: "error", input: { filePath: "src/b.ts" } } },
    ],
  }] }, "subject/system/seed-0");
  const aggregate = aggregateTelemetry(events);
  assert.equal(aggregate.input_tokens, 95);
  assert.equal(aggregate.output_tokens, 20);
  assert.equal(aggregate.usd, 0.25);
  assert.equal(aggregate.latency_ms, 250);
  assert.equal(aggregate.tool_calls, 3);
  assert.equal(aggregate.failed_tool_calls, 1);
  assert.equal(aggregate.finished_pages, 1);
});
