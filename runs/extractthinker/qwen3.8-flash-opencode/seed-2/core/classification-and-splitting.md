---
type: workflow
title: "Classification and Splitting"
description: "How documents are classified (Extractor.classify single-LLM text/vision paths; Process consensus/MoM/tree strategies) and split into per-document groups (Splitter lazy pair-comparison vs eager whole-document aggregation, ImageSplitter and TextSplitter prompts and conservative fallbacks)."
tags: [classification, splitting, consensus, mixture-of-models, tree, vision]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T11:01:32.247Z
sources:
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-dc7c494e3ba5af8a22fe54b1
    resource: repo://extract_thinker/image_splitter.py
  - id: openwiki-source-9b040ddd08f40366f527dfa0
    resource: repo://extract_thinker/models/classification.py
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
generated: { by: "opencode", at: "2026-09-11T11:01:32.247Z" }
---

# Classification and Splitting

Two related but separately owned workflows use classification labels: **classifying** a whole input into one of several `Classification` definitions (choosing which contract applies), and **splitting** a multi-document file into page groups, each classified, for per-group extraction.

## The Classification model

`Classification` (a Pydantic model, `extract_thinker/models/classification.py`) carries `name`, `description`, an optional `contract` and separate `extraction_contract` (both validated to be *types*), an optional reference `image` path (validated by `set_image()` to exist), an optional bound `extractor`, and an auto-generated `uuid` (`models/classification.py:6-33`). The uuid is the identity used by tree matching; the LLM-visible responses are `ClassificationResponseInternal {name, confidence 1..10}` and its subclass `ClassificationResponse`, which pins the matched `classification` object (`models/classification_response.py`).

## Single-LLM classification: `Extractor.classify`

`Extractor.classify(input, classifications, vision=False)` resolves a loader with `get_document_loader_for_file`, flips the loader into vision mode when `vision=True`, loads the content, and delegates to `_classify` (`extractor.py:774-807`).

- **Text path** (`_classify_text_only`, `extractor.py:722-772`): one prompt enumerates every `name: description` pair plus `add_classification_structure(contract)` (so field names only *nudge* confidence — the prompt explicitly says "Don't use contract structure, just to help on the ClassificationResponse"), asks for `{"name": ..., "confidence": <1..10>}`, and maps the returned name back to the matching `Classification` by case-insensitive stripped comparison. Quirk: an unknown name yields no match and the method dereferences `None` (AttributeError) rather than a clean error (`extractor.py:761-771`).
- **Vision path** (`_classify`, `extractor.py:536-607`): instead of one comparative prompt, it runs an "ask one-by-one" loop. The document image (first `image` found in the loaded pages/dict; bytes are base64-encoded) is scored against each classification — with its reference image (`_classify_one_image_with_ref`, `extractor.py:609-675`) or with a text-only classification description when no reference image exists (`extractor.py:677-720`). The highest-confidence response wins; if no comparison produced a confidence, the code falls back to `ClassificationResponse(name="Unknown", confidence=1)` (`extractor.py:600-605`).

`classify_async` is just `asyncio.to_thread(self.classify, ...)` (`extractor.py:809-823`).

## Multi-LLM classification: `Process`

`Process` holds "layers" of extractors added via `add_classify_extractor(List[List[Extractor]])`; each inner list is one simultaneous tier, and the outer list is tried in order — the Mixture-of-Models pattern (`process.py:65-125`). `classify()` (sync wrapper over `classify_async`) validates that `threshold` is an integer in 1..10, then for each layer runs all extractors' `classify` concurrently (`asyncio.gather`) and applies the `ClassificationStrategy`:

- `CONSENSUS`: accept if every extractor in the layer returned the same name;
- `HIGHER_ORDER`: return the max-confidence response immediately;
- `CONSENSUS_WITH_THRESHOLD`: require both unanimity and `confidence >= threshold` for all;
- a layer that throws is printed (`"Layer failed with error"`), skipped, and the next layer is tried; exhaustion raises `ValueError("No consensus could be reached on the classification of the document across any layer...")` (`process.py:104-125`).

