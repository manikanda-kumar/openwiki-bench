---
type: concept
title: Batch Processing
description: How ExtractThinker performs model-gated batch extraction via OpenAI Batch API through Extractor.extract_batch and the BatchJob lifecycle.
tags: [batch, openai, extraction, batchjob, instructor]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:22:48.987Z
sources:
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
generated: { by: "opencode", at: "2026-09-12T21:22:48.987Z" }
---

# Batch Processing

ExtractThinker provides batch extraction through `Extractor.extract_batch`, which delegates to the OpenAI Batch API via the `BatchJob` class and Instructor's batch utilities. Batch processing is **model-gated**: only specific OpenAI model identifiers are supported, and the pydantic-ai backend is explicitly rejected.

## Model eligibility

`Extractor.BATCH_SUPPORTED_MODELS` lists the supported model strings, which currently include `"gpt-4o-mini"`, `"gpt-4o"`, `"gpt-4o-2024-08-06"`, and `"gpt-4"` (`extract_thinker/extractor.py:40-45`).

`extract_batch` raises a `ValueError` if:

- No LLM is set (`extract_thinker/extractor.py:969-970`).
- The LLM backend is `LLMEngine.PYDANTIC_AI` (`extract_thinker/extractor.py:973-977`).
- The model is not supported, per `can_handle_batch`, which returns true only if the current model name contains one of the supported strings (`extract_thinker/extractor.py:979-983,1100-1113`).

## Message generation

`extract_batch` accepts a single source or a list of sources. It wraps sources into a generator `get_messages()` that yields one message list per source (`extract_thinker/extractor.py:1024-1087`):

- In **vision mode**, each source (file path or IO stream) is read and base64-encoded as a `data:image/jpeg;base64,...` image_url message; optional `extra_content` is prepended as text.
- In **non-vision mode**, sources are loaded through the extractor's DocumentLoader, converted to content via `_format_pages_to_content`, and wrapped in a `##Content` message block; optional extra content is prepended.

Before creating the job, `extract_batch` creates a directory `extract_thinker_batch` under the current working directory and generates unique UUID-based input/output file paths unless caller-provided. It raises `ValueError` if either path already exists (`extract_thinker/extractor.py:986-1004`).

## BatchJob lifecycle

`BatchJob.__init__` (`extract_thinker/batch_job.py:11-46`):

1. Uses `InstructorBatchJob.create_from_messages` to produce a base `.jsonl` file.
2. Calls `_add_method_to_file`, which rewrites each JSONL line into OpenAI's batch request format carrying `custom_id`, `method: POST`, `url: /v1/chat/completions`, and a `body` with `model`, `messages`, `max_tokens`, `temperature`, `tools`, and `tool_choice`.
3. Calls `_upload_file` to upload the `.jsonl` via the OpenAI Files API (`purpose="batch"`); raises `ValueError("Failed to upload file")` on failure.
4. Calls `_create_batch_job` via the OpenAI Batches API with endpoint `/v1/chat/completions` and a `completion_window="24h"`; raises `ValueError("Failed to create batch job")` on failure.

### Status polling

`get_status()` (`extract_thinker/batch_job.py:98-111`) retrieves the batch and maps OpenAI status strings to simplified values via `_map_status` (`:113-125`): `validating` → `queued`, `in_progress`/`finalizing`/`cancelling` → `processing`, `completed` → `completed`, and `failed`/`expired`/`cancelled` → `failed`. On any exception it returns `"failed"`.

### Result retrieval

`get_result()` (`extract_thinker/batch_job.py:127-175`) polls every `SLEEP_TIME` (60) seconds until the status is `completed` or `failed`. On failure it raises `ValueError("Batch job failed")`. On completion it downloads the output file, writes it to `output_path`, and uses `InstructorBatchJob.parse_from_file` to parse results into `response_model`, returning the parsed element. Errors are wrapped as `ValueError(f"Failed to process output file: {e}")`.

### Cancellation and cleanup

`cancel()` (`:177-193`) cancels the OpenAI batch and cleans up temp files, returning `True` on success or `False` if no job exists or cancellation errors. `_cleanup_files` (`:195-208`) removes the input/output files and, if the parent directory becomes empty, removes it. `BatchJob.__del__` also triggers `_cleanup_files`.

## Unsaved uncertainty

Batch processing requires a valid `OPENAI_API_KEY` environment variable (seed by default in `BatchJob.__init__`) and will fail at upload time if absent or invalid. Runtime behavior beyond the repo (OpenAI batch latency, 24-hour completion window semantics) is determined by the OpenAI service and is not asserted here.
