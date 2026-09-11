---
type: concept
title: LLM Integration and Backends
description: How ExtractThinker wraps model access — the litellm+instructor DEFAULT backend and the pydantic-ai backend, structured request flow, dynamic parsing, thinking-mode token budgets, routers, and tuning knobs.
tags: [llm, litellm, instructor, pydantic-ai, thinking-mode]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:00:08.410Z
sources:
  - id: openwiki-source-d14c100cb1c28d349fc7a183
    resource: repo://extract_thinker/global_models.py
  - id: openwiki-source-3fa92ad82a0a3d4b723095a9
    resource: repo://extract_thinker/llm_engine.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-11T09:00:08.410Z" }
---

# LLM Integration and Backends

All model access goes through the `LLM` wrapper
(`extract_thinker/llm.py:39-...`). The wrapper is backend-agnostic: the same
`Extractor` and handlers work regardless of which backend is configured.

## Backends

`LLMEngine` (`extract_thinker/llm_engine.py:4-12`) is an enum with two members:

- `DEFAULT` (`"default"`) — uses **litellm + instructor** for provider routing
  and structured outputs. In `LLM.__init__`, this builds
  `instructor.from_litellm(litellm.completion, mode=instructor.Mode.MD_JSON)`
  as the client (`extract_thinker/llm.py:79-84`).
- `PYDANTIC_AI` (`"pydantic_ai"`) — uses the optional `pydantic-ai` package
  (`Agent`). Importing it is lazy: `_check_pydantic_ai` raises a helpful
  `ImportError` if `pydantic-ai` is not installed
  (`extract_thinker/llm.py:85-96`, `98-107`).

Any other backend value raises `ValueError`. The backend restricts features: a
LiteLLM `Router` (model fallbacks) can only be loaded with the DEFAULT backend
(`load_router`, `extract_thinker/llm.py:121-125`), and OpenAI batch processing
is rejected for PYDANTIC_AI (`extract_thinker/extractor.py:973-977`).

## Request flow

`request(messages, response_model)` (`extract_thinker/llm.py:183-236`):

- **PYDANTIC_AI**: the messages are joined into one prompt and
  `agent.run(prompt, result_type=response_model)` is executed with `asyncio.run`,
  returning `result.data` (`extract_thinker/llm.py:189-201`).
- **DEFAULT**: when `is_dynamic` is true, `request_model` is forced to `None`
  (the model is asked for free-form JSON), a structure prompt is appended to the
  messages — `add_classification_structure(response_model)` plus
  `build_dynamic_prompt(structure)` (`extract_thinker/llm.py:14-37`,
  `211-219`) — and after the call the raw content is parsed with
  `extract_thinking_json(content, response_model)` (`extract_thinker/llm.py:232-234`).
  When not dynamic, the response is returned as-is.
- The call itself goes through the router (`_request_with_router`) or directly
  (`_request_direct`). Both build the same parameter set — model, messages,
  response_model, temperature, timeout, and `max_completion_tokens` — and add a
  `thinking` parameter (`{"type": "enabled", "budget_tokens": ...}`) only when
  `is_thinking` is set and `litellm.supports_reasoning(model)` is true
  (`extract_thinker/llm.py:238-296`).

`raw_completion(messages)` (`extract_thinker/llm.py:298-342`) is the
response-model-free variant used by the concatenation strategy and
MarkdownConverter; it returns the raw content string.

## Dynamic parsing

`set_dynamic(True)` (`extract_thinker/llm.py:144-153`) switches the LLM into a
mode where responses are expected to contain a reasoning/`<think>` block followed
by JSON. The prompt is produced by `build_dynamic_prompt` which wraps
chain-of-thought in a configurable tag (default `think`)
(`extract_thinker/llm.py:14-37`). `extract_thinking_json`
(`extract_thinker/utils.py:479-540`) then strips thinking tags, tries several
JSON regex patterns (fenced JSON with/without language id, bare object), cleans
placeholders, and validates the result into the response model. It raises
`ValueError` when no JSON can be found or parsed.

## Thinking mode and token budgets

Thinking mode is enabled via `set_thinking(True)`, which also sets temperature
to 1 (`extract_thinker/llm.py:135-142`). The thinking budget is derived from the
document's page count via `set_page_count`
(`extract_thinker/llm.py:155-181`):

- `content_tokens = min(page_count * DEFAULT_PAGE_TOKENS, MAX_TOKEN_LIMIT)`
  (`DEFAULT_PAGE_TOKENS = 1500`, `MAX_TOKEN_LIMIT = 120000`);
- `thinking_tokens = int(page_count * 1500 * DEFAULT_THINKING_RATIO)`, clamped
  to `MIN_THINKING_BUDGET = 1200` and `MAX_THINKING_BUDGET = 64000`;
- the computed values become `thinking_token_limit` and `thinking_budget`.

`set_page_count` raises `ValueError` for non-positive page counts.

## Token limits, temperature, and timeout

- The default completion-token ceiling is `DEFAULT_MAX_COMPLETION_TOKENS = 8000`,
  returned by `_get_model_max_tokens` (`extract_thinker/llm.py:348-356`). It is
  capped by an explicit `token_limit` if one was passed at construction, or by
  `thinking_token_limit` when thinking is enabled
  (`extract_thinker/llm.py:240-244`, `269-273`).
- `set_temperature(t)` (`extract_thinker/llm.py:127-133`) changes the sampling
  temperature; the default is `DEFAULT_TEMPERATURE = 0`.
- `set_timeout(ms)` changes the request timeout; the default is
  `TIMEOUT = 3000` (milliseconds) (`extract_thinker/llm.py:344-346`).
- Direct requests set `max_retries = 1` in the base parameters
  (`extract_thinker/llm.py:280`).

## Model name helpers

`extract_thinker/global_models.py` centralizes default model-name strings used
by examples and tests: `get_lite_model()`, `get_big_model()`,
`get_gemini_flash_model()`, `get_gpt_mini_model()`, and `get_gpt_o4_model()`.
As of this documentation they default to Gemini 2.5 Flash preview, GPT-4.1 Mini,
and GPT-4o strings, and the same value is currently returned by
`get_lite_model`/`get_big_model`/`get_gemini_flash_model`.

## Provider integration notes

Because litellm is the transport, provider-specific model strings (OpenAI,
Anthropic, Cohere, Azure OpenAI, Ollama-compatible local models) are passed
through as the model name, and provider credentials come from the environment /
litellm configuration rather than ExtractThinker.
