---
type: subsystem
title: "Evaluation Framework"
description: "The extract_thinker.eval subsystem: Evaluator and TeacherStudentEvaluator runs, datasets, field comparison, metrics, hallucination detection, cost tracking, reports, and the eval CLI."
tags: [evaluation, metrics, hallucination, cost, cli, teacher-student]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T10:24:25.212Z
sources:
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-8487b701e2f54db6dbd8380b
    resource: repo://extract_thinker/eval/__init__.py
  - id: openwiki-source-20348fa03582863679d141a9
    resource: repo://extract_thinker/eval/cli.py
  - id: openwiki-source-b027d6219be9dca2cec9b76a
    resource: repo://extract_thinker/eval/dataset.py
  - id: openwiki-source-72ce7d92abd4e848a4171b49
    resource: repo://extract_thinker/eval/evaluator.py
  - id: openwiki-source-6dca7475707e06d60e40fcef
    resource: repo://extract_thinker/eval/field_comparison.py
  - id: openwiki-source-1a8829a408e6b8676a90fdbb
    resource: repo://extract_thinker/eval/hallucination.py
  - id: openwiki-source-e6b806ca6158e5fd69687939
    resource: repo://extract_thinker/eval/metrics.py
  - id: openwiki-source-5d4b871e9c654d6fa460c740
    resource: repo://extract_thinker/eval/report.py
  - id: openwiki-source-f388e22431a1a1afe07448ea
    resource: repo://extract_thinker/eval/setup.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-8dc53e44124fed5d3b4d2a05
    resource: repo://tests/test_evaluator.py
generated: { by: "opencode", at: "2026-09-11T10:24:25.212Z" }
---

# Evaluation Framework

`extract_thinker/eval/` measures extraction quality against labeled documents. Its objects are exported through `extract_thinker/eval/__init__.py` (`Evaluator`, `TeacherStudentEvaluator`, datasets, metrics, comparison types, `HallucinationDetector`, `CostMetrics`, `EvaluationReport`) — note these are *not* re-exported from the top-level `extract_thinker/__init__.py`.

## Evaluator run flow

`Evaluator(extractor, response_model, vision, content, field_comparisons, detect_hallucinations, track_costs, document_text_provider)` wires:

- A `FieldComparisonManager` seeded from the contract's `__annotations__`: int/float fields default to NUMERIC comparison (relative tolerance 1%), everything else EXACT; per-field overrides come via the constructor map or `set_field_comparison`.
- Four metric accumulators (`FieldMetrics`, `DocumentMetrics`, `SchemaValidationMetrics`, `ExecutionTimeMetrics`) — field precision/recall/F1 count correct/present/absent outcomes per field; document accuracy counts only documents where **every** expected field matched.
- Optional `HallucinationDetector` (strategy `LLM` when the extractor has an `.llm`, else `HEURISTIC`) and `CostMetrics`.

`evaluate(dataset)` iterates `(doc_id, doc_path, expected)` items, times each `_extract_document`, and builds an `EvaluationReport` with aggregate metrics (documents tested, overall document accuracy, schema validation rate, avg precision/recall/F1, avg execution time, plus cost metrics when tracked) and per-field breakdowns. Inside `_extract_document`: extraction exceptions mark the schema invalid, **re-raise unless `skip_failures`** (then a failure result dict is appended instead); field-by-field comparison uses the configured matcher; hallucination detection needs document text, obtained from `document_text_provider` or by falling back to the extractor's own `document_loader.load()`; cost tracking reads `result._response.usage` and prices it with `litellm.completion_cost` per document.

Important subtlety: the LLM-strategy detector reuses **the same `LLM` instance as the extractor being evaluated** — the grader and the model under test are one and the same.

## Field comparison

`ComparisonType` is EXACT, FUZZY, SEMANTIC, NUMERIC, CUSTOM (`extract_thinker/eval/field_comparison.py`). EXACT compares stripped strings or JSON-serialized lists/dicts. FUZZY needs the optional `Levenshtein` package and falls back to EXACT on `ImportError`; SEMANTIC tries `sentence-transformers` (cached class-level `all-MiniLM-L6-v2` model), then litellm `text-embedding-ada-002`, then degrades to FUZZY; NUMERIC compares relative difference against `numeric_tolerance` (absolute when expected is 0). `custom_comparator` callables are supported for CUSTOM.

## Hallucination detection

`HallucinationDetector.detect_hallucinations(extracted_data, document_text)` scores each non-None, non-metadata field; the overall score is *contradicted fields / total fields* (its comments attribute this formulation to "Confident AI"). Heuristic scoring: exact substring in document text → 0.0; every word present → 0.3; any 4-gram substring present → 0.6; no match → 0.9. Lists average their item scores; dicts average subfields; complex lists under HEURISTIC cap at 0.5. The LLM strategy asks for a `HallucinationCheckResponse` (is_contradicted/score/reasoning) over a 2000-char text excerpt, falling back to the heuristic with a `"LLM error: ..."` reasoning prefix if the request fails. Fields with score ≥ `threshold` (default 0.7) count as contradicted. Results land in `DocumentHallucinationResults` per document.

## Datasets and teacher-student mode

`FileSystemDataset(documents_dir, labels_path, file_pattern)` globs documents, loads a JSON labels map keyed by basename, and **fails construction** if any document lacks a label or any label lacks a document. `TeacherStudentEvaluator` runs student and teacher extractors over the same dataset, tracking separate metric accumulators, then emits a report with student/teacher document accuracy, improvement percentages (division guards set `float('inf')` when student is 0 and teacher is not), schema rates, and average times. Unlike the base evaluator, its per-field matching uses plain recursive `_values_match` equality rather than the field comparison manager.

## Report and CLI

`EvaluationReport` is a Pydantic model holding the metric dicts, optional teacher fields, comparison configs, and per-document results; `print_summary()` picks a teacher-student or standard layout by the presence of a `teacher_document_accuracy` key, and `Evaluator.save_report` writes `report.json(indent=2)`.

The CLI (`extract_thinker/eval/cli.py`, `main`) takes `--config <json> [--output eval_results.json] [--detect-hallucinations] [--track-costs]`; the config supplies `contract_path` (a Python file scanned for the first non-`Contract` `Contract` subclass loaded via `importlib.util.spec_from_file_location`), `documents_dir`, `labels_path`, optional `vision`/`content`/`skip_failures`, and an `llm` entry that is either a model string or `{model, params}`. Its `setup_extractor` resolves `"document_loader.type"` by `getattr` on the `extract_thinker.document_loader` package namespace — a namespace package with no `__init__.py` re-exports — so loader-type names are not actually attributes of that module object; expect this path to need the class to be importable some other way or the key omitted. The `extract_thinker-eval` console script is declared only in the separate setuptools file `extract_thinker/eval/setup.py`, not in `pyproject.toml`'s poetry config, so `poetry install` does not register it.

## Focused tests

`tests/test_evaluator.py` builds temporary datasets around `tests/files/invoice.pdf`, checks report metric keys, comparison-config propagation (exact/fuzzy/numeric), hallucination result presence, cost metric presence, and JSON report persistence. It constructs a **real** extractor with `get_lite_model()` (Gemini), so these are live-API tests, not offline mocks.

Related: [Testing, CI & Release](/openwiki/operations/testing-ci-release.md) for how these live tests relate to CI; [Tuning Extraction Quality](/openwiki/guides/tuning-extraction-quality.md) for using this framework to gate changes.
