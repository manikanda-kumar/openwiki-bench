import assert from "node:assert/strict";
import { test } from "node:test";
import { assertExactResolvedModels } from "../src/amp.js";

test("requires every resolved model identifier to match the requested model exactly", () => {
  assert.doesNotThrow(() => assertExactResolvedModels(["gpt-5.5", "openai/gpt-5.5"], "openai/gpt-5.5", "thread"));
  assert.throws(
    () => assertExactResolvedModels(["gpt-5.5", "openai/gpt-5.5", "other/gpt-5.5"], "openai/gpt-5.5", "thread"),
    /resolved gpt-5\.5, openai\/gpt-5\.5, other\/gpt-5\.5; expected openai\/gpt-5\.5/u,
  );
  assert.throws(() => assertExactResolvedModels(["gpt-5.5"], "openai/gpt-5.5", "thread"), /expected openai\/gpt-5\.5/u);
});
