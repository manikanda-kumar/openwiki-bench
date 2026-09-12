---
type: concept
title: Process and Splitters
description: The Process orchestration layer in ExtractThinker, covering classification strategies and tree classification, eager/lazy splitting, and per-group extraction.
tags: [process, classification, splitting, doc-groups]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:12:00.069Z
sources:
  - id: openwiki-source-dc7c494e3ba5af8a22fe54b1
    resource: repo://extract_thinker/image_splitter.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-cda8ee7e415b6ecdfb133cd9
    resource: repo://extract_thinker/text_splitter.py
generated: { by: "opencode", at: "2026-09-12T21:12:00.069Z" }
---

# Process and Splitters

`Process` (extract_thinker/process.py:18-309) is the higher-level orchestration
layer that classifies a document into candidates, optionally
splits it into groups by page, and then extracts one structured result per group.
It uses `ClassificationStrategy` (models/classification_strategy.py:4-7),
`SplittingStrategy` (models/splitting_strategy.py:4-6), and various `Splitter`
implementations.

## Configuration

`Process` holds an optional default `document_loader`, a
`document_loaders_by_file_type` map, a `splitter`, and one or more
`extractor_groups` (lists of `Extractor` instances) added via
`add_classify_extractor`. A default loader and per-file-type loaders are
mutually exclusive: setting one while the other is set raises `ValueError`
(process.py:31-40). `load_splitter` configures vision mode on all loaded loaders
when the splitter is an `ImageSplitter` (process.py:42-63).

## Classification

`classify` / `classify_async` (process.py:74-125) run each extractor group as a
set of parallel `Extractor.classify` calls and pick a result by strategy:

- `CONSENSUS`: return the classification only if all in the group agree on the
  name (process.py:104-106).
- `HIGHER_ORDER`: return the classification with the highest confidence
  (process.py:108-109).
- `CONSENSUS_WITH_THRESHOLD`: require name agreement and every confidence at or
  above the given threshold (process.py:111-114).

If no layer meets the criteria, `ValueError` is raised
(process.py:124-125). Threshold integers must be between 1 and 10.

`_classify_tree_async` (process.py:127-188) implements level-by-level
hierarchical classification over a `ClassificationTree`: at each level the
current node's classifications are classified, confidence is checked against the
threshold, and the matching node (by `Classification.uuid`) narrows the next
level's candidates.

## Splitting

`split` (process.py:205-238) requires a loaded splitter and a document with at
least two pages. Under `SplittingStrategy.EAGER` it calls
`split_eager_doc_group`; under `LAZY` it requires a loader that
`can_handle_paginate` (PDF only) and calls `split_lazy_doc_group`. The result
populates `self.doc_groups`.

### Base Splitter

`Splitter` (extract_thinker/splitter.py:11-93) defines abstract
`belongs_to_same_document`, `split_lazy_doc_group`, and `split_eager_doc_group`.
It provides `split_document_into_groups` (overlapping two-page pairs) and an
`aggregate_doc_groups` helper that converts per-pair decisions into contiguous
`DocGroup`s of page indices and classifications (splitter.py:50-92).

### Image and Text splitters

`ImageSplitter` (image_splitter.py:11-254) and `TextSplitter` (text_splitter.py:9-182)
both build an LLM and implement `belongs_to_same_document`: given two adjacent
pages, the LLM decides whether they share a document and assigns each a
classification, with the candidate classifications rendered into the prompt.
Both fall back to a conservative "same document, first classification" result on
LLM failure. `split_eager_doc_group` sends the whole document at once requesting
`groupOfDocuments` on a `DocGroupsEager` model; on failure they treat all pages as
one group classified "unknown".

## Extraction of groups

`Process.extract` (process.py:240-308) maps each `doc_group` to its
`classification`, finds the matching `Classification`, uses its `extractor` and
`extraction_contract`/`contract`, reloads the pages, selects the group's page
indices, and calls `extractor.extract_async` with `set_skip_loading(True)`
(because content is already loaded) under FORBIDDEN or the given completion
strategy. Groups are processed concurrently via `asyncio.gather`.
