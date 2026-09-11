---
type: concept
title: Extraction Pipeline (Extractor)
description: The Extractor orchestrator — how it validates dependencies, resolves loaders, handles single vs multi-source and vision input, dispatches completion strategies, runs interceptors, and classifies failures.
tags: [extractor, orchestration, vision, error-handling]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:00:08.410Z
sources:
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-11T09:00:08.410Z" }
---

# Extraction Pipeline (Extractor)

`Extractor` (`extract_thinker/extractor.py:39-...`) is the central orchestrator.
It holds a primary document loader, an optional per-file-type loader registry, an
`LLM`, interceptor lists, and extraction flags, and exposes the main entry
points `extract`, `extract_async`, `classify`, `classify_async`, and
`extract_batch`.

## Configuration API

- `load_document_loader(loader)` sets the primary loader
  (`extract_thinker/extractor.py:128-129`).
- `load_llm(model)` accepts either an `LLM` instance or a model string (wrapping
  it in `LLM(model)`); passing `None` raises `ValueError`
  (`extract_thinker/extractor.py:131-137`).
- `add_interceptor(interceptor)` appends to `loader_interceptors` or
  `llm_interceptors` based on type, raising `ValueError` for anything else
  (`extract_thinker/extractor.py:61-71`).
- `enable_thinking_mode(enable)` requires an LLM and forwards to
  `llm.set_thinking` (`extract_thinker/extractor.py:1430-1444`).
- `set_page_count(n)` forwards page counts used for thinking-budget token
  calculations (`extract_thinker/extractor.py:1446-1459`).

## Loader resolution

`get_document_loader(source)` (`extract_thinker/extractor.py:92-126`) resolves a
loader for extraction, in priority order:

1. the primary `self.document_loader` if it `can_handle(source)`;
2. for string paths, the loader registered for the file extension if it can
   handle the source;
3. any loader in `document_loaders_by_file_type` that `can_handle`s the source;
4. `DocumentLoaderData()` when the source is a `list` or `dict` (e.g. content
   coming from splitting);
5. `DocumentLoaderLLMImage()` when `self.allow_vision` is set.

Returns `None` if nothing matches, which makes `extract` raise
`ValueError("No suitable document loader found for the input.")`.

`get_document_loader_for_file(source)` (`extract_thinker/extractor.py:73-90`) is
the classifier variant: extension lookup in `document_loaders_by_file_type`,
then primary, then any registered loader; it raises `ValueError` directly when
no loader matches. `Extractor.classify` uses this method.

## Dependency validation

`_validate_dependencies(response_model, vision)`
(`extract_thinker/extractor.py:139-157`) enforces:

- a document loader is required unless `vision=True`;
- an LLM is always required;
- `response_model` must be a `BaseModel`/`Contract` subclass.

## Extract paths

`extract(source, response_model, vision=False, content=None, completion_strategy=FORBIDDEN)`
(`extract_thinker/extractor.py:193-335`):

- A dict source with no loader auto-loads `DocumentLoaderData`
  (`extract_thinker/extractor.py:218-219`).
- When `vision=True`, `_handle_vision_mode` enables vision on the primary loader,
  or creates a `DocumentLoaderLLMImage` fallback if no loader is set
  (`extract_thinker/extractor.py:1398-1409`). A `ValueError` raised inside this
  path is wrapped as `InvalidVisionDocumentLoaderError`
  (`extract_thinker/extractor.py:226-230`). In non-vision mode, lists of
  sources have image keys stripped via `remove_images_from_content`.
- A non-FORBIDDEN strategy short-circuits to `extract_with_strategy`
  (`extract_thinker/extractor.py:235-236`), which loads content and hands the
  page list to the strategy's handler
  (`extract_thinker/extractor.py:464-504`).
- **Single source**: if `_skip_loading` is set (used by `Process` splitting,
  where content is already loaded), the source is mapped directly; otherwise the
  resolved loader loads it. Page count is derived from `metadata["num_pages"]`
  (default 1) and pushed to the LLM. `_extract` runs.
- **List source**: each element is loaded and mapped to universal format, page
  counts are summed (from `metadata["num_pages"]` or 1 each) and passed to
  `llm.set_page_count`, and the text is merged with a
  `--- Document Separator ---` marker while images are concatenated
  (`extract_thinker/extractor.py:239-289`).
- `content` (extra content) is stored and later inserted into the messages as
  `"##Extra Content\n\n..."` right after the system message
  (`extract_thinker/extractor.py:1368-1389`).

`extract_async` (`extract_thinker/extractor.py:434-462`) runs the whole
synchronous path in a worker thread via `asyncio.to_thread`.

## Message construction and `_extract`

`_extract` (`extract_thinker/extractor.py:1115-1147`):

1. Runs every `LlmInterceptor` (`interceptor.intercept(self.llm)`) before the
   LLM call.
2. Builds content via `_build_message_content` — a text block
   `"##Content\n\n..."` (or `##Content` plus `image_url` blocks in vision mode,
   where images are collected from page/`images` keys and base64-encoded)
   (`extract_thinker/extractor.py:1149-1182`, `1256-1330`).
3. Builds the message list with the shared system prompt
   ("You are a server API that receives document information and returns
   specific fields in JSON format.") via `_build_messages`
   (`extract_thinker/extractor.py:1332-1366`).
4. Dispatches on `self.completion_strategy`: PAGINATE → `PaginationHandler`,
   CONCATENATE → `ConcatenationHandler`, FORBIDDEN → `self.llm.request(messages,
   response_model)`.

## Failure classification

`extract` catches broadly and normalizes (`extract_thinker/extractor.py:320-335`):

- `IncompleteOutputException` (or validation/JSON-decode errors matching
  "ValidationError"/"JSONDecodeError"/"json_invalid") → `ExtractThinkerError`
  with the FORBIDDEN message;
- vision + `litellm.BadRequestError` → `classify_vision_error` re-raises
  `VisionError` ("Make sure that the model you're using supports vision
  features") (`extract_thinker/utils.py:542-563`);
- everything else → `ExtractThinkerError(f"Failed to extract from source:
  {str(e)}")`.

`_extract` also re-raises `IncompleteOutputException` directly for non-FORBIDDEN
strategies so the strategy handlers can continue the response
(`extract_thinker/extractor.py:1144-1147`).

## Auxiliary helpers

- `split_content(content, max_tokens)` chunks content by paragraphs honoring a
  token budget (`extract_thinker/extractor.py:867-898`), and
  `aggregate_results` merges per-chunk results into a single
  `response_model`, concatenating list fields and keeping first scalar values
  (`extract_thinker/extractor.py:900-943`).
- `_format_pages_to_content` joins page text, returning a
  `{"data": ..., "is_spreadsheet": True}` dict for spreadsheet pages
  (`extract_thinker/extractor.py:1411-1428`).
- `set_skip_loading(skip)` controls the pre-loaded-content path used by
  `Process` extraction (`extract_thinker/extractor.py:159-161`).
