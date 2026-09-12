---
type: "Reference"
title: "Domain Model Objects"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:16:59.187Z
sources:
  - id: openwiki-source-dc7c494e3ba5af8a22fe54b1
    resource: repo://extract_thinker/image_splitter.py
  - id: openwiki-source-7fa93fa33ef7db6a499c6360
    resource: repo://extract_thinker/models/doc_group.py
  - id: openwiki-source-edbd5b56a6dcbaf92b6e9ae7
    resource: repo://extract_thinker/models/doc_groups2.py
  - id: openwiki-source-d7ffb9ed5addad208802fd81
    resource: repo://extract_thinker/models/eager_doc_group.py
  - id: openwiki-source-97c8503763e1f79d5062af85
    resource: repo://extract_thinker/models/splitting_strategy.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-42be6a4a0c0db6ff5ebc246e
    resource: repo://extract_thinker/splitter.py
generated: { by: "opencode", at: "2026-09-12T21:16:59.187Z" }
---


# Domain Model Objects

ExtractThinker's splitter and `Process` components exchange structured objects that record which pages belong to the same document and under which classification. This page catalogs those supporting models.

## DocGroup and DocGroups

`DocGroup` (`extract_thinker/models/doc_group.py:4`) is a plain class:

```python
class DocGroup:
    def __init__(self, pages: List[int], classification: str):
        self.pages = pages
        self.classification = classification
```

It maps a set of 1-indexed page numbers to a single classification stringcleriks. `DocGroups` (`extract_thinker/models/doc_group.py:10`) is a container with a `doc_groups: List[DocGroup]` attribute (a separate module `extract_thinker/models/doc_groups.py` defines the same named container).

These are the outputs of the splitting process: `Process.extract` iterates `doc_groups.doc_groups` (or the list), matches each `DocGroup.classification` to a `Classification.extractor`, and extracts the subset of pages `pages` for that group (`extract_thinker/process.py:253`).

## DocGroups2

`DocGroups2` (`extract_thinker/models/doc_groups2.py:4`) is a Pydantic model returned by LLM-based page comparisons:

```python
class DocGroups2(BaseModel):
    reasoning: Optional[str] = None
    belongs_to_same_document: bool
    classification_page1: str
    classification_page2: str
```

`Splitter.belongs_to_same_document` (`extract_thinker/splitter.py:12`) compares two pages and returns a `DocGroups2` telling whether the pages belong to the same document and their respective classifications. `Splitter.aggregate_doc_groups` (`extract_thinker/splitter.py:50`) consumes a list of `DocGroups2` and builds a final `DocGroups` container by walking consecutive page-pairs: if `belongs_to_same_document` is true the adjacent page joins the current `DocGroup`; otherwise the current group is closed and a new one begins with `classification_page2`.

## EagerDocGroup and DocGroupsEager

`EagerDocGroup` (`extract_thinker/models/eager_doc_group.py:5`) is a dataclass with `pages: List[str]` and `classification: str` — the result of the eager (whole-document) split.

`DocGroup` (Pydantic) and `DocGroupsEager` (`extract_thinker/models/eager_doc_group.py:10`) type the LLM response for eager splitting:

```python
class DocGroupsEager(BaseModel):
    reasoning: str
    groupOfDocuments: List[DocGroup]
```

In `ImageSplitter.split_eager_doc_group` (and `TextSplitter.split_eager_doc_group`), the model returns a `DocGroupsEager`, whose `groupOfDocuments` entries are converted to `EagerDocGroup` instances (`extract_thinker/image_splitter.py:204`).

## LazyDocGroup

`extract_thinker/models/lazy_doc_group.py` defines `EagerDocResult` (dataclass with `reason` and `documents: List[List[int]]`) — a legacy/alternate grouping shape.

## Supporting classification types

- `Classification` (`extract_thinker/models/classification.py:6`) — name/description/contract/extraction_contract/image/extractor/uuid; used by splitters and classification.
- `ClassificationNode` (`extract_thinker/models/classification_node.py:4`) — `name`, `classification`, `children` for hierarchical trees.
- `ClassificationResponse`/`ClassificationResponseInternal` — name + integer confidence (1–10), with or without the matched `Classification` back-reference.
- `SplittingStrategy` (`extract_thinker/models/splitting_strategy.py:4`) — `EAGER` / `LAZY`.
- `CompletionStrategy` (`extract_thinker/models/completion_strategy.py:4`) — `CONCATENATE`/`PAGINATE`/`FORBIDDEN`.
- `ClassificationStrategy` (`extract_thinker/models/classification_strategy.py:4`) — `CONSENSUS`/`HIGHER_ORDER`/`CONSENSUS_WITH_THRESHOLD`.

## How Process uses these

- `Process.split` stores the result of `split_eager_doc_group` or `split_lazy_doc_group` in `self.doc_groups` (`extract_thinker/process.py:229`).
- `Process.extract` iterates groups; for each it finds the matching `Classification` by `name`, reloads the page subset, sets `_skip_loading`, and calls the extractor (`extract_thinker/process.py:247-293`).
- Tests in `tests/test_process.py` (e.g. `test_eager_splitting_strategy`) verify that eager/lazy splitting through both `ImageSplitter` and `TextSplitter` yields validated `Contract` instances per group.
