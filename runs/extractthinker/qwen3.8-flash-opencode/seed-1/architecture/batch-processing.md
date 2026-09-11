---
type: subsystem
title: "Batch Processing"
description: "Extractor.extract_batch and BatchJob: an OpenAI Batch-API pipeline with JSONL temp files, status polling, instructor parsing, and destructor-driven cleanup."
tags: [batch, openai, extractor, lifecycle, operations]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T10:24:25.212Z
sources:
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-32885aef730037c65f8bfa30
    resource: repo://extract_thinker/models/batch_result.py
  - id: openwiki-source-2733f24ab801767d8ffbc546
    resource: repo://extract_thinker/models/batch_status.py
  - id: openwiki-source-aea937801f02b6f87071428c
    resource: repo://tests/test_batch_extractor.py
generated: { by: "opencode", at: "2026-09-11T10:24:25.212Z" }
---

# Batch Processing

Batch extraction sends many documents through OpenAI's Batch API instead of synchronous chat completions. Two units own this path: `Extractor.extract_batch` builds the request payloads and job parameters (`extract_thinker/extractor.py:945-1098`), and `BatchJob` owns the upload/poll/parse/cleanup lifecycle against the OpenAI client (`extract_thinker/batch_job.py`).

## Preconditions

`extract_batch` refuses to start unless all of these hold, each as a plain `ValueError`:

- `self.llm` is set;
- the LLM backend is **not** `LLMEngine.PYDANTIC_AI` ("Batch processing is not supported with the PYDANTIC_AI backend");
- `can_handle_batch()` is true, which is a substring test of the model string against the class constant `BATCH_SUPPORTED_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4o-2024-08-06", "gpt-4"]` (case-insensitive `in` checks, so `openai/gpt-4o` also passes).

The check is purely name-based; nothing in this module verifies the model actually exists.

## Local file layout

`extract_batch` creates `extract_thinker_batch/` under the current working directory (`os.path.join(os.getcwd(), ...)`) and, unless the caller passes `output_file_path`/`batch_file_path`, generates UUID-named `input_<uuid>.jsonl` / `output_<uuid>.jsonl` files there. Provided paths that already exist are rejected with `File already exists`. It also sets an estimated page count on the LLM (number of sources, else 1) before job construction.

## Message building

The `get_messages()` generator yields one chat-completion message list per source:

- **Vision sources** must be existing file paths or readable streams; raw bytes are base64-inlined as a `data:image/jpeg` URL, with optional `extra_content` prepended as a text part.
- **Text sources** that exist as paths are loaded through `self.document_loader.load(...)` and flattened by `_format_pages_to_content` (spreadsheet pages become a `{data, is_spreadsheet}` dict, everything else joins page `content` with blank lines). A string that is *not* an existing path is sent as literal content.

The batch runs against `self.llm.model`, so the model string is interpreted by the OpenAI Batch API verbatim — this path talks to `openai.OpenAI` directly (default key from `OPENAI_API_KEY`), not through litellm, regardless of any provider prefix in the model string.

## Job lifecycle (`BatchJob`)

1. Instructor's `BatchJob.create_from_messages` writes the JSONL input file; `_add_method_to_file` then rewrites every line into OpenAI batch format (`{"custom_id", "method": "POST", "url": "/v1/chat/completions", "body": {...}}`), keeping only model/messages/max_tokens/temperature/tools/tool_choice from the instructor-generated body.
2. `_upload_file` (purpose `"batch"`) and `_create_batch_job` (endpoint `/v1/chat/completions`, `completion_window="24h"`) run eagerly in the constructor; failures print the error and raise `ValueError("Failed to upload file")` / `"Failed to create batch job"`.
3. `get_status()` retrieves the batch and maps provider statuses to four states: `validating→queued`, `in_progress/finalizing/cancelling→processing`, `completed→completed`, `failed/expired/cancelled→failed` (unknown statuses also map to `failed`, as does any exception during retrieval).
4. `get_result()` polls `get_status()` every 60 seconds (`SLEEP_TIME = 60`) until `completed`, raises on `failed`, downloads `batch.output_file_id` content to the local output path, and parses it with `InstructorBatchJob.parse_from_file`. **Only `parsed[0]` is returned** — a single object, not a list, even when multiple sources were submitted; per-source results beyond the first are dropped by this API. Cleanup of the local temp files happens in a `finally` block.
5. `cancel()` calls the OpenAI cancel endpoint, cleans files, and returns a bool; `_cleanup_files` removes input/output files and the batch directory if empty, and is also wired to `__del__` so garbage collection triggers cleanup.

## Models not used by this path

`models/batch_result.py` (`BatchResult`) and `models/batch_status.py` (`BatchStatus`) define Pydantic shapes for batch results/status, but no module in the package imports them, and they are not exported from `extract_thinker/__init__.py`; `BatchJob` works with raw strings and instructor parsing instead. Treat them as vestigial until referenced.

## Focused tests

`tests/test_batch_extractor.py` exercises the real lifecycle against OpenAI: `test_batch_extraction_single_source` asserts the status is one of `queued/processing/completed` and then checks parsed invoice fields via `get_result`; `test_cancel_batch_extraction` verifies `cancel()` returns True and the input/output JSONL files are removed. Both require live credentials and (for the loader) `TESSERACT_PATH`, so they are network tests, not offline unit coverage.

See also: [Extractor Core](/openwiki/architecture/extractor.md) for how `extract_batch` fits the Extractor surface, and [Testing, CI & Release](/openwiki/operations/testing-ci-release.md) for how these live tests relate to CI.
