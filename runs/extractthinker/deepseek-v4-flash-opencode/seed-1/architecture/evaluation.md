---
type: "Reference"
title: "Evaluation Subsystem"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:16:41.841Z
sources:
  - id: openwiki-source-20348fa03582863679d141a9
    resource: repo://extract_thinker/eval/cli.py
  - id: openwiki-source-6be05bf068c9ce8ab967bdf7
    resource: repo://extract_thinker/eval/cost_metrics.py
  - id: openwiki-source-b027d6219be9dca2cec9b76a
    resource: repo://extract_thinker/eval/dataset.py
  - id: openwiki-source-72ce7d92abd4e848a4171b49
    resource: repo://extract_thinker/eval/evaluator.py
  - id: openwiki-source-6dca7475707e06d60e40fcef
    resource: repo://extract_thinker/eval/field_comparison.py
  - id: openwiki-source-1a8829a408e6b8676a90fdbb
    resource: repo://extract_thinker/eval/hallucination.py
  - id: openwiki-source-c83661c1f2a81ba4fbc4927d
    resource: repo://extract_thinker/eval/HallucinationDetectionStrategy.py
  - id: openwiki-source-5d4b871e9c654d6fa460c740
    resource: repo://extract_thinker/eval/report.py
  - id: openwiki-source-8dc53e44124fed5d3b4d2a05
    resource: repo://tests/test_evaluator.py
generated: { by: "opencode", at: "2026-09-11T09:16:41.841Z" }
---


# Evaluation Subsystem

The `extract_thinker.eval` package measures how well an extraction setup performs against labeled ground-truth documents. It produces a structured `EvaluationReport` with field-level and document-level metrics, optional hallucination and cost tracking, and supports benchmarking a weaker ("student") model against a stronger ("teacher") model.

## Datasets

`EvaluationDataset` is the abstract source of `(doc_id, doc_path, expected_dict)` triples. `FileSystemDataset` loads documents from a directory and expected outputs from a JSON labels file keyed by filename. Its `_validate_documents` raises `ValueError` if any document lacks a label or any label lacks a document, so a dataset cannot silently skip items.

## Field comparison

`ComparisonType` defines how a predicted field value is judged against the expected value (`extract_thinker/eval/field_comparison.py`):

- `EXACT` — stringified equality (JSON-sorted comparison for dicts/lists).
- `FUZZY` — Levenshtein `ratio >= similarity_threshold` (falls back to exact if the library is missing).
- `SEMANTIC` — cosine similarity over `sentence-transformers` embeddings, then a `litellm.embedding` fallback, then fuzzy.
- `NUMERIC` — relative difference within `numeric_tolerance` (absolute tolerance when the expected value is zero).
- `CUSTOM` — user-supplied comparator.

`FieldComparisonConfig` bundles a `comparison_type`, `similarity_threshold` (0.8), `numeric_tolerance` (0.01), and optional `custom_comparator`. `FieldComparisonManager` assigns defaults per field from the response model annotations (numeric fields → NUMERIC, everything else → EXACT) and lets callers override per field.

## Evaluator

`Evaluator(extractor, response_model, vision, content, field_comparisons, detect_hallucinations, track_costs, document_text_provider)` (`extract_thinker/eval/evaluator.py`) runs the extractor over every dataset item:

1. Optionally obtains raw document text for hallucination detection (via `document_text_provider` or the extractor's own loader).
2. Times `extractor.extract(doc_path, response_model, vision=..., content=...)` and records schema validity.
3. Compares each expected field using the field comparison manager, feeding `FieldMetrics`, `DocumentMetrics` (all fields correct), `SchemaValidationMetrics`, and `ExecutionTimeMetrics`.
4. When `track_costs`, reads `_response.usage` tokens and calls litellm `completion_cost` into `CostMetrics`.
5. Optionally runs `HallucinationDetector.detect_hallucinations(predicted, document_text)`.

On extraction failure: if `skip_failures` is False the exception propagates; otherwise a failure result dict is recorded and the run continues. `evaluate()` returns an `EvaluationReport` aggregating overall document accuracy, schema validation rate, average precision/recall/F1, and average execution time (plus cost metrics when tracked).

## Teacher-student evaluation

`TeacherStudentEvaluator` extends `Evaluator` to run a student extractor and a more capable teacher extractor over the same dataset, tracking separate metric sets. Its `evaluate()` produces a comparative `EvaluationReport` containing per-field F1 improvements, document-accuracy improvement percentage, and both result sets (`teacher_results`).

## Hallucination detection

`HallucinationDetector` (`extract_thinker/eval/hallucination.py`) scores each extracted field 0.0 (grounded) to 1.0 (hallucinated). The strategy is `HallucinationDetectionStrategy.LLM` when an LLM is available and `HEURISTIC` otherwise:

- **HEURISTIC** — substring / all-words / 4-gram partial matching against the lowercased document text, mapping to scores 0.0 / 0.3 / 0.6 / 0.9.
- **LLM** — asks the model (via `HallucinationCheckResponse`) for `is_contradicted`, `score`, `reasoning`; falls back to the heuristic on LLM error.

List and dict fields are checked item/subfield-wise and averaged. Fields with `None` values or names in `doc_id`, `metadata`, `confidence` are skipped. The overall document score follows the Confident AI formula: contradicted fields (score >= threshold, default 0.7) divided by total fields, returned as `DocumentHallucinationResults`.

## Cost tracking

`CostMetrics` accumulates per-document input/output/total tokens and USD cost from litellm `completion_cost`, exposing totals, averages, and per-document breakdowns that are merged into the report's metrics when enabled.

## Report

`EvaluationReport` is a Pydantic model carrying the evaluation name, dataset, model(s), timestamp, overall metrics, field metrics, comparison configs, per-document results, and optional teacher/hallucination/cost sections. `print_summary()` renders a human-readable summary and detects teacher-student reports by the presence of `teacher_document_accuracy` in metrics.

## CLI

`extract_thinker/eval/cli.py` exposes a CLI that takes a JSON config:

- `--config` — JSON file with `document_loader` (type + params), `llm` (model name or `api_base`-style params), `contract_path` (a Python file whose `Contract` subclass is loaded dynamically by `load_contract`), `documents_dir`, `labels_path`, `vision`, `content`, `dataset_name`, `skip_failures`.
- `--output` — where the report JSON is written (default `eval_results.json`).
- `--detect-hallucinations` and `--track-costs` — enable the optional detectors (also settable in config).

`setup_extractor` dynamically imports the loader class from `extract_thinker.document_loader`, builds an `LLM` for `api_base`-style params, and returns a configured `Extractor`.

## Representative tests

`tests/test_evaluator.py` exercises `FileSystemDataset` validation, `Evaluator.evaluate` against a real invoice PDF with `InvoiceContract`, `TeacherStudentEvaluator`, `ComparisonType` configs, and hallucination detection against `tests/test_evals/invoice.pdf`.
