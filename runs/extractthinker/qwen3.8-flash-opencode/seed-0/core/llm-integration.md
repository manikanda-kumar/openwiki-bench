---
type: core-concept
title: LLM Integration
description: The LLM wrapper over litellm+instructor and pydantic-ai — request construction, router support, thinking budgets, token math, dynamic parsing, raw completions, and provider model helpers.
tags: [llm, litellm, instructor, thinking, router, backend]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:51:57.297Z
sources:
  - id: openwiki-source-d14c100cb1c28d349fc7a183
    resource: repo://extract_thinker/global_models.py
  - id: openwiki-source-3fa92ad82a0a3d4b723095a9
    resource: repo://extract_thinker/llm_engine.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-ee28bd363b1cf645a390084a
    resource: repo://tests/test_extractor.py
  - id: openwiki-source-aa326a6e338619f95df6a4ce
    resource: repo://tests/test_llm_backends.py
generated: { by: "opencode", at: "2026-09-11T09:51:57.297Z" }
---

# LLM Integration

`extract_thinker/llm.py` defines the `LLM` class — the single choke point through which every model call in the library flows (directly from `Extractor`, or via completion handlers and splitters, which construct their own `LLM`).

## Backends

`LLMEngine` (llm_engine.py:1-11) enumerates two backends:

- **`LLMEngine.DEFAULT`**: builds `instructor.from_litellm(litellm.completion, mode=instructor.Mode.MD_JSON)` as `self.client`, so Pydantic validation happens inside instructor (llm.py:79-83).
- **`LLMEngine.PYDANTIC_AI`**: lazily imports `pydantic_ai` (raising `ImportError` with a `pip install pydantic-ai` hint) and constructs `Agent(model)`; `self.client` stays `None` (llm.py:85-96, 98-119). Any other value raises `ValueError("Unsupported backend: ...")` (llm.py:96).

`load_router(Router)` attaches a `litellm.Router` for model fallbacks but refuses when the backend is not `DEFAULT` (llm.py:121-125).

## Request construction (`request`)

`LLM.request(messages, response_model=None)` (llm.py:183-236):

- **PYDANTIC_AI**: concatenates all message contents into one prompt and runs `asyncio.run(self.agent.run(prompt, result_type=response_model or str))`, returning `result.data`; any exception becomes `ValueError("Failed to extract from source: ...")` (llm.py:188-201).
- **DEFAULT, non-dynamic**: the Pydantic `response_model` is passed straight through to the instructor-wrapped call.
- **DEFAULT, dynamic** (`set_dynamic(True)`, llm.py:144-153): `response_model` is *not* sent to the model; instead the field structure from `add_classification_structure(response_model)` is rendered into `build_dynamic_prompt(structure)` (llm.py:14-37) — a system message asking the model to write its chain-of-thought inside "think" XML tags followed by a `##JSON OUTPUT` block. The raw text is then parsed by `extract_thinking_json`, which strips thinking tags, tries three JSON regex patterns (fenced-with-language, bare fenced, brace-balanced object), and instantiates the model (llm.py:209-236, utils.py:479-540).

The actual send is `_request_with_router` or `_request_direct` depending on `self.router` (llm.py:221-225). Note the asymmetry: the direct path uses the instructor client (`self.client.chat.completions.create`, returning a validated model instance, with `max_retries=1`), while the router path calls `Router.completion(**params)` directly — instructor is bypassed and `response_model` is forwarded as a litellm kwarg (llm.py:238-265, 267-296).

## Token limits and thinking budget

Constants at class level (llm.py:40-53): `TIMEOUT = 3000` ms (mutable via `set_timeout`, llm.py:344-346), `DEFAULT_TEMPERATURE = 0`, `THINKING_BUDGET_TOKENS = 8000`, `DEFAULT_PAGE_TOKENS = 1500`, `DEFAULT_THINKING_RATIO = 1/3`, `MAX_TOKEN_LIMIT = 120000`, `MAX_THINKING_BUDGET = 64000`, `MIN_THINKING_BUDGET = 1200`, `DEFAULT_MAX_COMPLETION_TOKENS = 8000`. `DEFAULT_OUTPUT_TOKENS = 32000` is defined but never read.

`_get_model_max_tokens()` always returns `DEFAULT_MAX_COMPLETION_TOKENS` (8000) — deliberately a single conservative completion-token cap accepted by most models; override with the constructor `token_limit=`, which is applied as `min(token_limit, model_max)` in all three request paths (llm.py:55-60, 238-244, 267-273, 314-318, 348-355).

`set_thinking(True)` (llm.py:135-142) forces `temperature = 1` (a reasoning-model requirement) and enables the `thinking: {type: enabled, budget_tokens}` parameter — but only when `litellm.supports_reasoning(model)` reports support; otherwise the call prints a warning and proceeds without it (llm.py:254-264, 285-294).

`set_page_count(n)` (llm.py:155-181) requires `n > 0` and recomputes: `content_tokens = min(n * 1500, 120000)` stored as `thinking_token_limit`, and `thinking_budget = clamp(int(n * 1500 / 3), 1200, 64000)`. When thinking is active and no explicit `token_limit` was given, `max_completion_tokens` is capped at `thinking_token_limit`. The Extractor invokes this from `metadata["num_pages"]` on every extraction (extractor.py:303-314).

## Raw completions

`raw_completion(messages)` (llm.py:298-342) is the unvalidated string path used by `ConcatenationHandler`: PYDANTIC_AI runs the agent with `result_type=str`; otherwise it sends model/messages/max_completion_tokens (thinking parameter honored the same way) via router or `litellm.completion` — notably without temperature or timeout — and returns `choices[0].message.content`.

## Model presets

`extract_thinker/global_models.py` centralizes model strings used by tests and examples: `get_lite_model()`, `get_big_model()`, and `get_gemini_flash_model()` all currently return `gemini/gemini-2.5-flash-preview-05-20`; `get_gpt_mini_model()` returns `gpt-4.1-mini`; `get_gpt_o4_model()` returns `gpt-4o` (global_models.py:1-20). Provider routing relies on litellm naming conventions (e.g. `groq/llama-3.3-70b-versatile` in the CI critical tests, tests/critical/test_critical_extraction.py:45).

## Test drift to be aware of

`tests/test_llm_backends.py` references `llm_engine.LITELLM`, a member that no longer exists (the enum now defines `DEFAULT`), and `test_invalid_backend` expects `TypeError` while the constructor raises `ValueError` — these tests fail against the current source and predate the rename (llm_engine.py:8-11, tests/test_llm_backends.py:6, 22-25). Working coverage of backends lives in `tests/test_extractor.py:342-380` (`LLMEngine.DEFAULT` extraction, PYDANTIC_AI extraction, and `load_router` rejection), and thinking mode is exercised by `test_thinking_mode_gemini_flash`/`test_thinking_mode_gpt_mini` (tests/test_extractor.py:475-510).

## Configuration and security consequences

- Model names and routing decide which provider SDK/env credentials litellm needs; the library itself only reads credentials for batch (`OPENAI_API_KEY`) and the Tesseract binary path (extractor/batch_job.py:19, document_loader_tesseract.py:139). API keys for models are resolved by litellm per provider.
- `build_dynamic_prompt` and the `think_tag` parameter are the exposed seam for customizing the dynamic-output prompt without editing `llm.py` (llm.py:9-37).

## Related pages

- `core/completion-strategies.md` — request vs raw_completion consumers
- `core/extractor.md` — where page count and vision flags are set
- `guides/change-playbooks.md` — adding a backend
