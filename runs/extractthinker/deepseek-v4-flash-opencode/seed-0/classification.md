---
type: concept
title: Document Classification
description: How ExtractThinker decides what a document is — the Classification model, confidence semantics, the text-only and image-comparison classification paths, multi-extractor strategies, and hierarchical classification trees.
tags: [classification, vision, classification-tree, strategy]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:00:08.410Z
sources:
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-63f5e8b3f1330b1c6f1832d6
    resource: repo://extract_thinker/models/classification_node.py
  - id: openwiki-source-a2ad0cecc3781b040423f249
    resource: repo://extract_thinker/models/classification_response.py
  - id: openwiki-source-c68d1e2bb46b45e4043fb16a
    resource: repo://extract_thinker/models/classification_strategy.py
  - id: openwiki-source-64fcb723f813cd6f52c6fee4
    resource: repo://extract_thinker/models/classification_tree.py
  - id: openwiki-source-9b040ddd08f40366f527dfa0
    resource: repo://extract_thinker/models/classification.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
generated: { by: "opencode", at: "2026-09-11T09:00:08.410Z" }
---

# Document Classification

Classification answers "what kind of document is this?" so the right contract
and extractor can be applied. ExtractThinker has two classification entry
points: `Extractor.classify` for a single extractor, and `Process.classify`
for orchestrating multiple extractors (or a hierarchical tree).

## The Classification model

`Classification` (`extract_thinker/models/classification.py:6-33`) is a Pydantic
model with:

- `name` — the class label;
- `description` — a natural-language description used in prompts;
- `contract` / `extraction_contract` — optional Pydantic model classes (validated
  to be `type` in a before-validator); `extraction_contract` overrides `contract`
  during process extraction;
- `image` — an optional reference image file path (settable via `set_image`,
  which rejects non-file paths);
- `extractor` — the `Extractor` used to extract data for this class;
- `uuid` — a UUID auto-generated at construction.

## Response model and confidence semantics

`ClassificationResponseInternal` (`extract_thinker/models/classification_response.py:5-10`)
requires an integer `confidence` constrained to `1..10` and a `name`.
`ClassificationResponse` extends it with the matched `classification` object.

Confidence is always an integer on a 1–10 scale where 10 is highest. In the
text-only path, higher confidence is prompted when more contract fields are
present. In the image paths, the comparison prompt asks the model for
`{"name": ..., "confidence": <1..10>}`.

## Extractor.classify

`Extractor.classify` (`extract_thinker/extractor.py:774-807`) is the single
extractor path:

1. Resolves the loader with `get_document_loader_for_file` (extension-based,
   then capability-based; `extract_thinker/extractor.py:73-90`) and raises
   `ValueError` if none matches.
2. Sets `self.is_classify_image = vision` and calls `loader.set_vision_mode(True)`
   when vision is requested.
3. Loads content; in vision mode, if the loaded content has no `image` key, it
   wraps the input as `{"image": encode_image(input)}`.
4. Delegates to `_classify`. `classify_async` is the same call wrapped in
   `asyncio.to_thread` (`extract_thinker/extractor.py:809-823`).

### Text-only classification

`_classify_text_only` (`extract_thinker/extractor.py:722-772`) builds one prompt
enumerating every classification name/description plus its contract structure
(`add_classification_structure`), instructs the model that each present contract
field raises confidence, and parses `ClassificationResponseInternal`. It then
finds the matching `Classification` by exact case-insensitive name comparison
and returns a `ClassificationResponse` that carries the matched classification.

### Image (vision) classification

`_classify` (`extract_thinker/extractor.py:536-607`) takes a one-by-one
comparison approach when `is_classify_image` is true:

- The first image is extracted from the loaded content (raising `ValueError`
  if no image data is found) and base64-encoded.
- For each classification, the document image is compared either against the
  classification's reference image (`_classify_one_image_with_ref`,
  `extract_thinker/extractor.py:609-675`) or — when no reference image is set —
  classified against the label alone (`_classify_one_image_no_ref`,
  `extract_thinker/extractor.py:677-720`).
- The candidate with the highest confidence wins; if nothing matched, the
  fallback is `ClassificationResponse(name="Unknown", confidence=1)`.

## Process.classify and strategies

`Process.classify` / `classify_async` (`extract_thinker/process.py:74-125`)
runs a list of extractor "layers" (`extractor_groups`, registered via
`add_classify_extractor`). Each layer's extractors classify the same document
concurrently (`asyncio.gather` of `_classify_async`). A layer succeeds only if
the configured strategy is satisfied; otherwise the loop `continue`s to the next
layer. If no layer succeeds, `ValueError("No consensus could be reached on the
classification of the document across any layer. ...")` is raised.

The strategies (`extract_thinker/models/classification_strategy.py`):

- `CONSENSUS` — all extractors in the layer returned the same name
  (`len(set(c.name ...)) == 1`);
- `HIGHER_ORDER` — pick the classification with the highest confidence;
- `CONSENSUS_WITH_THRESHOLD` — consensus plus every extractor's confidence
  ≥ `threshold`.

`threshold` must be an integer between 1 and 10 in both sync and async entry
points; anything else raises `ValueError` (`extract_thinker/process.py:74-90`).

## Hierarchical classification trees

`ClassificationTree` (`extract_thinker/models/classification_tree.py:5-6`)
holds a list of `ClassificationNode`s; each node has `name`, `classification`,
and `children` (recursive) (`extract_thinker/models/classification_node.py:4-12`).

`Process._classify_tree_async` (`extract_thinker/process.py:127-188`) walks the
tree level by level:

1. At each level, classify the file against that level's classifications using
   the first extractor of the first group (`extractor_groups[0][0]`).
2. A `None` response or a confidence below the (float-accepted) threshold raises
   `ValueError`.
3. The best response is matched to a node by `classification.uuid` (not name);
   a missing match raises `ValueError`.
4. If the matched node has children, descend; otherwise stop and return the best
   classification.

This is driven from `classify_async`, which dispatches to the tree path when the
classifications argument is a `ClassificationTree`
(`extract_thinker/process.py:92-93`).
