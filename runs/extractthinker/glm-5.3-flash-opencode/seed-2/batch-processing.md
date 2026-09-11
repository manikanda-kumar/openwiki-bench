---
type: workflow
title: Batch Processing
description: How Extractor.extract_batch creates OpenAI batch jobs — model gating, JSONL generation, upload, polling, and result parsing via BatchJob.
tags: [batch, openai, async, operations, extractor]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:45:03.808Z
sources:
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-aea937801f02b6f87071428c
    resource: repo://tests/test_batch_extractor.py
generated: { by: "opencode", at: "2026-09-11T09:45:03.808Z" }
---

# Batch Processing

ExtractThinker supports asynchronous, cost-reduced extraction via the OpenAI Batch API. The flow is `Extractor.extract_batch(...)` → `BatchJob` (create, upload, submit) → `get_status()` / `get_result()` / `cancel()`.

## Entry: Extractor.extract_batch

`extract_batch` accepts a single source or a list of sources and returns a `BatchJob` (`extract_thinker/extractor.py#L945-L1098`). Before doing any work it applies three gates:

1. An LLM must be configured (`extract_thinker/extractor.py#L969-L970`).
2. The backend must not be `LLMEngine.PYDANTIC_AI` — batch operations are rejected for that backend (`extract_thinker/extractor.py#L973-L977`).
3. The model name must substring-match one of `BATCH_SUPPORTED_MODELS` (`gpt-4o-mini`, `gpt-4o`, `gpt-4o-2024-08-06`, `gpt-4`) (`extract_thinker/extractor.py#L40-L45`, `extract_thinker/extractor.py#L979-L983`, performance check in `can_handle_batch` at `extract_thinker/extractor.py#L1100-L1113`).

## Job files and directory lifecycle

Unless the caller supplies explicit paths, the job writes into `./extract_thinker_batch/`:

- `input_<uuid>.jsonl` — the batch request file
- `output_<uuid>.jsonl` — downloaded results

The output and input paths are checked for pre-existence and raise `ValueError` if the file already exists (`extract_thinker/extractor.py#L986-L1004`).

## Message generation

`extract_batch` builds one messages list per source via a generator (`get_messages`, `extract_thinker/extractor.py#L1024-L1087`):

- A fixed system prompt frames the call as a JSON-fields server API.
- Vision sources become base64 `image_url` content blocks; non-vision sources are loaded through the extractor's `document_loader` and formatted as page content. If the source is an existing string path it is treated as a file; otherwise the string itself is used as the content.
- Optional `content` argument is prepended as "##Extra Content".

## BatchJob construction and upload

`BatchJob.__init__` (`extract_thinker/batch_job.py#L11-L53`) performs the whole setup synchronously at construction time:

1. `instructor.batch.BatchJob.create_from_messages` writes the JSONL request file with the model and response_model.
2. `_add_method_to_file` rewrites each line into OpenAI's batch format (`custom_id`, `method: "POST"`, `url: "/v1/chat/completions"`, body with model/messages/max_tokens/temperature/tools) (`extract_thinker/batch_job.py#L55-L70`).
3. The file is uploaded with purpose `batch` and a batch is created with `endpoint="/v1/chat/completions"` and `completion_window="24h"` (`extract_thinker/batch_job.py#L72-L96`).

Upload or batch creation failures abort construction by raising `ValueError` (`extract_thinker/batch_job.py#L48-L52`). The API key comes from the `OPENAI_API_KEY` environment variable at import time (`extract_thinker/batch_job.py#L10`).

## Status semantics

`get_status` maps raw OpenAI states to four simplified values (`extract_thinker/batch_job.py#L98-L125`):

| OpenAI status | Reported |
|---|---|
| validating | queued |
| in_progress, finalizing | processing |
| completed | completed |
| failed, expired, cancelled | failed |
| cancelling | processing |
| unknown | failed |

## Result retrieval

`get_result` polls `get_status` in a loop, sleeping 60 seconds between checks (`SLEEP_TIME`, `extract_thinker/batch_job.py#L8`, `L137-L143`). On completion it downloads the output file to the local output path, parses it with `instructor.batch.BatchJob.parse_from_file` against the original response model, and — despite the docstring describing a tuple — returns only `parsed[0]` (`extract_thinker/batch_job.py#L127-L170`).

Two caveats when operating this code path:

- A `parsed` list that is empty would raise `IndexError`, surfacing only as the generic `ValueError` wrapper from the outer except (`extract_thinker/batch_job.py#L172-L173`). This is a latent edge case, not a designed behavior.
- The `finally` block calls `_cleanup_files`, which deletes the input and output JSONL files and removes the batch directory if empty (`extract_thinker/batch_job.py#L195-L208`). Calling `get_result` destroys the persisted copy of the results — there is no restore. `__del__` also calls cleanup, so files are removed when the object is garbage collected.

## Cancellation

`cancel` calls `client.batches.cancel` and cleans up local files on success; with no `batch_id` it returns `False` (`extract_thinker/batch_job.py#L177-L193`).

## Operational notes

- All blocking OpenAI SDK calls are wrapped in `asyncio.to_thread`, so `get_status`/`get_result`/`cancel` are safe to call from async code (`extract_thinker/batch_job.py#L104-L107`).
- Error paths (upload, create, status, cancel) mostly print and return `None`/`False` rather than raising; only construction and `get_result` turn failures into exceptions.
- Tests are integration tests requiring real credentials: `test_batch_extraction_single_source` checks a full round-trip result against a stored invoice image, `test_cancel_batch_extraction` verifies file cleanup after cancel (`tests/test_batch_extractor.py#L10-L62`).

Related: [LLM Layer](/openwiki/llm-layer.md) · [Extractor and Extraction Flow](/openwiki/extractor-and-extraction-flow.md)
