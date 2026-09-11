---
type: data-models
title: Contracts, Classifications, and Data Models
description: The Pydantic data model layer of ExtractThinker — Contract marker, Classification, classification responses and trees, strategy enums, and document-group models — and how contracts shape LLM prompts.
tags: [models, pydantic, contract, classification, enums]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T08:46:09.069Z
sources:
  - id: openwiki-source-e9ebd8673ce94833101e27ed
    resource: repo://extract_thinker/concatenation_handler.py
  - id: openwiki-source-20348fa03582863679d141a9
    resource: repo://extract_thinker/eval/cli.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-dc7c494e3ba5af8a22fe54b1
    resource: repo://extract_thinker/image_splitter.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
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
  - id: openwiki-source-5d52ccd237935225a7a936dc
    resource: repo://extract_thinker/models/completion_strategy.py
  - id: openwiki-source-92ee41b85171e4663a071a13
    resource: repo://extract_thinker/models/contract.py
  - id: openwiki-source-7fa93fa33ef7db6a499c6360
    resource: repo://extract_thinker/models/doc_group.py
  - id: openwiki-source-edbd5b56a6dcbaf92b6e9ae7
    resource: repo://extract_thinker/models/doc_groups2.py
  - id: openwiki-source-d7ffb9ed5addad208802fd81
    resource: repo://extract_thinker/models/eager_doc_group.py
  - id: openwiki-source-214022cc27927d5c41d44e02
    resource: repo://extract_thinker/models/lazy_doc_group.py
  - id: openwiki-source-97c8503763e1f79d5062af85
    resource: repo://extract_thinker/models/splitting_strategy.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-11T08:46:09.069Z" }
---

# Contracts, Classifications, and Data Models

All structured data in ExtractThinker flows through Pydantic models defined in `extract_thinker/models/`. This page covers the model layer that users extend (contracts, classifications) and the internal models that carry results between components.

## Contract: the extraction schema marker

`Contract` is an empty subclass of `pydantic.BaseModel` (`extract_thinker/models/contract.py:1-3`). It carries no behavior of its own; it exists as a semantic marker so user schemas can be recognized as extraction contracts. `_validate_dependencies` accepts either a `BaseModel` or a `Contract` subclass as the `response_model` for extraction (`extract_thinker/extractor.py:150-157`), and the eval CLI dynamically loads contract classes by scanning a module for `Contract` subclasses (`extract_thinker/eval/cli.py:21-39`).

