---
type: concept
title: "Extraction pipeline: Extractor and the universal content format"
description: "How the Extractor orchestrates source loading, normalization to a universal content dict, prompt building, LLM structured-output requests, vision mode, multi-source merging, completion-strategy dispatch, interceptors, and error mapping."
tags: [extractor, extraction, vision, universal-format, pipeline]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:31:28.803Z
---

# Extraction pipeline: Extractor and the universal content format

The `Extractor` (extract_thinker/extractor.py) is the central orchestrator. Its public surface is `extract`, `extract_async`, `extract_batch`, `classify`, `classify_async`, and `loadfile`/`loadstream`, plus configuration via `load_document_loader`, `load_llm`, `add_interceptor`, `enable_thinking_mode`, and `set_page_count`.

## State and dependencies

An `Extractor` holds:

- a primary `document_loader` (optional at construction) and `document_loaders_by_file_type` (per-extension registry);
- an `llm`;
- `loader_interceptors` and `llm_interceptors` lists, populated through `add_interceptor` which raises `ValueError` for other types;
- per-call flags: `is_classify_image`, `_skip_loading`, `allow_vision`, `extra_content`, `completion_strategy`.

`_validate_dependencies` (extractor.py) requires a document loader (unless `vision=True`), an LLM, and a `response_model` that is a subclass of Pydantic `BaseModel` or `Contract`, raising `ValueError` otherwise.

## Loading and the universal format

`extract` maps any source through the loaders into a single **universal content dict**:

```python
{"content": str, "images": List[bytes], "metadata": {}}
```

`_map_to_universal_format` (extractor.py) normalizes the four possible loader outputs:

- `None` -> empty content;
- already-universal dicts -> normalized (`image` folded into `images`);
- a list of page dicts -> `content` joined with `"\n\n"`, `images` collected (only when `vision=True`), and `metadata.num_pages` set; spreadsheet pages additionally get their sheet name appended;
- a plain `str` -> `{"content": str, ...}`;
- legacy dicts -> `text` (list joined with newlines) plus non-text keys preserved as metadata.

Unsupported shapes raise `ValueError`.

For a **list source**, each element is loaded with its own loader (`get_document_loader`), mapped to universal format, and merged: text joined with `"\n\n--- Document Separator ---\n\n"`, all images concatenated, `metadata.num_documents` set, and an optional `content` argument prepended. The merged page count is pushed to the LLM via `llm.set_page_count(max(1, total_pages))`. For a single source the page count is derived from `metadata.num_pages` (defaulting to 1) and also passed to the LLM.

`_skip_loading` is an internal flag that `Process.extract` sets while passing already-loaded page groups, so the source list is mapped directly instead of being reloaded.

## Vision mode

When `vision=True`:

- `_handle_vision_mode` enables vision mode on the primary loader, or, if no loader is set, constructs a `DocumentLoaderLLMImage(llm=self.llm)` and enables vision on it; a failure surfaces as `InvalidVisionDocumentLoaderError`.
- `_build_message_content` adds a `##Content` text block from `_process_content_data` and appends every page image as base64 `image_url` parts (`_append_images`).
- `_build_messages` keeps images structured (list content) rather than joining strings.
- On failure, `is_vision_error` / `classify_vision_error` (utils.py) re-raise `litellm.BadRequestError` as `VisionError` ("Make sure that the model you're using supports vision features") only when `vision` is true, otherwise re-raise the original exception.

Vision extraction with and without an explicit loader is exercised in `tests/test_extractor.py` (`test_extract_with_pypdf_and_gpt4o_mini_vision`, `test_vision_content_pdf`).

## Prompt building and completion-strategy dispatch

`_extract` runs `llm_interceptors` (which intercept the LLM, not per-request messages), builds messages with `_build_messages`, optionally injects `extra_content` as a user message right after the system message (`_add_extra_content`), then dispatches on `self.completion_strategy`:

- `FORBIDDEN` -> `self.llm.request(messages, response_model)`;
- `PAGINATE` -> `PaginationHandler(self.llm).handle(messages, response_model, vision, extra_content)`;
- `CONCATENATE` -> `ConcatenationHandler(self.llm).handle(...)`;

see [completion strategies](completion-strategies.md). The system prompt is always `"You are a server API that receives document information and returns specific fields in JSON format."`.

## Error handling

`extract` catches and normalizes failures:

- instructor `IncompleteOutputException` and any `ValidationError`, `JSONDecodeError`, or `json_invalid` signal -> `ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")` (this only surfaces on the FORBIDDEN path).
- vision `litellm.BadRequestError` -> `VisionError` via `classify_vision_error`.
- anything else -> `ExtractThinkerError(f"Failed to extract from source: {str(e)}")`.

`extract_async` is `asyncio.to_thread(self.extract, ...)`; it does not add its own event loop.

The exception hierarchy (extract_thinker/exceptions.py) is `ExtractThinkerError` -> `VisionError` -> `InvalidVisionDocumentLoaderError`.

## Async and classification entry points

- `classify`/`classify_async` run single-pass classification (see [classification](classification.md)).
- `extract_batch` creates an OpenAI Batch API job (see [batch processing](../operations/batch-processing.md)); it rejects the `PYDANTIC_AI` backend and models outside `BATCH_SUPPORTED_MODELS`.

`tests/test_document_loader_base.py` and `tests/test_extractor.py` document the loader/extractor contract end to end, including the invalid-path failure, timeout behavior, both LLM backends, and thinking mode.