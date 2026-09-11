---
type: splitting
title: Splitting Strategies and Splitters
description: How Splitter, ImageSplitter, and TextSplitter detect document boundaries — pairwise page comparison with sliding-window aggregation, EAGER vs LAZY strategies, and conservative fallbacks when LLM analysis fails.
tags: [splitting, splitters, docgroups, eager, lazy]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T08:46:09.069Z
sources:
  - id: openwiki-source-dc7c494e3ba5af8a22fe54b1
    resource: repo://extract_thinker/image_splitter.py
  - id: openwiki-source-7fa93fa33ef7db6a499c6360
    resource: repo://extract_thinker/models/doc_group.py
  - id: openwiki-source-d7ffb9ed5addad208802fd81
    resource: repo://extract_thinker/models/eager_doc_group.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-42be6a4a0c0db6ff5ebc246e
    resource: repo://extract_thinker/splitter.py
  - id: openwiki-source-cda8ee7e415b6ecdfb133cd9
    resource: repo://extract_thinker/text_splitter.py
generated: { by: "opencode", at: "2026-09-11T08:46:09.069Z" }
---

# Splitting Strategies and Splitters

Splitters decide where one sub-document ends and the next begins inside a multi-page file. They are LLM-driven: every boundary decision is a model call, which shapes both cost and failure behavior.

## The `Splitter` ABC

`Splitter` (in `extract_thinker/splitter.py:11-22`) defines three abstract members:

- `belongs_to_same_document(page1, page2, contract)` — the pairwise boundary oracle, returning a `DocGroups2` (belongs flag, per-page classifications, reasoning).
- `split_lazy_doc_group(document, classifications)` — pairwise processing.
- `split_eager_doc_group(document, classifications)` — whole-document processing.

It also provides two shared helpers:

- **`split_document_into_groups(document)`** — a sliding window with `page_per_split = 2`: for a document of N pages it produces N−1 overlapping pairs `[i, i+1]`; a single-page document returns itself (`extract_thinker/splitter.py:24-32`).
- **`aggregate_doc_groups(doc_groups_tasks)`** — converts the pairwise results into final `DocGroup` page lists: starting from page 1, each `belongs_to_same_document=True` extends the current group, each `False` closes it and starts a new group classified by `classification_page2` (`extract_thinker/splitter.py:50-93`).

`process_split_groups` runs the pairwise comparisons concurrently with `asyncio.gather` (`extract_thinker/splitter.py:34-44`).

## ImageSplitter

`ImageSplitter(model)` builds its own `LLM` from the model string (`extract_thinker/image_splitter.py:11-15`).

- **Lazy path** (`split_lazy_doc_group`): documents with fewer than 2 pages short-circuit to a single group classified as the first classification; otherwise each overlapping page pair is base64-encoded and sent with a prompt asking for visual-consistency analysis (layout, content flow, headers/footers, page numbering, identifiers) plus the classification list, returning a `DocGroups2`. The aggregate comes from `aggregate_doc_groups` (`extract_thinker/image_splitter.py:115-142`).
- **Eager path** (`split_eager_doc_group`): all page images (plus any classification reference images) are sent in one request asking for a `DocGroupsEager` response with `groupOfDocuments: [{classification, pages}]`, converted into `EagerDocGroup` entries (`extract_thinker/image_splitter.py:144-213`).
- **Fallbacks are conservative**: if the pairwise analysis fails, the pair is declared the same document and both pages get the *first* classification's name; if the eager analysis fails, all pages become one group classified `"unknown"` (`extract_thinker/image_splitter.py:107-113`, `extract_thinker/image_splitter.py:215-222`). The eager fallback means a failed call silently degrades to "one document, unknown type" rather than erroring.

Note the eager implementation builds the `messages` list twice — the classification-reference loop appends to a list that is immediately replaced by a fresh literal — so classification reference images are effectively not sent (`extract_thinker/image_splitter.py:169-184`).

## TextSplitter

`TextSplitter` mirrors the same structure for text pages: `belongs_to_same_document` requires `'text'` keys and compares content flow, headers/footers, page numbering, identifiers, and writing style; eager/lazy methods follow the same aggregate path (`extract_thinker/text_splitter.py:11+`).

## EAGER vs LAZY semantics

`SplittingStrategy` (used by `Process.split`) selects the path:

- **EAGER** — one LLM call for the whole document; cheap in call count but the request grows with page count, and the fallback groups everything together on failure.
- **LAZY** — N−1 pairwise calls (potentially concurrent); finer-grained and resumable per pair, but more calls. `Process` only allows LAZY for sources where `can_handle_paginate` is true — PDFs (`extract_thinker/process.py:231-236`).

Both strategies ultimately produce `DocGroups` whose `DocGroup` entries carry 1-based page lists and a classification name, consumed by `Process.extract` (`extract_thinker/process.py:276-277`).

## Data models

- `DocGroups2` — pairwise comparison result (`belongs_to_same_document`, `classification_page1`, `classification_page2`, optional `reasoning`) (`extract_thinker/models/doc_groups2.py:1-7`).
- `DocGroupsEager` / `DocGroup` (Pydantic) / `EagerDocGroup` (dataclass) — the eager response schema and internal group representation; `EagerDocGroup.pages` is typed `List[str]` although page numbers are used as integers (`extract_thinker/models/eager_doc_group.py:1-13`).
- `DocGroups` / `DocGroup` (plain classes in `doc_group.py`) — the final aggregation output.

## Testing

Splitter behavior is exercised through `tests/test_process.py` with real LLM calls; there is no isolated offline unit test for the boundary logic, so splitter changes are validated against live credentials.

## Related pages

- [Process: Multi-Document Split-and-Extract Workflow](process-workflow.md)
- [Contracts, Classifications, and Data Models](contracts-and-classifications.md)
- [Architecture and Component Map](architecture.md)
