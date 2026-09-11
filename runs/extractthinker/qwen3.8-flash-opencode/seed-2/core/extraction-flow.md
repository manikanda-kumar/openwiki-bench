---
type: workflow
title: "Extraction Flow"
description: "The Extractor pipeline end to end: dependency validation, loader selection order, vision setup, universal content mapping, single-source, list-source merge, and skip-loading paths, message construction, page-count propagation, async wrappers, and error mapping."
tags: [extractor, pipeline, loader-selection, vision, data-flow]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T11:01:32.247Z
sources:
  - id: openwiki-source-0272fd3963ebbd7912866173
    resource: repo://extract_thinker/document_loader/llm_interceptor.py
  - id: openwiki-source-35d2ee2f69deeb57b32d69a5
    resource: repo://extract_thinker/document_loader/loader_interceptor.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-ee28bd363b1cf645a390084a
    resource: repo://tests/test_extractor.py
generated: { by: "opencode", at: "2026-09-11T11:01:32.247Z" }
---

# Extraction Flow

`Extractor` (`extract_thinker/extractor.py`) is the orchestrator that converts a source (file path, stream, page list, or list of sources) plus a Pydantic contract into a validated result via an LLM call. Everything below describes `extract()`; `extract_async()` is the same pipeline in a worker thread via `asyncio.to_thread` (`extractor.py:434-462`).

## Pipeline stages

### 1. Entry normalization and validation

- A `dict` source with no loader configured auto-installs `DocumentLoaderData` — a passthrough loader for already-normalized page dicts (`extractor.py:218-219`, `document_loader/document_loader_data.py:21-90`).
- `_validate_dependencies` requires a document loader (unless `vision=True`), an LLM, and a `BaseModel`/`Contract` response model (`extractor.py:139-157`).
- The call stores `extra_content`, `completion_strategy`, and `allow_vision = vision` on the instance (`extractor.py:221-224`) — note these are mutable instance state, so one `Extractor` is not safe for concurrent differently-configured calls.
- With `vision=True`, `_handle_vision_mode` puts the configured loader into vision mode or, if none exists, installs `DocumentLoaderLLMImage(llm=self.llm)` (`extractor.py:1398-1409`); a `ValueError` here surfaces as `InvalidVisionDocumentLoaderError` (`extractor.py:226-230`).
- With `vision=False` and a list source, image keys are stripped from page dicts (`extractor.py:163-191,232-233`).
- Non-`FORBIDDEN` completion strategies divert into `extract_with_strategy()` before any loading (`extractor.py:235-236`; see completion-strategies page).

### 2. Loader selection

`get_document_loader(source)` resolves in this order (`extractor.py:92-126`):

1. the primary `self.document_loader` if `can_handle(source)`;
2. the extension registry `document_loaders_by_file_type[ext]` (for str paths) if that loader `can_handle`s;
3. any registered loader whose `can_handle` returns true (streams rely on python-magic MIME sniffing — see loader-framework page);
4. `DocumentLoaderData` when the source is a `list`/`dict` (the split pipeline's pre-processed content);
5. `DocumentLoaderLLMImage` when `allow_vision` is set;
6. otherwise `None`, and `extract()` raises `ValueError("No suitable document loader found ...")`.

A stricter sibling, `get_document_loader_for_file`, is used by classification and raises instead of returning `None` (`extractor.py:73-90`).

### 3. Loading and universal mapping

Three loading shapes converge on `_map_to_universal_format` (`extractor.py:337-432`):

- **Single source**: if `_skip_loading` is set (only ever by `Process.extract` after splitting, `process.py:279-291`), the source list *is* the loaded page content; otherwise `loader.load(source)` runs.
- **List of sources**: each element gets its own loader, each result is mapped individually, then contents are joined with the separator `"\n\n--- Document Separator ---\n\n"`, images are concatenated, and metadata records `num_documents` (`extractor.py:238-283`).
- **Legacy/extra formats**: universal dicts pass through (a lone `image` key is promoted to `images`), lists of page dicts join their `content` (with a spreadsheet `Sheet: <name>` guard), strings pass through verbatim, and legacy `{"text": ...}` dicts keep the remaining keys as `metadata` (`extractor.py:353-430`).

The universal shape — `{"content": str, "images": List[bytes], "metadata": {...}}` — is the only format the prompt builder understands.

### 4. Page-count propagation

Before extraction, the LLM is told how many pages are in play: for list sources the page counts in each mapped `metadata.num_pages` are summed (minimum 1 total); for single sources `metadata.num_pages` is read; the value feeds `llm.set_page_count()` which sizes thinking-token budgets and caps (`extractor.py:251-268,303-314`; `llm.py:155-181`).

### 5. Message construction

`_extract` runs all registered `LlmInterceptor`s, builds messages, and injects extra content (`extractor.py:1115-1141`):

- system turn: `"You are a server API that receives document information and returns specific fields in JSON format."` (`extractor.py:1345-1348`);
- user turn: vision mode gets a content list — a `##Content` text part (list pages joined; spreadsheets rendered with `json_to_formatted_string`, other dicts YAML-dumped) followed by one `data:image/jpeg;base64,...` `image_url` part per image (`extractor.py:1149-1182,1256-1330`); text mode gets one joined string (`extractor.py:1224-1254`);
- an `extra_content` argument inserts a separate user turn `"##Extra Content\n\n..."` at position 1, YAML-serialized when it is a dict (`extractor.py:1368-1389`).

### 6. Request and result flow

With the default `FORBIDDEN` strategy the messages go straight to `llm.request(messages, response_model)`; instructor validates the JSON into the contract and the parsed model is returned as-is (`extractor.py:1140-1141`). Failures are mapped to `ExtractThinkerError`/`VisionError` per the error contract (see configuration-and-failure-handling page); `tests/test_extractor.py:131-140` pins the wrapper text for an unloadable vision source (`"Failed to extract from source: Cannot handle source"`).

## Wiring caveats

- `Extractor._extract_with_splitting()` (a ThreadPool chunk-and-aggregate path over `split_content`/`aggregate_results`, `extractor.py:825-943`) is **not called anywhere** in the package — token-splitting happens in the completion handlers instead. Do not treat it as live behavior.
- `chunk_height = 1500` is initialized in `__init__` but never read in `extractor.py`.
- `LoaderInterceptor`s can be registered via `add_interceptor`, but no code path ever invokes them; the only live hook is the LLM interceptor loop, which calls `interceptor.intercept(self.llm)` — while the `LlmInterceptor` ABC declares `process(self, messages, response)` (`document_loader/llm_interceptor.py`, `extractor.py:1122-1124`), so custom interceptors must implement `intercept()` despite the ABC.

## Representative tests

`tests/test_extractor.py` exercises the flow with live models: vision vs text loader paths (`test_extract_with_loader_and_vision`, `test_vision_content_pdf`, `test_chart_with_content`), multi-source merging of a PDF plus a URL into one contract (`test_extract_from_multiple_sources`, `tests/test_extractor.py:439-473`), spreadsheet data extraction, URL ingestion via Docling, and the timeout/invalid-path error paths.
