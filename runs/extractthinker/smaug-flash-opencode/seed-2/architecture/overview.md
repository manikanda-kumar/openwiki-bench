---
type: architecture
title: Architecture Overview
description: How ExtractThinker's modular components—Extractor, Process, DocumentLoader, Splitter, LLM, Contract, and Classification—compose to load, classify, split, and extract structured data from documents.
tags: [architecture, extractor, document-loader, llm, process, classification]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:22:48.987Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-fc161808b0aa695895bce5ee
    resource: repo://extract_thinker/completion_handler.py
  - id: openwiki-source-8837984946085fdb93153fa8
    resource: repo://extract_thinker/document_loader/document_loader_pypdf.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-80ac776afff46dd86a9f455f
    resource: repo://extract_thinker/exceptions.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-9b040ddd08f40366f527dfa0
    resource: repo://extract_thinker/models/classification.py
  - id: openwiki-source-92ee41b85171e4663a071a13
    resource: repo://extract_thinker/models/contract.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
generated: { by: "opencode", at: "2026-09-12T21:22:48.987Z" }
---

# Architecture Overview

ExtractThinker is a Python library for **intelligent document processing (IDP)** that uses large language models (LLMs) to extract structured data from documents. It is organized as a set of composable modules, inspired by the LangChain ecosystem, with a focus on documents rather than general LLM workflows. All core public types are re-exported from the package root in `extract_thinker/__init__.py`.

## Component roles and ownership

- **DocumentLoader** — Owns loading and preprocessing a source (file path, byte stream, URL, or pre-processed data) into a canonical page-based format. Each loader declares supported formats via `SUPPORTED_FORMATS` and exposes `can_handle`, `load`, and an optional vision mode (`extract_thinker/document_loader/document_loader.py`).
- **Extractor** — Orchestrates the interaction between a DocumentLoader and an LLM to produce structured output matching a Pydantic `Contract`. It handles vision mode, multiple-source merging, completion strategies, classification, batch extraction, and error translation (`extract_thinker/extractor.py`).
- **Process** — A higher-level workflow coordinator that loads a file, splits it into document groups via a Splitter using a set of Classifications, and then extracts each group through its associated Extractor (`extract_thinker/process.py`).
- **Splitter** — Splits a multi-page document into groups of pages that belong to the same logical documentached document, using either an eager or lazy strategy. Implementations are `ImageSplitter` (vision/layout based) and `TextSplitter` (text based).
- **LLM** — Wraps one or more model backends (litellm + instructor, or pydantic-ai) and exposes `request`, `raw_completion`, router fallback, thinking mode, and token budgeting (`extract_thinker/llm.py`).
- **Contract** — A tagged Pydantic `BaseModel` (`extract_thinker/models/contract.py`) that defines the expected shape of extracted data.
- **Classification** — Associates a name, description, an optional reference image, and an optional contract with an Extractor, and is used to both classify documents and select extraction contract/extractor in the Process flow (`extract_thinker/models/classification.py`).

## The page-based data contract

Document loaders normalize every source into a **list of page dictionaries**, one entry per page (or per sheet for spreadsheets). Each page dictionary has at least a `"content"` string (extracted text). In vision mode loaders also attach an `"image"` (or `"images"`) entry holding the rendered page bytes. Examples:

- `DocumentLoaderPyPdf` returns pages with `"content"` and, when `vision_mode` is enabled, `"image"` bytes from pypdfium2 rendering (`extract_thinker/document_loader/document_loader_pypdf.py:127-149`).
- `DocumentLoaderTesseract` returns pages with OCR text in `"content"` and the original image when in vision mode (`extract_thinker/document_loader/document_loader_tesseract.py:237-250`).
- `DocumentLoaderSpreadSheet` treats each sheet as a separate "page".
- `DocumentLoaderData` accepts already-normalized lists of dicts or raw strings and passes them through (`extract_thinker/document_loader/document_loader_data.py`).

This consistent page contract is what allows the same Extractor/LLM pipeline to consume output from any loader.

## Universal content flow

`Extractor._map_to_universal_format` (`extract_thinker/extractor.py:337-432`) converts loaded content into a single dictionary shaped as:

```
{
  "content": str,          # joined text from pages
  "images": List[bytes],   # optional page image bytes when vision=True
  "metadata": {}
}
```

It accepts either already-universal dicts, lists of page dicts (joining text and collecting images), plain strings, or legacy dict formats. The `_extract` method then builds chat messages from this universal dict, appends optional `extra_content`, and dispatches by `CompletionStrategy` to either the LLM directly, `PaginationHandler`, or `ConcatenationHandler`.

When the source passed to `extract` is a list (e.g. from splitting), `Extractor` loads each item, maps each to the universal format, records page counts in metadata, merges text with a `--- Document Separator ---`, merges images, and passes the merged content to `_extract` (`extract_thinker/extractor.py:238-318`).

## Control flow: basic extraction

1. Caller configures an `Extractor` with `load_document_loader` and `load_llm`.
2. Caller calls `extractor.extract(source, Contract, ...)`.
3. `_validate_dependencies` enforces that a DocumentLoader is set (unless vision), an LLM is set, and the response model is a `BaseModel`/`Contract` (`extract_thinker/extractor.py:139-157`).
4. In vision mode the loader's `set_vision_mode(True)` is invoked; otherwise image keys are stripped from list content.
5. The chosen loader loads pages; those are mapped to the universal format; page count is set on the LLM for token budgeting.
6. `_extract` builds messages and calls `LLM.request(messages, response_model)`, returning an instance of the response model.

## Classification flow

`Extractor.classify` (`extract_thinker/extractor.py:774-807`) selects a loader, optionally enables vision, loads content, and dispatches to `_classify`, which either uses the single-prompt text approach (`_classify_text_only`) or, when `is_classify_image`, an image-vs-reference comparison per classification (`_classify_one_image_with_ref` / `_classify_one_image_no_ref`). Results are returned as a `ClassificationResponse` (`name`, `confidence` 1–10, and the matched `Classification`).

`Process.classify_async` supports multiple extractor "layers" and strategies: `CONSENSUS`, `HIGHER_ORDER`, and `CONSENSUS_WITH_THRESHOLD`, plus hierarchical traversal of a `ClassificationTree` (`extract_thinker/process.py:74-188`).

## Error handling

The library defines a small exception hierarchy in `extract_thinker/exceptions.py`: `ExtractThinkerError` (base), `VisionError`, and `InvalidVisionDocumentLoaderError`. `Extractor.extract` translates incomplete-output and JSON-validation failures into `ExtractThinkerError` when the `FORBIDDEN` completion strategy is set, and re-classifies vision-related LiteLLM `BadRequestError`s into a `VisionError` (`extract_thinker/extractor.py:318-335`). The `FORBIDDEN` strategy completes extraction only if the full response validates; otherwise the extraction fails rather than returning a partial result.

## Extensibility seams

- **Loaders**: implement `DocumentLoader` and set `SUPPORTED_FORMATS`; optionally extend `CachedDocumentLoader` for TTL caching.
- **Splitters**: subclass `Splitter` and implement `belongs_to_same_document`, `split_lazy_doc_group`, and `split_eager_doc_group`.
- **Completion strategies**: implement `CompletionHandler` with a `handle(content, response_model, vision, extra_content)` method (`extract_thinker/completion_handler.py`).
- **Interceptors**: `LoaderInterceptor` and `LlmInterceptor` abstract classes can be added to an `Extractor` via `add_interceptor` (`extract_thinker/document_loader/loader_interceptor.py`, `extract_thinker/document_loader/llm_interceptor.py`, `extract_thinker/extractor.py:61-71`).

## External integrations

ExtractThinker integrates with external document-intelligence services via loaders: Tesseract OCR, Azure Document Intelligence (`DocumentLoaderAzureForm`), AWS Textract, Google Document AI, Mistral OCR, EasyOCR, Docling, MarkItDown, and BeautifulSoup. LLM access is provider-agnostic through LiteLLM (default) or pydantic-ai, and model names are provider-prefixed strings (e.g. `gemini/...`, `gpt-4o`).