Example contracts live in `tests/models/` (e.g. `InvoiceContract`, `DriverLicenseContract`, `GDPContract`) and are referenced throughout the test suite. Contracts do double duty: they are the validation target for LLM output *and* a prompt ingredient (see [How contracts shape prompts](#how-contracts-shape-prompts)).

## Classification

`Classification` describes one document category (`extract_thinker/models/classification.py:1-23`):

| Field | Type | Role |
|---|---|---|
| `name` | `str` | Category name; matched case-insensitively against LLM output in text classification |
| `description` | `str` | Natural-language description included in classification prompts |
| `contract` | `Optional[Type]` | Pydantic contract whose structure boosts confidence scoring and drives per-group extraction |
| `extraction_contract` | `Optional[Type]` | Optional override contract used at extraction time |
| `image` | `Optional[str]` | Path to a reference image for vision classification |
| `extractor` | `Optional[Any]` | The `Extractor` that performs extraction for this classification (used by `Process`) |
| `uuid` | `UUID` | Auto-generated (`uuid4` default); used for robust tree-node matching |

Field validators enforce that `contract` and `extraction_contract`, when provided, are *types* (classes, not instances) (`extract_thinker/models/classification.py:14-20`). `set_image(path)` raises `ValueError` unless the path is an existing file (`extract_thinker/models/classification.py:22-25`).

The `contract` vs `extraction_contract` distinction matters in `Process.extract`: when resolving a document group, the extraction contract is `classification.extraction_contract or classification.contract` (`extract_thinker/process.py:253-257`). This lets a classification use a rich contract for splitting/confidence while extracting into a different schema.

## Classification responses and trees

- `ClassificationResponseInternal` is what the LLM is asked to produce: `name: str` and `confidence: int` constrained to 1–10 (`extract_thinker/models/classification_response.py:1-6`).
- `ClassificationResponse` extends it with the matched `Classification` object, so callers get the full category (including its contract and extractor) rather than just a name (`extract_thinker/models/classification_response.py:7-8`).
- `ClassificationTree` holds a list of `ClassificationNode`s; each node wraps a `Classification` plus recursive `children` (with `model_rebuild()` to resolve the forward reference) (`extract_thinker/models/classification_tree.py:1-5`, `extract_thinker/models/classification_node.py:1-6`). Trees are consumed by `Process._classify_tree_async`, which walks level by level and matches the LLM's chosen classification back to a node via `uuid` comparison (`extract_thinker/process.py:127-188`).

## Strategy enums

Three enums parameterize orchestration behavior (`extract_thinker/models/`):

- `ClassificationStrategy`: `CONSENSUS`, `HIGHER_ORDER`, `CONSENSUS_WITH_THRESHOLD` (serialized value `"both"`) (`extract_thinker/models/classification_strategy.py:1-5`).
- `SplittingStrategy`: `EAGER`, `LAZY` (`extract_thinker/models/splitting_strategy.py:1-4`).
- `CompletionStrategy`: `CONCATENATE`, `PAGINATE`, `FORBIDDEN` (`extract_thinker/models/completion_strategy.py:1-5`).

## Document-group models

Splitting produces page groupings represented by several models:

- `DocGroup` / `DocGroups` (in `doc_group.py` and duplicated in `doc_groups.py`) are *plain Python classes* (not Pydantic): a group is `pages: List[int]` (1-based page numbers) plus `classification: str` (`extract_thinker/models/doc_group.py:1-11`).
- `DocGroups2` is the Pydantic result of a pairwise page comparison: `belongs_to_same_document: bool`, `classification_page1`, `classification_page2`, optional `reasoning` (`extract_thinker/models/doc_groups2.py:1-7`).
- `DocGroupsEager` is the LLM response schema for eager splitting: `reasoning` plus `groupOfDocuments: List[DocGroup]`; `EagerDocGroup` is a dataclass form used internally by `ImageSplitter` (`extract_thinker/models/eager_doc_group.py:1-13`). Note that `EagerDocGroup.pages` is typed `List[str]` even though it carries page numbers used as integer indices by `Process.extract` — the LLM response is trusted to contain integers.
- `lazy_doc_group.py` defines an `EagerDocResult` dataclass (`reason` + `documents: List[List[int]]`) that is not referenced by the current splitting flow.

## How contracts shape prompts

`add_classification_structure(response_model)` in `extract_thinker/utils.py:268+` renders a contract into a text "Response Structure" block: for each field it emits the name, type (resolving `List[...]`/`Dict[...]` origins and recursing into nested Pydantic models), and required status. This rendering is used in several places:

- Text-only classification appends each classification's contract structure to boost confidence scoring (`extract_thinker/extractor.py:732-735`).
- The dynamic LLM mode embeds the structure in a `think`-tagged prompt (`extract_thinker/llm.py:14-37`, `extract_thinker/llm.py:213-219`).
- `ConcatenationHandler` embeds the structure in its system prompt (`extract_thinker/concatenation_handler.py:141-151`).
- `ImageSplitter._add_classification_structure` re-implements a simpler version for splitter prompts (`extract_thinker/image_splitter.py:239-254`).

Because required-ness is detected by checking whether the string `"required"` appears in the Pydantic field's string representation, the rendered structure is a heuristic, not a schema guarantee.

## Related pages

- [Extractor: Extraction and Classification Engine](extractor.md)
- [Process: Multi-Document Split-and-Extract Workflow](process-workflow.md)
- [Splitting Strategies and Splitters](splitting.md)
- [Completion Strategies](completion-strategies.md)
