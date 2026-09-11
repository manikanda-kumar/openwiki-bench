---
type: core-workflow
title: Splitting and Process Workflow
description: Splitter boundary detection, DocGroups, eager vs lazy strategies, and the Process load_file/split/extract orchestration of multi-document files.
tags: [splitting, doc-groups, process, eager, lazy]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:40:03.572Z
sources:
  - id: openwiki-source-dc7c494e3ba5af8a22fe54b1
    resource: repo://extract_thinker/image_splitter.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-42be6a4a0c0db6ff5ebc246e
    resource: repo://extract_thinker/splitter.py
  - id: openwiki-source-cda8ee7e415b6ecdfb133cd9
    resource: repo://extract_thinker/text_splitter.py
generated: { by: "opencode", at: "2026-09-11T09:40:03.572Z" }
---

# Splitting and Process Workflow

A single PDF often contains multiple unrelated documents (stacked invoices, forms, statements). The `Splitter` family detects boundaries; `Process` then classifies, splits, and extracts each group concurrently.

## Splitter contract

`Splitter` (extract_thinker/splitter.py:11-93) is an ABC with three abstract methods — `belongs_to_same_document(page1, page2, contract)`, `split_lazy_doc_group(pages, classifications)`, and `split_eager_doc_group(pages, classifications)` — plus shared helpers:

- `split_document_into_groups` produces sliding pairs of adjacent pages (`page_per_split = 2`).
- `aggregate_doc_groups` converts per-pair `DocGroups2` verdicts into final `DocGroup(pages=[...], classification=...)` groups: a `belongs_to_same_document=True` result extends the current group, otherwise a new group starts. Note its page-number bookkeeping adds `page_number + 1` per pair, expecting the `DocGroups2.classification_page2` semantics; consecutive single-document input merges into one group ending at page N.

## ImageSplitter

`ImageSplitter(model)` builds its own internal `LLM(model)` (extract_thinker/image_splitter.py:11-15) — a splitter is not attached to the Extractor's LLM.

- **Lazy path** (`split_lazy_doc_group`, extract_thinker/image_splitter.py:115-142): sequential pairwise comparisons of page images; each pair asks the LLM to judge visual continuity and assign classifications to both pages (`DocGroups2`). Results are aggregated via the base helper.
- **Eager path** (`split_eager_doc_group`, extract_thinker/image_splitter.py:144-222): one request containing **all** page images at once, requesting a `DocGroupsEager` with `groupOfDocuments: [{classification, pages}]`. For each classification with a reference image, an example image is appended to the prompt — but note the loop building that list is dead-stored; the second `messages = [...]` assignment overwrites it, so reference classification images are actually dropped (extract_thinker/image_splitter.py:167-191).
- **Failure semantics**: both paths fail *open* — LLM exceptions return "keep pages together" with the first classification's name (lazy) or one "unknown" group for all pages (eager, extract_thinker/image_splitter.py:215-222). Extraction then may fail later for "Extractor not found for classification" if "unknown" has no matching `Classification`.
- A subtle bug: `belongs_to_same_document` raises if the input dict lacks `'image'`; lazy splits therefore only work with page dicts carrying image bytes (vision-capable loader pipelines).

## TextSplitter

`TextSplitter(model)` mirrors the lazy strategy on `'text'`-keyed page dicts (no image requirement), asking about content flow, page numbering, style (extract_thinker/text_splitter.py:9-80). It shares the fail-open fallback. It is exported in the public façade but not wired into Process-specific vision mode toggling, which applies only to `ImageSplitter` instances.

## DocGroups models

`DocGroup(pages, classification)` + `DocGroups` (plain grouping), `DocGroups2` (pair verdict + per-page classification), `DocGroupsEager`/`EagerDocGroup` (LLM-decided groupings with page-number lists). `Process.split` normalizes both paths into `DocGroups` stored on `self.doc_groups`.

## Process orchestration

`Process` (extract_thinker/process.py:18-309) is a fluent workflow:

1. **Config**: `load_document_loader` (default) or `set_document_loader_for_file_type` (per extension) — mutually exclusive, raising if both are used; `load_splitter` installs the splitter and auto-enables loader vision mode when it is an `ImageSplitter` (extract_thinker/process.py:31-63).
2. **Load**: `load_file(path)` stores the path; there is also a `file_stream` field though no stream-loading method is shown in this class excerpt (the field is set only via `load_file` — treat stream use as unverified).
3. **Split** (`split(classifications, strategy)`): loads the pages, demands ≥ 2 pages, and goes eager or lazy; LAZY additionally requires `can_handle_paginate(file_path)` (PDF only at present; otherwise "Document Type does not support lazy splitting. for now only pdf is supported").
4. **Extract**: walks `doc_groups`, locating the classification matcher by **name** (`classification.name == doc_group.classification`) and preferring the classification's `extraction_contract`. All missing pieces raise `ValueError`. Page numbering is 1-indexed: `pages[i - 1]` for each listed page. It sets `extractor.set_skip_loading(True)`, runs `extract_async`, and always resets the flag in `finally` (extract_thinker/process.py:240-309).

`Process.extract` drives the group extractions with `asyncio.gather` inside `loop.run_until_complete` (extract_thinker/process.py:295-309). Similar to other flows, sharing a single `Extractor` between Classification objects produces the shared-state caveats described on the Extraction Flow page. Failures print `An error occurred: ...` before re-raising.

## Representative tests

- tests/test_process.py verifies the Process fluent flow, splitting behavior, classifications, and extraction against sample documents.
- tests/critical/ and tests/files/ provide fixtures for multi-document PDFs.
