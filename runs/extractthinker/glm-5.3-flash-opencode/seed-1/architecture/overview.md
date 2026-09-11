---
type: architecture-overview
title: Architecture Overview
description: ExtractThinker's component map — DocumentLoaders, Extractor, Process, Splitter, Classification/Contract models, and the LLM layer — and the data flow that connects them.
tags: [architecture, extract-thinker, document-intelligence, orchestration]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:40:03.572Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
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
generated: { by: "opencode", at: "2026-09-11T09:40:03.572Z" }
---

# Architecture Overview

ExtractThinker (project name `extract_thinker`, version 0.1.14, pyproject.toml) is an Intelligent Document Processing (IDP) library: it loads documents, classifies them against user-defined types, optionally splits multi-document files into page groups, and extracts structured data using LLMs bound to Pydantic schemas.

## Public surface

`extract_thinker/__init__.py` is the single public façade (`__all__`, extract_thinker/__init__.py:40-89). It exports:

- **`Extractor`** — the extraction and classification engine (extract_thinker/extractor.py:39).
- **`Process`** — the multi-document workflow orchestrator (extract_thinker/process.py:18).
- **`Splitter`, `ImageSplitter`, `TextSplitter`** — document-boundary detection strategies.
- **`DocumentLoader` and ~16 concrete loaders** (Tesseract, PyPdf, PDFPlumber, Azure, AWS Textract, Google Document AI, Mistral OCR, EasyOCR, MarkItDown, Docling, BeautifulSoup, spreadsheet, txt, doc2txt, LLM image, data).
- **`Contract`** — a trivial Pydantic `BaseModel` subclass serving as the user-facing type of extraction schemas (extract_thinker/models/contract.py:1-5). Any `BaseModel` subclass is also accepted by `Extractor._validate_dependencies` (extract_thinker/extractor.py:156-157).
- Models: `Classification`, `ClassificationResponse`, `ClassificationStrategy`, `ClassificationTree`, `SplittingStrategy`, `CompletionStrategy`, `BatchJob`.
- `LLM` — the model gateway (see the LLM Layer page).
- `MarkdownConverter` / `PageContent` — markdown conversion utility surface (extract_thinker/markdown/).

`filter_pydantic_v2_warnings()` runs on package import (extract_thinker/__init__.py:38), so importing the package mutates warnings filters.

## Ownership boundaries

| Component | Owns | Does not own |
|---|---|---|
| `DocumentLoader` (ABC) | File/stream → normalized per-page content dicts; PDF/image rendering via pypdfium2; vision-mode artifacts; URL screenshots via Playwright; TTLCache | LLM calls; extraction prompts |
| `Extractor` | Loader selection, content normalization to the universal format, message building, classification prompts, completion-strategy dispatch, batch-job creation | Page splitting; loader parsing |
| `Process` | End-to-end workflow: file → optional split → concurrent group extraction; multi-extractor classification strategies | Direct extraction without `Classification` groupings |
| `Splitter` implementations | Deciding page boundaries and which classification applies to each group | Extraction; loader selection |
| `LLM` | All litellm/instructor/pydantic-ai interaction, thinking budgets, dynamic JSON parsing | Prompt construction (owned by Extractor/handlers) |

## Core data flow

1. **Load**: `DocumentLoader.load(source)` returns a list of per-page dicts (`{"content", "image"/"images", ...}`) or similar normalized structures (extract_thinker/document_loader/document_loader.py:84-87). Loader selection in `Extractor.get_document_loader` prefers the default loader, then extension-based lookup, then capability probing via `can_handle`, then falls back to `DocumentLoaderData` for list/dict sources or `DocumentLoaderLLMImage` when vision is allowed (extract_thinker/extractor.py:92-126).
2. **Normalize/merge**: `Extractor._map_to_universal_format` produces `{"content": str, "images": list, "metadata": {...}}`; multi-source lists are merged with a `--- Document Separator ---` text join and combined image lists (extract_thinker/extractor.py:262-303, 337-432).
3. **Extract**: `Extractor._extract` invokes LLM interceptors, builds messages (`_build_message_content` stringifies non-image content via YAML or JSON formatting for spreadsheets), and dispatches on `CompletionStrategy` — FORBIDDEN straight to `llm.request`, PAGINATE/CONCATENATE to that handler (extract_thinker/extractor.py:1115-1147).
4. **Split & orchestrate**: `Process.load_file(...).split(classifications, strategy)` loads pages and produces `DocGroups` (`DocGroup(pages=[...], classification=...)`); `split()` requires ≥ 2 pages and refuses lazy splitting unless `can_handle_paginate` reports PDF support (extract_thinker/process.py:205-238). `Process.extract` then maps each group's classification to a `Classification`-owned `Extractor`, page-slices the original pages, calls `extractor.set_skip_loading(True)`, and runs grouped extractions concurrently via asyncio (extract_thinker/process.py:240-309).
5. **Validate**: every result is a Pydantic-validated instance of the user's `Contract`.

## Model layer

`extract_thinker/models/` defines the shared vocabulary: `Classification` (name, description, optionally contract/extraction_contract/extractor/image/uuid), `ClassificationResponse`/`ClassificationResponseInternal` (LLM-facing name+confidence), `DocGroups`/`DocGroup`/`DocGroups2`/`EagerDocGroup` (split groupings), plus the `SplittingStrategy`, `CompletionStrategy`, `ClassificationStrategy`, and `ClassificationTree` enums/containers. The LLM-facing classification response is explicitly a JSON `{name, confidence 1..10}` shape (see Extraction Flow page).

## External integrations

- **litellm + instructor** — the default model backend for all extraction/classification calls.
- **pydantic-ai** — optional alternative backend.
- **OpenAI Batch API** — only for `extract_batch`/`BatchJob`.
- **Cloud OCR providers** (Azure Document Intelligence, AWS Textract, Google Document AI, Mistral OCR) and local engines (Tesseract, EasyOCR, Docling, MarkItDown, Beautiful Soup, pypdfium2) inside loaders; each concrete loader performs its own network/authentication calls and is covered on the Document Loaders page.
- **Playwright** — headless Chromium screenshots for URL sources in vision mode (document_loader.py:263-301).

## Failure philosophy

Errors are converted into a small `ExtractThinkerError`-family hierarchy (extract_thinker/exceptions.py); with the default FORBIDDEN completion strategy, incomplete LLM outputs and JSON-validation failures are wrapped as "Incomplete output received and FORBIDDEN strategy is set" (extract_thinker/extractor.py:320-335). Concurrency paths deliberately swallow per-chunk/page failures and continue, printing diagnostics (ThreadPoolExecutor loops in extractor.py:837-863 and pagination_handler.py:38-62). Details per page in the Core group.

## What this overview does not cover

Per-page mechanics live in focused pages: extraction flow, loaders, classification, splitting, completion strategies, batch processing, the LLM layer, eval framework. Deployment, packaging, and publishing claims are noted on the Testing/CI page and not invented here.
