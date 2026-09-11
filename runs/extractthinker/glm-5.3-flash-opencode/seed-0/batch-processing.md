---
type: batch-processing
title: Batch Processing via OpenAI Batch API
description: How Extractor.extract_batch and BatchJob submit extraction work to the OpenAI Batch API, including model gating, JSONL creation, status polling, result parsing, cancellation, and cleanup.
tags: [batch, openai, async, operations]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T08:46:09.069Z
sources:
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-aea937801f02b6f87071428c
    resource: repo://tests/test_batch_extractor.py
generated: { by: "opencode", at: "2026-09-11T08:46:09.069Z" }
---

# Batch Processing via OpenAI Batch API

ExtractThinker supports deferred, lower-cost extraction through the OpenAI Batch API. The flow is: `Extractor.extract_batch(...)` builds messages for every source, writes them to a JSONL file, uploads it, and creates a batch; the returned `BatchJob` object then polls status and parses results asynchronously.

## Entry point: `Extractor.extract_batch`

`extract_batch(source, response_model, vision=False, content=None, output_file_path=None, batch_file_path=None)` returns a `BatchJob` (`extract_thinker/extractor.py:945-1098`). It enforces two gates before doing any work:

1. **Backend gate** — if the LLM's backend is `LLMEngine.PYDANTIC_AI`, batch processing is rejected with a message directing users to GPT-4o models and the default backend (`extract_thinker/extractor.py:972-977`).
2. **Model gate** — `can_handle_batch()` requires the configured model name to contain one of `BATCH_SUPPORTED_MODELS`: `gpt-4o-mini`, `gpt-4o`, `gpt-4o-2024-08-06`, `gpt-4` (substring match, case-insensitive) (`extract_thinker/extractor.py:40-45`, `extract_thinker/extractor.py:1100-1113`).

An LLM must be configured or `ValueError` is raised (`extract_thinker/extractor.py:969-970`).

## File layout and working directory

By default the batch artifacts live under `extract_thinker_batch/` in the current working directory, with UUID-unique filenames `input_<uuid>.jsonl` and `output_<uuid>.jsonl` (`extract_thinker/extractor.py:985-999`). Callers may pass explicit `batch_file_path`/`output_file_path` instead; either way, if either path already exists, `ValueError` is raised to avoid clobbering (`extract_thinker/extractor.py:1001-1004`).

For list sources, page count is estimated as the number of sources and pushed onto the LLM via `set_page_count` (relevant only for thinking mode) (`extract_thinker/extractor.py:1014-1022`).

## Message construction

A generator produces one OpenAI-style message list per source (`extract_thinker/extractor.py:1024-1087`):

- Every request starts with the same system prompt used in normal extraction: "You are a server API that receives document information and returns specific fields in JSON format."
- **Vision mode** reads each source as raw bytes (file path or IO stream), base64-encodes it, and builds a `image_url` content part; optional `content` is inserted as a leading text part (`extract_thinker/extractor.py:1033-1063`).
- **Non-vision mode** loads each source through `self.document_loader` and formats the pages with `_format_pages_to_content`, which joins page `content` values with blank lines, or, for spreadsheets, builds `{"data": {sheet_name: data}, "is_spreadsheet": True}` (`extract_thinker/extractor.py:1064-1085`, `extract_thinker/extractor.py:1411-1428`). Non-existent file paths are treated as literal text content (`extract_thinker/extractor.py:1066-1071`).
- Optional `content` is prepended as `##Extra Content\n\n...` before the `##Content` block (`extract_thinker/extractor.py:1078-1080`).

Note that in non-vision mode the loader call does not go through the `get_document_loader` selection logic — it uses `self.document_loader` directly, so batch extraction requires a primary loader to be set.

## BatchJob lifecycle

`BatchJob.__init__` performs the entire submission synchronously (`extract_thinker/batch_job.py:11-46`):

1. `instructor.batch.BatchJob.create_from_messages` writes the messages to the input JSONL file with `custom_id`, model, messages, max_tokens, temperature, and tool fields.
2. `_add_method_to_file` rewrites the JSONL into OpenAI's batch request format, wrapping each record as `{"custom_id", "method": "POST", "url": "/v1/chat/completions", "body": {...}}` (`extract_thinker/batch_job.py:48-70`).
3. `_upload_file` uploads the file with purpose `"batch"` via the OpenAI Python client (`extract_thinker/batch_job.py:72-83`).
4. `_create_batch_job` creates the batch against endpoint `/v1/chat/completions` with a **24-hour completion window** (`extract_thinker/batch_job.py:85-96`).

If upload or batch creation fails, `ValueError` is raised immediately. The OpenAI client is constructed with `OPENAI_API_KEY` from the environment captured at import time of the module default (`extract_thinker/batch_job.py:19-25`).

## Status, results, and cancellation

- `get_status()` retrieves the batch and maps OpenAI's statuses to a simplified set: `validating→queued`, `in_progress/finalizing/cancelling→processing`, `completed→completed`, `failed/expired/cancelled→failed`; unknown statuses map to `failed` (`extract_thinker/batch_job.py:98-125`).
- `get_result()` polls every 60 seconds (`SLEEP_TIME`) until `completed`, raising `ValueError("Batch job failed")` on failure. It then downloads the output file, writes it to `output_path`, parses it with `instructor`'s `parse_from_file` against the original `response_model`, and returns `parsed[0]` (`extract_thinker/batch_job.py:127-175`).
- `cancel()` cancels the batch via the API and triggers cleanup (`extract_thinker/batch_job.py:177-193`).
- `_cleanup_files` removes the input and output files and the batch directory if empty; it runs in the `finally` block of `get_result()` and from `__del__`, so both paths are cleaned whether or not parsing succeeded (`extract_thinker/batch_job.py:195-212`).

## Failure behavior

Every network call in `BatchJob` catches exceptions, prints them, and either returns `None` (turning into a `ValueError` at the call site) or, for `get_status`, degrades to `"failed"` (`extract_thinker/batch_job.py:81-83`, `extract_thinker/batch_job.py:109-111`). `get_result` wraps all post-completion work in a `try/except` that re-raises as `ValueError(f"Failed to process output file: {e}")`, with cleanup guaranteed by `finally` (`extract_thinker/batch_job.py:172-175`).

## Representative tests

`tests/test_batch_extractor.py` exercises the real OpenAI API: `test_batch_extraction_single_source` submits a Tesseract-loaded invoice image with `gpt-4o-mini`, asserts the status is one of `queued`/`processing`/`completed`, and verifies parsed invoice fields; `test_cancel_batch_extraction` cancels a job with explicit file paths and asserts both JSONL files were removed after cancellation (`tests/test_batch_extractor.py:13-56`). These tests require `OPENAI_API_KEY` and a local Tesseract binary (`TESSERACT_PATH`).

## Related pages

- [Extractor: Extraction and Classification Engine](extractor.md)
- [LLM Integration Layer](llm-integration.md)
- [Architecture and Component Map](architecture.md)
