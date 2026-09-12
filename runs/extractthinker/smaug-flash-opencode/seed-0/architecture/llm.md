---
type: concept
title: LLM Abstraction and Backends
description: The LLM class in ExtractThinker, covering backends, thinking mode, router support, dynamic prompting, token and temperature configuration, and request handling.
tags: [llm, litellm, instructor, pydantic-ai, thinking]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:12:00.069Z
sources:
  - id: openwiki-source-3fa92ad82a0a3d4b723095a9
    resource: repo://extract_thinker/llm_engine.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
generated: { by: "opencode", at: "2026-09-12T21:12:00.069Z" }
---

# LLM Abstraction and Backends

`LLM` (extract_thinker/llm.py:39-356) is the thin wrapper that issues structured
completion requests. It is constructed with a model string and an `LLMEngine`
backend (extract_thinker/llm_engine.py:4-12): `DEFAULT`
(litellm + instructor) or `PYDANTIC_AI`.

## Backends

- `DEFAULT`: wraps `litellm.completion` with `instructor.Mode.MD_JSON` into
  `self.client` (llm.py:79-84). Structured output is provided by instructor via
  the `response_model` parameter.
- `PYDANTIC_AI`: uses `pydantic_ai.Agent`; `request` concatenates message content
  into a combined prompt and runs the agent with `result_type` (llm.py:189-201,
  300-312). The backend is import-checked lazily.

## Request path

`request` (llm.py:183-236) handles both backends. For `DEFAULT`, when
`is_dynamic` is false it passes `response_model` straight through; when dynamic,
it appends a system prompt built by `build_dynamic_prompt` (llm.py:14-37) that
asks the model to output its reasoning inside a thinking tag followed by JSON,
and then parses the JSON from the raw text with `extract_thinking_json`
(llm.py:213-235).

Requests go through `_request_with_router` (llm.py:238-265) or `_request_direct`
(llm.py:267-296). Both compute `max_completion_tokens` from
`_get_model_max_tokens()` (default `DEFAULT_MAX_COMPLETION_TOKENS` = 8000,
llm.py:348-356), clamp with `token_limit` if set, and include the `thinking`
parameter when `is_thinking` is enabled and `litellm.supports_reasoning` passes.

## Configuration

- `set_temperature` (default `DEFAULT_TEMPERATURE = 0`).
- `set_thinking` sets `is_thinking` and forces temperature to 1 (llm.py:135-142).
- `set_dynamic` toggles dynamic JSON extraction (llm.py:144-153).
- `set_page_count` computes `thinking_token_limit` and `thinking_budget` from
  `DEFAULT_PAGE_TOKENS = 1500` per page and `DEFAULT_THINKING_RATIO = 1/3`,
  clamped by `MAX_TOKEN_LIMIT`, `MAX_THINKING_BUDGET`, and `MIN_THINKING_BUDGET`
  (llm.py:155-181).
- `set_timeout` changes the request timeout (default 3000 ms); `raw_completion`
  issues a request without a response model (llm.py:298-342).
- `load_router` attaches a litellm `Router` for model fallbacks (llm.py:121-125).

## Model helpers

`global_models.py` provides convenience selectors for the commonly used models:
`get_lite_model`, `get_big_model`, `get_gemini_flash_model`, `get_gpt_mini_model`,
and `get_gpt_o4_model`.
