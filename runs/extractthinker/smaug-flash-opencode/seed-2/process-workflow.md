---
type: concept
title: Process Workflow and Document Groups
description: How Process orchestrates loading, splitting, classifying, and extracting multi-page documents, including its chaining API, per-file-type loaders, and document-group extraction flow.
tags: [process, workflow, splitting, classification, extraction]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:22:48.987Z
sources:
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
generated: { by: "opencode", at: "2026-09-12T21:22:48.987Z" }
---

# Process Workflow and Document Groups

`Process` (`extract_thinker/process.py`) is a higher-level workflow coordinator that composes the loading, splitting, classification, and extraction steps for multi-page documents that may contain several logical documents (e.g. a PDF with both a license and a vehicle registration).

## Role and configuration

`Process.__init__` (`process.py:18-29`) holds:

- `doc_groups` — result of splitting (a list of page/classification groups).
- `split_classifications` — the `Classification` list used during splitting.
- `extractor_groups` — lists of extractor groups used for classification.
- `document_loaders_by_file_type` — loaders keyed by file extension.
- `document_loader` — optional default loader.
- `splitter` — the `Splitter` to use.
- `file_path` / `file_stream` — the source.

Configuration methods return `self` for method chaining:

- `load_document_loader(loader)` — sets the default loader; raises `ValueError` if per-type loaders are already set (`process.py:36-40`).
- `set_document_loader_for_file_type(file_type, loader)` — sets a loader for a specific extension; raises `ValueError` if a default loader is already set (`process.py:31-34`).
- `load_splitter(splitter)` — sets the splitter and enables vision mode on existing loaders if the splitter is an `ImageSplitter` (`process.py:42-63`).
- `add_classify_extractor(extractor_groups)` — appends extractor groups for layered classification (`process.py:65-68`).
- `load_file(file)` — records the source path and returns `self` (`process.py:201-203`).

## Classification

`Process.classify_async(file, classifications, strategy, threshold, image)` (`process.py:81-125`) supports layered consensus classification:

- If `classifications` is a `ClassificationTree`, delegates to `_classify_tree_async`.
- For each extractor group, runs `extractor.classify` concurrently (via `asyncio.gather` in a thread executor).
- Applies the selected strategy:
  - `CONSENSUS` — requires all results in the layer to agree on one name.
  - `HIGHER_ORDER` — returns the highest-confidence result.
  - `CONSENSUS_WITH_THRESHOLD` — requires consensus and all confidences >= threshold.
- If a layer meets the criteria it returns; otherwise it moves to the next layer; after all layers fail it raises `ValueError` ("No consensus could be reached...").

`classify(...)` is the synchronous wrapper that runs `classify_async` via `asyncio.run`. Both validate that `threshold` is an int 1–10 (`process.py:74-90`). `_classify_tree_async` (`process.py:127-188`) performs level-by-level hierarchical classification using the first extractor group, enforcing confidence >= threshold and matching nodes by UUID.

## Split / extract flow

`split(classifications, strategy=EAGER)` (`process.py:205-238`):

1. Requires a splitter (else `ValueError("No splitter loaded...")`).
2. Resolves a loader via `get_document_loader(file)` — returns the default, else one matched by image type, else `None` → `ValueError` (`process.py:194-199`).
3. Loads pages from `file_path` or `file_stream`. For **EAGER**, uses `split_eager_doc_group`; for **LAZY**, requires the loader to support pagination (`can_handle_paginate`) since only the PDF path supports lazy splitting, else `ValueError`.
4. Raises `ValueError` if the document has fewer than 2 pages ("Document must have at least 2 pages") (`process.py:224-225`).

`extract(vision=False, completion_strategy=FORBIDDEN)` (`process.py:240-308`):

1. Requires `doc_groups` to be initialized, else `ValueError`.
2. For each `DocGroup` in `doc_groups`, finds the matching `Classification` (by name) to obtain its `extractor` and its `extraction_contract` or `contract`.
3. Re-loads pages (or uses the stream), extracts the group's page indices.
4. Sets `extractor.set_skip_loading(True)` so the extraction uses the already-loaded group pages directly, calls `extractor.extract_async` with the group's pages and the chosen contract/vision/completion strategy, then resets the flag in a `finally`.
5. Runs `_extract` callbacks via `asyncio.gather`; on exception prints "An error occurred: ..." and re-raises (`process.py:295-302`).
6. Runs the event loop with `loop.run_until_complete` and returns the list of extracted results.

If no extractor is found for a classification, raises `ValueError("Extractor not found for classification")` (`process.py:260-261`).

## Error handling summary

- `ValueError` guards: mutually-exclusive default/per-type loaders, no splitter, no loader for file type, fewer than two pages, file/stream required, missing doc_groups, unsupported completion strategy.
- Strategy failure (`no consensus`) raises `ValueError` rather than swallowing.
- Extraction failures are propagated (re-raised after logging), so callers see underlying `ExtractThinkerError`s from the Extractor.
