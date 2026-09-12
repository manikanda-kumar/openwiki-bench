---
type: concept
title: LLM Integration
description: The LLM wrapper that unifies model backends (LiteLLM+instructor and pydantic-ai), the request and raw_completion paths, response_model handling, thinking mode, token/thinking budgets, dynamic parsing prompts, routers, and timeouts.
tags: [llm, litellm, instructor, pydantic-ai, thinking-mode, token-budget]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:16:59.187Z
sources:
  - id: openwiki-source-d14c100cb1c28d349fc7a183
    resource: repo://extract_thinker/global_models.py
  - id: openwiki-source-3fa92ad82a0a3d4b723095a9
    resource: repo://extract_thinker/llm_engine.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-12T21:16:59.187Z" }
---

# LLM Integration

`LLM` (`extract_thinker/llm.py:39`) is the single abstraction for model access. It supports two backends, manages request parameters, and adds thinking/dynamic-parsing capabilities on top of structured output.

## Backends (LLMEngine)

`LLMEngine` (`extract_thinker/llm_engine.py:4`) is an enum:

- `DEFAULT = "default"` — LiteLLM + instructor for structured outputs. `LLM.__init__` builds `client = instructor.from_litellm(litellm.completion, mode=instructor.Mode.MD_JSON)` (`extract_thinker/llm.py:79-84`).
- `PYDANTIC_AI = "pydantic_ai"` — uses `pydantic_ai.Agent` with a `KnownModelName`. Requires `pydantic_ai` installed (checked lazily via `_check_pydantic_ai`).

`LLM(..., backend=LLMEngine.PYDANTIC_AI)` rejects router use (routers are only supported with DEFAULT).

## Configuration knobs

Class constants and instance state:

- `TIMEOUT = 3000` ms (overridable with `set_timeout`).
- `DEFAULT_TEMPERATURE = 0` (`set_temperature` overrides).
- Thinking defaults: `THINKING_BUDGET_TOKENS = 8000`, `DEFAULT_PAGE_TOKENS = 1500`, `DEFAULT_THINKING_RATIO = 1/3`, `MAX_TOKEN_LIMIT = 120000`, `MAX_THINKING_BUDGET = 64000`, `MIN_THINKING_BUDGET = 1200`, `DEFAULT_MAX_COMPLETION_TOKENS = 8000`.
- `set_thinking(is_thinking)` sets `temperature = 1`.
- `set_dynamic(is_dynamic)` toggles dynamic parsing.
- `set_page_count(page_count)` computes content tokens and thinking budget.
- `load_router(Router)` enables LiteLLM router fallback (DEFAULT only).

## Token and thinking budget

`set_page_count(page_count)` (`extract_thinker/llm.py:155`) validates positive page count and computes:

```python
content_tokens   = min(page_count * DEFAULT_PAGE_TOKENS, MAX_TOKEN_LIMIT)
thinking_tokens  = int(page_count * DEFAULT_PAGE_TOKENS * DEFAULT_THINKING_RATIO)
thinking_tokens  = clamp(thinking_tokens, MIN_THINKING_BUDGET, MAX_THINKING_BUDGET)
self.thinking_token_limit = content_tokens
self.thinking_budget      = thinking_tokens
```

This is how the extractor tightly budgets thinking tokens proportional to document size. Droploads when thinking is enabled cap `max_completion_tokens` at `min(thinking_token_limit, max_tokens)`.

## request path

`request(messages, response_model)` (`extract_thinker/llm.py:183`):

1. **PYDANTIC_AI**: combines messages into one prompt and runs `self.agent.run(combined_prompt, result_type=...)`; returns `result.data`.
2. **DEFAULT**: 
   - `request_model = None if self.is_dynamic else response_model`.
   - If `is_dynamic and response_model`, appends a `build_dynamic_prompt(add_classification_structure(response_model))` system message.
   - Routes to `_request_with_router` (if a router is loaded) or `_request_direct`.
   - If `is_dynamic == False`, returns the response directly; otherwise parses the raw text with `extract_thinking_json(content, response_model)`.

`_request_direct` submits `self.client.chat.completions.create(**base_params)` with `max_retries=1`, `timeout`, `temperature`, and, when thinking is enabled and `litellm.supports_reasoning(model)`, a `thinking` param `{"type":"enabled","budget_tokens":self.thinking_budget}`. `_request_with_router` mirrors this against `self.router.completion(...)`.

`_get_model_max_tokens` returns `DEFAULT_MAX_COMPLETION_TOKENS` (8000); if `token_limit` was supplied it caps `max_tokens` to `min(token_limit, max_tokens)`.

## raw_completion path

`raw_completion(messages)` (`extract_thinker/llm.py:298`) returns the raw string content:

- PYDANTIC_AI: runs `self.agent.run(..., result_type=str)`.
- DEFAULT: computes max tokens (same thinking/token-limit clamp), optionally adds thinking params, then `router.completion` or `litellm.completion`, returning `response.choices[0].message.content`.

Used by `ConcatenationHandler` and `MarkdownConverter` when raw (unstructured) text is needed.

## Dynamic parsing

`set_dynamic(True)` (`extract_thinker/llm.py:144`) enables handling of "thinking" style outputs. 

`build_dynamic_prompt(structure, *, think_tag="think")` (`extract_thinker/llm.py:14`) is a standalone helper producing a prompt that asks the model to put its reasoning in `<think>` tags followed by JSON output.

`extract_thinking_json(thinking_text, response_model)` (`extract_thinker/utils.py:479`) strips thinking/response tags, searches for JSON via several regexes (code-fenced JSON, fenced, or bare object), cleans the JSON string, `json.loads` it, and constructs `response_model(**data)`. It raises `ValueError` on malformed input.

## Timeout

`set_timeout(timeout_ms)` mutates the class-level `TIMEOUT`. The timeout is passed in request params to LiteLLM.

## Global model helpers

`global_models.py` provides convenience accessors used across tests and docs:

- `get_lite_model()` → `gemini/gemini-2.5-flash-preview-05-20`
- `get_big_model()` → `gemini/gemini-2.5-flash-preview-05-20`
- `get_gemini_flash_model()` → `gemini/gemini-2.5-flash-preview-05-20`
- `get_gpt_mini_model()` → `gpt-4.1-mini`
- `get_gpt_o4_model()` → `gpt-4o`

## Testing

- `tests/test_llm_backends.py` covers backend selection and behavior.
- `tests/test_ollama.py` covers local Ollama usage via `API_BASE`.
- `tests/test_extractor.py` (#test_thinking_mode_* , #test_llm_timeout) exercises thinking mode with Gemini Flash and gpt-4o-mini and LLM timeouts.
