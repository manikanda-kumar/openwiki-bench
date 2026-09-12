---
type: "Reference"
title: "Change Guides"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:22:48.987Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-fc161808b0aa695895bce5ee
    resource: repo://extract_thinker/completion_handler.py
  - id: openwiki-source-e9ebd8673ce94833101e27ed
    resource: repo://extract_thinker/concatenation_handler.py
  - id: openwiki-source-8c1194dbc029d262f0a9e0ec
    resource: repo://extract_thinker/document_loader/cached_document_loader.py
  - id: openwiki-source-8837984946085fdb93153fa8
    resource: repo://extract_thinker/document_loader/document_loader_pypdf.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-5d52ccd237935225a7a936dc
    resource: repo://extract_thinker/models/completion_strategy.py
  - id: openwiki-source-3ed24b37fde18a7f8973b7b4
    resource: repo://extract_thinker/pagination_handler.py
  - id: openwiki-source-dbdf465048aa8501845821eb
    resource: repo://tests/critical/test_critical_extraction.py
  - id: openwiki-source-4cb63d592f78f2cce122c033
    resource: repo://tests/test_document_loader_base.py
  - id: openwiki-source-ee28bd363b1cf645a390084a
    resource: repo://tests/test_extractor.py
generated: { by: "opencode", at: "2026-09-12T21:22:48.987Z" }
---


# Change Guides

This page gives step-by-step guidance, grounded in concrete files, for representative maintenance tasks. Each task lists the files to touch, the pattern to follow, and the narrowest verification approach.

## Adding a document loader

A document loader converts some source format into the canonical **list-of-pages** format consumed downstream. Follow the existing Tesseract or PyPDF loaders as templates.

1. **Define a config dataclass (optional but conventional).** Most loaders declare a `@dataclass` config with `__post_init__` validation, e.g. `PyPDFConfig` (`extract_thinker/document_loader/document_loader_pypdf.py:11-35`) and `TesseractConfig` (`extract_thinker/document_loader/document_loader_tesseract.py:16-84`).
2. **Subclass `CachedDocumentLoader` or `DocumentLoader`.** `CachedDocumentLoader` (`extract_thinker/document_loader/cached_document_loader.py`) adds a `cachetools.TTLCache` whose cache key includes the source content and `vision_mode`. Most loaders subclass it to get caching for free.
3. **Set `SUPPORTED_FORMATS`.** Declare the file extensions the loader can handle.
4. **Implement `can_handle` (inherited from the base) and `load`.** `can_handle` uses the base class to match file extensions or MIME types (`extract_thinker/document_loader/document_loader.py:49-83`). `load` must return a `List[Dict]` where each dict has a `"content"` string and, when `self.vision_mode` is true, an `"image"`/`"images"` entry.
5. **If the loader supports vision, implement `can_handle_vision`.** See `DocumentLoaderTesseract.can_handle_vision` (`document_loader_tesseract.py:321-323`).
6. **Export it.** Add imports and `__all__` entries in `extract_thinker/__init__.py`.

Verification: run the shared loader contract tests via `pytest tests/test_document_loader_base.py` (it defines `BaseDocumentLoaderTest` with `test_load_content_basic`, `test_vision_mode`, and `test_cache_functionality`), plus any loader-specific test file. The package is linted with flake8/`ruff` (`.flake8`, `.ruff.toml`).

## Adding a completion handler

Completion handlers post-process large or paginated content when a `CompletionStrategy` other than `FORBIDDEN` is selected.

1. **Subclass `CompletionHandler`** (`extract_thinker/completion_handler.py:5-27`) and implement `handle(content, response_model, vision=False, extra_content=None)`.
2. **Register the strategy.** The strategy is chosen via the `CompletionStrategy` enum (`extract_thinker/models/completion_strategy.py`) and dispatched in `Extractor.extract_with_strategy` (`extract_thinker/extractor.py:464-504`) and `Extractor._extract` (`extract_thinker/extractor.py:1133-1147`). Add a case there mapping the enum value to your handler.
3. **Reuse existing handlers as references.** `PaginationHandler` (`extract_thinker/pagination_handler.py`) processes pages in parallel and merges results, resolving scalar conflicts with a follow-up LLM call; `ConcatenationHandler` (`extract_thinker/concatenation_handler.py`) streams JSON continuations with a retry loop.

Verification: add a focused test that calls `extract_with_strategy` (or `extract` with your `CompletionStrategy`) against a small document, and run it with `pytest tests/test_extractor.py`.

## Modifying extraction logic

Extraction is driven by `Extractor` and the LLM. Changes usually touch `Extractor._extract`, `_build_message_content`, `_map_to_universal_format`, or the message-building helpers in `extract_thinker/extractor.py`.

1. **Understand the flow.** `extract` loads/maps content, sets page count, and calls `_extract`, which runs LLM interceptors, builds messages, appends extra content, and dispatches by completion strategy (`extract_thinker/extractor.py:193-335, 1115-1147`).
2. **Add a contract/Pydantic model for a test.** Tests define contracts inline or in `tests/models/` (e.g. `tests/models/invoice.py`) and use `tests/files/invoice.pdf`.
3. **Mind the `FORBIDDEN` contract.** Under the default strategy, an incomplete/validation failing LLM response surfaces as `ExtractThinkerError` (`extract_thinker/extractor.py:1144-1147`). If you loosen schema handling, keep the `FORBIDDEN` semantics intact or update tests accordingly.

Verification targets: `tests/critical/test_critical_extraction.py` exercises the end-to-end minimal extraction path, and `tests/test_extractor.py` covers vision, page-count handling, and completion strategies. Run them with `pytest tests/critical tests/test_extractor.py`. These tests require configured model/API credentials and environment keys (loaded via `load_dotenv()`), so they may not run in a sandbox without secrets; the assertion structure and contracts still serve as behavioral references.
