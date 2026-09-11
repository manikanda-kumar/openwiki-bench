---
type: architecture-component
title: LLM Layer
description: How ExtractThinker wraps LLM providers via the LLM class, its DEFAULT (litellm + instructor) and PYDANTIC_AI backends, routing, thinking-mode budget sizing, and dynamic JSON parsing.
tags: [llm, litellm, instructor, pydantic-ai, structured-output, backend]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:40:03.572Z
sources:
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-3fa92ad82a0a3d4b723095a9
    resource: repo://extract_thinker/llm_engine.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-11T09:40:03.572Z" }
---

# LLM Layer

`extract_thinker.llm.LLM` is the single LLM gateway used by `Extractor`, splitters, completion handlers, and the evaluation framework. The repository does not call any LLM provider SDK directly outside this class (the sole exception is the OpenAI batch API, which `extract_thinker.batch_job.BatchJob` talks to separately for batch jobs only).

## Responsibilities

- Hold the model identifier and completion parameters (temperature, timeout, token budget).
- Issue structured-output requests bound to a Pydantic `response_model` via `LLM.request(messages, response_model)` (extract_thinker/llm.py:183-236).
- Issue raw unstructured completions via `LLM.raw_completion(messages)` (extract_thinker/llm.py:298-342), used by `ConcatenationHandler`.
- Optionally manage a LiteLLM `Router` for model fallback scenarios (`load_router`, extract_thinker/llm.py:121-125).
- Compute thinking-mode token budgets from a caller-supplied page count (`set_page_count`, extract_thinker/llm.py:155-181).

## Backends (LLMEngine)

The `LLMEngine` enum (extract_thinker/llm_engine.py) defines two supported backends; any other value raises `ValueError` at construction (extract_thinker/llm.py:95-96):

- `DEFAULT` ("default"): builds an instructor client over `litellm.completion` with `instructor.Mode.MD_JSON` (extract_thinker/llm.py:79-84). All structured extraction goes through instructor's response-model parsing.
- `PYDANTIC_AI` ("pydantic_ai"): requires the extra `pydantic-ai` package; construction raises `ImportError` with an install hint when it is missing (extract_thinker/llm.py:85-96, 98-107). Under this backend the `LLM` holds a `pydantic_ai.Agent`, `request()` collapses the message list into one prompt string and runs `agent.run(...)` synchronously through `asyncio.run` (extract_thinker/llm.py:189-201).

Because the pydantic-ai path joins messages into a single prompt, message-level structure (system role, multi-part image content) is not preserved. `Extractor.extract_batch` explicitly refuses this backend (extract_thinker/extractor.py:972-977).

## Request paths

`request()` branches on state:

- **Router path**: when a router is loaded, `self.router.completion(...)` is called with `response_model`, temperature, `max_completion_tokens`, and a 3-second timeout constant (`TIMEOUT = 3000` milliseconds, extract_thinker/llm.py:40) (extract_thinker/llm.py:238-265). Routers are only accepted with the DEFAULT backend (extract_thinker/llm.py:122-124).
- **Direct path**: `self.client.chat.completions.create(...)` with `max_retries: 1`, the model, temperature, response model, and `max_completion_tokens` (extract_thinker/llm.py:267-296).

### Max-token computation

Both paths call `_get_model_max_tokens()`, which returns the constant `DEFAULT_MAX_COMPLETION_TOKENS = 8000` (extract_thinker/llm.py:53, 348-356). An explicit `token_limit` constructor argument clamps this via `min` (extract_thinker/llm.py:241-242, 270-273).

### Thinking mode

`set_thinking(True)` flips `is_thinking` and forces temperature to 1 (extract_thinker/llm.py:135-142). When thinking is on and `litellm.supports_reasoning(model)` accepts the model, a `thinking: {"type": "enabled", "budget_tokens": N}` parameter is added; otherwise the code prints a warning and proceeds without the parameter (extract_thinker/llm.py:254-263, 285-294).

Token budget sizing is driven by `set_page_count`, which the `Extractor` calls before every extraction with the document's page count (see extract_thinker/extractor.py:303-314, 251-268):

- Each page is assumed to cost `DEFAULT_PAGE_TOKENS = 1500` tokens (text + image); content tokens are `page_count * 1500` clamped to `MAX_TOKEN_LIMIT = 120000` (extract_thinker/llm.py:43-45, 169-170).
- The thinking budget is one third of the content tokens (`DEFAULT_THINKING_RATIO = 1/3`), clamped between `MIN_THINKING_BUDGET = 1200` and `MAX_THINKING_BUDGET = 64000` (extract_thinker/llm.py:44-47, 172-181).
- A non-positive page count raises `ValueError` (extract_thinker/llm.py:164-165).

## Dynamic JSON parsing mode

`set_dynamic(True)` switches `request()` into a two-phase mode (extract_thinker/llm.py:144-153, 208-236):

1. The `response_model` is withheld from instructor (`request_model = None`) and converted into a JSON-structure description via `add_classification_structure` (extract_thinker/utils.py:268).
2. A system prompt built by `build_dynamic_prompt` instructs the model to emit chain-of-thought inside `<think>` tags followed by JSON (extract_thinker/llm.py:14-37).
3. The raw response content is run through `extract_thinking_json`, which strips `think` tags and tries several JSON regex patterns (fenced JSON, backticked JSON, bare object), parses the first match, and validates it into the response model; failure raises `ValueError` (extract_thinker/utils.py:479-540).

With `is_dynamic=False` (the default), `request()` returns the instructor-parsed model instance directly.

## Configuration surface

- `set_temperature(value)` — request temperature; default 0 (extract_thinker/llm.py:41, 127-133).
- `set_timeout(ms)` — overrides the class-level `TIMEOUT` used in both request paths (extract_thinker/llm.py:40, 344-346).
- `token_limit` constructor argument — per-instance completion-token ceiling overriding the 8000 default (extract_thinker/llm.py:55-67, 348-356).
- Concrete model coverage (OpenAI, Anthropic, Cohere, Azure, Ollama-style local models) is inherited from litellm's naming resolution; the repository pins `litellm >= 1.71.1` (pyproject.toml) and otherwise delegates to it.

## Extension seams

- Subclass or wrap `LLM` to override `request`/`raw_completion`; `Extractor.load_llm` accepts either an `LLM` instance or a model string (extract_thinker/extractor.py:131-137).
- New backends require extending `LLMEngine` and the constructor branch (extract_thinker/llm.py:79-96); the enum docstring CURRENTLY documents only litellm+instructor and pydantic-ai support.
- `build_dynamic_prompt` is deliberately exposed as a standalone function so callers can swap prompt variants without editing `LLM` internals (extract_thinker/llm.py:9-11).

## Known limitations and uncertainty

- `request()`/`raw_completion()` call `asyncio.run` on the pydantic-ai path, which throws `RuntimeError` inside an already-running event loop; combined with `asyncio.to_thread` in `Extractor.extract_async` this is safe, but the repository provides no test coverage for pydantic-ai under an active loop — treat this edge as unverified.
- `PAGE_COUNT_TO_TOKEN` sizing (1500 tokens/page) is a heuristic, not a measured true-cost model; no test pins the exact budget arithmetic beyond clamping bounds.
