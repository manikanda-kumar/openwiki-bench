---
type: workflow
title: Process — Multi-Document Split-and-Extract Workflow
description: The Process class orchestrates multi-document pipelines — load_file, split with EAGER/LAZY strategies, layered classification with consensus strategies or classification trees, and concurrent per-group extraction.
tags: [process, workflow, splitting, classification, orchestration]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T08:46:09.069Z
sources:
  - id: openwiki-source-8c1194dbc029d262f0a9e0ec
    resource: repo://extract_thinker/document_loader/cached_document_loader.py
  - id: openwiki-source-e5d98d15f37805328cfa039e
    resource: repo://extract_thinker/document_loader/document_loader.py
  - id: openwiki-source-dc7c494e3ba5af8a22fe54b1
    resource: repo://extract_thinker/image_splitter.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
generated: { by: "opencode", at: "2026-09-11T08:46:09.069Z" }
---

# Process: Multi-Document Split-and-Extract Workflow

`Process` (in `extract_thinker/process.py:18+`) handles documents that contain several distinct sub-documents — e.g. a PDF combining an invoice and a driver's license. It chains a splitter, per-group classifications, and per-group extractors into a fluent pipeline: `process.load_file(path).split(classifications, strategy=...).extract()`.

## Configuration and loader rules

`Process` holds a default `document_loader`, a per-file-type registry (`document_loaders_by_file_type`), a `splitter`, and accumulated state (`doc_groups`, `split_classifications`, `extractor_groups`). The two loader configurations are mutually exclusive: setting a default loader after per-type loaders (or vice versa) raises `ValueError` (`extract_thinker/process.py:31-40`).

`load_splitter(splitter)` stores the splitter and propagates vision mode to every configured loader based on whether the splitter is an `ImageSplitter` (`extract_thinker/process.py:42-63`). Loader resolution at split/extract time prefers the default loader; otherwise it looks up by `get_image_type(file)` and returns `None` when nothing matches, which later raises `ValueError("No suitable document loader found for file type")` (`extract_thinker/process.py:193-199`).

## Splitting phase

`split(classifications, strategy=SplittingStrategy.EAGER)` (`extract_thinker/process.py:205-238`):

1. Requires a splitter to be loaded.
2. Loads all pages through the resolved loader and requires **at least 2 pages**.
3. `EAGER` — the splitter groups the whole document in a single LLM analysis (`split_eager_doc_group`).
4. `LAZY` — pairwise page-boundary detection (`split_lazy_doc_group`), permitted only when `document_loader.can_handle_paginate(file)` is true; since that check is PDF-only, lazy splitting fails with `"Document Type does not support lazy splitting. for now only pdf is supported"` for anything else.

The result is stored in `self.doc_groups` and `self` is returned for chaining.

## Extraction phase

`extract(vision=False, completion_strategy=FORBIDDEN)` (`extract_thinker/process.py:240-307`) runs an async pipeline over the doc groups:

1. Each group's classification name is matched against `split_classifications` to find its `extractor` and contract (`extraction_contract or classification.contract`); a missing extractor raises `ValueError`.
2. Pages are re-loaded from the source file and sliced by the group's 1-based page numbers (`pages[i - 1]`).
3. `extractor.set_skip_loading(True)` tells the Extractor the content is pre-loaded; extraction runs via `extract_async` with the requested completion strategy; the flag is reset in a `finally` block.
4. All groups run concurrently via `asyncio.gather`; a synchronous event loop (`loop.run_until_complete`) drives it, and errors propagate after printing.

Note that pages are re-loaded once per group — the loader cache (TTL 300s by default) is what makes this tolerable rather than O(groups × load time).

## Classification layers and strategies

`add_classify_extractor(extractor_groups)` registers layers of extractors (`List[List[Extractor]]`) used by `classify`/`classify_async` (`extract_thinker/process.py:65-68`). Classification runs **layer by layer**: within a layer, every extractor classifies the file concurrently (`asyncio.gather`), then the strategy decides whether the layer's result is accepted (`extract_thinker/process.py:81-125`):

| Strategy | Acceptance condition |
|---|---|
| `CONSENSUS` | All extractors in the layer return the same classification name |
| `HIGHER_ORDER` | The highest-confidence result in the layer wins immediately |
| `CONSENSUS_WITH_THRESHOLD` | Unanimous names *and* every confidence ≥ `threshold` |

`threshold` must be an integer 1–10 (validated in both sync and async entry points). If a layer doesn't meet its criterion (or errors — errors are printed and the loop continues), the next layer is tried; exhausting all layers raises `ValueError("No consensus could be reached...")`. There is no fallback result.

## Classification trees

Passing a `ClassificationTree` instead of a flat list switches to hierarchical classification (`_classify_tree_async`, `extract_thinker/process.py:127-188`): starting from the tree's root nodes, each level classifies among the level's classifications using the *first extractor of the first layer* (`extractor_groups[0][0]` — a tree requires at least one layer to be registered), enforces the threshold at every level (confidence below threshold raises `ValueError`), and descends into the child nodes of the winning classification, matched by `uuid` rather than name. The walk ends when the winning node has no children.

## Relation to Extractor

`Process` never talks to an LLM directly: splitting goes through the `Splitter` (which owns its own LLM) and extraction is delegated to per-classification `Extractor` instances. This is the ownership boundary — `Process` is a workflow coordinator, `Extractor` is the LLM engine wrapper. See [Splitting Strategies](splitting.md) for the splitter internals and [Extractor](extractor.md) for the extraction engine.

## Representative tests

`tests/test_process.py` exercises the split-and-extract pipeline with fixture documents; like most of the suite it requires live LLM credentials.

## Related pages

- [Splitting Strategies and Splitters](splitting.md)
- [Extractor: Extraction and Classification Engine](extractor.md)
- [Contracts, Classifications, and Data Models](contracts-and-classifications.md)
- [Architecture and Component Map](architecture.md)
