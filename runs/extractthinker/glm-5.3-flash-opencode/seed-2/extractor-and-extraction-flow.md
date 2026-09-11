---
type: flow
title: Extractor and Extraction Flow
description: The complete Extractor pipeline — dependency validation, loader resolution, universal content mapping, multi-source merging, message construction, interceptors, and error mapping to ExtractThinkerError.
tags: [extractor, extraction, flow, error-handling, interceptors, vision]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:45:03.808Z
sources:
  - id: openwiki-source-0272fd3963ebbd7912866173
    resource: repo://extract_thinker/document_loader/llm_interceptor.py
  - id: openwiki-source-35d2ee2f69deeb57b32d69a5
    resource: repo://extract_thinker/document_loader/loader_interceptor.py
  - id: openwiki-source-80ac776afff46dd86a9f455f
    resource: repo://extract_thinker/exceptions.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
generated: { by: "opencode", at: "2026-09-11T09:45:03.808Z" }
---

# Extractor and Extraction Flow

`Extractor` (`extract_thinker/extractor.py#L39-L60`) is the per-document workhorse. It owns one optional `document_loader` and `llm`, a registry of per-file-type loaders, interceptor lists, and knobs (`chunk_height=1500`, `allow_vision`).

## Dependency validation

`extract()` first runs `_validate_dependencies` (`extract_thinker/extractor.py#L139-L157`):

- `document_loader` must be set **unless** `vision=True` (pure-vision requests don't need a text loader).
- `llm` must be set.
- `response_model` must be a `BaseModel`/`Contract` subclass.

## Source routing (`extract`, `#L193-L335`)

`extract(source, response_model, vision=False, content=None, completion_strategy=FORBIDDEN)` branches on source shape:

1. **Dict source**: falls back to `DocumentLoaderData` if no loader configured (`#L218-L219`).
2. **Vision=True**: goes through `_handle_vision_mode`, and loader-validation failures are re-raised as `InvalidVisionDocumentLoaderError` (`#L226-L230`).
3. **List source + non-FORBIDDEN strategy** or any non-FORBIDDEN strategy: delegated to `extract_with_strategy` (`#L235-L236`).
4. **List source, FORBIDDEN**: each item is loaded, mapped to universal format, and merged — page counts summed, texts joined with `"\n\n--- Document Separator ---\n\n"`, image lists concatenated — then extracted once (`#L239-L289`). Images are stripped from list contents before merging unless in vision mode (`remove_images_from_content`, `#L163-L191`).
5. **Single source**: load → `_map_to_universal_format` → `_extract`. A `_skip_loading` flag (set by `Process.extract` for already-loaded page groups, `extract_thinker/process.py#L280-L292`) bypasses the loader.
6. **Async variant**: `extract_async` simply wraps `extract` with `asyncio.to_thread` (`#L434-L462`).

Multiple-source merges also set `llm.set_page_count(total_pages)` using each document's metadata `num_pages` or a default of 1 (`#L251-L268`).

## Universal format and message construction

`_map_to_universal_format` (`#L337-L432`) produces `{"content": str, "images": list, "metadata": {...}}`, handling already-universal dicts, lists of page dicts (with spreadsheet sheet names), raw strings, and a legacy dict shape. `_extract` (`#L1115-L1147`) then:

1. Runs each `LlmInterceptor` (`interceptor.intercept(self.llm)`) before building messages.
2. Builds content strings — vision mode collects page texts and base64-images each `image`/`images` key into `image_url` blocks (`_add_images_to_message_content`/`_append_images`, `#L1249-L1367`); text mode YAML-serializes dict content (`_convert_content_to_string`, `#L1224-L1263`).
3. `_build_messages` (`#L1369-L1403`) frames both shapes with a fixed system prompt: "You are a server API that receives document information and returns specific fields in JSON format." Vision requests put the mixed content list in one user message; text requests join content into a single string.
4. Appends `extra_content` (YAML-dumped if dict) via `_add_extra_content`.
5. Dispatches by strategy: handlers for PAGINATE/CONCATENATE; for FORBIDDEN a single `llm.request(messages, response_model)` call.

## Interceptor seams

Two ABCs exist (`extract_thinker/document_loader/loader_interceptor.py`, `llm_interceptor.py`):

- `LoaderInterceptor.process(file, content)` — abstract loader-side hook (declared; loader interception wiring is minimal in current source).
- `LlmInterceptor` — `interceptor.intercept(self.llm)` is actually invoked in `_extract` before every LLM request (#L1122-L1124), enabling model substitution or request inspection.

## Error mapping (`#L318-L335`)

Extraction failures are normalized:

- `IncompleteOutputException` (or wrapped inside `e.args[0]`) → `ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")`.
- Pydantic `ValidationError`, `JSONDecodeError`, or substring matches for "ValidationError"/"JSONDecodeError"/"json_invalid" → same incomplete-output error.
- Vision errors are classified by `is_vision_error`/`classify_vision_error` (`extract_thinker/utils.py`) into model-specific guidance (e.g., missing image support in the configured model).
- Everything else → `ExtractThinkerError(f"Failed to extract from source: {str(e)}")`.

This means low-level library errors rarely escape raw; callers program against `ExtractThinkerError` and the two vision-specific exceptions (`extract_thinker/exceptions.py`).

## Batch entry

`Extractor` also hosts `extract_batch`/`can_handle_batch`; see [Batch Processing](/openwiki/batch-processing.md).

## Tests

`tests/test_extractor.py` covers vision content, chart extraction, invalid paths, strategies, backends, multi-source extraction, and spreadsheet data (`tests/test_extractor.py#L43-L493`). Integration tests against live models.

Related: [Document Loaders](/openwiki/document-loaders.md) · [Completion Strategies](/openwiki/completion-strategies.md) · [LLM Layer](/openwiki/llm-layer.md)
