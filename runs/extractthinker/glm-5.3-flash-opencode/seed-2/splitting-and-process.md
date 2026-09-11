---
type: workflow
title: Splitting and the Process Orchestrator
description: Process bundles classification, a splitter, and extractors to segment multi-document files into page groups and extract each group under its matched classification's contract.
tags: [process, splitting, doc-groups, orchestration, eager, lazy]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:45:03.808Z
sources:
  - id: openwiki-source-dc7c494e3ba5af8a22fe54b1
    resource: repo://extract_thinker/image_splitter.py
  - id: openwiki-source-edbd5b56a6dcbaf92b6e9ae7
    resource: repo://extract_thinker/models/doc_groups2.py
  - id: openwiki-source-d7ffb9ed5addad208802fd81
    resource: repo://extract_thinker/models/eager_doc_group.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-42be6a4a0c0db6ff5ebc246e
    resource: repo://extract_thinker/splitter.py
  - id: openwiki-source-cda8ee7e415b6ecdfb133cd9
    resource: repo://extract_thinker/text_splitter.py
  - id: openwiki-source-749f08e74a04a46f1629ea04
    resource: repo://tests/test_process.py
generated: { by: "opencode", at: "2026-09-11T09:45:03.808Z" }
---

# Splitting and the Process Orchestrator

`Process` (`extract_thinker/process.py#L18-L30`) composes the full pipeline for files possibly containing many documents (e.g., `bulk.pdf` scanned forms): configure loaders, add classify-extractor layers, load a splitter, then `split()` and `extract()`.

## State machine

`Process` insists on a specific setup order (fail fast via `ValueError`):

- A default loader and per-file-type loaders are mutually exclusive (`process.py#L31-L40`).
- `load_splitter` toggles `vision_mode` on all configured loaders if the splitter is an `ImageSplitter` (`process.py#L42-L63`).
- `add_classify_extractor` collects layers of `Extractor` groups used by classification or tree navigation (`process.py#L65-L68`).
- `load_file(path)` stores the target; no content is loaded until `split`/`extract`.

## Splitting

`Process.split(classifications, strategy=EAGER)` (`process.py#L205-L238`) loads the document's pages (requires ≥2 pages) and produces `DocGroups` — a list of `DocGroup(pages, classification)` (`extract_thinker/models/doc_group.py`).

- **EAGER**: one LLM call for the whole document. `TextSplitter.split_eager_doc_group` (`extract_thinker/text_splitter.py#L103-L145`) joins all page texts with `=== PAGE BREAK ===`, requests a `DocGroupsEager` structure (`{"reasoning", "groupOfDocuments": [{"classification", "pages"}]}` from `extract_thinker/models/eager_doc_group.py`), converts it to `EagerDocGroup` items. On any failure it falls back to one group over all pages with classification `"unknown"` (`text_splitter.py#L146-L155`) — meaning silent fallback exists for extraction to later trip on.
- **LAZY**: consecutive-page pairwise comparison. `belongs_to_same_document(page1, page2, classifications)` asks the LLM for a `DocGroups2` verdict (`belongs_to_same_document`, classification names for both pages, reasoning — `extract_thinker/models/doc_groups2.py#L1-L6`); the base class `aggregate_doc_groups` walks pairwise verdicts to build contiguous groups (`extract_thinker/splitter.py#L89-L147`).
  - Requires the loader's `can_handle_paginate` (PDF only) — otherwise `ValueError` (`process.py#L231-L236`).

Two splitter implementations: `TextSplitter` (compares page `"text"`/`content`) and `ImageSplitter` (base64-codes page images into `image_url` blocks). `ImageSplitter.belongs_to_same_document` is conservative: on LLM failure it returns `belongs_to_same_document=True` so pages stay together (`extract_thinker/image_splitter.py#L89-L99`).

## Extraction over groups

`Process.extract(vision=False, completion_strategy=FORBIDDEN)` (`process.py#L240-L309`):

1. For each doc group, find the matching `Classification` by name; it supplies both the `extractor` and the contract (`extraction_contract or contract`); missing extractor raises `ValueError("Extractor not found for classification")`.
2. Re-loads the whole document once per group, selects only the group's pages (`pages[i - 1] for i in doc_group.pages`), enables `set_skip_loading(True)` on the extractor, and calls `extract_async` with the group pages and the contract.
3. All groups extract concurrently via `asyncio.gather`; `loop.run_until_complete` blocks the caller.

Note the load-per-group is redundant work today (document reloaded for every group from the same source) — an observable inefficiency, not a documented contract.

## Classification linkage

Before splitting, callers can use `Process.classify`/`classify_async` with `ClassificationStrategy` layers or a `ClassificationTree` — covered in [Classification](/openwiki/classification.md). Splitting stores `split_classifications`, and group classification names must match those entries for extraction to resolve.

## Tests

`tests/test_process.py` runs end-to-end pipelines against `tests/files/bulk.pdf` (a real multi-document file), defining contracts like `VehicleRegistration` and classifications for vehicle registration and driver license (`tests/test_process.py#L21-L44`). Integration tests with live OCR/LLM credentials.

Related: [Classification](/openwiki/classification.md) · [Architecture Overview](/openwiki/architecture-overview.md)
