---
type: subsystem
title: "LLM Integration"
description: "The LLM facade: litellm+instructor default backend, optional pydantic-ai agents, LiteLLM routers, thinking budgets derived from page counts, and dynamic-output parsing."
tags: [llm, litellm, instructor, pydantic-ai, thinking, tokens]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T10:24:25.212Z
sources:
  - id: openwiki-source-e9ebd8673ce94833101e27ed
    resource: repo://extract_thinker/concatenation_handler.py
  - id: openwiki-source-d14c100cb1c28d349fc7a183
    resource: repo://extract_thinker/global_models.py
  - id: openwiki-source-3fa92ad82a0a3d4b723095a9
    resource: repo://extract_thinker/llm_engine.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-aa326a6e338619f95df6a4ce
    resource: repo://tests/test_llm_backends.py
generated: { by: "opencode", at: "2026-09-11T10:24:25.212Z" }
---

# LLM Integration

`LLM` (`extract_thinker/llm.py`) is the single object through which every LLM call in the library flows — extraction, classification, splitting verdicts, conflict resolution, markdown conversion, and hallucination checks. It wraps either `instructor` over `litellm` or a `pydantic_ai.Agent`, selected by the `backend: LLMEngine` constructor argument (`extract_thinker/llm_engine.py`: `DEFAULT = "default"`, `PYDANTIC_AI = "pydantic_ai"`; any other value raises `ValueError`).

## Default backend (litellm + instructor)

`DEFAULT` builds `self.client = instructor.from_litellm(litellm.completion, mode=instructor.Mode.MD_JSON)` — structured outputs are enforced by instructor validating the model's Markdown-embedded JSON against the `response_model`. Requests go through `_request_direct` (`client.chat.completions.create(..., max_retries=1, timeout=LLM.TIMEOUT)` — 3000 ms default) or, when a LiteLLM `Router` was attached via `load_router` for provider-level fallbacks, `_request_with_router` (`router.completion`). `load_router` rejects non-DEFAULT backends with `ValueError`. Model routing to providers is inherited from litellm conventions: model strings like `"ollama/phi3"` or `"gemini/..."` pass through verbatim, with provider credentials resolved by litellm from the environment (the repository itself only reads API keys directly in the batch path).

## Thinking mode and token budgets

`set_thinking(True)` is a two-in-one toggle: it flips `is_thinking` **and pins `temperature` to 1**. When thinking is on and `litellm.supports_reasoning(model)` says yes, requests include `thinking={"type": "enabled", "budget_tokens": self.thinking_budget}`; otherwise a warning prints and the parameter is omitted. Budgets derive from document size via `set_page_count(page_count)` (positive integers only):

- content cap: `min(page_count * 1500, 120000)` tokens → `thinking_token_limit`;
- budget: `int(page_count * 1500 / 3)` clamped to `[1200, 64000]` → `thinking_budget`.

Effective `max_completion_tokens` per request is the constant `DEFAULT_MAX_COMPLETION_TOKENS = 8000`, then clamped by an explicit constructor `token_limit`, or (when thinking and no explicit limit) by `thinking_token_limit`. The extractors feed page counts automatically in `extract()`; `Extractor.enable_thinking_mode()` is the manual switch.

## Dynamic parsing mode

`set_dynamic(True)` switches to a manual flow: instructor receives `response_model=None`, a second system message built by `build_dynamic_prompt(structure)` (overridable `think` tag) instructs the model to emit `<think>...</think>` then JSON, and the raw `choices[0].message.content` is post-processed with `extract_thinking_json` — a regex cascade (fenced ```json, plain fences, bare object braces, whole-string JSON) that also strips `<think>` tags and `{content}` placeholders before `response_model(**data)`. Parse failures surface as `ValueError` with the offending text excerpt. This mode trades instructor validation for thinking-text tolerance.

## PYDANTIC_AI backend

`PYDANTIC_AI` imports `pydantic_ai` lazily (`ImportError` with a pip hint otherwise), sets `client = None`, and constructs `Agent(model)` with the model string cast to `KnownModelName`. `request()` and `raw_completion()` collapse the message list into one space-joined prompt, run `asyncio.run(agent.run(prompt, result_type=...))`, and return `result.data`; all failures become `ValueError("Failed to extract from source: ...")`. Router attachment, thinking parameters, and batch jobs are not available on this backend (both explicitly raise).

## Shared knobs and presets

- `TIMEOUT` (3000 ms) via `set_timeout` — assigned as an instance attribute shadowing the class constant;
- `temperature` via `set_temperature` (default 0);
- `LLMEngine` presets in `extract_thinker/global_models.py`: `get_lite_model()` and `get_big_model()` currently return the *same* string `gemini/gemini-2.5-flash-preview-05-20`, alongside `get_gpt_mini_model()` (`gpt-4.1-mini`) and `get_gpt_o4_model()` (`gpt-4o`). Test code uses these for both cheap and "big" model slots, so consensus layering across the lite/big presets is not actually testing heterogeneous models with the current values.

## Focused tests and a stale member

`tests/test_llm_backends.py` checks backend selection, agent-vs-client wiring, the router/backend incompatibility, and skips the pydantic-ai case when the package is missing. Caveat when reading it: the tests reference `llm_engine.LITELLM`, a member the current `LLMEngine` enum does not define (it has `DEFAULT`/`PYDANTIC_AI`), so that file cannot run green against the present source as-is.

Related: [Extractor Core](/openwiki/architecture/extractor.md) for callers, [Tuning Extraction Quality](/openwiki/guides/tuning-extraction-quality.md) for budget effects.
