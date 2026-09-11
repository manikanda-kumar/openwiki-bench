---
type: core-concept
title: Process Orchestration — Classification, Splitting, Batch
description: The Process multi-document pipeline (consensus/tree classification, eager vs lazy splitting with Text/Image splitters, per-group extraction) plus the OpenAI BatchJob lifecycle.
tags: [process, classification, splitting, doc-groups, batch, orchestrator]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:51:57.297Z
sources:
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-dc7c494e3ba5af8a22fe54b1
    resource: repo://extract_thinker/image_splitter.py
  - id: openwiki-source-9b040ddd08f40366f527dfa0
    resource: repo://extract_thinker/models/classification.py
  - id: openwiki-source-edbd5b56a6dcbaf92b6e9ae7
    resource: repo://extract_thinker/models/doc_groups2.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-42be6a4a0c0db6ff5ebc246e
    resource: repo://extract_thinker/splitter.py
  - id: openwiki-source-cda8ee7e415b6ecdfb133cd9
    resource: repo://extract_thinker/text_splitter.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
  - id: openwiki-source-11ca4d71d0bcafa6689655ef
    resource: repo://tests/test_classify.py
  - id: openwiki-source-749f08e74a04a46f1629ea04
    resource: repo://tests/test_process.py
generated: { by: "opencode", at: "2026-09-11T09:51:57.297Z" }
---

# Process Orchestration

`Process` (extract_thinker/process.py) is the multi-document orchestrator: it registers extractors and loaders, classifies documents (optionally with multi-model consensus or hierarchical trees), splits mixed documents into per-classification page groups, and extracts each group with its assigned extractor.

## Registration and loader lookup

State is plain attributes (`process.py:18-29`): `extractor_groups` (layers of extractors for classification), `document_loaders_by_file_type`, `document_loader`, `splitter`, `file_path`/`file_stream`, and `doc_groups`. Loader registration is mutually exclusive: `set_document_loader_for_file_type` refuses if a default exists and `load_document_loader` refuses if per-type entries exist (both `ValueError`, `process.py:31-40`). `get_document_loader` returns the default if set, else the per-type map entry keyed by `get_image_type(file)` — note the key function is image-type oriented, so `Process`' per-type lookup is narrower than the Extractor's extension lookup (`process.py:194-199`, `utils.py:86-97`). `load_splitter` has a side effect: it propagates vision mode to all registered loaders when the splitter is an `ImageSplitter` (`process.py:42-63`). Files are staged with `load_file`; `file_stream` has no setter API and must be assigned directly, and `extract`/`split` raise if neither is present.

## Classification with consensus layers

`Process.classify(file, classifications, strategy=CONSENSUS, threshold=9, image=False)` validates the threshold (int, 1-10) and runs `classify_async` through `asyncio.run` (`process.py:74-79`). `classify_async` iterates **layers** (each `extractor_group` runs its extractors concurrently via `asyncio.gather`, with sync `Extractor.classify` pushed to an executor thread, `process.py:70-100`) and accepts the first layer satisfying the strategy (`process.py:102-124`):

- `CONSENSUS`: all responses in the layer share one name;
- `HIGHER_ORDER`: return the max-confidence response (never fails);
- `CONSENSUS_WITH_THRESHOLD`: consensus *and* every confidence ≥ threshold.

A layer that throws is logged and skipped; exhausting all layers raises `ValueError("No consensus could be reached...")` (`process.py:119-125`). Passing a `ClassificationTree` diverts to `_classify_tree_async` before the layer loop (`process.py:92-93`).

## Tree classification

`_classify_tree_async` walks `ClassificationTree` (nodes of `ClassificationNode` with children, `models/classification_tree.py`, `models/classification_node.py`) one level at a time: at each level it classifies among the current nodes' classifications using only **the first extractor of the first layer** (`self.extractor_groups[0][0]`), requires the confidence ≥ threshold (threshold may be float here), and descends via UUID match of `node.classification.uuid` (`process.py:127-188`). Null responses, sub-threshold confidence, or unmatched nodes raise `ValueError`; a leaf ends the walk and the last response is returned.

## Splitting mixed documents

`Process.split(classifications, strategy=EAGER|LAZY)` (`process.py:205-238`) requires a splitter (`ValueError` otherwise), loads pages through the resolved loader, and requires ≥2 pages. EAGER calls `splitter.split_eager_doc_group(pages, classifications)` and stores the result directly; LAZY calls `split_lazy_doc_group` only when `document_loader.can_handle_paginate(path)` (PDF) and stores the `.doc_groups` attribute (`process.py:228-236`).

