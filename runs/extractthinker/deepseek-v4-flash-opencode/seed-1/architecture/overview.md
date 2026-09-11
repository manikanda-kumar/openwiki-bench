---
type: concept
title: Architecture Overview
description: How ExtractThinker is organized as a layered document-intelligence library, the ownership boundaries between its public API, models, document loaders, LLM adapter, orchestration classes, and evaluation package, and the shared page-based data flow.
tags: [architecture, overview, module-map, data-flow]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:16:41.841Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-fc161808b0aa695895bce5ee
    resource: repo://extract_thinker/completion_handler.py
  - id: openwiki-source-e9ebd8673ce94833101e27ed
    resource: repo://extract_thinker/concatenation_handler.py
  - id: openwiki-source-8c1194dbc029d262f0a9e0ec
    resource: repo://extract_thinker/document_loader/cached_document_loader.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-80ac776afff46dd86a9f455f
    resource: repo://extract_thinker/exceptions.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-3fa92ad82a0a3d4b723095a9
    resource: repo://extract_thinker/llm_engine.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-9b040ddd08f40366f527dfa0
    resource: repo://extract_thinker/models/classification.py
  - id: openwiki-source-92ee41b85171e4663a071a13
    resource: repo://extract_thinker/models/contract.py
  - id: openwiki-source-3ed24b37fde18a7f8973b7b4
    resource: repo://extract_thinker/pagination_handler.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-42be6a4a0c0db6ff5ebc246e
    resource: repo://extract_thinker/splitter.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-11ca4d71d0bcafa6689655ef
    resource: repo://tests/test_classify.py
  - id: openwiki-source-8dc53e44124fed5d3b4d2a05
    resource: repo://tests/test_evaluator.py
  - id: openwiki-source-749f08e74a04a46f1629ea04
    resource: repo://tests/test_process.py
generated: { by: "opencode", at: "2026-09-11T09:16:41.841Z" }
---

# Architecture Overview

ExtractThinker is a Python library for **intelligent document processing**: it extracts structured data from documents (PDFs, images, spreadsheets, web pages, Office files) by combining a pluggable **document loader** layer with **LLM**-driven, schema-validated extraction. Its README describes the design goal as an "ORM for document processing": the user declares a `Contract` (a Pydantic model), points an `Extractor` at a document, and receives a typed object.

## Package layout

The distribution is a single package, `extract_thinker`, plus `tests/`, `examples/`, and `docs/` (an mkdocs site). `pyproject.toml` pins Python `>=3.9,<3.14` and declares the runtime dependencies: `pydantic`, `litellm`, `instructor`, `pillow`, `pypdfium2`, `python-dotenv`, `cachetools`, `pyyaml`, `tiktoken`, `python-magic`, `playwright`, and `libmagic`; OCR/cloud loaders add their own optional packages.

```
extract_thinker/
├── __init__.py            # public API surface (extract_thinker/__init__.py)
├── extractor.py           # Extractor: load + LLM orchestration, classify, batch
├── process.py             # Process: classify + split + per-group extract workflow
├── llm.py / llm_engine.py # LLM adapter and backends
├── image_splitter.py / text_splitter.py / splitter.py
├── pagination_handler.py / concatenation_handler.py / completion_handler.py
├── batch_job.py           # OpenAI batch API integration
├── markdown/markdown_converter.py
├── document_loader/       # loader plugin system (document_loader/*.py)
├── models/                # Contract, Classification*, strategy enums, doc groups
├── eval/                  # evaluation subsystem (eval/*.py)
├── utils.py / exceptions.py / global_models.py / warning.py
```

`extract_thinker/__init__.py` is the only public surface: it re-exports `Extractor`, `LLM`, all `DocumentLoader*` classes and their configs, `Classification`, `ClassificationResponse`, `ClassificationStrategy`, `Process`, `Splitter`/`ImageSplitter`/`TextSplitter`, `Contract`, `SplittingStrategy`, `CompletionStrategy`, `BatchJob`, and `MarkdownConverter`/`PageContent`. It also calls `filter_pydantic_v2_warnings()` at import time to suppress Pydantic v2 warnings.

## Layered architecture and control flow

The system is a pipeline with clearly separated ownership:

