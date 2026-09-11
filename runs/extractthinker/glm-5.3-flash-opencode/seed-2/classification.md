---
type: concept
title: Classification
description: How ExtractThinker assigns documents to user-defined categories via Extractor.classify (text and vision paths), layered Process strategies, and hierarchical ClassificationTree navigation.
tags: [classification, vision, consensus, extraction, llm]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:45:03.808Z
sources:
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-63f5e8b3f1330b1c6f1832d6
    resource: repo://extract_thinker/models/classification_node.py
  - id: openwiki-source-a2ad0cecc3781b040423f249
    resource: repo://extract_thinker/models/classification_response.py
  - id: openwiki-source-9b040ddd08f40366f527dfa0
    resource: repo://extract_thinker/models/classification.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-11ca4d71d0bcafa6689655ef
    resource: repo://tests/test_classify.py
generated: { by: "opencode", at: "2026-09-11T09:45:03.808Z" }
---

# Classification

Classification maps a loaded document to one of the caller's `Classification` choices, returning a `ClassificationResponse` with a 1–10 confidence score. It exists at two levels: standalone (`Extractor.classify`) and orchestrated (`Process.classify_async` with layered extractors or a `ClassificationTree`).

## Data model

- `Classification` (`extract_thinker/models/classification.py`): `name`, `description`, optional `contract` and `extraction_contract` (validated to be types), optional reference `image` path, optional `extractor` (used by Process to extract after splitting), and an auto-generated `uuid` (`Field(default_factory=uuid4)`) used for robust tree matching.
- `ClassificationResponseInternal` (`extract_thinker/models/classification_response.py`): Pydantic-constrained `confidence` integer between 1 and 10 plus `name`; `ClassificationResponse` adds the matching `classification` object.

## Extractor-level classification

`Extractor.classify(input, classifications, vision=False)` (`extract_thinker/extractor.py#L774-L807`) resolves a loader (extension-based, then capability fallback via `get_document_loader_for_file`), enables loader `vision_mode` when requested, loads the document, and delegates to `_classify`.

Two classification modes (`_classify`, `extract_thinker/extractor.py#L536-L607`):

- **Text mode** (`_classify_text_only`, `L722-L772`): one prompt enumerating all classes with descriptions and contract field structures (`add_classification_structure` from `extract_thinker/utils.py#L268-L326`); the name match is an exact case-insensitive string comparison against the candidates.
- **Vision mode** (`is_classify_image=True`): one-by-one image comparison. If the classification has a reference image, `_classify_one_image_with_ref` sends both images as base64 `image_url` content; otherwise `_classify_one_image_no_ref` sends the document alone. The best-confidence partial response wins; if nothing matched, a fallback `ClassificationResponse(name="Unknown", confidence=1)` is returned (`extract_thinker/extractor.py#L577-L607`).

Failure semantics: vision mode with no images in content raises `ValueError` ("No images found in content for vision-based classification") (`extract_thinker/extractor.py#L560-L574`).

## Process-level strategies

`Process.classify_async(file, classifications, strategy, threshold, image)` (`extract_thinker/process.py#L81-L125`) accepts either a flat list or a `ClassificationTree`. For flat lists it walks `extractor_groups` layers — each layer runs all its extractors concurrently via `asyncio.gather`:

- `ClassificationStrategy.CONSENSUS`: the layer yields a result only if all extractors agree on the same class name; otherwise the next layer runs.
- `ClassificationStrategy.HIGHER_ORDER`: the layer result is the classification with maximum confidence.
- `ClassificationStrategy.CONSENSUS_WITH_THRESHOLD`: consensus plus every extractor's confidence must meet the integer `threshold` (validated as 1–10).

If no layer satisfies the strategy across all groups, the method raises `ValueError("No consensus could be reached ...")` (`extract_thinker/process.py#L96-L125`). `threshold` is validated at both `Process.classify` and `classify_async` entry points (`process.py#L74-L90`).

## ClassificationTree hierarchical navigation

`_classify_tree_async` (`extract_thinker/process.py#L127-L188`) walks the tree level-by-level:

1. Classify among the current level's classifications.
2. Reject if confidence is below `threshold` (`ValueError`).
3. Match the response to the tree node **by UUID** rather than name ("Use UUID for robust matching instead of name", `process.py#L169-L176`).
4. Descend into children; a childless best match terminates the loop.

A failed level (`None` response) or no matching node raises `ValueError`. Note that the tree path uses whatever extractor layer 0 group 0 contains (`self.extractor_groups[0][0]`, `process.py#L148-L150`), so `add_classify_extractor` must have been called before tree classification.

## Split-to-classify linkage

`Process.split` stores `split_classifications`; on `Process.extract`, each doc group's classification name selects the classification, which in turn supplies the `extractor` and the contract (`extraction_contract` preferred over `contract`) used for that group's extraction (`extract_thinker/process.py#L240-L293`). Classification therefore drives which contract a split page group is extracted into.

## Tests

`tests/test_classify.py` exercises standalone extraction (`test_classify_feature`), async (`test_classify_async`), strategy behavior (`test_classify_consensus`, `tests/test_classify.py#L103-L129`), and large-tree scenarios (dummy contract classes at `L33-L39`). Tests use real credentials and OCR loaders (Tesseract/Textract), so they are integration tests.

Related: [Splitting and the Process Orchestrator](/openwiki/splitting-and-process.md) · [Extractor and Extraction Flow](/openwiki/extractor-and-extraction-flow.md)
