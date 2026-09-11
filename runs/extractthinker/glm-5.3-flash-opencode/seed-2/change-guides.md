---
type: guide
title: Change Guides
description: Step-by-step maintenance guides for adding a document loader, LLM backend behavior, or CompletionStrategy, with the tests each change must touch.
tags: [guide, maintenance, testing, extension, document-loaders, llm]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:45:03.808Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-67a2c4f10acd4e83de86b47f
    resource: repo://extract_thinker/document_loader/document_loader_pdfplumber.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-3fa92ad82a0a3d4b723095a9
    resource: repo://extract_thinker/llm_engine.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-5d52ccd237935225a7a936dc
    resource: repo://extract_thinker/models/completion_strategy.py
  - id: openwiki-source-3ed24b37fde18a7f8973b7b4
    resource: repo://extract_thinker/pagination_handler.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-aea937801f02b6f87071428c
    resource: repo://tests/test_batch_extractor.py
  - id: openwiki-source-ee28bd363b1cf645a390084a
    resource: repo://tests/test_extractor.py
generated: { by: "opencode", at: "2026-09-11T09:45:03.808Z" }
---

# Change Guides

Representative maintenance tasks with the files, seams, and tests each change touches. Source is authoritative; follow these patterns exactly.

## Guide 1: Add a new document loader

Real reference implementation: `DocumentLoaderPdfPlumber` (`extract_thinker/document_loader/document_loader_pdfplumber.py`).

1. **Create the module** at `extract_thinker/document_loader/document_loader_<name>.py` with a `<Name>Config` dataclass. Validate it in `__post_init__` (e.g., `cache_ttl` must be positive — `document_loader_pdfplumber.py#L11-L35`).
2. **Subclass `CachedDocumentLoader`** (which adds TTL caching over the `DocumentLoader` ABC). Declare `SUPPORTED_FORMATS` as lowercase extensions — this list drives `can_handle` through `_can_handle_file_path` (extension check) and `_can_handle_stream` (python-magic MIME check) (`extract_thinker/document_loader/document_loader.py#L49-L82`).
3. **Accept both config-style and legacy kwargs** in `__init__` (see `content_or_config` handling, `document_loader_pdfplumber.py#L41-L75`), and call `_check_dependencies()` at construction with a lazy `_get_<lib>()` accessor so missing SDKs produce a clear ImportError at instantiation rather than import time (`document_loader_pdfplumber.py#L82-L102`).
4. **Implement `load(source)`** decorated with `@cachedmethod(cache=attrgetter('cache'), key=...)` matching the existing key pattern of `hashkey(source-or-bytes, self.vision_mode)` (`document_loader_pdfplumber.py#L104-L105`). Return `List[Dict]`, one dict per page with at least `"content"`; add `"image"` when `self.vision_mode` (optionally via the base class `convert_to_images`). Wrap failures in `ValueError`.
5. **Override `set_vision_mode`** to keep the config in sync if your loader stores a vision flag in its config (`document_loader_pdfplumber.py#L77-L80`). Optionally override `can_handle_vision` and `can_handle_paginate` (paginate defaults matter for Process lazy splitting).
6. **Register the export** in `extract_thinker/__init__.py` (import + `__all__`).
7. **Tests**: create `tests/test_document_loader_<name>.py` mirroring existing loader tests (see e.g. `tests/test_document_loader_pypdf.py`, `tests/test_document_loader_base.py` for base-contract expectations).

Behavioral constraints to honor: loaders produce a page list consumed by `Extractor._map_to_universal_format`; page dicts may carry `content`, `image`/`images`, and `is_spreadsheet` special-casing (`extract_thinker/extractor.py#L337-L432`).

## Guide 2: Change LLM-layer behavior (backend, tokens, thinking)

All model I/O lives in `extract_thinker/llm.py`. Key extension points:

- **New backend**: extend the `LLMEngine` enum (`extract_thinker/llm_engine.py`), branch in `LLM.__init__` for client construction and in `LLM.request` for the call path (`extract_thinker/llm.py#L55-L97`, `L183-L236`). Note the existing pattern: `PYDANTIC_AI` joins messages into a single prompt and raises `ValueError("Failed to extract from source: ...")` on any failure.
- **Token management**: completion-limit defaults are `DEFAULT_MAX_COMPLETION_TOKENS = 8000`, overridable per-instance via `token_limit=`; `_get_model_max_tokens` is the single knob (`extract_thinker/llm.py#L50-L53`, `L348-L360`).
- **Thinking budgets**: `set_page_count` computes thinking budget as 1/3 of estimated content tokens, clamped to `[MIN_THINKING_BUDGET, MAX_THINKING_BUDGET]` (`extract_thinker/llm.py#L155-L181`).
- **Dynamic parsing**: when `is_dynamic` is set, `request` skips instructor parsing, appends the dynamic prompt from `build_dynamic_prompt`, and routes raw output through `extract_thinking_json` (`extract_thinker/llm.py#L183-L236`, `extract_thinker/utils.py#L479`).
- **Router fallbacks**: `load_router` accepts a litellm `Router` only on the DEFAULT backend and routes through `_request_with_router` (`extract_thinker/llm.py#L121-L125`).

Tests: `tests/test_llm_backends.py` covers backend selection; extraction-level backend behavior (`default` vs `pydanticai`) is exercised in `tests/test_extractor.py#L342-L381`.

## Guide 3: Add a new CompletionStrategy

Reference: how PAGINATE and CONCATENATE were wired.

1. **Add the enum member** in `extract_thinker/models/completion_strategy.py` (`extract_thinker/models/completion_strategy.py#L1-L6`).
2. **Implement a handler** subclassing `CompletionHandler` (ABC holding the `llm`), like `PaginationHandler` (`extract_thinker/pagination_handler.py`) or `ConcatenationHandler` (`extract_thinker/concatenation_handler.py`). Both expose `handle(content, response_model, vision, extra_content)`.
3. **Wire the dispatch points** — there are two:
   - `Extractor._extract` dispatches by strategy after message building (`extract_thinker/extractor.py#L1132-L1147`);
   - `Extractor.extract_with_strategy` dispatches early, per loaded content, before the universal-format path (`extract_thinker/extractor.py#L464-L504`).
   Both raise `ValueError("Unsupported completion strategy")` for unknown values — a new strategy must be added in both places or it will be unreachable from one path.
4. **Pydantic-model note**: paginate-style strategies mutate the contract via `make_all_fields_optional` (`extract_thinker/utils.py#L247`) to allow partial per-page results, then merge.
5. **Tests**: strategy behavior is verified in `tests/test_extractor.py` (`test_pagination_handler`, `test_pagination_handler_optional`, `test_concatenation_handler`, `test_forbidden_strategy_with_token_limit`, `tests/test_extractor.py#L143-L318`).

## Cross-cutting testing caveats

- Many repository tests are live integration tests: they require provider API keys (e.g., `OPENAI_API_KEY`, `TESSERACT_PATH`) loaded via dotenv and will exercise real cloud APIs (`tests/test_batch_extractor.py#L10-L25`, `tests/test_extractor.py#L43-L60`).
- Loader tests generally guard optional dependencies; tests skip or fail fast when OCR/cloud SDKs are absent — check the import/check pattern in each test before assuming CI coverage.

Related: [Document Loaders](/openwiki/document-loaders.md) · [Extractor and Extraction Flow](/openwiki/extractor-and-extraction-flow.md) · [Completion Strategies](/openwiki/completion-strategies.md) · [LLM Layer](/openwiki/llm-layer.md)
