---
type: core-concept
title: Classification
description: How documents are classified against user-defined Classification types, including text and image paths, multi-layer extractor strategies, and hierarchical trees.
tags: [classification, consensus, classification-tree, vision]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:40:03.572Z
sources:
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-63f5e8b3f1330b1c6f1832d6
    resource: repo://extract_thinker/models/classification_node.py
  - id: openwiki-source-c68d1e2bb46b45e4043fb16a
    resource: repo://extract_thinker/models/classification_strategy.py
  - id: openwiki-source-9b040ddd08f40366f527dfa0
    resource: repo://extract_thinker/models/classification.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
generated: { by: "opencode", at: "2026-09-11T09:40:03.572Z" }
---

# Classification

Classification decides which document type a source belongs to and attaches the matching contract for downstream extraction. It is exposed through two entrypoints:

- `Extractor.classify(input, classifications, vision)` / `classify_async` (extract_thinker/extractor.py:774-823)
- `Process.classify(file, classifications, strategy, threshold, image)` / `classify_async` (extract_thinker/process.py:74-125)

## Classification model

`Classification` (extract_thinker/models/classification.py:6-33) carries:

- `name`, `description` — identity and prompt-facing semantics.
- `contract` and `extraction_contract` (`Optional[Type]`) — optional contract classes for extraction after classification; validators reject non-type values; `Process.extract` prefers `extraction_contract` and falls back to `contract` (extract_thinker/process.py:255-258).
- `image` (`Optional[str]`) — path to a reference image used in image classification; `set_image` verifies the path exists.
- `extractor` (`Optional[Any]`) — the `Extractor` used when this classification is chosen within `Process`.
- `uuid` (uuid4 default) — used for robust tree-node matching rather than name strings (extract_thinker/process.py:168-176).

## Extractor-level classification

`Extractor.classify` resolves a loader via `get_document_loader_for_file` (extension lookup, then primary loader, then all registered loaders; raises `ValueError` on none, extract_thinker/extractor.py:73-94). With `vision=True` it puts the loader in vision mode and, if the loaded dict lacks an `image` key, encodes the raw input (extract_thinker/extractor.py:792-807).

`self.is_classify_image` selects the internal path:

- **Text path** (`_classify_text_only`, extract_thinker/extractor.py:722-772): a single LLM prompt enumerating every classification name/description plus its contract structure via `add_classification_structure`. The response model is `ClassificationResponseInternal` (name + confidence); the returned name is matched case-insensitively against the provided `Classification.name` values, and the response is wrapped as `ClassificationResponse(name, confidence, classification=matched)`.
- **Image path** (`_classify`, extract_thinker/extractor.py:536-607): one-by-one "ask" loop. For each classification, the document image is compared against the classification reference image (`_classify_one_image_with_ref`) or classified alone when no reference exists (`_classify_one_image_no_ref`). The highest-confidence response wins; all-failure falls back to `ClassificationResponse(name="Unknown", confidence=1)`. Both variants request the literal JSON shape `{"name": ..., "confidence": <1..10>}` from a vision-capable model.

## Process-level classification: layered strategies

`Process.classify_async` runs classification layers of extractors registered via `add_classify_extractor(extractor_groups)` where each layer is a `List[List[Extractor]]` (extract_thinker/process.py:65-68). Each layer app's extractors classify concurrently (`asyncio.gather`, extract_thinker/process.py:95-100). Then the strategy applies (extract_thinker/process.py:104-114):

- `CONSENSUS` — return the result if all extractors in the layer agree on the name.
- `HIGHER_ORDER` — return the result with the maximum confidence.
- `CONSENSUS_WITH_THRESHOLD` — require name agreement **and** every confidence `>= threshold`.

If a layer does not satisfy the strategy, the loop moves to the next layer; exhaustion raises `ValueError` "No consensus could be reached…". `threshold` must be an int 1–10 (extract_thinker/process.py:74-79). Layer errors are printed and the next layer is tried (extract_thinker/process.py:119-122).

## Classification trees

When `classifications` is a `ClassificationTree`, `Process` walks it recursively (extract_thinker/process.py:127-188): at each level it classifies among that level's nodes using **only the first extractor of the first group** (`self.extractor_groups[0][0]`, extract_thinker/process.py:148-153). A confidence below `threshold` raises; matching the winning classification to a node is done by `uuid` comparison and a missing match or a failed level also raises. Nodes with `children` advance the frontier; otherwise the current best is returned. `ClassificationNode` composes a `Classification` with a recursive `children` list (extract_thinker/models/classification_node.py:5-10).

## Failure behavior

- No loader or no valid image data raise `ValueError` before any LLM call (extract_thinker/extractor.py:792-807, 559-574).
- Image-mode LLM failures inside the comparison are handled only at the splitter level for splitting; the classify loop itself has no per-classification try/except, so a failing request propagates.
- `classify_async` in `Process` re-validates the threshold before dispatch; note `image: str = False` is an annotated default with a suspicious type hint (extract_thinker/process.py:87) — the repository does not establish intent here.

## Representative tests

- tests/test_classify.py exercises extractor classification and strategies against test fixtures in tests/files.
- tests/test_process.py covers `Process` split + classify flows including tree behavior.
