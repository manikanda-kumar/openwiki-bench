---
type: subsystem
title: "Contracts & Shared Models"
description: "The Pydantic/enum data model shared across ExtractThinker: Contract, Classification and classification responses, doc-group containers, strategy enums, and the exception hierarchy."
tags: [models, pydantic, contracts, enums, exceptions]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T10:24:25.212Z
sources:
  - id: openwiki-source-80ac776afff46dd86a9f455f
    resource: repo://extract_thinker/exceptions.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-e65baf6c792259ebf35ad03e
    resource: repo://extract_thinker/models/abstract_classification.py
  - id: openwiki-source-63f5e8b3f1330b1c6f1832d6
    resource: repo://extract_thinker/models/classification_node.py
  - id: openwiki-source-a2ad0cecc3781b040423f249
    resource: repo://extract_thinker/models/classification_response.py
  - id: openwiki-source-c68d1e2bb46b45e4043fb16a
    resource: repo://extract_thinker/models/classification_strategy.py
  - id: openwiki-source-9b040ddd08f40366f527dfa0
    resource: repo://extract_thinker/models/classification.py
  - id: openwiki-source-5d52ccd237935225a7a936dc
    resource: repo://extract_thinker/models/completion_strategy.py
  - id: openwiki-source-92ee41b85171e4663a071a13
    resource: repo://extract_thinker/models/contract.py
  - id: openwiki-source-7fa93fa33ef7db6a499c6360
    resource: repo://extract_thinker/models/doc_group.py
  - id: openwiki-source-ceefb0a1c63bd2e0b6eca7a0
    resource: repo://extract_thinker/models/doc_groups.py
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
  - id: openwiki-source-42be6a4a0c0db6ff5ebc246e
    resource: repo://extract_thinker/splitter.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-11T10:24:25.212Z" }
---

# Contracts & Shared Models

Everything that crosses component boundaries — user-defined output schemas, classification descriptors, splitting verdicts, strategy flags — lives in `extract_thinker/models/` as inert data containers. Components act on them; the models themselves never do.

## Contract

`Contract` is a bare `pydantic.BaseModel` subclass (`extract_thinker/models/contract.py`) users inherit to declare extraction schemas. `Extractor._validate_dependencies` accepts any `BaseModel` subclass or `Contract` as the `response_model`, so `Contract` is a semantic marker, not a functional distinction. Contract fields surface to the LLM in three places: instructor's structured-output validation, the prompt structure rendered by `add_classification_structure` (`extract_thinker/utils.py:268-328`, used by dynamic mode, concatenation, and splitters), and classification prompts that instruct the model to raise confidence when contract fields are present.

## Classification and responses

`Classification` (`extract_thinker/models/classification.py`) is the unit binding a document type to behavior:

- `name` and `description` are required strings injected into prompts.
- `contract` and `extraction_contract` are `Optional[Type]` with field validators rejecting non-types; `Process.extract` uses `extraction_contract or contract` as the response model, letting a richer classification schema drive only identification while a lighter contract drives extraction.
- `image` is an optional reference-image path (`set_image` rejects non-existent paths); vision classification compares against it.
- `extractor` holds an `Extractor` instance (typed `Any`) that `Process.extract` looks up by group classification name.
- `uuid` defaults to `uuid4()` and is the identity key used by tree classification node matching instead of names.

`ClassificationResponseInternal` (name + `confidence: int` bounded `ge=1, le=10`) is the raw LLM output shape; `ClassificationResponse` extends it with the matched `classification` object. `AbstractClassification` is an empty ABC that no module imports.

## Trees

`ClassificationNode` is `{name, classification, children: List[ClassificationNode]}` with `model_rebuild()` for the self-reference; `ClassificationTree` is just `{nodes: List[ClassificationNode]}`. A tree is only consumed by `Process._classify_tree_async`.

## Doc-group containers (two families)

Lazy-style and eager-style splitting produce different containers, and the module set has real duplication you should know before touching it:

- `models/doc_group.py` defines plain (non-Pydantic) `DocGroup(pages: List[int], classification: str)` and a `DocGroups` wrapper holding `.doc_groups`. `models/doc_groups.py` defines a *second* `DocGroups` wrapper with identical shape importing the plain `DocGroup`; splitters import from `doc_group`, while `Process` imports from `doc_groups` (`extract_thinker/process.py:13-15` vs `extract_thinker/splitter.py:6`).
- `DocGroups2` (`models/doc_groups2.py`) is the Pydantic verdict shape splitters request from the LLM: `belongs_to_same_document` plus per-page classification names and optional reasoning. It is consumed by `Splitter.aggregate_doc_groups`.
- `models/eager_doc_group.py` mixes styles in one file: a dataclass `EagerDocGroup` (what splitters return per group) plus a Pydantic `DocGroup`/`DocGroupsEager` pair (the JSON shape requested from the LLM — reasoning + `{classification, pages: List[int]}` entries). `models/lazy_doc_group.py` defines `EagerDocResult`, which nothing imports.
- After `Process.split`, `self.doc_groups` holds either a `List[EagerDocGroup]` (EAGER) or a `List[doc_group.DocGroup]` (LAZY); `Process.extract` only relies on the common `.pages`/`.classification` attributes.

## Strategy enums

| Enum | Values | Consumed by |
|---|---|---|
| `ClassificationStrategy` | `CONSENSUS`, `HIGHER_ORDER`, `CONSENSUS_WITH_THRESHOLD` (value `"both"`) | `Process.classify_async` layer voting |
| `SplittingStrategy` | `EAGER`, `LAZY` | `Process.split` |
| `CompletionStrategy` | `CONCATENATE`, `PAGINATE`, `FORBIDDEN` | `Extractor.extract`/handlers |
| `LLMEngine` | `DEFAULT`, `PYDANTIC_AI` | `LLM.__init__`, batch gating |

## Exceptions

The hierarchy is three levels: `ExtractThinkerError` (base) → `VisionError` → `InvalidVisionDocumentLoaderError` (`extract_thinker/exceptions.py`). Only `ExtractThinkerError` (extraction failures) and `InvalidVisionDocumentLoaderError` (vision loader setup failure) are raised by the core path; the `classify_vision_error` helper converts model-side `litellm.BadRequestError`s into `VisionError`.

Related: [Classification & Splitting (Process)](/openwiki/architecture/classification-and-splitting.md) consumes these shapes at runtime; [Tuning Extraction Quality](/openwiki/guides/tuning-extraction-quality.md) covers contract-design effects on prompts.
