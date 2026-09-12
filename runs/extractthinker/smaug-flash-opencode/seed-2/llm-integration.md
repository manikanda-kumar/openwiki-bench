---
type: "Reference"
title: "LLM Integration"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:22:48.987Z
sources:
  - id: openwiki-source-0272fd3963ebbd7912866173
    resource: repo://extract_thinker/document_loader/llm_interceptor.py
  - id: openwiki-source-35d2ee2f69deeb57b32d69a5
    resource: repo://extract_thinker/document_loader/loader_interceptor.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-d14c100cb1c28d349fc7a183
    resource: repo://extract_thinker/global_models.py
  - id: openwiki-source-3fa92ad82a0a3d4b723095a9
    resource: repo://extract_thinker/llm_engine.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
generated: { by: "opencode", at: "2026-09-12T21:22:48.987Z" }
---


# LLM Integration

ExtractThinker wraps model access behind a single `LLM` class (`extract_thinker/llm.py`), hiding provider differences and enabling structured-output extraction, thinking/reasoning models, and routing/fallback. The `LLMEngine` enum (`extract_thinker/llm_engine.py`) selects the backend.

## Backends

`LLMEngine` (`extract_thinker/llm_engine.py`):

- `DEFAULT` — uses `instructor.from_litellm(litellm.completion, mode=instructor.Mode.MD_JSON)` to get a structured, markdown-JSON refiner over any LiteLLM-supported provider.
- `PYDANTIC_AI` — builds a `pydantic_ai.Agent` over the model name. Requires `pydantic-ai` to be installed (checked lazily on import).

`LLM(model, token_limit=None, backend=DEFAULT)` stores the model string, temperature (default 0), thinking flags, and page/token budgets. Models are provider-prefixed strings (e.g. `gemini/gemini-2.5-flash-preview-05-20`, `gpt-4o`, `ollama/phi3`), which LiteLLM understands.

## Request / raw completion

`LLM.request(messages, response_model)` (`llm.py:183-236`):

- **pydantic-ai backend**: joins message contents into a single prompt and runs `agent.run(..., result_type=response_model or str)`, returning `result.data`.
- **default backend**:
  - If `is_dynamic` is True, `request_model` is set to `None` (the response model is passed to dynamic JSON parsing later), and a `build_dynamic_prompt` system message is appended describing the expected structure.
  - Otherwise `request_model = response_model`.
  - Uses `self.router` via `_request_with_router` or `self.client.chat.completions.create` via `_request_direct`.
  - When `is_dynamic`, extracts JSON from the raw content with `extract_thinking_json` into the response model; otherwise returns the structured response directly.

`LLM.raw_completion(messages)` (`llm.py:298-342`) returns plain `content` (the first message choice) without response_model parsing, choosing router vs direct and adding a thinking parameter when supported. It is used by `ConcatenationHandler` and the MarkdownConverter.

## Dynamic prompting

`build_dynamic_prompt(structure, think_tag="think")` (`llm.py:14-37`) documents the dynamic prompt template that asks the model for a `think_tag`-wrapped reasoning block followed by a JSON output. It's a standalone function so callers can supply custom variants (e.g. changing the tag name).

## Thinking mode

`set_thinking(True)` (`llm.py:135-141`) sets `is_thinking` and forces `temperature = 1`. When a request is made with thinking enabled:

- If `litellm.supports_reasoning(self.model)` is true, a `thinking = {"type": "enabled", "budget_tokens": self.thinking_budget}` parameter is added to the request.
- Otherwise it prints a warning and proceeds without the thinking parameter.

`set_page_count(page_count)` (`llm.py:155-181`) computes a content-token estimate (`quantity_effect_page_tokens`) and a thinking budget:

- `content_tokens = min(page_count * DEFAULT_PAGE_TOKENS, MAX_TOKEN_LIMIT)`
- `thinking_tokens = page_count * DEFAULT_PAGE_TOKENS * DEFAULT_THINKING_RATIO`, clamped to `[MIN_THINKING_BUDGET, MAX_THINKING_BUDGET]`
- Results are stored in `thinking_token_limit` and `thinking_budget`.

`_get_model_max_tokens` returns `DEFAULT_MAX_COMPLETION_TOKENS` (8000). When `set_thinking` is on.gridth and `thinking_token_limit` is set, `max_tokens` is capped by it; a user-supplied `token_limit` always wins.

Constants: `TIMEOUT=3000` ms, `DEFAULT_TEMPERATURE=0`, `THINKING_BUDGET_TOKENS=8000`, `DEFAULT_PAGE_TOKENS=1500`, `DEFAULT_THINKING_RATIO=1/3`, `MAX_TOKEN_LIMIT=120000`, `MAX_THINKING_BUDGET=64000`, `MIN_THINKING_BUDGET=1200`, `DEFAULT_OUTPUT_TOKENS=32000`, `DEFAULT_MAX_COMPLETION_TOKENS=8000` (`llm.py:40-53`).

## Router fallback

`LLM.load_router(Router)` (`llm.py:121-125`) only works for the `DEFAULT` backend (raises `ValueError` otherwise). When a router is set, `_request_with_router` uses `router.completion`; otherwise `_request_direct` uses `self.client.chat.completions.create` with `max_retries: 1`.

## Extractor-level LLM wiring

- `Extractor.load_llm(model)` (`extractor.py:131-137`) accepts a model string (wrapping it in `LLM(model)`) or an existing `LLM` instance, and stores it.
- `Extractor.enable_thinking_mode(True)` and `set_page_count` forward to the LLM (`extractor.py:1430-1459`).
- `Process` propagation and `_extract` invoke `LlmInterceptor` instances before the LLM call (`extractor.py:1122-1124`).

## Interceptor seam

Two abstract interceptor types exist:

- `LoaderInterceptor` (`extract_thinker/document_loader/loader_interceptor.py`) with `process(file, content)`.
- `LlmInterceptor` (`extract_thinker/document_loader/llm_interceptor.py`) with `process(messages, response)`.

`Extractor.add_interceptor` registers them into `loader_interceptors` / `llm_interceptors` and raises `ValueError` for other types (`extractor.py:61-71`). Loader interceptors are invoked around `load` in `_extract` `extractor.py:1122-1124` before the LLM request. (Note: `LlmInterceptor.process` signature expects `(messages, response)` but the call site in `_extract` only passes `self.llm`; this is an existing inconsistency to be aware of when extending this seam.)

## Model selection helpers

`extract_thinker/global_models.py` centralizes commonly used model identifiers: `get_lite_model()`/`get_big_model()`/`get_gemini_flash_model()` → `gemini/gemini-2.5-flash-preview-05-20`, `get_gpt_mini_model()` → `gpt-4.1-mini`, `get_gpt_o4_model()` → `gpt-4o`.
