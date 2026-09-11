---
type: operations-workflow
title: Batch Processing
description: extract_batch and BatchJob — OpenAI-only batch constraints, JSONL staging and upload, asynchronous status polling, destructive result retrieval, and cancellation.
tags: [batch, openai, async, polling, jsonl]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:40:03.572Z
sources:
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-aea937801f02b6f87071428c
    resource: repo://tests/test_batch_extractor.py
generated: { by: "opencode", at: "2026-09-11T09:40:03.572Z" }
---

# Batch Processing

Batch extraction moves many requests off the critical path to the OpenAI Batch API at lower cost — at the price of a dedicated, model-restricted and provider-restricted workflow.

## extract_batch

`Extractor.extract_batch(source, response_model, vision, content, output_file_path, batch_file_path)` (extract_thinker/extractor.py:945-1098):

- **Model gating**: requires an LLM; refuses `LLMEngine.PYDANTIC_AI` ("Batch processing is not supported with the PYDANTIC_AI backend..."), and refuses any model not containing one of `BATCH_SUPPORTED_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4o-2024-08-06", "gpt-4"]` checked by substring against the lowercased model name (extract_thinker/extractor.py:40-45, 969-983, 1100-1113).
- **File staging**: creates `<cwd>/extract_thinker_batch/`, generates `input_<uuid>.jsonl` and `output_<uuid>.jsonl` (overridable via `batch_file_path`/`output_file_path`), and errors if either provided-or-generated path already exists (extract_thinker/extractor.py:985-1004).
- **Message assembly**: a generator yields one message list per source — the same system line as normal extraction; vision mode base64-encodes image bytes; text mode loads via `self.document_loader` and formats pages with `_format_pages_to_content` (which groups spreadsheet sheet data, extract_thinker/extractor.py:1411-1428), prepending `##Extra Content` when `content` is present.
- Returns a `BatchJob` immediately; creation itself performs network calls (upload + job creation) and raises `ValueError` if the file upload or batch create fails (extract_thinker/batch_job.py:40-46).

## BatchJob internals

`BatchJob` (extract_thinker/batch_job.py:11-212) is OpenAI-exclusive:

- Writes JSONL through `instructor.batch.BatchJob.create_from_messages` with the response model, then **rewrites every line** into OpenAI batch-request form (`{"custom_id", "method": "POST", "url": "/v1/chat/completions", "body": {...}}`, extract_thinker/batch_job.py:48-70).
- Uploads the file with `purpose="batch"` and creates a batch with `endpoint="/v1/chat/completions"` and `completion_window="24h"` (extract_thinker/batch_job.py:72-96).
- Construction reads `OPENAI_API_KEY` from the environment at module/argument evaluation time — a missing key surfaces as an OpenAI client error, not an ExtractThinker-typed error.

## Status and results

- `get_status()` maps OpenAI states into simplified strings: validating→queued, in_progress/finalizing/cancelling→processing, completed→completed, failed/expired/cancelled→failed, unknown→failed; errors also report "failed" (extract_thinker/batch_job.py:98-125).
- `get_result()` is **a polling loop** with `SLEEP_TIME = 60` seconds between checks that blocks until completed, raising `ValueError("Batch job failed")` on failed status (extract_thinker/batch_job.py:127-173). On completion it downloads the output file via the OpenAI files API, writes it to `output_path`, parses through instructor's `parse_from_file`, and — despite the docstring promising a tuple `(parsed, unparsed)` — returns only `parsed[0]`, discarding additional parsed rows and unparsed items (extract_thinker/batch_job.py:165-170). All exceptions are rewrapped as `ValueError(f"Failed to process output file: {e}")`.
- **Cleanup is destructive**: the `finally` block removes both JSONL files and the batch directory if empty (`_cleanup_files`), and `__del__` repeats cleanup at garbage collection (extract_thinker/batch_job.py:174-208). After `get_result` or `cancel`, both your staged files are gone — copy anything you need first.
- `cancel()` cancels via the API, cleans files, and returns a bool; API failure prints and returns False (extract_thinker/batch_job.py:177-193).

## Operational caveats

- Results polling is 60-second granularity with no backoff/jitter; long jobs call `batches.retrieve` once per minute.
- `get_status`/`get_result` are async methods; call them from `asyncio.run(...)` as the tests do (tests/test_batch_extractor.py:24-28).
- Tests are live-integration: they require `TESSERACT_PATH`, a `gpt-4o-mini` billing account, and fixture `tests/test_images/invoice.png`; no hermetic mock exists in the repository — treat any claim of offline batch testing as unverified.

## Representative tests

- tests/test_batch_extractor.py: single-source batch assertion of extracted invoice fields, plus a cancel flow asserting cleanup of `tests/batch_input.jsonl`/`tests/batch_output.jsonl` files.
