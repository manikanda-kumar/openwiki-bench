---
type: "Reference"
title: "Classification Contracts and Tree"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:12:00.069Z
sources:
  - id: openwiki-source-63f5e8b3f1330b1c6f1832d6
    resource: repo://extract_thinker/models/classification_node.py
  - id: openwiki-source-a2ad0cecc3781b040423f249
    resource: repo://extract_thinker/models/classification_response.py
  - id: openwiki-source-9b040ddd08f40366f527dfa0
    resource: repo://extract_thinker/models/classification.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
generated: { by: "opencode", at: "2026-09-12T21:12:00.069Z" }
---


# Classification Contracts and Tree

Classification in ExtractThinker is expressed through a small set of Pydantic
models in `extract_thinker/models/`. These models describe the candidate
document types, the result of a classification decision, and an optional
hierarchical decision tree used by `Process`.

## Classification

`Classification` (extract_thinker/models/classification.py:6-33) is the core
candidate model. It carries:

- `name` and `description`: human-readable identity of the document type.
- `contract`: an optional Pydantic model type (typically a `Contract`
  subclass) describing the expected extraction schema for that classification.
  Used to steer classification confidence.
- `extraction_contract`: an optional type used as the extraction schema when
  running `Process.extract` after a split; falls back to `contract` if unset
  (extract_thinker/process.py:253-257).
- `image`: an optional file path to a classification example image, used in
  vision-based classification reference comparisons.
- `extractor`: an optional `Extractor` instance attached to the classification,
  used by `Process` to extract a group assigned to this classification.
- `uuid`: a stable `UUID` auto-generated per instance; used for reliable
  node matching in tree classification (process.py:169-176).

Validators require `contract` and `extraction_contract` to be types when
present, and `set_image` validates that the path is a real file.

## ClassificationResponse

`ClassificationResponseInternal` (extract_thinker/models/classification_response.py:5-7)
is the raw LLM-facing shape: a `name` string and an integer `confidence` between
1 and 10. `ClassificationResponse` (classification_response.py:9-10) extends it
with the matched `Classification` object, linking the decision back to the
candidate so downstream code can access its extractor/contract.

## Tree models

`ClassificationTree` (extract_thinker/models/classification_tree.py:5-6) is a
list of `ClassificationNode` objects. `ClassificationNode`
(classification_node.py:5-10) holds a `name`, its `classification`, and a list
of child nodes, enabling a level-by-level hierarchical classification. The
recursive self-reference is resolved with `model_rebuild()`.

## Relationship to classification flows

`Extractor.classify` builds a text or vision prompt from the classifications
and returns a `ClassificationResponse` (extractor.py:774-807). `Process`
interprets the response according to its classification strategy and traverses
a tree when given a `ClassificationTree` (process.py:127-188).
