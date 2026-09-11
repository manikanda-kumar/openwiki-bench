---
type: concept
title: Process Workflow and Splitting
description: The Process class composes classification, splitting, and per-group extraction for multi-page documents, with eager and lazy strategies implemented by ImageSplitter and TextSplitter over the Splitter ABC.
tags: [process, splitting, splitter, doc-groups, eager, lazy]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:16:41.841Z
sources:
  - id: openwiki-source-dc7c494e3ba5af8a22fe54b1
    resource: repo://extract_thinker/image_splitter.py
  - id: openwiki-source-7fa93fa33ef7db6a499c6360
    resource: repo://extract_thinker/models/doc_group.py
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
generated: { by: "opencode", at: "2026-09-11T09:16:41.841Z" }
---

# Process Workflow and Splitting

`Process` (`extract_thinker/process.py`) is the higher-level orchestration class for **multi-page documents that contain more than one logical document**. It chains three steps: load the file, split the pages into `DocGroup`s according to a set of `Classification`s, and extract each group with the classification's extractor and contract.

## Configuration

A `Process` holds a default `document_loader` or per-file-type loaders (`set_document_loader_for_file_type`), a `splitter`, and layers of classify extractors. It enforces exclusivity: setting a default loader when file-type loaders exist (or vice versa) raises `ValueError`. `load_splitter` registers the splitter and, when the splitter is an `ImageSplitter`, enables vision mode on the configured loaders.

## The split() step

`Process.split(classifications, strategy)` (`extract_thinker/process.py:201`):

1. Requires a loaded splitter, else `ValueError`.
2. Resolves a loader via `get_document_loader` (default loader first, else by `get_image_type` file-type lookup).
3. Loads the file (from `file_path` or `file_stream`) into a list of pages; documents with fewer than 2 pages raise `ValueError("Document must have at least 2 pages")`.
4. **`SplittingStrategy.EAGER`** — delegates to `splitter.split_eager_doc_group(pages, classifications)`, producing `DocGroup`s directly.
5. **`SplittingStrategy.LAZY`** — requires the loader's `can_handle_paginate(source)` to be true (only PDFs), then delegates to `splitter.split_lazy_doc_group(...)`; non-PDF sources raise `ValueError`.

The resulting `doc_groups` are stored on the process.

## The Splitter ABC

`Splitter` (`extract_thinker/splitter.py`) declares three abstract methods:

- `belongs_to_same_document(page1, page2, contract)` — decides whether two consecutive pages are part of the same logical document, returning a `DocGroups2`.
- `split_lazy_doc_group(pages, classifications)` — lazy pairwise strategy.
- `split_eager_doc_group(pages, classifications)` — whole-document strategy.

It provides shared helpers: `split_document_into_groups` builds sliding 2-page windows, and `aggregate_doc_groups` reconstructs contiguous page ranges from the pairwise `belongs_to_same_document` results — starting a new `DocGroup` whenever a boundary is found and carrying each page's `classification_pageN`.

### Doc-group models

- `DocGroup` (`extract_thinker/models/doc_group.py`) — plain class with `pages: List[int]` (1-indexed) and `classification: str`; `DocGroups` wraps a `List[DocGroup]`.
- `DocGroups2` (`extract_thinker/models/doc_groups2.py`) — Pydantic result of a pairwise comparison: `reasoning`, `belongs_to_same_document`, `classification_page1`, `classification_page2`.
- `EagerDocGroup` (`extract_thinker/models/eager_doc_group.py`) — dataclass with `pages` and `classification`; `DocGroup` (Pydantic) is the per-group schema and `DocGroupsEager` wraps `reasoning` + `groupOfDocuments` as the eager LLM response schema.

## Concrete splitters

### ImageSplitter

`ImageSplitter(model)` (`extract_thinker/image_splitter.py`) builds its own `LLM(model)` and works on page `image` bytes:

- **Lazy** — for each 2-page window it sends both page images to the LLM asking for a `DocGroups2` JSON verdict (visual consistency, layout, content flow, headers/footers, page numbers, document identifiers), then aggregates. On LLM failure it falls back to "same document" (`belongs_to_same_document=True`) with the first classification name.
- **Eager** — encodes all page images plus any classification reference images and asks for `DocGroupsEager` (`groupOfDocuments` with `classification` + `pages`). On failure it falls back to a single group containing all pages with classification `"unknown"`.

### TextSplitter

`TextSplitter(model)` (`extract_thinker/text_splitter.py`) is the same design but works on page `content` text (joined pages separated by `=== PAGE BREAK ===` in eager mode) with the same `DocGroups2` / `DocGroupsEager` prompts and the same conservative fallbacks.

## The extract() step

`Process.extract(vision, completion_strategy)` (`extract_thinker/process.py:240`) runs every `DocGroup` concurrently:

1. Each group looks up its classification among `split_classifications` to find the `extractor` and the contract (`classification.extraction_contract or classification.contract`); an unknown classification raises `ValueError`.
2. It re-loads the document pages, then selects `group_pages = [pages[i-1] for i in doc_group.pages]` (1-indexed page numbers).
3. It calls `extractor.set_skip_loading(True)`, then `extractor.extract_async(source=group_pages, response_model=contract, vision, completion_strategy)` — the list source routes to `DocumentLoaderData`, and `_skip_loading` avoids re-loading already-processed content. The flag is reset in a `finally`.
4. Results are gathered with `asyncio.gather`; any error is re-raised after logging.

## Representative tests

`tests/test_process.py` covers eager and lazy splitting with both `ImageSplitter` and `TextSplitter` on the multi-page `tests/files/bulk.pdf`, asserting each result matches one of the configured contracts (`VehicleRegistration` / `DriverLicense`) and that extracted names and license numbers match ground truth.
