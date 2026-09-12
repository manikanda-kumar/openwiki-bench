---
type: concept
title: Extractor and Extraction Flows
description: The Extractor class in ExtractThinker, covering extraction and classification entrypoints, dependency validation, vision mode, message construction, completion strategy dispatch, batch processing, and error handling.
tags: [extractor, extraction, classification, vision, batch]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:12:00.069Z
sources:
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-12T21:12:00.069Z" }
---

# Extractor and Extraction Flows

`Extractor` (extract_thinker/extractor.py:39) orchestrates the core pipeline:
taking a source, loading it through a `DocumentLoader`, converting it to a
universal format, building LLM messages, and validating the structured reply
against a `response_model` (a `Contract` or Pydantic `BaseModel`).

## Dependencies and validation

An `Extractor` holds a default `document_loader`, an `llm`, and optionally a
`document_loaders_by_file_type` map. `load_document_loader` sets the default,
`load_llm` accepts either a model string or an `LLM` object
(extractor.py:128-137). `_validate_dependencies` requires a document loader
(unless vision mode is set) and an LLM, and that `response_model` is a
`BaseModel`/`Contract` subclass (extractor.py:139-157).

## Extraction flow

`extract` (extractor.py:193-335):

1. If no `document_loader` and the source is a dict, it defaults to
   `DocumentLoaderData`.
2. `_validate_dependencies` runs; `vision` sets `allow_vision`, and in vision
   mode `_handle_vision_mode` sets the loader's vision mode or falls back to a
   new `DocumentLoaderLLMImage` (extractor.py:1398-1409).
3. For a list source, each item is loaded and mapped to universal format, then
   text and images are merged under a `--- Document Separator ---` (extractor.py:239-289).
4. For a single source, the loader loads content, `_map_to_universal_format`
   normalizes it, and the page count is set on the LLM for thinking-mode token
   budgeting (extractor.py:291-316).
5. `_extract` (extractor.py:1115-1147) runs `llm_interceptors`, builds messages
   (system + `##Content` user message, injecting `##Extra Content` when set),
   and dispatches by `completion_strategy`.

## Message construction

`_build_message_content` (extractor.py:1149-1182) and `_build_messages`
(extractor.py:1332-1366) produce either a vision list (text + base64 `image_url`
items) or a plain text user message. Spreadsheet dicts are rendered as formatted
JSON (`json_to_formatted_string`); other dicts are YAML-dumped
(extractor.py:1224-1254). Images are appended via `_append_images`
(extractor.py:1274-1330).

## Classify

`classify` (extractor.py:774-807) loads the input, sets `is_classify_image` for
vision mode, and dispatches to `_classify`. Image mode compares each candidate
against (optionally) reference images one classification at a time and keeps the
highest confidence; text mode uses a single prompt enumerating all classes
(extractor.py:536-772). Results return as a `ClassificationResponse`.

## Batch processing

`extract_batch` (extractor.py:945-1098) builds request messages and uses
`BatchJob` to create an OpenAI batch. It validates that the model is in the
`BATCH_SUPPORTED_MODELS` allowlist and that the backend is not `PYDANTIC_AI`.
`BatchJob` (extract_thinker/batch_job.py:11-212) writes a JSONL input, transforms
it to OpenAI's batch request format, uploads it as a file, creates a batch with
a 24h completion window, and offers `get_status`/`get_result`/`cancel`. The
`get_result` loop polls every 60 seconds and cleans up files on completion or
destruction.

## Error handling

Errors from the LLM are wrapped. Under `FORBIDDEN` strategy,
`IncompleteOutputException`, `ValidationError`, and `JSONDecodeError` all map to
`ExtractThinkerError` ("Incomplete output received and FORBIDDEN strategy is
set"; extractor.py:320-335). Vision-related `litellm.BadRequestError` is
reclassified as `VisionError` via `classify_vision_error`
(extractor.py:332-333, utils.py:542-563). The exception hierarchy is in
extract_thinker/exceptions.py:1-11.
