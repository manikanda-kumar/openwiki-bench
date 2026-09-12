---
type: concept
title: Process and Document Splitting
description: The Process component that chains file loading, document splitting under classifications, and per-group extraction, plus the Splitter abstractions (ImageSplitter, TextSplitter) with eager and lazy strategies.
tags: [process, splitting, eager, lazy, splitter, image-splitter, text-splitter]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:16:59.187Z
sources:
  - id: openwiki-source-dc7c494e3ba5af8a22fe54b1
    resource: repo://extract_thinker/image_splitter.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-42be6a4a0c0db6ff5ebc246e
    resource: repo://extract_thinker/splitter.py
  - id: openwiki-source-cda8ee7e415b6ecdfb133cd9
    resource: repo://extract_thinker/text_splitter.py
generated: { by: "opencode", at: "2026-09-12T21:16:59.187Z" }
---

# Process and Document Splitting

`Process` (`extract_thinker/process.py:18`) chains the multi-step document workflow: pick a loader, load a file, split it into classified page-groups, and extract each group via the matching extractor. Splitting is implemented by the `Splitter` family (LLM-based page comparison).

## Process state machine

`Process.__init__` keeps:

- `document_loader` (default loader) and `document_loaders_by_file_type`.
- `splitter` (an `ImageSplitter` or `TextSplitter`).
- `extractor_groups: List[List[Extractor]]` — layers of extractors used for classification.
- `doc_groups` — the result of splitting (`DocGroups` or a list of `EagerDocGroup`).
- `file_path` / `file_stream` and `_content_loaded`.

### Configuration

- `load_document_loader(loader)` sets the default loader; rejects if per-type loaders are already set (`extract_thinker/process.py:36`).
- `set_document_loader_for_file_type(file_type, loader)` registers a per-extension loader; rejects if a default loader is already set (`extract_thinker/process.py:31`).
- `load_splitter(splitter)` (`extract_thinker/process.py:42`) stores the splitter and, when it's an `ImageSplitter`, calls `set_vision_mode(True)` on all loaded loaders (auto-enabling vision for image splitting).
- `add_classify_extractor(groups)` appends extractor layers.

### File loading

- `load_file(file)` binds a file path.
- `get_document_loader(file)` (`extract_thinker/process.py:194`) returns the default loader, or the per-type loader chosen by `get_image_type`.

### split

`split(classifications, strategy=EAGER)` (`extract_thinker/process.py:205`):

- Requires a splitter be loaded, else `ValueError("No splitter loaded...")`.
- Requires a suitable loader; loads pages via `document_loader.load(...)`.
- Requires at least 2 pages (`ValueError("Document must have at least 2 pages")`).
- `EAGER` → `splitter.split_eager_doc_group(pages, classifications)`.
- `LAZY` → requires `document_loader.can_handle_paginate(file_path)` (currently PDF only), else `ValueError("Document Type does not support lazy splitting...")`, then `split_lazy_doc_group`.

### extract

`extract(vision=False, completion_strategy=FORBIDDEN)` (`extract_thinker/process.py:240`):

- Requires `doc_groups` (else `ValueError`).
- For each `doc_group`, finds the matching `Classification` by `name`; looks up its `extractor` and (if set) `extraction_contract` (`extract_thinker/process.py:253`).
- Reloads pages for the group (`pages[i-1] for i in doc_group.pages`), sets `extractor.set_skip_loading(True)`, calls `extractor.extract_async(group_pages, contract, vision, content=None, completion_strategy)`, then resets the skip flag.
- Runs all groups concurrently via `asyncio.gather` in a loop and returns the list of validated results.

## Classification within Process

`Process.classify` (`extract_thinker/process.py:74`) is a synchronous wrapper over `classify_async`.

`classify_async(file, classifications, strategy=CONSENSUS, threshold=9, image=False)` (`extract_thinker/process.py:81`):

- Validates `threshold` is an int in 1–10.
- For a `ClassificationTree`, delegates to `_classify_tree_async`.
- Otherwise, for each extractor layer, gathers each layer's `extractor.classify(...)` results concurrently (`asyncio.gather`) and applies the `ClassificationStrategy`:
  - `CONSENSUS` — return when all layer results share the same `name`.
  - `HIGHER_ORDER` — return `max(...)` by `confidence`.
  - `CONSENSUS_WITH_THRESHOLD` — return when names agree and all confidences ≥ threshold.
- If no layer satisfies the strategy, raises `ValueError("No consensus could be reached...")`.

`_classify_tree_async` (`extract_thinker/process.py:127`) implements hierarchical level-by-level classification using the first registered extractor, threshold validation, and `node.classification.uuid` matching (see `/openwiki/concepts/contracts-classifications.md`).

## The Splitter contract

`Splitter` (`extract_thinker/splitter.py:11`) is abstract with:

- `belongs_to_same_document(page1, page2, contract) -> DocGroups2` — does page2 continue page1?
- `split_lazy_doc_group(doc, classifications) -> DocGroups` — lazy (pairwise) split.
- `split_eager_doc_group(doc, classifications) -> DocGroups` — whole-document split.

Shared helpers:
- `split_document_into_groups` (`extract_thinker/splitter.py:24`) — sliding window of 2 pages.
- `process_group` / `process_split_groups` — concurrent `belongs_to_same_document` over pairs.
- `aggregate_doc_groups` (`extract_thinker/splitter.py:50`) — the base final-grouping used by subclasses.

### SplittingStrategy

`SplittingStrategy` (`extract_thinker/models/splitting_strategy.py`): `EAGER` (all pages analyzed together) and `LAZY` (page pairs).

## ImageSplitter

`ImageSplitter` (`extract_thinker/image_splitter.py:11`) wraps `LLM(model)`.

- `belongs_to_same_document(obj1, obj2, ...)` compares two pages' `image` keys (base64-embedded into an image+text prompt) and returns a `DocGroups2`, asking the model to decide whether pages belong together and classify each page. On LLM failure it returns a **conservative fallback** of `belongs_to_same_document=True` and both classifications defaulting to the first classification's name (`extract_thinker/image_splitter.py:108`).
- `split_lazy_doc_group` pairs pages via `split_document_into_groups`, runs the comparisons, and calls `aggregate_doc_groups`. A single-page document returns one group.
- `split_eager_doc_group` encodes all page images (plus any optional classification example images), asks the model for a `DocGroupsEager` (`groupOfDocuments`), and converts each entry to `EagerDocGroup`. On failure it falls back to one `EagerDocGroup` spanning all pages with classification `"unknown"` (`extract_thinker/image_splitter.py:217`).

## TextSplitter

`TextSplitter` (`extract_thinker/text_splitter.py:9`) works on `content` text instead of images.

- `belongs_to_same_document` compares two pages' `text`/`content` via an LLM, with a conservative failure fallback identical to `ImageSplitter`.
- `split_lazy_doc_group` and `split_eager_doc_group` mirror the image splitter's structure, using `DocGroups2` and `DocGroupsEager` respectively; eager groups join pages separated by `=== PAGE BREAK ===` for the whole-document prompt.

## Loader interaction

Both splitters depend on the document loader to supply page dicts:

- `ImageSplitter` requires each page dict to carry an `image`; loading must be run with `vision_mode=True` (auto-enabled by `Process.load_splitter`).
- `TextSplitter` reads page `content` text.

## Testing

- `tests/test_process.py` exercises eager/lazy splitting through `ImageSplitter` and `TextSplitter` (both text and vision), extraction-contract routing, and the "split requires splitter" guard.
- `tests/test_extractor.py::test_pagination_handler` and `test_batch_extractor.py` exercise related extractor behaviors.
