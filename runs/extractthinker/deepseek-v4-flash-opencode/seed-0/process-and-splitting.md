---
type: concept
title: Process and Splitting
description: The Process orchestration API and the Splitter family — eager vs lazy splitting, page-grouping via an LLM, doc-group aggregation, and per-group extraction dispatch.
tags: [process, splitting, splitter, eager, lazy]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:00:08.410Z
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
generated: { by: "opencode", at: "2026-09-11T09:00:08.410Z" }
---

# Process and Splitting

`Process` (`extract_thinker/process.py:18-...`) is the higher-level orchestration
API that chains **load file → split into documents → extract per group**, and is
also the multi-extractor classification entry point. It composes the components
documented in [Extraction](extraction.md) and
[Classification](classification.md).

## Process configuration

- `load_document_loader(loader)` sets a default loader but raises `ValueError`
  if per-file-type loaders already exist; `set_document_loader_for_file_type`
  is the inverse (`extract_thinker/process.py:31-39`).
- `load_splitter(splitter)` stores the splitter and, when it is an
  `ImageSplitter`, enables vision mode on every loaded document loader
  (`extract_thinker/process.py:42-63`).
- `add_classify_extractor(extractor_groups)` registers extractor layers used by
  `classify` (`extract_thinker/process.py:65-68`).
- `get_document_loader(file)` returns the default loader, or looks up the loader
  registered for the file's image type via `get_image_type`
  (`extract_thinker/process.py:194-199`).
- `load_file(file)` stores the path for the upcoming `split` call.

## Splitting strategies

`SplittingStrategy` (`extract_thinker/models/splitting_strategy.py`) has two
values:

- `EAGER` — the whole document (all pages at once) is analyzed and grouped in a
  single LLM call.
- `LAZY` — consecutive page pairs are compared one at a time and the boundaries
  are stitched together.

`Process.split(classifications, strategy=EAGER)`
(`extract_thinker/process.py:205-238`):

1. Requires a splitter (`ValueError` if none loaded) and a resolvable document
   loader.
2. Loads the file/stream into a page list; documents with fewer than 2 pages
   raise `ValueError("Document must have at least 2 pages")`.
3. For EAGER, `splitter.split_eager_doc_group(pages, classifications)` returns
   the groups directly.
4. For LAZY, the loader must support pagination —
   `document_loader.can_handle_paginate(file_path)` — otherwise `ValueError`
   (`"Document Type does not support lazy splitting. for now only pdf is
   supported"`). Lazy is therefore **PDF-only** at present
   (`extract_thinker/document_loader/document_loader.py:223-246`).

## The Splitter base class

`Splitter` (`extract_thinker/splitter.py:11-93`) is an ABC with three abstract
methods — `belongs_to_same_document`, `split_lazy_doc_group`, and
`split_eager_doc_group` — and shared helpers:

- `split_document_into_groups(document)` builds sliding windows of
  `page_per_split = 2` consecutive pages (`splitter.py:24-32`).
- `process_split_groups(split, contract)` runs `belongs_to_same_document` for
  each window concurrently with `asyncio.gather` (`splitter.py:34-48`).
- `aggregate_doc_groups(doc_groups_tasks)` (`splitter.py:50-92`) converts the
  pairwise `DocGroups2` decisions into a `DocGroups` of `DocGroup(pages,
  classification)`. The first pair seeds the running group (pages `[1,2]` when
  pages belong together, otherwise page 1 is emitted alone and page 2 starts a
  new group); each later pair either extends the running group or closes it and
  starts a new one with `classification_page2`.

`DocGroups2` (`extract_thinker/models/doc_groups2.py`) carries
`belongs_to_same_document`, `classification_page1`, `classification_page2`, and
optional `reasoning`. The eager output model `DocGroupsEager`
(`extract_thinker/models/eager_doc_group.py`) carries `reasoning` plus
`groupOfDocuments` entries of `classification` + `pages`.

## ImageSplitter

`ImageSplitter(model)` (`extract_thinker/image_splitter.py:11-...`) uses an LLM
to reason about page images:

- `belongs_to_same_document` requires an `'image'` key on both inputs, base64
  encodes them, and prompts the LLM with visual-consistency criteria plus the
  candidate classifications, parsing a `DocGroups2`
  (`image_splitter.py:37-113`).
- `split_lazy_doc_group` handles single-page documents with a default
  same-document group, otherwise compares consecutive page pairs and aggregates
  (`image_splitter.py:115-142`).
- `split_eager_doc_group` sends every page image (plus optional classification
  reference images) in one request, parses `DocGroupsEager`, and converts entries
  into `EagerDocGroup(pages, classification)` (`image_splitter.py:144-222`).
- **Fallback behavior**: if the LLM call fails, `belongs_to_same_document`
  returns a conservative `DocGroups2(belongs_to_same_document=True, ...)` that
  keeps pages together (defaulting to the first classification name), and
  `split_eager_doc_group` falls back to a single group covering all pages with
  classification `"unknown"` (`image_splitter.py:107-113`, `215-222`).

## TextSplitter

`TextSplitter(model)` (`extract_thinker/text_splitter.py:9-...`) is the text
analogue. It requires a `'text'` key on page inputs (the `Process` path passes
`{"text": page['content']}`), compares content-flow/writing-style criteria, and
has the same single-group fallbacks on LLM failure
(`text_splitter.py:15-154`).

## Extraction dispatch

`Process.extract(vision=False, completion_strategy=FORBIDDEN)`
(`extract_thinker/process.py:240-309`):

1. Raises `ValueError` if `doc_groups` was not initialized by `split`.
2. For each group (concurrently via `asyncio.gather`), `_extract`:
   - matches `group.classification` against `split_classifications` by name and
     picks the classification's extractor and contract
     (`extraction_contract or contract`), raising `ValueError` if no extractor
     matches (`process.py:247-261`);
   - reloads the document pages and selects the group's pages with
     `pages[i - 1] for i in doc_group.pages` (1-based page indices);
   - calls `extractor.set_skip_loading(True)`, runs
     `extractor.extract_async(group_pages, contract, vision, completion_strategy)`,
     and resets `skip_loading` in a `finally` block
     (`process.py:276-291`).
3. Returns the list of extracted contract instances, one per group.

Because extraction reuses the already-split pages rather than re-splitting, the
`set_skip_loading` flag tells `Extractor.extract` to map the source pages
directly instead of loading from a path (see
[Extraction](extraction.md#extract-paths)).
