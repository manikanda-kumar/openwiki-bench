---
type: architecture
title: "Architecture Overview"
description: "Component map and ownership boundaries of ExtractThinker: document loaders, the Extractor pipeline, LLM layer, Process/splitters, completion handlers, batch, eval, and markdown subsystems, connected by a page-dict/universal-content data contract."
tags: [architecture, components, data-flow, ownership]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T11:42:30.305Z
sources:
  - id: openwiki-source-1d4891e6fe7afb64116aee2d
    resource: repo://.github/workflows/workflow.yml
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-964e22fb6c2de60a25515dfc
    resource: repo://extract_thinker/document_loader/document_loader_llm_image.py
  - id: openwiki-source-8837984946085fdb93153fa8
    resource: repo://extract_thinker/document_loader/document_loader_pypdf.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-42be6a4a0c0db6ff5ebc246e
    resource: repo://extract_thinker/splitter.py
  - id: openwiki-source-757f2a5291d89612677f740d
    resource: repo://mkdocs.yml
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-dbdf465048aa8501845821eb
    resource: repo://tests/critical/test_critical_extraction.py
generated: { by: "opencode", at: "2026-09-11T11:01:32.247Z" }
---

# Architecture Overview

ExtractThinker is a single Python package (`extract_thinker/`, published via Poetry as `extract_thinker`, Python >=3.9,<3.14) that turns a document source plus a Pydantic "contract" into validated structured data via an LLM. The public surface is re-exported from `extract_thinker/__init__.py`, which exposes the `Extractor`, `Process`, `LLM`, `Contract`, `Classification`, splitter classes, ~17 document loaders with their config classes, `BatchJob`, and `MarkdownConverter`.

## Components and ownership

| Component | Module(s) | Owns |
|---|---|---|
| `Extractor` | `extractor.py` | Loader selection, content normalization, prompt/message construction, extraction, classification, batch submission |
| `LLM` / `LLMEngine` | `llm.py`, `llm_engine.py` | Model invocation through litellm+instructor or pydantic-ai; token budgets, thinking mode, routers |
| `DocumentLoader` hierarchy | `document_loader/` | Turning files/streams/URLs into page dicts; capability detection; vision-mode images; TTL caching |
| `Process` | `process.py` | Multi-document workflow: classification across extractor groups (MoM/tree), splitting orchestration, group extraction |
| `Splitter` subclasses | `splitter.py`, `image_splitter.py`, `text_splitter.py` | Deciding document boundaries within one file; producing `DocGroup`s with classifications |
| Completion handlers | `completion_handler.py`, `pagination_handler.py`, `concatenation_handler.py` | Strategies for large/paged outputs: per-page merge with conflict resolution, or raw JSON continuation |
| `BatchJob` | `batch_job.py` | OpenAI Batch API lifecycle (jsonl upload, status polling, result parsing, cleanup) |
| `eval` subpackage | `eval/` | Offline evaluation of extractors: datasets, field comparison, metrics, hallucination detection, cost, reports |
| `MarkdownConverter` | `markdown/markdown_converter.py` | LLM-assisted document→Markdown conversion with certainty-scored structured output |
| Shared utilities | `utils.py`, `exceptions.py`, `models/` | Encoding, token counting, model-structure prompts, contracts/enums/DTOs, exception hierarchy |

Ownership is deliberately narrow at the edges: loaders never call LLMs — even `DocumentLoaderLLMImage` only converts sources into image-bearing pages (always `vision_mode=True`) suitable for a vision model invoked later by the `Extractor` — and `LLM` never knows about documents, receiving only message lists and a response model. `Process` coordinates `Extractor`s but delegates every LLM interaction back to them.

## The page-dict contract (data backbone)

Every document loader's `load()` returns `List[Dict[str, Any]]` — one dict per page. The de-facto contract is `"content"` (extracted text) plus optional `"image"`/`"images"` bytes when `vision_mode` is enabled; for example `DocumentLoaderPyPdf` emits `{"content": str}` per page and injects `"image"` bytes per page when vision mode is on (`extract_thinker/document_loader/document_loader_pypdf.py:106-151`), and `DocumentLoaderTesseract` documents pages as "content: extracted text, image: original image if vision_mode" (`extract_thinker/document_loader/document_loader_tesseract.py:172-182`). Specialized loaders add keys: spreadsheets carry `is_spreadsheet`/`sheet_name`/`data`, cloud OCR loaders add `table`/`form` structures.

