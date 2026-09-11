---
type: concept
title: "Classification: strategies, trees, and mixture of models"
description: "How ExtractThinker classifies documents or document sections: the Classification model, text vs vision classification paths, Process-level consensus/higher-order/threshold strategies, tree classification by UUID, and layered mixture-of-models."
tags: [classification, extractor, process, mixture-of-models, classification-tree]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:31:28.803Z
---

# Classification: strategies, trees, and mixture of models

Classification in ExtractThinker decides *what kind of document* a source is. It is implemented at two layers:

- `Extractor.classify` runs a single classification pass over one source and returns a `ClassificationResponse`.
- `Process.classify` / `Process.classify_async` orchestrates one or more `Extractor` layers (a "mixture of models") with voting strategies, or walks a `ClassificationTree` level by level.

Both paths reuse the same `Classification` and `ClassificationResponse` models.

## The Classification model

A `Classification` (extract_thinker/models/classification.py) binds a document type to a contract and optionally to an extractor and a reference image:

- `name` and `description` describe the document type.
- `contract` is the Pydantic `Contract` used for extraction or to boost classification confidence.
- `extraction_contract` overrides the contract actually used when `Process.extract` runs for a group classified with this label (see the [process and splitting](process-and-splitting.md) page).
- `extractor` is the `Extractor` instance used to extract data for that classification inside a split workflow.
- `image` is an optional reference image path used for vision classification; `set_image` validates that the path exists.
- `uuid` is auto-generated (`default_factory=uuid4`). It is the stable identity used to match tree nodes, so classification survives name changes.

## Classification responses and the confidence contract

The LLM is asked to return a `ClassificationResponseInternal` with a `name` and an integer `confidence` from 1 to 10 (`Field(ge=1, le=10)`), see extract_thinker/models/classification_response.py. `ClassificationResponse` extends that internal model with the full matched `Classification` object.

Two matching conventions exist:

- In the text path, `Extractor._classify_text_only` compares the returned `name` to each `Classification.name` with a **case-insensitive, stripped exact string match** (extractor.py `_classify_text_only`).
- In tree classification, matching is done by **UUID equality** between the response's `classification.uuid` and the node's `classification.uuid` (process.py `_classify_tree_async`), which the tests assert explicitly (`tests/test_classify.py` `test_with_tree`).

## Single-pass classification on the Extractor

`Extractor.classify(input, classifications, vision=False)` (extractor.py) picks a document loader via `get_document_loader_for_file`, sets `is_classify_image = vision`, enables vision mode on the loader, loads the content, and delegates to `_classify`.

- **Text path** (`_classify_text_only`): one prompt lists all classifications (with contract structure from `add_classification_structure`) and asks for a single JSON `{"name", "confidence"}`; the response is matched back to a `Classification` by exact name.
- **Vision path** (`_classify` with `is_classify_image=True`): the document image is compared against each classification one-by-one. If the classification has a reference image, `_classify_one_image_with_ref` sends the document image and the reference image in one message; otherwise `_classify_one_image_no_ref` asks about the document image alone. The classification with the highest confidence wins, with `ClassificationResponse(name="Unknown", confidence=1)` as a fallback. Confidence is still returned on the 1-10 scale used by the internal model.

## Process-level strategies (mixture of models)

`Process.add_classify_extractor` registers **layers** of extractors (`extractor_groups: List[List[Extractor]]`). `classify_async` runs each layer's extractors concurrently over the same source and tries to reach a decision per layer before falling through to the next:

- `CONSENSUS` — all extractors in the layer returned the same `name`.
- `HIGHER_ORDER` — take the classification with the highest confidence.
- `CONSENSUS_WITH_THRESHOLD` — all names agree **and** every confidence is `>= threshold`.

If no layer satisfies the strategy, the next layer is tried; if all layers fail, a `ValueError` is raised (`process.py` `classify_async`). `threshold` is validated to be an integer in `1..10` in the synchronous `Process.classify` wrapper, which is otherwise just `asyncio.run(self.classify_async(...))`. This layering is what powers the "mixture of models" tests: cheap models as layer 1, stronger models as layer 2 to break ambiguity (`tests/test_classify.py` `test_mom_classification_layers`).

## Tree classification

`Process.classify` accepts a `ClassificationTree` in place of a flat list. `_classify_tree_async` walks the tree level by level (process.py):

1. Start at `classification_tree.nodes`.
2. Classify the document among the current level's `Classification` objects using `self.extractor_groups[0][0]` (the first extractor of the first layer) with `image=image`.
3. If the response is `None` or its confidence is below `threshold`, raise `ValueError`.
4. Find the node whose `classification.uuid == best_classification.classification.uuid`; if none matches, raise `ValueError`.
5. Descend into that node's `children` and repeat; stop at a leaf.

`ClassificationNode` is a recursive Pydantic model (`children: List['ClassificationNode']`) and `ClassificationTree` is just a list of root nodes. Multi-level trees (e.g. Financial → Invoice/Bill → Sales/Purchase Invoice) are exercised in `tests/test_classify.py` `test_large_classification_tree`, which asserts the returned classification's `uuid` equals the leaf node's `uuid`.

## Where classification results flow next

In split workflows, a `DocGroup` stores a `classification` string and `Process.extract` maps that string back to the matching `Classification` (by exact `name`) to pick the extractor and contract for extraction. See [process and splitting](process-and-splitting.md).

## Testing

- `tests/test_classify.py` covers flat classification, async, all three strategies, contract-bearing classifications, image-reference classification, UUID-based tree matching, low-confidence tree errors, a large multi-level tree, and the two-layer mixture-of-models resolution.
- `tests/critical/test_critical_classification.py` is the CI-critical end-to-end classification smoke test.