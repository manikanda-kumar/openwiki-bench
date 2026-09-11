---
type: workflow
title: "Batch Processing"
description: "Async bulk extraction through the OpenAI Batch API: extract_batch message construction and constraints, the BatchJob lifecycle (jsonl upload, status polling, result parsing, cancellation, temp-file cleanup), and the model/backend whitelist."
tags: [batch, openai, extraction, lifecycle, cleanup]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T11:01:32.247Z
sources:
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-32885aef730037c65f8bfa30
    resource: repo://extract_thinker/models/batch_result.py
  - id: openwiki-source-2733f24ab801767d8ffbc546
    resource: repo://extract_thinker/models/batch_status.py
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-aea937801f02b6f87071428c
    resource: repo://tests/test_batch_extractor.py
generated: { by: "opencode", at: "2026-09-11T11:01:32.247Z" }
---

# Batch Processing

Batch processing sends many single-turn extraction requests to the OpenAI Batch API instead of calling models synchronously. Two units collaborate: `Extractor.extract_batch` builds the per-source message set and validates eligibility, and `BatchJob` owns the remote job lifecycle (`extract_thinker/extractor.py:945-1098`, `extract_thinker/batch_job.py`).

## Eligibility rules

`extract_batch` raises `ValueError` before doing any work when:

- no LLM is configured (`extractor.py:969-970`);
- the LLM uses the `PYDANTIC_AI` backend — batch is only wired for the litellm/instructor path (`extractor.py:973-977`);
- `can_handle_batch()` fails: the model string must contain one of the `BATCH_SUPPORTED_MODELS` entries (`gpt-4o-mini`, `gpt-4o`, `gpt-4o-2024-08-06`, `gpt-4`), matched case-insensitively as a substring (`extractor.py:40-45,1100-1113`).

Note the whitelist is substring-based, so any provider-prefixed name containing e.g. `gpt-4o` passes; the repository does not establish filtering beyond this.

## Input construction

Paths are materialized under the current working directory: `extract_batch` creates `./extract_thinker_batch/` and, unless overridden via `batch_file_path`/`output_file_path`, generates UUID-named `input_<uuid>.jsonl` / `output_<uuid>.jsonl`; an explicitly provided path that already exists raises `ValueError` (`extractor.py:985-1004`). The LLM page-count heuristic is set to the number of sources (`extractor.py:1014-1022`).

A generator produces one message list per source (`extractor.py:1024-1087`):

- **Vision mode**: each source must be an existing file path or readable stream; bytes are base64-encoded into a `data:image/jpeg` `image_url` part, optionally preceded by the caller's `content` as a text part.
- **Text mode**: existing file paths are loaded through `self.document_loader` (the primary loader — no extension/capability re-selection happens per source here) and joined via `_format_pages_to_content`, which returns a `{"data": ..., "is_spreadsheet": true}` dict when any page is a spreadsheet; a non-path string is treated as literal text content (`extractor.py:1066-1076,1411-1428`).

A system message ("You are a server API that receives document information and returns specific fields in JSON format") is prepended to each request.

## BatchJob lifecycle

`BatchJob.__init__` performs the submission eagerly (`batch_job.py:12-46`):

1. `instructor.batch.BatchJob.create_from_messages` writes the JSONL request file with the response model schema.
2. `_add_method_to_file` rewrites each line into OpenAI batch format: `{"custom_id", "method": "POST", "url": "/v1/chat/completions", body:{model, messages, max_tokens, temperature, tools, tool_choice}}` (`batch_job.py:48-70`).
3. The file is uploaded with `purpose="batch"` using an `OpenAI` client whose api key defaults to `os.getenv("OPENAI_API_KEY")`, and `client.batches.create` starts the job with `completion_window="24h"` (`batch_job.py:19,72-96`). Upload/create failures print the error, return `None`, and the constructor converts that to `ValueError`.

Status handling: `get_status()` (async) retrieves the batch and maps provider states to a four-value vocabulary — `validating→queued`, `in_progress/finalizing/cancelling→processing`, `completed→completed`, `failed/expired/cancelled` and any unknown/thrown state → `failed` (`batch_job.py:98-125`).

Result retrieval: `get_result()` polls `get_status()` every 60 seconds (`SLEEP_TIME`) until `completed` or raises on `failed`; it then downloads `batch.output_file_id`, writes it to `output_path`, parses with `InstructorBatchJob.parse_from_file`, and — regardless of how many requests were sent — returns `parsed[0]`, i.e. the first parsed result object. Temporary input/output files and the batch directory are deleted in a `finally` block (`batch_job.py:127-175`). ⚠️ The README example iterates `results.parsed_results` (`README.md:228-231`), which does not match this implementation; treat `get_result()` returning one contract instance for the whole batch as the code-confirmed behavior.

`cancel()` calls `client.batches.cancel`, cleans up files, and returns a bool (`batch_job.py:177-193`); a final safety net removes files in `__del__` (`batch_job.py:210-212`).

## Dead DTOs

`models/batch_result.py` (`BatchResult`) and `models/batch_status.py` (`BatchStatus`) exist but are referenced nowhere in `extract_thinker/`; do not use them as integration points.

## Representative tests

`tests/test_batch_extractor.py` covers the happy path and cancellation, both requiring a live OpenAI account and Tesseract:

- `test_batch_extraction_single_source`: Tesseract-loaded `invoice.png` + `gpt-4o-mini`; asserts status ∈ {queued, processing, completed}, then `get_result()` yields an `InvoiceContract` with `invoice_number == "0000001"` and `invoice_date == "2014-05-07"` (`tests/test_batch_extractor.py:10-32`).
- `test_cancel_batch_extraction`: passes explicit `batch_file_path`/`output_file_path` under `tests/`, cancels, and verifies the files were removed (`tests/test_batch_extractor.py:34-60`).
