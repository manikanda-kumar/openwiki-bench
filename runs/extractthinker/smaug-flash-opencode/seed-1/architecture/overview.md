---
type: architecture
title: Architecture Overview
description: The modular architecture of ExtractThinker — ownership boundaries among Extractor, Process, DocumentLoader, LLM, Splitter, and Evaluation, plus the core data and control flow from document loading to validated Contract output.
tags: [architecture, extractor, document-loader, llm, process, control-flow]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:16:59.187Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-fc161808b0aa695895bce5ee
    resource: repo://extract_thinker/completion_handler.py
  - id: openwiki-source-8c1194dbc029d262f0a9e0ec
    resource: repo://extract_thinker/document_loader/cached_document_loader.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-80ac776afff46dd86a9f455f
    resource: repo://extract_thinker/exceptions.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-5d52ccd237935225a7a936dc
    resource: repo://extract_thinker/models/completion_strategy.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-12T21:16:59.187Z" }
---

# Architecture Overview

ExtractThinker is a document-intelligence library ("an ORM for documents") that turns structured documents (PDFs, images, spreadsheets, Word, HTML, URLs) into validated Pydantic objects. The architecture is deliberately modular and LangChain-inspired: small components with narrow responsibilities that are composed in an `Extractor` or a `Process` pipeline.

## Public surface and packaging

The package's public API is centralized in `extract_thinker/__init__.py`, which re-exports the primary building blocks:

- `Extractor` — single-document (or list-of-sources) extraction.
- `Process` — the chained load / split / classify / extract workflow.
- `DocumentLoader` and all concrete loader classes (`DocumentLoaderPyPdf`, `DocumentLoaderTesseract`, `DocumentLoaderSpreadSheet`, `DocumentLoaderAzureForm`, `DocumentLoaderAWSTextract`, `DocumentLoaderGoogleDocumentAI`, `DocumentLoaderDocling`, `DocumentLoaderBeautifulSoup`, `DocumentLoaderMarkItDown`, `DocumentLoaderLLMImage`, `DocumentLoaderMistralOCR`, `DocumentLoaderEasyOCR`, `DocumentLoaderData`, `DocumentLoaderTxt`, `DocumentLoaderDoc2txt`, `DocumentLoaderPdfPlumber`).
- `LLM` — the LLM wrapper unifying LiteLLM/instructor and pydantic-ai.
- `Splitter`, `ImageSplitter`, `TextSplitter` — document segmentation.
- `Classification`, `ClassificationResponse`, `ClassificationStrategy` — document classification.
- `Contract`, `CompletionStrategy`, `SplittingStrategy` — schema typing and strategy enums.
- `MarkdownConverter`, `BatchJob` — markdown conversion and OpenAI batch lifecycle.

Importing the package also calls `filter_pydantic_v2_warnings()` (`extract_thinker/__init__.py:38`) to silence Pydantic v2 config-key warnings.

## Ownership boundaries

| Component | Responsibility | Key module |
|---|---|---|
| `DocumentLoader` | Read a source (path, stream, or URL) and normalize it to a standard list-of-pages dict format. Handles caching and vision mode | `extract_thinker/document_loader/document_loader.py` |
| `Extractor` | Orchestrate one extraction: pick a loader by source, load content, map to a universal format, build prompts, invoke the LLM, and produce a validated `Contract` instance | `extract_thinker/extractor.py` |
| `LLM` | Abstract model access: LiteLLM+instructor (structured output) or pydantic-ai; manage request params, thinking mode, token budgets, timeouts, routers, dynamic parsing | `extract_thinker/llm.py` |
| `Splitter` / `ImageSplitter` / `TextSplitter` | Decide which pages of a document belong together (into a `DocGroup`) and under which classification, using an LLM | `extract_thinker/splitter.py`, `extract_thinker/image_splitter.py`, `extract_thinker/text_splitter.py` |
| `Process` | Chain `load_file -> split -> extract`, and orchestrate multi-extractor classification (consensus/higher-order/tree) | `extract_thinker/process.py` |
| Completion handlers | Handle large/incomplete LLM outputs (`COMPLETION` strategies: paginate vs concatenate) | `extract_thinker/pagination_handler.py`, `extract_thinker/concatenation_handler.py` |
| `eval` package | Measure extraction quality: field/document/schema/time metrics, hallucination detection, cost tracking, teacher–student comparison | `extract_thinker/eval/*` |

## End-to-end control and data flow

### 1. Source resolution

`Extractor.get_document_loader(source)` (`extract_thinker/extractor.py:92`) selects a loader in priority order:

1. A primary `self.document_loader` if `can_handle(source)` is true.
2. Extension-based lookup in `document_loaders_by_file_type`.
3. Iterate all registered loaders, returning the first that `can_handle(source)`.
4. If source is a list or dict (e.g., pre-split page data), return a `DocumentLoaderData()`.
5. If `allow_vision` is set, fall back to `DocumentLoaderLLMImage()`.

`Extractor.get_document_loader_for_file` (`extract_thinker/extractor.py:73`) is the variant used by classification.

### 2. Loading to the universal page format

Each concrete loader implements `load()`. Loaders extend a shared contract (`extract_thinker/document_loader/document_loader.py:16`) that standardizes output as **a list of page dictionaries**, each typically holding:

- `content` — extracted text (may be empty in pure vision loaders like `DocumentLoaderLLMImage`)
- `image` — page-rendered image bytes (present when `vision_mode` is enabled)
- optional enrichment: `tables`, `forms`, `signatures`, `formulas`, `barcodes`, `languages` (varies per loader/provider)