1. **Document loaders** (`document_loader/`) own the *input*: turning a file path, `BytesIO`, URL, or raw data into the **standard page format** — a `list[dict]` where each page has a `content` text key and, in vision mode, an `image` bytes key (plus optional structured metadata such as `tables`, `forms`, `formulas`, `barcodes`, `languages`). The base `DocumentLoader` (`extract_thinker/document_loader/document_loader.py`) provides format detection (`can_handle`), vision mode, PDF/image rendering, and URL screenshots; `CachedDocumentLoader` adds TTL caching keyed on `(source, vision_mode)`.
2. **The LLM adapter** (`llm.py`) owns the *model boundary*: one class wrapping either `instructor` over `litellm.completion` (MD_JSON structured outputs) or `pydantic-ai`, plus router fallbacks, thinking-mode token budgeting, and raw completions.
3. **Orchestration** owns the *flow*:
   - `Extractor.extract` resolves a loader for the source, normalizes loaded content into the **universal content format** (`{content, images, metadata}`) via `_map_to_universal_format`, sets the page count for token budgeting, builds messages, and calls `llm.request(messages, response_model)` to get an instructor-validated `response_model` instance.
   - `Extractor.classify` asks the LLM which of several `Classification` objects matches the document.
   - `Process` composes classification (with consensus strategies or a `ClassificationTree`), splitting a multi-page document into `DocGroup`s with `ImageSplitter`/`TextSplitter`, and extracting each group with its classification's extractor and contract.
4. **Models** (`models/`) own the *schema*: `Contract` is the base Pydantic class for extraction outputs; `Classification` binds a name/description/contract/extractor; strategy enums (`ClassificationStrategy`, `SplittingStrategy`, `CompletionStrategy`) and doc-group containers (`DocGroup`/`DocGroups`, `DocGroups2`, `EagerDocGroup`/`DocGroupsEager`) are all here.
5. **Completion handlers** (`pagination_handler.py`, `concatenation_handler.py`) own *long-document recovery*, and **`batch_job.py`** owns *async batch submission* to the OpenAI Batch API.
6. **The evaluation package** (`eval/`) is a separate, downstream subsystem that drives an `Extractor` over labeled datasets and produces quality/cost/hallucination reports.

### Data/control flow summary

```
source ──► DocumentLoader.load() ──► list[pages {content, image?}]
   Extractor.extract:  pages ──► _map_to_universal_format ──► {content, images, metadata}
                        ──► _build_message_content/_build_messages ──► llm.request(messages, Contract)
                        ──► instructor-validated Contract instance
   Process:  file ──► classify (strategy/tree) ──► split (eager/lazy) ──► per-DocGroup extract_async
```

## Error model

The library funnels failures through `extract_thinker/exceptions.py`: `ExtractThinkerError` (base), `VisionError` (vision-related), and `InvalidVisionDocumentLoaderError` (loader cannot do vision). The `Extractor` converts instructor truncation (`IncompleteOutputException`), Pydantic `ValidationError`, and `JSONDecodeError` into `ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")`, and routes `litellm.BadRequestError` under vision into `VisionError`.

## Extension seams

- **New document loaders**: subclass `DocumentLoader`/`CachedDocumentLoader`, declare `SUPPORTED_FORMATS`, implement `load`, optionally add a config dataclass and `can_handle_vision`; export from `__init__.py`. See [Adding a Document Loader](/openwiki/guides/adding-a-document-loader.md).
- **New LLM backends**: add an `LLMEngine` member and a branch in `LLM.request`/`raw_completion`.
- **New splitters**: subclass `Splitter` and implement `belongs_to_same_document` + the two split methods.
- **New completion handlers**: subclass `CompletionHandler` (ABC) and implement `handle`.
- **Interceptors**: `LoaderInterceptor` / `LlmInterceptor` can be registered on an `Extractor`.

## Representative tests

The suite in `tests/` mirrors the layers: `test_document_loader_*` for the loader catalog, `test_extractor.py`/`test_batch_extractor.py` for orchestration, `test_classify.py`/`test_process.py` for classification and splitting, `test_llm_backends.py`/`test_ollama.py` for the LLM adapter, `test_markdown_converter.py` for markdown conversion, `test_evaluator.py` for the eval subsystem, and `tests/critical/` for end-to-end smoke tests.
