---
type: architecture
title: Architecture Overview
description: System-level map of ExtractThinker's core objects, ownership boundaries, and the end-to-end document-to-structured-data flow.
tags: [architecture, overview, extract-thinker, llm, document-processing]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:45:03.808Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-80ac776afff46dd86a9f455f
    resource: repo://extract_thinker/exceptions.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
generated: { by: "opencode", at: "2026-09-11T09:45:03.808Z" }
---

# Architecture Overview

ExtractThinker is a Python library (published as `extract_thinker`, version 0.1.14, Python >=3.9,<3.14) that turns documents — PDFs, images, spreadsheets, office files, web pages — into validated structured objects using LLMs. It acts like an "ORM for document processing": contracts (Pydantic models) define the schema, document loaders turn files into universal content, an LLM layer performs the extraction, and orchestration classes combine classification, splitting, and extraction into pipelines.

## Core objects and ownership boundaries

The public API is exported from `extract_thinker/__init__.py` (`extract_thinker/__init__.py#L1-L110`). Each object owns one responsibility:

| Object | File | Ownership |
|---|---|---|
| `Process` | `extract_thinker/process.py` | Pipeline orchestration: classify → split → extract multi-document files |
| `Extractor` | `extract_thinker/extractor.py` | Single-source extraction and classification; loader selection; completion strategies; batch entry |
| `LLM` | `extract_thinker/llm.py` | Provider-agnostic model calls (litellm/instructor or pydantic-ai), thinking budgets, dynamic parsing |
| `DocumentLoader` (ABC) | `extract_thinker/document_loader/document_loader.py` | Convert any source into a page-list universal format; `can_handle` capability checks |
| `Splitter` (ABC), `TextSplitter`, `ImageSplitter` | `extract_thinker/splitter.py`, `text_splitter.py`, `image_splitter.py` | Decide page-group boundaries using an LLM |
| `PaginationHandler` / `ConcatenationHandler` | `extract_thinker/pagination_handler.py`, `concatenation_handler.py` | Completion strategies for pages whose fields spread across page boundaries |
| `BatchJob` | `extract_thinker/batch_job.py` | OpenAI Batch API job creation/upload/polling |
| `Evaluator` + `extract_thinker/eval/*` | `extract_thinker/eval/evaluator.py` | Offline evaluation, hallucination detection, cost tracking |
| `MarkdownConverter` | `extract_thinker/markdown/markdown_converter.py` | LLM-based markdown conversion per page |

Ownership boundary: `Process` does not call LLMs directly; it composes `Extractor` instances and drives them via `classify`/`extract_async`. `Extractor` does not implement providers; all model I/O goes through `LLM`. `LLM` does not implement providers either — it delegates to `litellm`/`instructor` (or `pydantic_ai.Agent`) (`extract_thinker/llm.py#L55-L97`).

## End-to-end data flow

1. **Loading**: a `DocumentLoader` implementation converts a file path, `BytesIO` stream, or URL into a list of page dictionaries. The base class provides generic PDF/image conversion via `pypdfium2`, URL screenshotting via Playwright, image resizing, and vertical image splitting (`extract_thinker/document_loader/document_loader.py#L92-L150`).
2. **Universal format**: `Extractor._map_to_universal_format` normalizes loader output into `{"content": str, "images": List[bytes], "metadata": {...}}`, joining page texts and collecting images when `vision=True` (`extract_thinker/extractor.py#L337-L432`).
3. **Classification (optional)**: `Extractor.classify` loads the document and asks the LLM to pick one of the `Classification` objects; `Process.classify_async` can layer multiple `Extractor` groups with consensus/higher-order/threshold strategies or walk a `ClassificationTree` (`extract_thinker/process.py#L81-L188`, `extract_thinker/extractor.py#L536-L807`).
4. **Splitting (multi-document files, optional)**: `Process.split` + a `Splitter` produce `DocGroups` — page ranges paired with class names — using EAGER or LAZY strategies (`extract_thinker/process.py#L205-L238`).
5. **Extraction**: `Extractor.extract` merges all pages/sources, optionally applies a `CompletionStrategy` (PAGINATE/CONCATENATE handlers), otherwise sends one request through `LLM.request` and lets `instructor` parse/validate the result into the caller's `Contract`/BaseModel (`extract_thinker/extractor.py#L193-L335`, `extract_thinker/extractor.py#L1115-L1147`).
6. **Error shaping**: extraction failures are converted to `ExtractThinkerError`; incomplete LLM output under the FORBIDDEN strategy becomes an explicit error; vision-specific failures are classified by `classify_vision_error` (`extract_thinker/extractor.py#L318-L335`, `extract_thinker/exceptions.py`).

## Key invariants and semantics

- Loader selection is mutual exclusive: `Process` refuses a default loader when per-type loaders exist and vice versa (`extract_thinker/process.py#L31-L40`).
- A document must have ≥2 pages to be split; lazy splitting additionally requires paginatable sources (PDF only today) (`extract_thinker/process.py#L224-L236`).
- `extract_with_splitting` results are merged field-by-field with list concatenation and first-value-wins for scalars (`aggregate_results`, `extract_thinker/extractor.py#L900-L943`).
- Page counts drive token budgets: `Extractor` sets `llm.set_page_count(...)` from loaded metadata so the LLM layer can size thinking budgets (`extract_thinker/extractor.py#L266-L314`, `extract_thinker/llm.py#L155-L181`).
- Batch mode is restricted to a whitelist of GPT-4o family models and is unavailable on the `PYDANTIC_AI` backend (`extract_thinker/extractor.py#L40-L45, 969-983`).

## External dependencies worth knowing

The stack sits on `litellm` + `instructor` (structured output parsing), `pydantic` v2 (contracts), `pypdfium2` (PDF rasterization), `pillow` (image ops), `cachetools` (loader TTL caches), `python-magic` (MIME sniffing for streams), and `playwright` (URL screenshots) — see `pyproject.toml#L7-L20`. Each cloud loader (Azure Document Intelligence, AWS Textract, Google Document AI, Mistral OCR) requires its own SDK, which is why loaders live behind the `DocumentLoader` seam and are lazily imported/dependency-checked at runtime.

## Where to go next

- Lifecycle details of extraction: [Extractor and Extraction Flow](/openwiki/extractor-and-extraction-flow.md)
- Loader contract and catalog: [Document Loaders](/openwiki/document-loaders.md)
- Model-call mechanics: [LLM Layer](/openwiki/llm-layer.md)
- Pipeline composition: [Splitting and the Process Orchestrator](/openwiki/splitting-and-process.md) and [Classification](/openwiki/classification.md)
- Getting running locally: [Quickstart](/openwiki/quickstart.md)