`CachedDocumentLoader` (`extract_thinker/document_loader/cached_document_loader.py:7`) keys its `TTLCache` by `(source, vision_mode)`.

### 3. Mapping to a universal format

`Extractor._map_to_universal_format` (`extract_thinker/extractor.py:337`) normalizes loader output into:

```python
{
    "content": str,       # joined text
    "images": List[bytes],# optional list of page images
    "metadata": {...}     # e.g. num_pages
}
```

It accepts page lists, raw strings, legacy dicts, or already-universal dicts Normalizing all loader types means `_extract` only ever sees one shape.

### 4. Extraction and LLM invocation

`Extractor._extract` (`extract_thinker/extractor.py:1115`):

- Runs any registered `llm_interceptors` against the LLM.
- Builds messages via `_build_message_content(content, vision)` and `_build_messages(...)`.
- Prepends `extra_content` if supplied.
- Dispatches on `completion_strategy`:
  - `FORBIDDEN` → a single `self.llm.request(messages, response_model)`.
  - `PAGINATE` → `PaginationHandler.handle(...)`.
  - `CONCATENATE` → `ConcatenationHandler.handle(...)`.

`LLM.request` (`extract_thinker/llm.py:183`) sends the messages and returns a validated Pydantic `response_model`. In the default backend it uses an `instructor.from_litellm(litellm.completion, mode=instructor.Mode.MD_JSON)` client; in `PYDANTIC_AI` backend it runs a `pydantic_ai.Agent`.

### 5. Vision mode

When `vision=True`, `Extractor.extract` first calls `_handle_vision_mode(source)`, which configures the loader for vision (`set_vision_mode(True)`) and can raise `InvalidVisionDocumentLoaderError` (`extract_thinker/exceptions.py:9`) if the loader does not support vision. In vision mode `_build_message_content` appends base64 `image_url` blocks alongside the text content; otherwise content is passed as text. If the model does not actually support vision, `is_vision_error` / `classify_vision_error` (`extract_thinker/utils.py:542`) re-raise a `VisionError` with a clarifying message.

### 6. Multiple sources

When `source` is a list, `Extractor.extract` loads and maps each item, counts total pages (calling `llm.set_page_count`), then joins the text with a `"\n\n--- Document Separator ---\n\n"` marker and merges all images, producing one combined extraction (`extract_thinker/extractor.py:232`).

## Process pipeline flow

`Process` (`extract_thinker/process.py`) owns the multi-step workflow:

1. Configure a document loader (default, or keyed by file type); configure a splitter; register classification extractor groups.
2. `load_file(path)` binds a file path (or a stream).
3. `split(classifications, strategy)` loads pages, then:
   - `EAGER` → `splitter.split_eager_doc_group(pages, classifications)`.
   - `LAZY` → requires `document_loader.can_handle_paginate(...)` (PDF only), then `split_lazy_doc_group`.
4. `extract(vision, completion_strategy)` iterates `doc_groups`, matches each group's `classification` to the corresponding `extractor` (and its `extraction_contract` if set), reloads the page subset, sets `extractor._skip_loading`, and calls `extractor.extract_async(...)` per group via `asyncio.gather`.

The `Process` also has its own multi-extractor classification flow (`classify_async` / `_classify_tree_async`), which applies `ClassificationStrategy` (consensus / higher-order / consensus-with-threshold) or walks a `ClassificationTree` level by level.

## Async model

`Extractor.extract_async` (`extract_thinker/extractor.py:434`) wraps the synchronous `extract` in `asyncio.to_thread`, so the blocking loader/LLM calls run off the event loop. `Process.classify` uses `asyncio.run(self.classify_async(...))`; `Process.extract` uses a fresh `asyncio.get_event_loop().run_until_complete(...)`. Completion handlers (Pagination) use `ThreadPoolExecutor` to process pages in parallel.

## Extension seams

- **Interceptors**: `Extractor.add_interceptor` accepts `LoaderInterceptor` or `LlmInterceptor` instances (`extract_thinker/extractor.py:61`). Loader interceptors receive `(file, content)`; LLM interceptors receive `(messages, response)`. Registered LLM interceptors run before every LLM request in `_extract`.
- **Document loaders**: implementing `DocumentLoader` (`can_handle`, `load`) + one of the concrete patterns lets a new source format join the pipeline. `CachedDocumentLoader` adds caching by subclassing.
- **LLM backends**: `LLMEngine.DEFAULT` (LiteLLM+instructor) and `LLMEngine.PYDANTIC_AI`; a `litellm.Router` can be loaded for model fallback.
- **Completion handlers**: `ConcatenationHandler` and `PaginationHandler` both subclass `CompletionHandler` (`extract_thinker/completion_handler.py`), which is the seam for new `CompletionStrategy` values.
- **Splitters**: `Splitter` defines `belongs_to_same_document`, `split_lazy_doc_group`, `split_eager_doc_group`; `ImageSplitter`/`TextSplitter` implement LLM-based page-boundary detection.

## Failure handling

`Extractor.extract` wraps errors into the library's exception hierarchy:

- Incomplete output / validation/JSON errors under `FORBIDDEN` strategy are raised as `ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")` (`extract_thinker/extractor.py:320`).
- Vision-specific `litellm.BadRequestError` is re-raised as `VisionError` (`extract_thinker/utils.py:547`).
- Loader failures are wrapped: e.g. `DocumentLoaderPyPdf.load` raises `ValueError(f"Error loading PDF: ...")`.
