---
type: concept
title: LLM Integration
description: The LLM class is the single adapter for talking to language models, supporting a litellm+instructor backend with structured outputs and a pydantic-ai backend, plus router fallbacks, thinking mode with token budgeting, dynamic prompt parsing, and raw completion.
tags: [llm, litellm, instructor, pydantic-ai, thinking, structured-output]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:16:41.841Z
sources:
  - id: openwiki-source-d14c100cb1c28d349fc7a183
    resource: repo://extract_thinker/global_models.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-aa326a6e338619f95df6a4ce
    resource: repo://tests/test_llm_backends.py
generated: { by: "opencode", at: "2026-09-11T09:16:41.841Z" }
---

# LLM Integration

Every call to a language model in ExtractThinker goes through the `LLM` class (`extract_thinker/llm.py`). It centralizes model selection, backend differences, structured-output extraction, timeouts, token limits, thinking-mode token budgeting, and optional dynamic (self-parsing) prompts.

## Backends

`LLMEngine` (`extract_thinker/llm_engine.py`) selects the adapter:

- **`LLMEngine.DEFAULT`** — wraps `instructor.from_litellm(litellm.completion, mode=instructor.Mode.MD_JSON)`. `request(messages, response_model)` passes the Pydantic `response_model` straight through, so instructor validates and retries structured JSON output automatically. This is the default and the only backend with full feature support.
- **`LLMEngine.PYDANTIC_AI`** — lazily imports `pydantic_ai`, builds an `Agent(model)`, and `request`/`raw_completion` concatenate the message contents into a single prompt and return `result.data` (with `result_type=response_model` for structured requests). `client` is `None` and `agent` is set. `load_router` is rejected with `ValueError("Router is only supported with LITELLM backend")`, and batch processing is unsupported.

## Request flow

`LLM.request(messages, response_model)`:

1. **Pydantic-AI path** — combines messages and runs the agent.
2. **Dynamic mode** — if `is_dynamic` is True and a `response_model` is given, the request model is suppressed (`request_model = None`) and a system prompt is appended that asks the model to emit `<think>` reasoning followed by JSON. The raw content is then parsed by `extract_thinking_json`.
3. Otherwise the response model is passed to the (instructor) client directly.
4. The call goes through `_request_with_router` (if a LiteLLM `Router` was loaded via `load_router`) or `_request_direct`. Both pass `temperature`, `timeout` (3000 ms default), `max_retries: 1`, and `max_completion_tokens`; direct calls go through `self.client.chat.completions.create`.

`raw_completion(messages)` returns the plain text of `choices[0].message.content` without any response model, using `litellm.completion` (or the router when one is set). The concatenation completion strategy depends on this raw path.

## Token and thinking budget

- `DEFAULT_MAX_COMPLETION_TOKENS = 8000` is the default output-token cap for ~99% of models; callers override it with the `token_limit=` constructor argument. `token_limit` wins over everything in `_get_model_max_tokens` logic.
- `set_thinking(True)` enables reasoning mode and forces `temperature = 1`.
- `set_page_count(n)` computes the content budget as `min(n * DEFAULT_PAGE_TOKENS (1500), MAX_TOKEN_LIMIT (120000))` and the thinking budget as `n * 1500 * DEFAULT_THINKING_RATIO (1/3)`, then clamps it between `MIN_THINKING_BUDGET (1200)` and `MAX_THINKING_BUDGET (64000)`.
- When `is_thinking` and `litellm.supports_reasoning(model)` are true, requests add `thinking={"type": "enabled", "budget_tokens": thinking_budget}`; otherwise a warning is printed and thinking is skipped. `MAX_TOKEN_LIMIT`/`MAX_THINKING_BUDGET` are the Claude 3.7 Sonnet-era constants.

## Dynamic prompts and self-parsing

`build_dynamic_prompt(structure, think_tag="think")` (`extract_thinker/llm.py`) generates a prompt instructing the model to produce `<think>`-tagged reasoning then JSON matching the given structure; the `think_tag` is configurable so downstream users can customize the wrapper. `extract_thinking_json(thinking_text, response_model)` (`extract_thinker/utils.py`) strips malformed `thinking`/`response` markers, extracts JSON via progressive regex patterns (json-fenced, backticked, then bare JSON), and instantiates the response model.

## Configuration surface

`LLM.TIMEOUT = 3000` (ms) is the default request timeout, adjustable via `set_timeout`. `DEFAULT_TEMPERATURE = 0` and `set_temperature` adjust sampling. `LLMEngine.DEFAULT` keeps a non-None `client` and a `None` agent; PYDANTIC_AI is the inverse.

## Model helpers

`extract_thinker/global_models.py` centralizes the model strings used across tests and examples (`get_lite_model`, `get_big_model`, `get_gemini_flash_model`, `get_gpt_mini_model`, `get_gpt_o4_model`) so callers don't hardcode providers everywhere.

## Representative tests

- `tests/test_llm_backends.py` — LiteLLM backend wiring, PydanticAI backend (skipped when `pydantic_ai` is missing), invalid backend rejection, and router rejection on PYDANTIC_AI.
- `tests/test_ollama.py` — local/OpenAI-compatible endpoints via `API_BASE`.