The `Extractor._map_to_universal_format` step collapses any loader output into the universal shape used downstream:

```python
{
  "content": str,        # page texts joined with "\n\n"
  "images": List[bytes], # only populated when vision=True
  "metadata": {"num_pages": int, ...}
}
```

(`extract_thinker/extractor.py:337-432`.) It also accepts already-universal dicts, plain strings, and legacy `{"text": ...}` dicts, and converts a single `image` key into an `images` list.

## End-to-end extraction flow

For `extractor.extract(source, Contract)`:

1. **Validate** dependencies (loader unless vision, LLM, Pydantic model) — `extractor.py:139-157`.
2. **Select loader** by extension registry → capability probe (`can_handle`) → list/dict fallback to `DocumentLoaderData` → vision fallback to `DocumentLoaderLLMImage` — `extractor.py:92-126`.
3. **Load + normalize** to universal format; set the LLM's page count (feeds thinking-token budgets) — `extractor.py:238-316`.
4. **Build messages**: system prompt "You are a server API that receives document information and returns specific fields in JSON format" plus `##Content` user text and, in vision mode, base64 `image_url` parts; optional `##Extra Content` inserted after the system message — `extractor.py:1149-1390`.
5. **Dispatch to LLM**: `FORBIDDEN` strategy calls `llm.request(messages, response_model)`, where instructor validates/parses into the contract; `PAGINATE`/`CONCATENATE` delegate to the completion handlers — `extractor.py:1132-1143`.
6. **Normalize errors** into `ExtractThinkerError`/`VisionError` (see configuration-and-failure-handling).

Classification (`Extractor.classify`) reuses the loader path but asks the LLM for a `{name, confidence 1..10}` JSON (`ClassificationResponse`) instead of a contract (`extractor.py:536-807`); splitting (`Process.load_file().split().extract()`) layers `Splitter` page-boundary analysis on top and finally re-enters the same extractor path with `set_skip_loading(True)` on pre-cut page lists (`extract_thinker/process.py:205-309`).

## Third-party integration substrate

The package builds on: `litellm` (provider-agnostic chat completions, cost/token helpers, `Router`), `instructor` (structured JSON parsing modes and batch helpers), `pydantic >= 2` (all contracts, configs, and generated optional models), `Pillow` + `pypdfium2` (image handling and PDF→image rendering in the base loader), `python-magic` (MIME capability checks), `cachetools` (TTL caches), `tiktoken` (token counting, with a regex fallback on Python 3.13), `playwright` (optional, URL→screenshot ingestion in vision mode), and optional per-loader dependencies (`pytesseract`, `azure-ai-formrecognizer`, `boto3`, `docling`, `markitdown`, `openpyxl`, `bs4`, `mistral SDK`, `easyocr`, `google-documentai`) that are imported lazily inside loaders — `pyproject.toml:8-28`, `document_loader_tesseract.py:148-170`. Only the core set is a hard dependency; loader extras degrade with `ImportError` install hints at use time.

## Repository layout (by responsibility, not one-to-one with code)

- `extract_thinker/` — the runtime library described above.
- `tests/` — pytest suite: per-loader tests, extractor/process/classify/batch/eval/markdown tests, plus `tests/critical/` end-to-end tests used in CI and `tests/models/` contract fixtures.
- `docs/` + `mkdocs.yml` — the published MkDocs Material site (nav mirrors the conceptual taxonomy: document-loaders, classification, splitters, completions, evals...).
- `examples/` — runnable scripts (basic extraction, receipt/resume processors).
- `.github/workflows/` — CI (`workflow.yml` critical tests + version matrix, `documentation.yml` mkdocs deploy, `manual-publish.yml`, plus the OpenWiki update workflow).
