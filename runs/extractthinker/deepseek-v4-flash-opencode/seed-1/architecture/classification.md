---
type: concept
title: Document Classification
description: How ExtractThinker assigns a document (or document pages) to one of a set of user-defined classes, using text-only prompts, vision-based image comparison, extractor-group strategies, and hierarchical classification trees.
tags: [classification, extractor, process, classification-tree, vision]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:16:41.841Z
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
  - id: openwiki-source-03c94b87dc3801c3c293e463
    resource: repo://tests/critical/test_critical_classification.py
  - id: openwiki-source-11ca4d71d0bcafa6689655ef
    resource: repo://tests/test_classify.py
generated: { by: "opencode", at: "2026-09-11T09:16:41.841Z" }
---

# Document Classification

Classification answers "what kind of document is this?" so that a document can later be routed to the right extraction contract. The building blocks are the `Classification` model (which pairs a human-readable name and description with an optional extraction contract and extractor), the `ClassificationResponse` result type, and two runtime entrypoints:

- `Extractor.classify` / `Extractor.classify_async` — classify a single source against a flat list of `Classification` objects.
- `Process.classify` / `Process.classify_async` — classify using layered extractor groups with a consensus strategy, or descend a `ClassificationTree` level by level.

## The Classification model

`Classification` (`extract_thinker/models/classification.py`) is a Pydantic model with the fields:

| Field | Type | Meaning |
|---|---|---|
| `name` | `str` | The classification name the LLM returns (matched case-insensitively). |
| `description` | `str` | Free-text guidance supplied to the LLM. |
| `contract` | optional type | Pydantic model whose structure is injected into the prompt to raise confidence when fields are present. |
| `extraction_contract` | optional type | Optional override contract used at extraction time (see Process splitting). |
| `image` | optional `str` | Path to a reference image used for vision-based classification. |
| `extractor` | optional `Any` | The `Extractor` used to extract this classification's contract in the Process flow. |
| `uuid` | `UUID` | Auto-generated stable identity used for tree-node matching. |

`set_image(image_path)` validates that the path is a real file before storing it; a non-file path raises `ValueError`. `contract` and `extraction_contract` are validated to be types via `field_validator`.

## The response type

`ClassificationResponse` (`extract_thinker/models/classification_response.py`) extends `ClassificationResponseInternal`, which has:

- `confidence`: integer from 1 to 10 (`ge=1, le=10`), 10 being highest.
- `name`: the matched classification name.

`ClassificationResponse` adds a `classification` field carrying the full matched `Classification` object. The internal model is what the LLM is asked to produce; the wrapper is what callers receive.

## Classification through the Extractor

`Extractor.classify(input, classifications, vision=False)` resolves a document loader for the source, sets `is_classify_image` from `vision`, loads content, and dispatches to `_classify` (`extract_thinker/extractor.py`).

### Text-only classification

`_classify_text_only` builds one prompt enumerating all classifications with `add_classification_structure(c)` (a rendered description of the contract's fields/types), asks the LLM for a `ClassificationResponseInternal`, then matches the returned name against the input list case-insensitively. The prompt tells the model that present contract fields should increase the confidence level. The matched `Classification` object is attached to the result.

### Vision-based classification

When `vision=True`, `_classify` switches to an ask-one-by-one approach. It extracts the first image from the loaded content (a list of pages or a single dict with an `image` key; missing images raise `ValueError`) and, for each classification:

- if the classification has a reference `image`, `_classify_one_image_with_ref` sends the reference image and the document image together and asks for a JSON `{"name": ..., "confidence": 1..10}` verdict;
- otherwise `_classify_one_image_no_ref` sends just the document image with a minimal prompt.

The classification with the highest confidence wins; if nothing matches, a fallback `ClassificationResponse(name="Unknown", confidence=1)` is returned. Each candidate request is made via `self.llm.request(messages, ClassificationResponseInternal)`.

## Classification through the Process

`Process.classify(file, classifications, strategy, threshold, image)` (`extract_thinker/process.py`) validates that `threshold` is an integer 1–10, then runs `classify_async`. Classifications can be a flat list or a `ClassificationTree`.

### Extractor groups and strategies

Extractors are registered as ordered "layers" of groups via `Process.add_classify_extractor([[extractor1, extractor2], [extractor3]])`. `classify_async` runs every extractor in the first layer concurrently (`asyncio.gather`) and applies the strategy:

- `ClassificationStrategy.CONSENSUS` — all extractors in the group must agree on the same name.
- `ClassificationStrategy.HIGHER_ORDER` — the classification with the highest confidence wins.
- `ClassificationStrategy.CONSENSUS_WITH_THRESHOLD` — all extractors must agree AND every confidence must be `>= threshold`.

If a layer does not meet the criteria, the next layer is tried. If no layer succeeds, a `ValueError("No consensus could be reached...")` is raised. This is the "Mixture of Models" (MoM) pattern exercised by `test_mom_classification_layers`.

### Classification trees

`ClassificationTree` holds a list of `ClassificationNode`; each node carries a `name`, a `Classification`, and `children` (recursive). `Process._classify_tree_async` performs a level-by-level descent:

1. Classify among the current level's classifications using the first extractor of the first group (`extractor_groups[0][0]`).
2. If the result confidence is below the (numeric) threshold, raise `ValueError`.
3. Match the returned classification to a node **by UUID** (`node.classification.uuid`); if no node matches, raise `ValueError`.
4. If the matched node has children, descend; otherwise return the result.

Tests confirm the tree result preserves the exact node's UUID and contract (`test_with_tree`, `test_large_classification_tree`) and that a confidence below the threshold raises `ValueError` (`test_tree_classification_low_confidence`). Note `_classify_tree_async` accepts a `float` threshold while the flat-list path requires an `int`; both enforce the 1–10 range.

## Representative tests

- `tests/test_classify.py` — feature, async, consensus, higher-order, consensus-with-threshold, contract-augmented, image-based, tree, low-confidence, large-tree, and MoM-layer cases.
- `tests/critical/test_critical_classification.py` — end-to-end classification of an invoice PDF through `Process`.
