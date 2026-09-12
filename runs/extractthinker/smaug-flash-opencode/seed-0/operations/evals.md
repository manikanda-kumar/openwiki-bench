---
type: "Reference"
title: "Evaluation and Quality Metrics"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:12:00.069Z
sources:
  - id: openwiki-source-b027d6219be9dca2cec9b76a
    resource: repo://extract_thinker/eval/dataset.py
  - id: openwiki-source-72ce7d92abd4e848a4171b49
    resource: repo://extract_thinker/eval/evaluator.py
  - id: openwiki-source-6dca7475707e06d60e40fcef
    resource: repo://extract_thinker/eval/field_comparison.py
  - id: openwiki-source-1a8829a408e6b8676a90fdbb
    resource: repo://extract_thinker/eval/hallucination.py
generated: { by: "opencode", at: "2026-09-12T21:12:00.069Z" }
---


# Evaluation and Quality Metrics

The eval subsystem (`extract_thinker/eval/`) measures how well an `Extractor`
extracts structured data against a labeled dataset and produces an
`EvaluationReport`.

## Datasets

`EvaluationDataset` (extract_thinker/eval/dataset.py:8-45) is the abstract
source of `(document_id, document_source, expected_output)` triples.
`FileSystemDataset` (dataset.py:48-132) loads documents from a directory and
expected outputs from a JSON labels file, validating that every document has a
label and vice versa.

## Evaluator

`Evaluator` (extract_thinker/eval/evaluator.py:26-425) is constructed with an
`Extractor`, a `Contract` response model, and optional vision/content settings.
`evaluate` (evaluator.py:145-215) resets metrics then iterates the dataset,
extracting each document and comparing against expected output:

- Schema validation success drives `SchemaValidationMetrics`.
- Field-level correctness uses a `FieldComparisonManager`
  (field_comparison.py:145-214) that maps each field to a `ComparisonType`:
  `EXACT`, `FUZZY` (Levenshtein), `SEMANTIC` (embeddings), `NUMERIC`, or
  `CUSTOM`.
- `FieldMetrics`, `DocumentMetrics`, and `ExecutionTimeMetrics`
  (metrics.py:6-262) accumulate precision/recall/F1, document accuracy, and
  timing.
- Token usage and cost are tracked via litellm `completion_cost`/
  `token_counter` when `track_costs` is enabled.

The result is an `EvaluationReport` (evaluator.py:200-213) with document counts,
overall accuracy, schema validation rate, average precision/recall/F1,
execution time, optional cost metrics, and per-field metrics. `skip_failures`
keeps it running after schema failures and records the error.

## Hallucination detection

`HallucinationDetector` (extract_thinker/eval/hallucination.py:15-310) scores
each extracted field against the source document text. It supports two
strategies via `HallucinationDetectionStrategy`:
`HEURISTIC` (string/word/partial matching) and `LLM` (ask the model whether the
field contradicts the document). The overall score follows the Confident AI
approach: contradicted fields / total fields. The `Evaluator` chooses the LLM
strategy when an LLM is available and falls back to heuristic otherwise
(evaluator.py:88-111).

## Teacher-student benchmarking

`TeacherStudentEvaluator` (evaluator.py:427-781) runs both a student and a
teacher extractor over the same dataset, tracking independent metric sets, then
produces a comparative report with field-level F1 improvements and document
accuracy improvement percentages.
