---
type: concept
title: Splitting and Document Groups
description: How ExtractThinker splits multi-page documents into logical document groups using lazy and eager strategies, and how ImageSplitter and TextSplitter compute and aggregate groups.
tags: [splitting, splitter, document-groups, lazy, eager]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:22:48.987Z
sources:
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-dc7c494e3ba5af8a22fe54b1
    resource: repo://extract_thinker/image_splitter.py
  - id: openwiki-source-edbd5b56a6dcbaf92b6e9ae7
    resource: repo://extract_thinker/models/doc_groups2.py
  - id: openwiki-source-d7ffb9ed5addad208802fd81
    resource: repo://extract_thinker/models/eager_doc_group.py
  - id: openwiki-source-97c8503763e1f79d5062af85
    resource: repo://extract_thinker/models/splitting_strategy.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-42be6a4a0c0db6ff5ebc246e
    resource: repo://extract_thinker/splitter.py
  - id: openwiki-source-cda8ee7e415b6ecdfb133cd9
    resource: repo://extract_thinker/text_splitter.py
generated: { by: "opencode", at: "2026-09-12T21:22:48.987Z" }
---

# Splitting and Document Groups

Multi-page documents can contain several logical documents (e.g. a mixed PDF with a license followed by a vehicle registration). ExtractThinker's `Splitter` abstraction (and its `ImageSplitter`/`TextSplitter` implementations) partition pages into groups, each belonging to one logical document and assigned a classification.

## The Splitter abstraction

`Splitter` (`extract_thinker/splitter.py`) is abstract with three required methods:

- `belongs_to_same_document(page1, page2, contract/classifications) -> DocGroups2`
- `split_lazy_doc_group(...) -> DocGroups`
- `split_eager_doc_group(...) -> DocGroups`

It provides shared helpers:

- `split_document_into_groups(document)` (`splitter.py:24-32`) — produces overlapping pairs of pages (page_per_split = 2): for a single-page document returns `[document]`, else `[document[i:i+2]]` for i in range(0, len-1).
- `aggregate_doc_groups(doc_groups_tasks)` (`splitter.py:50-92`) — walks the pairwise `belongs_to_same_document` results and builds `DocGroups`:
  - If page 1 & 2, they start a group with pages `[1, 2]`.
  - Otherwise page 1 becomes its own group, then page 2 begins a new group.
  - For each subsequent pair, if the two pages belong to the same document the current group grows by one page; otherwise the current group is closed and a new one starts.
- `process_group` / `process_split_groups` (`splitter.py:34-48`) run pair comparisons (concurrently via `asyncio.gather`) and catch/`raise` exceptions after printing.

`SplittingStrategy` (`extract_thinker/models/splitting_strategy.py`) defines `EAGER` and `LAZY`.

The output models:

- `DocGroup` (plain Python class in `models/doc_group.py`) — `pages: List[int]`, `classification: str`.
- `DocGroups` (`models/doc_group.py` / `models/doc_groups.py`) — a container with `doc_groups: List[DocGroup]`.
- `DocGroups2` (pydantic, `models/doc_groups2.py`) — the per-pair comparison result: `belongs_to_same_document: bool`, `classification_page1`, `classification_page2`, optional `reasoning`.
- `EagerDocGroup` / `DocGroupsEager` / `DocGroup` (pydantic `models/eager_doc_group.py`) — the eager strategy's output JSON shape — `reasoning` + `groupOfDocuments` list with `pages` and `classification`.

## Lazy strategy

`split_lazy_doc_group` processes the document pairwise, comparing consecutive pages to find logical boundaries:

- `ImageSplitter.split_lazy_doc_group` (`image_splitter.py:115-142`) — encodes each page image to base64ched and sends a prompt (visual consistency, layout, content flow, headers/footers, page numbering, document identifiers) with both images to the LLM asking for a `DocGroups2` JSON response.
- `TextSplitter.split_lazy_doc_group` (`text_splitter.py:74-101`) — similarly compares page text, considering content flow, headers/footers, page numbering, and writing style.

If the pair comparison raises, both splitters fall back to `DocGroups2(belongs_to_same_document=True, ...)` — a conservative "keep pages together" default named after the first classification (`image_splitter.py:96-113`, `text_splitter.py:56-72`).

For a single-page document, both return a single group tied to the first classification.

Because `Process.split` uses `can_handle_paginate` (PDF only) to permit lazy splitting, lazy splitting is currently limited to PDF sources.

## Eager strategy

`split_eager_doc_group` inspects the whole document at once and returns a JSON grouping:

- `ImageSplitter.split_eager_doc_group` (`image_splitter.py:144-222`) — encodes all page images and, if a classification has a reference `image`, includes it in the prompt; asks for `DocGroupsEager` with `groupOfDocuments`. It converts the response into `List[EagerDocGroup]`.
- `TextSplitter.split_eager_doc_group` (`text_splitter.py:103-154`) — joins all page texts with `=== PAGE BREAK ===` and asks for `DocGroupsEager`.

On an exception, both fall back to a single group spanning all pages with `classification="unknown"` (`image_splitter.py:215-222`, `text_splitter.py:148-154`).

## Classification structure injection

Both splitters render the candidate classifications (name, description, and the contract's field structure) into the prompt via `_classifications_to_text` and `_add_classification_structure` (`image_splitter.py:224-254`, `text_splitter.py:156-182`), so the model can assign a classification to each group/pair.

## Usage in the workflow

`Process.split` (`extract_thinker/process.py:205-238`) selects EAGER or LAZY based on the strategy. For EAGER it uses `split_eager_doc_group`; for LAZY it uses `split_lazy_doc_group` after confirming the loader supports pagination. The resulting `DocGroups` are then consumed by `Process.extract`, which re-loads pages to pick group indices and extracts each via its classification's Extractor.
