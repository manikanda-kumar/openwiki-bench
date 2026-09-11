---
type: subsystem
title: "Classification & Splitting (Process)"
description: "How Process orchestrates multi-layer document classification, eager/lazy page-group splitting via LLM splitters, and per-group extraction."
tags: [process, classification, splitting, orchestration, llm]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T10:24:25.212Z
sources:
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-dc7c494e3ba5af8a22fe54b1
    resource: repo://extract_thinker/image_splitter.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-42be6a4a0c0db6ff5ebc246e
    resource: repo://extract_thinker/splitter.py
  - id: openwiki-source-cda8ee7e415b6ecdfb133cd9
    resource: repo://extract_thinker/text_splitter.py
  - id: openwiki-source-11ca4d71d0bcafa6689655ef
    resource: repo://tests/test_classify.py
  - id: openwiki-source-749f08e74a04a46f1629ea04
    resource: repo://tests/test_process.py
generated: { by: "opencode", at: "2026-09-11T10:24:25.212Z" }
---

# Classification & Splitting (Process)

`Process` (`extract_thinker/process.py`) is the workflow layer above `Extractor`. It owns three sequential phases — classify (what kind of document is this?), split (which pages belong to which document?), extract (run each group through the right extractor/contract) — and delegates all LLM work to `Extractor`, `Splitter`, and `LLM` instances it never constructs itself except via the splitters' own models.

## Loader configuration

`load_document_loader` sets a single default loader; `set_document_loader_for_file_type` registers per-extension loaders. The two are mutually exclusive: each raises `ValueError` if the other was configured first. `load_splitter` additionally propagates vision mode to every configured loader — `ImageSplitter` puts all loaders into `set_vision_mode(True)`, other splitters reset them to `False`. At resolve time, `get_document_loader` returns the default loader if present, else looks up `get_image_type(file)` in the by-type map (this lookup is image-format based, not extension based).

## Multi-layer classification

`add_classify_extractor([[e1, e2], [e3]])` appends *layers* of extractors. `classify()` validates the threshold as an integer 1–10, then runs `classify_async` via `asyncio.run`. For a flat `List[Classification]`:

- Each layer runs concurrently (`asyncio.gather`), each member calling `Extractor.classify` in a thread executor.
- `CONSENSUS` returns the layer result only when every extractor produced the same name; `HIGHER_ORDER` returns the max-confidence response; `CONSENSUS_WITH_THRESHOLD` requires both unanimity and `confidence >= threshold`.
- A layer that fails its criteria or raises (errors are printed and swallowed) falls through to the next layer; exhaustion raises `ValueError("No consensus could be reached ...")`. So `HIGHER_ORDER` effectively always returns from the first layer unless an extractor raised.

On the extractor side, `Extractor.classify` loads content through `get_document_loader_for_file` and calls `_classify`: text mode sends one enumerated prompt and maps the returned name case-insensitively onto the input classifications; vision mode (`image=True`) compares the document image against each classification's reference image (or a no-reference prompt) and returns the highest-confidence match, falling back to `ClassificationResponse(name="Unknown", confidence=1)` if nothing scored. The response carries `name`, `confidence` (1–10), and the matched `classification` object.

### Tree classification

Passing a `ClassificationTree` routes to `_classify_tree_async`, which walks one level at a time: it asks the **first extractor of the first layer** to classify among the current level's nodes, raises if the result is `None` or below `threshold`, then descends into the matched node's children. Nodes are matched by `classification.uuid` (a per-`Classification` UUID default) rather than by name to avoid ambiguity, and the walk stops at the first leaf.

## Splitting into document groups

`split(classifications, strategy)` requires a loaded splitter and loads the pages once; documents with fewer than 2 pages raise `ValueError`. Strategy differences:

- **EAGER**: `splitter.split_eager_doc_group(pages, classifications)` — one LLM request containing all pages (and classification reference images for `ImageSplitter`) returning a `DocGroupsEager` JSON with explicit `groupOfDocuments: [{classification, pages}]`; converted to `EagerDocGroup` list. On any LLM failure it falls back to one group of all pages classified `"unknown"`.
- **LAZY**: only allowed when `document_loader.can_handle_paginate(path)` (effectively PDF), else `ValueError`. The base `Splitter.split_document_into_groups` builds *overlapping consecutive pairs* `(1,2), (2,3), ...`, each pair is compared by `belongs_to_same_document` (image pairs as two base64 images; text pairs as page text under `=== PAGE BREAK ===` semantics), producing `DocGroups2` verdicts. `aggregate_doc_groups` then threads the verdicts into `DocGroup(pages=[...], classification=...)` with 1-based page numbers.

Both splitters share a conservative failure mode: if the comparison request raises, `belongs_to_same_document` returns `belongs_to_same_document=True` with both pages assigned the **first** classification, so an LLM outage keeps pages merged rather than splitting wrongly. `TextSplitter` expects page dicts carrying `content` (it rewraps them as `{"text": ...}` internally).

## Group extraction

`Process.extract()` requires `doc_groups` to exist (i.e., `split` ran). Per group, it finds the matching `Classification` by name, takes `classification.extraction_contract or classification.contract` as the response model, re-loads the full document through the loader, slices `pages[i-1]` for the group's 1-based page list, then calls `extractor.extract_async(source=group_pages, ..., set_skip_loading(True))`. All groups run under one `asyncio.gather`; a failing group propagates after a printed error.

## Focused tests

- `tests/test_classify.py` covers the sync/async entrypoints, each strategy (`test_classify_consensus`, `test_classify_higher_order`, `test_classify_both`), contract-informed classification, image classification, tree classification including a low-confidence rejection and a large tree, and multi-layer behavior (`test_mom_classification_layers`). These call live Gemini/GPT models (`global_models` presets) and sometimes Textract.
- `tests/test_process.py` runs the end-to-end `load_file → split → extract` chain over a multi-page scan (`tests/files/bulk.pdf`) with both `ImageSplitter` and `TextSplitter` under both strategies, asserting per-group contract fields. It requires a local tesseract binary path.

Related: [Contracts & Shared Models](/openwiki/architecture/contracts-and-models.md) for `Classification`/`ClassificationTree`/strategy enums, [Extractor Core](/openwiki/architecture/extractor.md) for `Extractor.classify` internals, and [Debugging Extraction Failures](/openwiki/guides/debugging-extraction-failures.md) for the swallowed-layer and fallback behaviors.
