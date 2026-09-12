---
type: "Reference"
title: "Evaluation and Quality Metrics"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:16:59.187Z
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
  - id: openwiki-source-e6b806ca6158e5fd69687939
    resource: repo://extract_thinker/eval/metrics.py
  - id: openwiki-source-5d4b871e9c654d6fa460c740
    resource: repo://extract_thinker/eval/report.py
  - id: openwiki-source-f388e22431a1a1afe07448ea
    resource: repo://extract_thinker/eval/setup.py
generated: { by: "opencode", at: "2026-09-12T21:16:59.187Z" }
---


# Evaluation and Quality Metrics

The `extract_thinker/eval` package measures how well an `Extractor` performs against labeled test datavoice, providing a structured `EvaluationReport`.

## Datasets

`EvaluationDataset` (`extract_thinker/eval/dataset.py:8`) is the abstract base; it yields tuples of `(doc_id, doc_source, expected_output_dict)` via `items()` and reports `__len__`.

`FileSystemDataset` (`extract_thinker/eval/dataset.py:48`) loads documents from a directory (using a glob `file_pattern`) and expected values from a JSON `labels_path` file keyed by filename. It validates that every document file has a label and every label has a document file (`_validate_documents`), raising `ValueError` for mismatches.

## Evaluator

`Evaluator` (`extract_thinker/eval/evaluator.py:26`) runs a labeled dataset through an `Extractor` and records per-document and aggregate metrics.

### evaluate() flow

1. Reset all metric trackers.
2. For each `(doc_id, doc_path, expected)` in `dataset.items()`, call `_extract_document`.
3. `_extract_document` (`extract_thinker/eval/evaluator.py:217`):
   - Times extraction with `time.time()`.
   - Runs `extractor.extract(doc_path, response_model, vision, content)`.
   - On success, records schema-valid, converts the predicted model to a dict, and computes field-by-field matches via `field_comparison_manager`.
   - Detects hallucinations if enabled.
   - Tracks token usage/cost if enabled.
4. Builds an `EvaluationReport` with overall metrics: `documents_tested`, `overall_document_accuracy`, `schema_validation_rate`, `average_precision`, `average_recall`, `average_f1`, `average_execution_time_s` (plus cost metrics if tracked).

### Metric trackers

- `FieldMetrics` (`extract_thinker/eval/metrics.py:6`): per-field precision, recall, F1, accuracy. Uses `model_class.__annotations__` to enumerate fields; `update(field, correct, present)` increments TP/FP/FN.
- `DocumentMetrics` (`extract_thinker/eval/metrics.py:143`): document-level accuracy (a document is correct only if all its fields are correct).
- `SchemaValidationMetrics` (`extract_thinker/eval/metrics.py:178`): schema-validation success rate.
- `ExecutionTimeMetrics` (`extract_thinker/eval/metrics.py:215`): average/min/max execution time.

### Field comparison

`ComparisonType` (`extract_thinker/eval/field_comparison.py:6`) defines how predicted values are judged:

- `EXACT` — serialized equality (JSON-string compare for complex types).
- `FUZZY` — string similarity via Levenshtein `ratio`, compared against `similarity_threshold` (default 0.8).
- `SEMANTIC` — cosine similarity of embeddings (sentence-transformers or litellm), vs threshold.
- `NUMERIC` — relative difference vs `numeric_tolerance` (default 0.01).
- `CUSTOM` — user-supplied comparator callable.

`FieldComparisonManager` (`extract_thinker/eval/field_comparison.py:145`) assigns default configs by field type (numeric → `NUMERIC`, primitive str/bool → `EXACT`, complex → `EXACT`) and stores per-field overrides set via `set_field_comparison`.

## Hallucination detection

`HallucinationDetector` (`extract_thinker/eval/hallucination.py:15`) computes per-field hallucination scores using the **Confident AI approach**: `Hallucination = Number of Contradicted Fields / Total Number of Fields` (`extract_thinker/eval/hallucination.py:90`).

Two strategies exist (`HallucinationDetectionStrategy`, `extract_thinker/eval/HallucinationDetectionStrategy.py:4`):

- **LLM** — require an `LLM`; ask it (via `HallucinationCheckResponse` model of `is_contradicted`/`score`/`reasoning`) whether each field contradicts the document, truncating document text to 2000 chars.
- **HEURISTIC** — string matching: exact match → score 0.0; all words present → 0.3; partial match → 0.6; no match → 0.9.

A field is considered hallucinated when its score ≥ threshold (default 0.7). List fields average their item scores; dict fields recursively average subfield scores. Skipped fields: `None` values and `doc_id`/`metadata`/`confidence`. The `Evaluator` auto-selects strategy: LLM if the extractor has an `llm`, else HEURISTIC.

Results materialize as `DocumentHallucinationResults` (`extract_thinker/eval/DocumentHallucinationResults.py:10`) with `doc_id`, `overall_score`, `field_scores`, and `detailed_results`.

## Cost tracking

`CostMetrics` (`extract_thinker/eval/cost_metrics.py:5`) accumulates per-document input/output tokens and USD costcars, exposing totals and averages. `Evaluator._extract_document` estimates input tokens via litellm `token_counter` matching estimated tokens when cost tracking is enabled, and computes actual usage + `completion_cost(completion_response=extracted._response, ...)` (`extract_thinker/eval/evaluator.py:288`).

## Report

`EvaluationReport` (`extract_thinker/eval/report.py:6`) is a Pydantic model with overall metrics, field metrics, comparison configs, per-document results, and optional teacher fields. `print_summary()` prints either a standard summary or a teacher–student summary depending on whether `teacher_document_accuracy` is present in metrics.

## Teacher–Student comparison

`TeacherStudentEvaluator` (`extract_thinker/eval/evaluator.py:427`) compares a student (cheaper/weaker) extractor against a teacher (stronger) extractor on the same dataset, tracking separate metrics and producing a report with field-level F1 improvements and document-accuracy improvement percentages.

## CLI

`extract_thinker-eval` (`extract_thinker/eval/cli.py:95`, registered via `extract_thinker/eval/setup.py:4`) is an argparse CLI:

- `--config` (required): JSON config file.
- `--output` (default `eval_results.json`).
- `--detect-hallucinations` / `--track-costs` flags.

Config format (JSON):

```json
{
  "contract_path": "path/to/contract_module.py",
  "documents_dir": "path/to/docs",
  "labels_path": "path/to/labels.json",
  "document_loader": {"type": "DocumentLoaderPyPdf", "params": {}},
  "llm": "gpt-4o-mini",
  "vision": false,
  "dataset_name": "...",
  "file_pattern": "*.*",
  "detect_hallucinations": false,
  "track_costs": false,
  "skip_failures": false
}
```

`load_contract` dynamically loads a Python file and finds the single subclass of `Contract` within it. `setup_extractor` builds the loader and LLM from the config. The CLI runs `Evaluator.evaluate(...)`, prints the summary, and writes the report JSON.

## Testing

- `tests/test_evaluator.py` exercises the evaluation flow and metrics.
- `tests/test_data/` holds labeled evaluation documents and `permanent_labels.json`.
