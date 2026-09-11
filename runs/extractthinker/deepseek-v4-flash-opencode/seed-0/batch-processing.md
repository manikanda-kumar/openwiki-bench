---
type: concept
title: Batch Processing
description: Asynchronous, lower-cost extraction through the OpenAI Batch API, including model allow-listing, JSONL job construction, status polling, result parsing, and cleanup.
tags: [batch, openai, async, extraction]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:00:08.410Z
sources:
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-32885aef730037c65f8bfa30
    resource: repo://extract_thinker/models/batch_result.py
  - id: openwiki-source-2733f24ab801767d8ffbc546
    resource: repo://extract_thinker/models/batch_status.py
generated: { by: "opencode", at: "2026-09-11T09:00:08.410Z" }
---

# Batch Processing

Batch processing lets you submit many extraction requests to the OpenAI Batch
API in a single asynchronous job instead of issuing synchronous per-document
calls. It is orchestrated by `Extractor.extract_batch`, which returns a
`BatchJob` handle for status polling and result retrieval.

## Entry point and constraints

`Extractor.extract_batch` (`extract_thinker/extractor.py:945-1098`) enforces
several constraints before creating a job:

- An LLM must be set (`self.llm is None` raises `ValueError`).
- The **pydantic-ai backend is rejected** outright:
  `"Batch processing is not supported with the PYDANTIC_AI backend..."`
  (`extract_thinker/extractor.py:973-977`).
- The model must be batch-capable. `BATCH_SUPPORTED_MODELS`
  (`extract_thinker/extractor.py:40-45`) is `["gpt-4o-mini", "gpt-4o",
  "gpt-4o-2024-08-06", "gpt-4"]`. `can_handle_batch`
  (`extract_thinker/extractor.py:1100-1113`) returns True only when the
  configured model name contains one of those tokens (case-insensitive
  substring match).

Input/output file paths default to `extract_thinker_batch/` under the current
working directory with unique UUID-suffixed names
(`output_<uuid>.jsonl` / `input_<uuid>.jsonl`). The directory is created if
needed, and an explicit `ValueError` is raised if a provided file path already
exists (`extract_thinker/extractor.py:985-1004`).

### Message construction

`extract_batch` builds messages with an internal generator `get_messages()`
(`extract_thinker/extractor.py:1024-1087`). For each source:

- **Vision mode**: the source is read as bytes (file path or IO), base64
  encoded, and sent as an `image_url` content block, with optional
  `extra_content` text prepended.
- **Text mode**: a document loader loads the source and `_format_pages_to_content`
  produces the text; file paths are assumed to exist, and strings that are not
  existing paths are treated as raw text content.

Each yielded item is a complete message list for one request. The generator is
passed to the `BatchJob` constructor.

## The BatchJob lifecycle

`BatchJob` (`extract_thinker/batch_job.py:11-46`) wraps the whole OpenAI Batch
interaction:

1. **Create JSONL**: `InstructorBatchJob.create_from_messages` writes the
   messages into `file_path` in instructor's batch format
   (`extract_thinker/batch_job.py:30-35`).
2. **Transform lines**: `_add_method_to_file` rewrites every line into OpenAI's
   batch request schema — `custom_id`, `method: "POST"`,
   `url: "/v1/chat/completions"`, and a `body` carrying model, messages,
   max_tokens, temperature, tools, and tool_choice
   (`extract_thinker/batch_job.py:48-70`).
3. **Upload**: `_upload_file` uploads the file with `purpose="batch"` via the
   OpenAI SDK and stores the file id (`extract_thinker/batch_job.py:72-83`).
4. **Create job**: `_create_batch_job` calls
   `client.batches.create(endpoint="/v1/chat/completions", completion_window="24h")`
   and stores the batch id (`extract_thinker/batch_job.py:85-96`).

The OpenAI client is constructed from `OPENAI_API_KEY`
(`extract_thinker/batch_job.py:19-25`); a failed upload or job creation raises
`ValueError`.

### Status polling

`get_status` (`extract_thinker/batch_job.py:98-111`) retrieves the batch and
maps the API status via `_map_status` (`extract_thinker/batch_job.py:113-125`):

| OpenAI API status | Returned status |
|---|---|
| `validating` | `queued` |
| `in_progress`, `finalizing`, `cancelling` | `processing` |
| `completed` | `completed` |
| `failed`, `expired`, `cancelled` | `failed` |

Any retrieval error returns `"failed"`.

### Result retrieval

`get_result` (`extract_thinker/batch_job.py:127-175`) polls every 60 seconds
(`SLEEP_TIME`) until the job is `completed` (raising `ValueError` on `failed`),
downloads the output file via `client.files.content`, saves it to `output_path`,
and parses it with `InstructorBatchJob.parse_from_file` against the response
model, returning `parsed[0]`. Cleanup runs in a `finally` block.

### Cancellation and cleanup

`cancel` (`extract_thinker/batch_job.py:177-193`) cancels the batch via the SDK
and then cleans up files. `_cleanup_files` (`extract_thinker/batch_job.py:195-208`)
removes the input and output JSONL files and removes the parent directory if it
is empty. The destructor `__del__` also calls cleanup, so abandoned jobs do not
leave stray files.

## Auxiliary models

- `BatchResult` (`extract_thinker/models/batch_result.py:1-6`) models a job id
  with a `results` list.
- `BatchStatus` (`extract_thinker/models/batch_status.py:1-5`) models `id`,
  `status`, and optional `output_file_id`.

These models describe the batch payload/state but the primary return types used
by the public flow are the plain `str` from `get_status` and the parsed
`response_model` from `get_result`.