`tests/test_classify.py` exercises each strategy; the MoM test builds layer 1 with two light models and layer 2 with two stronger ones, classifying an "ambiguous credit note" with `CONSENSUS_WITH_THRESHOLD, threshold=8` and asserting the final result is the `Credit Note` classification with its contract attached (`tests/test_classify.py:495-558`).

### Tree classification

When `classifications` is a `ClassificationTree` (root nodes of `ClassificationNode {name, classification, children}`, `models/classification_node.py`, `models/classification_tree.py`), `Process._classify_tree_async` walks level-by-level (`process.py:127-188`): each level classifies only among that level's nodes using the **first extractor of the first layer** (`self.extractor_groups[0][0]`) — MoM escalation does not apply per level; a null result, a confidence below the (int-or-float, 1..10) threshold, or a response whose classification uuid matches no node raises `ValueError`. Node selection matches on `node.classification.uuid` explicitly "Use UUID for robust matching instead of name" (`process.py:169-181`). Descent continues until a leaf; tests include a low-confidence rejection and a large-tree scenario (`tests/test_classify.py:289,353`).

## Splitting: `Splitter` and its subclasses

`Process.split(classifications, strategy)` requires a loaded splitter, at least 2 pages from the document loader, and for `LAZY` strategy that the loader reports `can_handle_paginate` (effectively PDFs: "for now only pdf is supported") (`process.py:205-238`). The splitter consumes the loaded page dicts and produces groups of `pages` (1-based indices) tagged with a classification name — `DocGroup`/`EagerDocGroup` — stored in `self.doc_groups`.

The base class defines the mechanics (`splitter.py:11-92`): `split_document_into_groups` builds overlapping consecutive pairs (page i with i+1, stride 1); `aggregate_doc_groups` folds the pair verdicts into contiguous groups: while `belongs_to_same_document` is true the current group extends, otherwise a new group starts with page i+1 taking `classification_page2`.

- **`ImageSplitter`** compares two page *images* (`'image'` keys required) in one vision request, asking for `{belongs_to_same_document, classification_page1, classification_page2, reasoning}`; the prompt embeds each classification's name, description, and contract field structure (`image_splitter.py:37-113,224-254`). On any LLM failure the fallback is deliberately conservative: pages stay together, classified as `classifications[0].name` (`image_splitter.py:107-113`). Eager mode analyzes the entire document at once into `DocGroupsEager {reasoning, groupOfDocuments:[{classification, pages}]}`, falling back to one `"unknown"`-classified group on error (`image_splitter.py:144-222`). Two code-level caveats: the lazy path returns an unaggregated `[DocGroups2]` list for single-page input, and the eager path's reference-image block appends to a `messages` list before it is (re)defined, so eager splitting with any classification carrying `image` set hits a `NameError` (`image_splitter.py:167-191`) — the repository's own eager tests use image-less classifications (`tests/test_process.py:66-103`).
- **`TextSplitter`** mirrors this over `'text'`/`'content'` page keys, joining pages with `=== PAGE BREAK ===` for the eager request (`text_splitter.py:15-154`).

Splitting and classification compose in `Process.extract`: for each doc group it finds the matching `Classification` by name, uses that class's bound `extractor` and `extraction_contract or contract` as the response model, re-loads the file, slices the 1-based page list for that group, and calls `extract_async` with `set_skip_loading(True)` so the extractor treats the page dicts as already-loaded content — all groups run concurrently under one event loop (`process.py:240-309`).

## Failure behavior summary

| Stage | Trigger | Result |
|---|---|---|
| Extractor text classify | unknown class name | `AttributeError` (None dereference), `extractor.py:761-771` |
| Extractor vision classify | no confidence from any comparison | `"Unknown"` fallback response, `extractor.py:600-605` |
| Process classify | layer exception | printed + skipped to next layer, `process.py:119-122` |
| Process classify | all layers fail criteria | `ValueError` "No consensus could be reached", `process.py:125` |
| Tree classify | below threshold / unmatched node / null | `ValueError`, `process.py:156-181` |
| Splitters | LLM request failure | conservative grouping (same-document or single `unknown` group) |
