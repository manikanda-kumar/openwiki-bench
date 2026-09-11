---
type: component
title: "LLM Layer and Backends"
description: "The LLM class and LLMEngine backends: litellm+instructor DEFAULT requests, pydantic-ai agent backend, routers, thinking-mode token budgets, dynamic think-tag JSON parsing, raw completions, and the constants that shape every model call."
tags: [llm, litellm, instructor, pydantic-ai, thinking, router]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T11:01:32.247Z
sources:
  - id: openwiki-source-e9ebd8673ce94833101e27ed
    resource: repo://extract_thinker/concatenation_handler.py
  - id: openwiki-source-0272fd3963ebbd7912866173
    resource: repo://extract_thinker/document_loader/llm_interceptor.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
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
  - id: openwiki-source-7a642dbc4c0ac0458f24b380
    resource: repo://tests/test_ollama.py
generated: { by: "opencode", at: "2026-09-11T11:01:32.247Z" }
---

# LLM Layer and Backends

`LLM` (`extract_thinker/llm.py`) is the only component that talks to models. Everything upstream — `Extractor`, splitters, completion handlers, `DocumentLoaderLLMImage` consumers — passes it a `messages` list and an optional response model; it returns validated objects or plain text.

## Backends

`LLMEngine` (`extract_thinker/llm_engine.py`) selects between:

- **`DEFAULT`** — wraps `litellm.completion` with `instructor.from_litellm(..., mode=instructor.Mode.MD_JSON)` so responses are parsed into Pydantic models by instructor (`llm.py:79-84`). Works with any provider name litellm understands, including local models such as `ollama/phi4` with `API_BASE` pointed at Ollama (`tests/test_ollama.py:63-80`, `README.md:249-251`).
- **`PYDANTIC_AI`** — constructs a `pydantic_ai.Agent(model)`; the optional `pydantic-ai` package is verified eagerly with an `ImportError` install hint (`llm.py:85-96`, `98-107`). Requests collapse all messages into one space-joined prompt and run `asyncio.run(agent.run(prompt, result_type=response_model or str))`, returning `result.data`; failures are wrapped in `ValueError("Failed to extract from source: ...")` (`llm.py:188-201`).
- Any other value raises `ValueError(f"Unsupported backend: ...")` (`llm.py:96`).

Batch processing (`Extractor.extract_batch` → `BatchJob`) explicitly refuses the `PYDANTIC_AI` backend because it bypasses the litellm/instructor plumbing (`extractor.py:972-977`).

## Request shaping (DEFAULT backend)

`request(messages, response_model)` (`llm.py:183-236`) decides three things:

1. **Structured vs raw.** Normally `response_model` is forwarded to instructor. When `is_dynamic` is true (see below) the model is called without a response model and its text is parsed afterwards.
2. **Router vs direct.** `load_router(router)` accepts a litellm `Router` (provider fallbacks/rate limits); when set, `_request_with_router` calls `router.completion(...)`, otherwise `_request_direct` calls the instructor-wrapped client with `max_retries=1` (`llm.py:121-125,222-225,238-296`). Routers are rejected for `PYDANTIC_AI` with `ValueError("Router is only supported with LITELLM backend")` — asserted by `tests/test_llm_backends.py:28-35`.
3. **Token ceiling.** `max_completion_tokens` starts at `DEFAULT_MAX_COMPLETION_TOKENS = 8000` (`llm.py:348-355`), is capped by the constructor's `token_limit`, or by `thinking_token_limit` when thinking mode is active (`llm.py:238-244,267-273`).

Common parameters: `temperature` (default 0, settable via `set_temperature`) and `timeout` in **milliseconds** (`TIMEOUT = 3000`, adjustable with `set_timeout`, `llm.py:40,127-143,344-346`).

## Thinking mode and budgets

`set_thinking(True)` enables extended-reasoning requests and forces `temperature = 1` (`llm.py:135-142`). For models where `litellm.supports_reasoning(model)` is true, the request gains `thinking={"type": "enabled", "budget_tokens": thinking_budget}`; otherwise a warning is printed and the call proceeds unmodified (`llm.py:254-263,285-294`).

Budgets are recomputed by `set_page_count(page_count)` — called by the extraction pipeline with the document's page count — using the class constants at `llm.py:42-48`:

- `thinking_token_limit = min(page_count × 1500, 120000)` (content-token cap, `DEFAULT_PAGE_TOKENS`/`MAX_TOKEN_LIMIT`),
- `thinking_budget = clamp(page_count × 1500 / 3, 1200, 64000)` (`DEFAULT_THINKING_RATIO` against `MIN_THINKING_BUDGET`/`MAX_THINKING_BUDGET`),
- non-positive counts raise `ValueError` (`llm.py:155-181`).

`Extractor.enable_thinking_mode()` and `Extractor.set_page_count()` are chainable passthroughs; `tests/test_extractor.py:475-510` exercises thinking mode with Gemini Flash and GPT-mini model strings.

## Dynamic think-tag parsing

`set_dynamic(True)` switches `LLM` to a manual structured-output path designed for models (notably local reasoning models) that emit prose before JSON (`llm.py:144-153`):

- On request, a second system message is appended, built by `build_dynamic_prompt(add_classification_structure(response_model))`: the model must put chain-of-thought inside `<think>...</think>` and then emit `##JSON OUTPUT` (`llm.py:14-37,211-219`).
- The raw completion text is post-processed with `utils.extract_thinking_json`, which strips think tags and tries, in order, fenced ```json blocks, fenced blocks without a language, a balanced bare JSON object, or a whole-string `{...}` before `json.loads` + model construction; failures raise `ValueError` with the offending text excerpt (`utils.py:479-540`).
- `tests/test_ollama.py:167-196` demonstrates the combination with `ollama/deepseek-r1:1.5b`, asserting a full `InvoiceContract` comes back.

`build_dynamic_prompt` takes a `think_tag` argument so callers can change the tag without editing `llm.py` (`llm.py:14-37`).

## Raw completions

`raw_completion(messages)` bypasses instructor entirely — same token/timeout/thinking shaping, but returns `choices[0].message.content` as a string (for `PYDANTIC_AI` it runs the agent with `result_type=str`) (`llm.py:298-342`). This is the transport used by `ConcatenationHandler`, which does its own JSON assembly and validation.

## Interception point

`Extractor._extract` invokes each registered `LlmInterceptor` with `interceptor.intercept(self.llm)` before every request (`extractor.py:1122-1124`); the ABC in `document_loader/llm_interceptor.py` declares `process(...)`, so implementers must match the call site (see extraction-flow wiring caveats).

## Model-name conventions

`global_models.py` centralizes the model strings the test-suite prefers (Gemini 2.5 Flash preview as both "lite" and "big", `gpt-4.1-mini`, `gpt-4o`) — the only in-repo registry of recommended models; provider support itself is delegated to litellm.

## Caveats in the backend tests

`tests/test_llm_backends.py` is partially stale relative to current source: it imports `llm_engine.LITELLM`/`llm_engine.PYDANTIC_AI` as module attributes (the module only defines the `LLMEngine` enum with `DEFAULT`/`PYDANTIC_AI`) and expects `TypeError` for a string backend where the constructor raises `ValueError` (`tests/test_llm_backends.py:1-35` vs `llm_engine.py:3-11`, `llm.py:96`). Verify against source rather than treating that file as the contract.
