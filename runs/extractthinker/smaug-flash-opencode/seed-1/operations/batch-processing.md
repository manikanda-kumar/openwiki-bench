---
type: operations
title: Batch Extraction and Management
description: The asynchronous batch extraction path — Extractor.extract_batch, the BatchJob lifecycle over the OpenAI Batch API, JSONL file preparation, status polling, result parsing, and file cleanup.
tags: [batch, openai, batch-job, async, jsonl]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:16:59.187Z
sources:
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
generated: { by: "opencode", at: "2026-09-12T21:16:59.187Z" }
---

# Batch Extraction and Management

For high-throughput processing, ExtractThinker supports OpenAI's asynchronous Batch API. The entry point is `Extractor.extract_batch`, which returns a `BatchJob` object you poll and await asynchronously.

## Entry point: Extractor.extract_batch

`extract_batch(source, response_model, vision=False, content=None, output_file_path=None, batch_file_path=None)` (`extract_thinker/extractor.py:945`):

### Preconditions

- An LLM must be set (`ValueError("LLM is not set...")`).
- The `PYDANTIC_AI` backend is **not supported** for batch operations (`extract_thinker/extractor.py:973`).
- The model must be in `BATCH_SUPPORTED_MODELS` (`extract_thinker/extractor.py:40`): `gpt-4o-mini`, `gpt-4o`, `gpt-4o-2024-08-06`, `gpt-4`. `can_handle_batch` (`extract_thinker/extractor.py:1100`) matches by substring against `self.llm.model.lower()`. Otherwise `ValueError`.
- Output/input file paths must not already exist (the method raises `ValueError` if they do).

### File setup

- Creates an `extract_thinker_batch/` directory in the current working directory (`os.path.join(os.getcwd(), "extract_thinker_batch")`, `extract_thinker/extractor.py:986`).
- Generates unique UUID-based names: `output_<uuid>.jsonl` and `input_<uuid>.jsonl` if no paths are given.
- Sets `self.extra_content = content`.

### Message generation

`get_messages()` (`extract_thinker/extractor.py:1024`) yields one message list per source:

- SYSTEM message: `"You are a server API that receives document information and returns specific fields in JSON format."`
- Vision mode: base64-encodes the source bytes and sends an `image_url` content (plus optional `extra_content` text).
- Text mode: reads the source via `self.document_loader.load(src)`, formats with `_format_pages_to_content`, and wraps as `##Content`.

## BatchJob

`BatchJob` (`extract_thinker/batch_job.py:11`) drives the OpenAI Batch API. Constructor:

```python
BatchJob(messages_batch, model, response_model, file_path, output_path, api_key=os.getenv("OPENAI_API_KEY"))
```

It uses the `OpenAI` client directly (never LiteLLM/instructor for the API calls), and `api_key` defaults to the `OPENAI_API_KEY` env var.

### Lifecycle

1. **JSONL creation**: `InstructorBatchJob.create_from_messages(messages_batch, model, file_path, response_model)` writes the initial `.jsonl` (`extract_thinker/batch_job.py:30`).
2. **Transform to OpenAI batch format**: `_add_method_to_file` (`extract_thinker/batch_job.py:48`) rewrites each line into the OpenAI `custom_id`/`method`/`url`/`body` structure (method `POST`, url `/v1/chat/completions`).
3. **Upload**: `_upload_file` (`extract_thinker/batch_job.py:72`) uploads the file via `client.files.create(..., purpose="batch")`, storing `file_id`. Raises `ValueError("Failed to upload file")` on failure.
4. **Create batch**: `_create_batch_job` (`extract_thinker/batch_job.py:85`) calls `client.batches.create(input_file_id=..., endpoint="/v1/chat/completions", completion_window="24h")`, storing `batch_id`. Raises `ValueError("Failed to create batch job")` on failure.

### Status polling

`get_status()` (`extract_thinker/batch_job.py:98`):

- Retrieves the batch via `client.batches.retrieve(batch_id)` (offloaded with `asyncio.to_thread`).
- Maps OpenAI statuses via `_map_status`: `validating`→`queued`, `in_progress`/`finalizing`→`processing`, `completed`→`completed`, everything else (`failed`, `expired`, `cancelled`)→`failed`.
- Returns `"failed"` on API error.

### Result retrieval

`get_result()` (`extract_thinker/batch_job.py:127`):

- Polls `get_status` every `SLEEP_TIME = 60` seconds until `completed` (raises `ValueError("Batch job failed")` on failure).
- On completion, retrieves `batch.output_file_id`, downloads the output file via `client.files.content`, writes it to `output_path`.
- Parses with `InstructorBatchJob.parse_from_file(output_path, response_model)`, returning `parsed[0]`.
- Cleans up files in a `finally`.

### Cancellation

`cancel()` (`extract_thinker/batch_job.py:177`) cancels the batch via `client.batches.cancel(batch_id)` and cleans up.

### File cleanup

- `_cleanup_files` (`extract_thinker/batch_job.py:195`) removes the input and output JSONL files, then removes the parent directory if empty.
- `__del__` (`extract_thinker/batch_job.py:210`) also calls `_cleanup_files`, so abandoned jobs clean up on GC.

## Usage pattern

```python
batch_job = extractor.extract_batch(source=doc, response_model=ReceiptContract, vision=True)
status = await batch_job.get_status()      # queued / processing / completed / failed
results = await batch_job.get_result()     # parsed[0] once completed
```

## Constraints & caveats

- Requires `OPENAI_API_KEY` (or explicit `api_key`) and a model from `BATCH_SUPPORTED_MODELS`.
- Is async-first: `get_status` and `get_result` are coroutines.
- Polling interval is a fixed 60 seconds (`SLEEP_TIME`, `extract_thinker/batch_job.py:9`).
- Processing is best-effort in that `get_result` raises `ValueError` on any parse failure, but files are always cleaned up.
