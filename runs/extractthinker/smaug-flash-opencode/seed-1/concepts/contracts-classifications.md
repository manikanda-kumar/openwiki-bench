---
type: concept
title: Contracts and Classification
description: The Contract BaseModel schema-typing pattern, Classification objects, ClassificationResponse, classification strategies, and hierarchical classification trees used to route documents to extraction contracts.
tags: [contracts, classification, pydantic, schema, classification-tree]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:16:59.187Z
sources:
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-a2ad0cecc3781b040423f249
    resource: repo://extract_thinker/models/classification_response.py
  - id: openwiki-source-c68d1e2bb46b45e4043fb16a
    resource: repo://extract_thinker/models/classification_strategy.py
  - id: openwiki-source-64fcb723f813cd6f52c6fee4
    resource: repo://extract_thinker/models/classification_tree.py
  - id: openwiki-source-9b040ddd08f40366f527dfa0
    resource: repo://extract_thinker/models/classification.py
  - id: openwiki-source-92ee41b85171e4663a071a13
    resource: repo://extract_thinker/models/contract.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
generated: { by: "opencode", at: "2026-09-12T21:16:59.187Z" }
---

# Contracts and Classification

ExtractThinker treats the output of extraction as validated Pydantic models. The `Contract` class types the extraction schema, and `Classification` objects decide which `Contract` (and which `Extractor`) to apply to a document or document section.

## Contract: the extraction schema

`Contract` (`extract_thinker/models/contract.py:4`) is simply `class Contract(BaseModel): pass` — a Pydantic `BaseModel` marker. Users define their output schema by subclassing it:

```python
class InvoiceContract(Contract):
    invoice_number: str
    invoice_date: str
```

`Extractor._validate_dependencies` requires `response_model` to be a subclass of `BaseModel` or `Contract` (`extract_thinker/extractor.py:156`). The `add_classification_structure` utility (`extract_thinker/utils.py:268`) recursively renders the model's field structure (types, required flags, nested models) into a prompt fragment used to guide the LLM.

## Classification

`Classification` (`extract_thinker/models/classification.py:6`) is a Pydantic model that tells ExtractThinker *what kinds of documents exist and how to extract them*:

| Field | Type | Purpose |
|---|---|---|
| `name` | `str` | Identifier used in responses and within splitters. |
| `description` | `str` | Human-readable semantics used in classification prompts. |
| `contract` | `Optional[Type]` | The output Pydantic model for this document type. |
| `extraction_contract` | `Optional[Type]` | Optional narrower output model used at extraction time instead of `contract`. |
| `image` | `Optional[str]` | Path to a reference image, used for vision-based classification examples. |
| `extractor` | `Optional[Any]` | The `Extractor` that handles extraction for documents belonging to this classification. |
| `uuid` | `UUID` | Unique per-instance id (`default_factory=uuid4`); used for robust tree-node matching. |

Validation rules (`extract_thinker/models/classification.py:15`): `contract` and `extraction_contract`, if present, must be types (else `ValueError`). `set_image` only accepts a path that `os.path.isfile` returns true for.

The `classification.uuid` is important: `Process._classify_tree_async` matches tree nodes by `node.classification.uuid`, not by name (`extract_thinker/process.py:169`).

## ClassificationResponse

`ClassificationResponseInternal` (`extract_thinker/models/classification_response.py:5`) has `confidence` (integer 1–10) and `name`. `ClassificationResponse` (`extract_thinker/models/classification_response.py:9`) adds a `classification: Classification` back-reference to the matched classification object.

In text-based classification (`Extractor._classify_text_only`, `extract_thinker/extractor.py:722`), the LLM returns the internal JSON (`name`, `confidence`), and the code does an exact, case-insensitive name match against the supplied classifications to attach the correct `Classification`.

## Classification strategies

`ClassificationStrategy` (`extract_thinker/models/classification_strategy.py:4`) governs how `Process` reconciles results from multiple extractors:

- `CONSENSUS = "consensus"` — return a result only when all extractors in a layer agree on the same `name`.
- `HIGHER_ORDER = "higher_order"` — return the classification with the highest `confidence`.
- `CONSENSUS_WITH_THRESHOLD = "both"` — all must agree **and** each `confidence` must be at or above the threshold.

In `Process.classify_async` (`extract_thinker/process.py:81`), extractor layers are tried in order; if the strategy criteria fail for one layer, the process moves to the next layer)Skip else after exhausting all layers a `ValueError` is raised.

## Classification trees

`ClassificationTree` (`extract_thinker/models/classification_tree.py:5`) is a list of `ClassificationNode`s. `ClassificationNode` (`extract_thinker/models/classification_node.py:5`) holds a `name`, a `Classification`, and `children: List[ClassificationNode]`.

`Process._classify_tree_async` (`extract_thinker/process.py:127`) implements level-by-level hierarchical classification:

1. Classify among the current level's classifications using the first registered extractor (`self.extractor_groups[0][0]`).
2. If classification returns `None`, raise `ValueError("Classification failed at the current level...")`.
3. If confidence is below the threshold, raise `ValueError` saying confidence is below threshold.
4. Match the returned classification to a node by `<node>.classification.uuid`.
5. If no matching node, raise `ValueError("No matching node found...")`.
6. Remaining with children: descend into `matching_node.children` and repeat. Leaf nodes end the walk.

This gives coarse-to-fine document typing (e.g., "Vehicle" → "Invoice" → "Receipt").

## Classification within the extraction flow

- **Direct** (`Extractor.classify`, `extract_thinker/extractor.py:774`): load content, then classify text-only or vision-based. In vision mode (`is_classify_image=True`), `_classify` does an ask-one-by-one comparison against each classification's reference image (`_classify_one_image_with_ref` / `_classify_one_image_no_ref`, `extract_thinker/extractor.py:609`), keeping the highest-confidence match.
- **Within Process/splitting** (`Process.split`): each page gets a classification, and `Process.extract` uses `doc_group.classification` to find the matching `Classification` and its `extractor`/`extraction_contract` (`extract_thinker/process.py:253`).

## Testing

- `tests/test_classify.py` exercises text and vision classification flows.
- `tests/critical/test_critical_classification.py` verifies critical classification paths.
