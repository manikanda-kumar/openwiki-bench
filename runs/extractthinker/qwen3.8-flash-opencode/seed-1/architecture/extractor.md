---
type: subsystem
title: "Extractor Core"
description: "The Extractor class internals: two loader-resolution strategies, dependency validation, state-on-instance request parameters, error taxonomy, dead seams, and the batch/thinking entrypoints."
tags: [extractor, core, validation, interceptors, error-handling]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T10:24:25.212Z
sources:
  - id: openwiki-source-0272fd3963ebbd7912866173
    resource: repo://extract_thinker/document_loader/llm_interceptor.py
  - id: openwiki-source-35d2ee2f69deeb57b32d69a5
    resource: repo://extract_thinker/document_loader/loader_interceptor.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-ee28bd363b1cf645a390084a
    resource: repo://tests/test_extractor.py
generated: { by: "opencode", at: "2026-09-11T10:24:25.212Z" }
---

# Extractor Core

`Extractor` (`extract_thinker/extractor.py`, ~1460 lines) is the orchestrator between loaders and the `LLM`. The end-to-end data flow is summarized in [Architecture Overview](/openwiki/architecture.md); this page covers its internal contracts and traps.

## Construction and configuration

`Extractor(document_loader=None, llm=None)` accepts both constructor injection and the chainable-ish setters `load_document_loader(loader)` and `load_llm(model_or_llm)` — `load_llm` branches on `isinstance(model, LLM)` (despite the `Optional[str]` annotation), so passing an `LLM` instance replaces the client. There is no global validation at construction time; every check is deferred to the call site.

`extract()` records caller parameters **on the instance** (`self.extra_content`, `self.completion_strategy`, `self.allow_vision`), and `classify()` mutates `self.is_classify_image` plus the resolved loader's vision mode. A single `Extractor` shared across concurrent calls therefore carries cross-call state; `Process` mitigates this by instantiating per-classification extractors and toggling `set_skip_loading()` around its `finally` block.

## Loader resolution: two strategies, one source of confusion

- `get_document_loader(source)` (used by extraction paths) is capability-first: primary loader if `can_handle`, then extension map, then any registered loader, then `DocumentLoaderData` for list/dict sources, then `DocumentLoaderLLMImage` if `allow_vision`, else `None` (callers raise "No suitable document loader found").
- `get_document_loader_for_file(source)` (used by `classify`) is extension-first on string paths, then capability checks, and raises instead of returning `None`.

`extract()` additionally has a side-effecting quirk: a `dict` source with no configured loader assigns `self.document_loader = DocumentLoaderData()` before validation.

## Validation and error taxonomy

`_validate_dependencies` enforces: loader required unless `vision`, LLM always, and `response_model` a `BaseModel`/`Contract` subclass. Everything else is failure-wrapping in `extract()`:

- instructor `IncompleteOutputException` (direct or in `e.args[0]`) → `ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")`;
- `ValidationError`/`JSONDecodeError` — type-checked **or matched by substring in `str(e)`** (`"ValidationError"`, `"JSONDecodeError"`, `"json_invalid"`) → same "incomplete output" error;
- `vision & is_vision_error(e)` (litellm `BadRequestError` in `args[0]`) → `classify_vision_error` raises `VisionError` telling you to check model vision support; note the bitwise `&` between bools works but is unusual;
- anything else → `ExtractThinkerError(f"Failed to extract from source: ...")`.

`is_vision_error`/`classify_vision_error` index `e.args[0]` unguarded, so an argument-less exception raises `IndexError` inside the handler path.

## classify()

`classify(input, classifications, vision)` resolves a loader via `get_document_loader_for_file`, loads content, and calls `_classify`:

- Text mode (`is_classify_image` False): one prompt enumerating names/descriptions plus `add_classification_structure(contract)` output, parsed into `ClassificationResponseInternal`, name matched back case-insensitively. The prompt explicitly tells the model to boost confidence when contract fields are present and not to use contract structure for classification.
- Vision mode: the document image is compared **one classification at a time** — against the reference image when provided (`_classify_one_image_with_ref`) or a minimal no-reference prompt — and the highest-confidence response wins; an all-fail fallback returns `name="Unknown", confidence=1`. `_classify` uses only the first image found on multi-page content.

`classify_async`/`extract_async` are `asyncio.to_thread` wrappers around the sync methods; `Process` adds its own `run_in_executor` layer on top.

## Batch and thinking entrypoints

`extract_batch` gates on `BATCH_SUPPORTED_MODELS` substring matching and rejects the `PYDANTIC_AI` backend, then writes JSONL under `./extract_thinker_batch/` and returns a `BatchJob` — details in [Batch Processing](/openwiki/architecture/batch-processing.md). `enable_thinking_mode()` requires a set LLM and delegates to `LLM.set_thinking` (which also pins temperature to 1); `set_page_count()` forwards to `LLM.set_page_count` for the thinking budget — see [LLM Integration](/openwiki/architecture/llm-integration.md).

## Interceptor seams and dead code

`add_interceptor(obj)` routes `LoaderInterceptor` and `LlmInterceptor` instances into two lists and rejects anything else. The integration is asymmetric in ways to know before extending:

- `_extract` invokes `interceptor.intercept(self.llm)` for LLM interceptors, but the `LlmInterceptor` ABC declares an abstract `process(self, messages, response)` — no `intercept` method exists in the ABC, so conforming subclasses would fail with `AttributeError` at extraction time.
- `loader_interceptors` is populated but never read anywhere in the package.

Similarly unused by the live pipeline: `_extract_with_splitting` (thread-pooled chunked extraction with `split_content`/`aggregate_results` — the only definitions of per-chunk scalar-conflict "keep first value" merging) and `_build_classification_message_content` (multi-image classification prompt). `loadfile`/`loadstream` are vestigial one-liners storing `self.file`. Treat all as non-functional seams.

## Focused tests

`tests/test_extractor.py` pins observable behavior against live models: `test_extract_with_invalid_file_path` expects `ExtractThinkerError`, `test_forbidden_strategy_with_token_limit` matches the exact "Incomplete output received and FORBIDDEN strategy is set" message, and pagination/concatenation, backend, URL, and spreadsheet scenarios exercise the routing described above.
