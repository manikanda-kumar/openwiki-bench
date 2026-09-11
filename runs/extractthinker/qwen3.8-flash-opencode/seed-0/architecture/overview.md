---
type: architecture-overview
title: Architecture Overview
description: Map of the ExtractThinker package — components, ownership boundaries, and the end-to-end data flow from document source to validated Pydantic output.
tags: [architecture, overview, data-flow, components]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:51:57.297Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-0272fd3963ebbd7912866173
    resource: repo://extract_thinker/document_loader/llm_interceptor.py
  - id: openwiki-source-8487b701e2f54db6dbd8380b
    resource: repo://extract_thinker/eval/__init__.py
  - id: openwiki-source-80ac776afff46dd86a9f455f
    resource: repo://extract_thinker/exceptions.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-d14c100cb1c28d349fc7a183
    resource: repo://extract_thinker/global_models.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-f087112619b9c50915a1e49c
    resource: repo://extract_thinker/markdown/markdown_converter.py
  - id: openwiki-source-7fa93fa33ef7db6a499c6360
    resource: repo://extract_thinker/models/doc_group.py
  - id: openwiki-source-ceefb0a1c63bd2e0b6eca7a0
    resource: repo://extract_thinker/models/doc_groups.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-11T09:51:57.297Z" }
---

# Architecture Overview

ExtractThinker is a Python library (`extract_thinker`, packaged with Poetry, Apache-2.0) that extracts and classifies structured data from documents using LLMs. The source is authoritative here; `docs/` and `README.md` are user documentation.

## Responsibility and public surface

Everything an integrator needs is re-exported from `extract_thinker/__init__.py`: the `Extractor` and `Process` facades, the `LLM` wrapper, the `DocumentLoader` base plus ~17 concrete loaders (each with an optional `*Config` dataclass), the splitters (`Splitter`, `TextSplitter`, `ImageSplitter`), model types (`Contract`, `Classification`, strategies), `BatchJob`, and the `MarkdownConverter`. The module also calls `filter_pydantic_v2_warnings()` at import time to suppress a known Pydantic v2 warning.

## Component map

| Component | File | Responsibility |
|---|---|---|
| `Extractor` | `extract_thinker/extractor.py` | Central facade: loader selection, content normalization, prompt building, extraction/classify/batch entry points, error wrapping |
| `Process` | `extract_thinker/process.py` | Multi-document workflow: layer consensus/tree classification, eager/lazy splitting, per-group extraction |
| `LLM` | `extract_thinker/llm.py` | Provider-agnostic request layer over `litellm` + `instructor` (default) or `pydantic-ai` |
| `DocumentLoader` (ABC) | `extract_thinker/document_loader/document_loader.py` | Capability detection, PDF/image rasterization (pypdfium2), URL screenshots (Playwright) |
| Concrete loaders | `extract_thinker/document_loader/document_loader_*.py` | One per backend (Tesseract, PyPDF, Azure DI, AWS Textract, Google DocAI, Mistral OCR, …), all extending `CachedDocumentLoader` |
| Completion handlers | `pagination_handler.py`, `concatenation_handler.py` | PAGINATE/CONCATENATE strategies behind the `CompletionHandler` ABC (`completion_handler.py`) |
| Splitters | `splitter.py`, `text_splitter.py`, `image_splitter.py` | Decide page→document grouping via LLM pairwise comparisons |
| Models | `extract_thinker/models/` | `Contract` (Pydantic base for user schemas), `Classification`, strategy enums, doc-group containers |
| `BatchJob` | `extract_thinker/batch_job.py` | OpenAI Batch API lifecycle (upload, create, poll, cleanup) |
| Eval suite | `extract_thinker/eval/` | `Evaluator`, `TeacherStudentEvaluator`, datasets, metrics, field comparison, hallucination detection, cost tracking, CLI |
| Markdown | `extract_thinker/markdown/markdown_converter.py` | Page→Markdown conversion (LLM-assisted or basic) |

## End-to-end extraction flow

`Extractor.extract(source, response_model, vision, content, completion_strategy)` (extractor.py:193) drives the happy path:

1. **Validation** — `_validate_dependencies` requires a document loader (unless `vision=True`), an `LLM`, and a Pydantic-derived `response_model` (extractor.py:139-157).
2. **Vision setup** — with `vision=True`, `_handle_vision_mode` turns on vision mode on the loader, or substitutes a `DocumentLoaderLLMImage` when no loader is present (extractor.py:1398-1409).
3. **Loading** — `get_document_loader(source)` picks a loader (see boundaries), then `loader.load(source)` returns page dicts. A `List` source is loaded per item and merged with a `"--- Document Separator ---"` join; total pages are counted (extractor.py:238-287).
4. **Normalization** — `_map_to_universal_format` converts loader output into `{"content": str, "images": [bytes], "metadata": {...num_pages...}}`, handling page lists, legacy dicts, strings, and spreadsheet pages (extractor.py:337-432).
5. **Token sizing** — the Extractor calls `llm.set_page_count(...)` from `metadata["num_pages"]`, which recomputes the thinking budget (extractor.py:303-314; llm.py:155-181).
6. **Prompting** — `_extract` runs LLM interceptors, builds a fixed system message ("You are a server API that receives document information and returns specific fields in JSON format") plus a user message containing `##Content` (and `image_url` parts when vision), then dispatches by completion strategy (extractor.py:1115-1147, 1332-1366).
7. **LLM call** — `LLM.request` either passes the Pydantic `response_model` through `instructor.from_litellm(litellm.completion, mode=instructor.Mode.MD_JSON)` for validated output, or (when `is_dynamic`) appends a dynamic structure prompt and parses `<think>`-style output with `extract_thinking_json` (llm.py:79-84, 183-236).
8. **Result** — the validated Pydantic instance is returned to the caller.

`extract_async` is a thin `asyncio.to_thread` wrapper around `extract` (extractor.py:434-462).

## Orchestration flow (`Process`)

`Process` composes classification and splitting around Extractors. Loaders are registered either as one default (`load_document_loader`) or per file type (`set_document_loader_for_file_type`) — the two modes are mutually exclusive and raise `ValueError` (process.py:31-40). `classify()` runs `Extractor.classify` concurrently across an extractor group per layer and applies `ClassificationStrategy.CONSENSUS`/`HIGHER_ORDER`/`CONSENSUS_WITH_THRESHOLD`, falling through layers until one yields a valid answer (process.py:81-125). `split()` requires a loaded splitter and ≥2 pages, then produces `DocGroup` page-index lists via eager or lazy strategies (process.py:205-238). `extract()` re-loads all pages, slices them per doc group, sets `set_skip_loading(True)` on the matched extractor so pre-processed pages are passed directly, and gathers results with `asyncio` (process.py:240-309).

## Ownership boundaries

- **Loader choice** is owned by `Extractor.get_document_loader` (primary loader if `can_handle`, then extension map, then capability scan, `DocumentLoaderData` for list/dict sources, `DocumentLoaderLLMImage` when `allow_vision`) — extractor.py:92-126 — while **capability detection** is owned by the `DocumentLoader` base: extension checks for paths and `libmagic` MIME sniffing for `BytesIO` (document_loader.py:49-82).
- **Page counts and thinking budgets** are set by the Extractor but computed by `LLM.set_page_count` (llm.py:155-181).
- **Error mapping** is owned by the Extractor: `IncompleteOutputException`, `ValidationError`, and `JSONDecodeError` become `ExtractThinkerError` under `FORBIDDEN`; `litellm.BadRequestError` in vision mode becomes `VisionError` (extractor.py:320-335, utils.py:542-563, exceptions.py:1-11).
- **Completion strategy dispatch** appears twice: pre-load in `extract` (extractor.py:235-236, 464-504) and post-message-build in `_extract` (extractor.py:1132-1143).

## Batch path

`Extractor.extract_batch` builds per-source chat messages (text or base64 image) and hands them to `instructor.batch.BatchJob` wrapped by `extract_thinker/batch_job.py`, which writes JSONL into `./extract_thinker_batch`, uploads via the OpenAI client (API key from `OPENAI_API_KEY`), creates a batch, and polls with 60-second sleeps; it is gated to `BATCH_SUPPORTED_MODELS` (GPT-4 family) and rejects the `PYDANTIC_AI` backend (extractor.py:945-1098, batch_job.py:11-46).

## Known rough edges (source-observed)

- `_validate_dependencies` references the name `Contract` (extractor.py:156) but never imports it; a non-Pydantic `response_model` therefore raises `NameError` rather than the intended `ValueError`.
- `LoaderInterceptor`s registered via `add_interceptor` are stored but never invoked anywhere in the package; only `LlmInterceptor.intercept(self.llm)` is called (extractor.py:61-71, 1122-1124). Interceptor ABCs themselves declare `process(...)`, not `intercept(...)` (document_loader/llm_interceptor.py), so conforming interceptors must add an `intercept` method.
- Duplicate doc-group containers exist (`models/doc_group.py` and `models/doc_groups.py`); `Process` uses the `DocGroups` from `doc_groups.py`, while splitters use the identically-named classes in `doc_group.py` (process.py:13-15, splitter.py:6).
- `global_models.py` returns the same Gemini model for both `get_lite_model()` and `get_big_model()` (global_models.py:1-12).

## Related pages

- Core pipeline: `core/extractor.md`, `core/llm-integration.md`, `core/document-loaders.md`, `core/completion-strategies.md`, `core/process-orchestration.md`
- Features and operations: `features/markdown-conversion.md`, `eval/evaluation-framework.md`, `operations/ci-packaging-testing.md`
- Maintenance: `guides/change-playbooks.md`, `/openwiki/quickstart.md`