The `Splitter` ABC (splitter.py:11-93) defines the three abstract methods plus shared machinery: `split_document_into_groups` produces **overlapping consecutive page pairs** `(1,2), (2,3), …` and `aggregate_doc_groups` converts the sequence of `belongs_to_same_document` verdicts (`DocGroups2`: reasoning, flag, per-page classification) into `DocGroup` objects holding 1-based page index lists — a page starts a new group whenever its pair verdict says *not* the same document (`splitter.py:24-93`).

Concrete splitters each own their own `LLM(model)` (`text_splitter.py:11-13`, `image_splitter.py:13-15`):

- **`TextSplitter`** works on `page["content"]` text. Lazy pairs go into a single prompt asking for the `DocGroups2` JSON (content flow, headers, page numbers, identifiers, style) (`text_splitter.py:74-101`); any LLM failure falls back conservatively — *same document*, classification = first provided classification (`text_splitter.py:66-72`). Eager mode sends all pages joined by `=== PAGE BREAK ===` and expects a `DocGroupsEager` `groupOfDocuments` list of `{classification, pages}`; on failure it returns one group classified `"unknown"` (`text_splitter.py:103-154`). Classification lists are rendered with name, description, and a flattened contract-field structure (`text_splitter.py:156-181`).
- **`ImageSplitter`** is the vision twin: pair comparison requires `image` keys, encodes both pages as base64, and returns `DocGroups2` with the same conservative fallback (`image_splitter.py:37-113`); eager mode embeds all page images plus the classification prompt as multimodal content (`image_splitter.py:144-222`). Note a latent bug: lines 169-181 append reference-image blocks to `messages` **before** `messages` is (re)initialized at line 184, so eager splitting crashes with `UnboundLocalError` whenever any classification carries an `image`, and the reference examples are discarded either way.

## Extraction across groups

`Process.extract(vision=False, completion_strategy=FORBIDDEN)` (`process.py:240-309`) requires `doc_groups`, then for each group: matches a `Classification` by name to obtain its `extractor` and the contract — preferring `extraction_contract` over `contract` (`process.py:253-258`, `models/classification.py:7-16`); re-loads **all** pages via the file-level loader (or raises if no loader); slices `pages[i-1]` for the group's 1-based indices; sets `extractor.set_skip_loading(True)` around an `extract_async` call passing the sliced page dicts; and gathers groups concurrently (`asyncio.gather`) driven by `loop.run_until_complete` on the current event loop. Missing extractor for a group classification raises `ValueError("Extractor not found for classification")`; any group failure aborts the whole run (re-raised from `process_doc_groups`).

## BatchJob (OpenAI Batch API)

`extract_thinker/batch_job.py` wraps instructor's batch helpers. Construction (`batch_job.py:12-46`) writes the `.jsonl` input via `InstructorBatchJob.create_from_messages`, rewrites each line into OpenAI batch format (POST `/v1/chat/completions` envelope; note: `temperature`/`max_tokens` are assumed present in instructor's output format), uploads with purpose `"batch"`, and creates a batch with `completion_window="24h"` — a `ValueError` is raised if upload or creation fails. `get_status()` maps the eight vendor states onto `queued|processing|completed|failed` (unknown maps to `failed`) (`batch_job.py:98-125`). `get_result()` polls every `SLEEP_TIME = 60` seconds until completion (failure raises `ValueError("Batch job failed")`), downloads the single output file, parses it with `InstructorBatchJob.parse_from_file`, and **returns `parsed[0]` — only the first parsed item**, with cleanup of both temp files (and the `extract_thinker_batch` dir when empty) in a `finally` (`batch_job.py:127-175`, `195-208`). `cancel()` cancels and cleans up; `__del__` also attempts cleanup.

## Representative tests

- `tests/test_process.py:66-162`: the EAGER/LAZY × text/image matrix through `ImageSplitter`/`TextSplitter` on a combined PDF, asserting per-group extraction results; `test_split_requires_splitter` pins the guard.
- `tests/test_process.py` also demonstrates custom splitter injection via a `DummySplitter` to test `extraction_contract` precedence without LLM calls.
- `tests/test_classify.py:64-215`: layer registration (`add_classify_extractor([group1, group2])`), CONSENSUS/HIGHER_ORDER/CONSENSUS_WITH_THRESHOLD against a real invoice file, and image classification.
- `tests/test_classify.py:219-340`: tree classification with a `ClassificationTree` (`threshold=7`) and a low-confidence failure case.
- `tests/test_batch_extractor.py`: `extract_batch` JSONL round trip gated on `TESSERACT_PATH` and an OpenAI key.

## Related pages

- `core/extractor.md`, `core/completion-strategies.md`, `architecture/overview.md`, `core/llm-integration.md`
