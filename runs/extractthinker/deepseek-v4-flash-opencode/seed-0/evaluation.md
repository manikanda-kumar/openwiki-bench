---
type: concept
title: Evaluation Toolkit
description: The eval subsystem for measuring extraction quality — Evaluator and TeacherStudentEvaluator, datasets, field/document/schema/time metrics, cost tracking, hallucination detection, field comparison types, reports, and the CLI.
tags: [evaluation, metrics, hallucination, cost, datasets]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:00:08.410Z
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
  - id: openwiki-source-e6b806ca6158e5fd69687939
    resource: repo://extract_thinker/eval/metrics.py
  - id: openwiki-source-5d4b871e9c654d6fa460c740
    resource: repo://extract_thinker/eval/report.py
  - id: openwiki-source-f388e22431a1a1afe07448ea
    resource: repo://extract_thinker/eval/setup.py
generated: { by: "opencode", at: "2026-09-11T09:00:08.410Z" }
---

# Evaluation Toolkit

The `extract_thinker/eval/` package measures how well an `Extractor` performs
against a dataset of documents with expected results. Everything is re-exported
through `extract_thinker/eval/__init__.py`.

## Evaluator

`Evaluator` (`extract_thinker/eval/evaluator.py:28-...`) is the main entry
point. Construction options (`evaluator.py:34-...`):

- `extractor` — an initialized `Extractor`;
- `response_model` — the `Contract` class defining the expected schema;
- `vision` / `content` — extraction options forwarded to each run;
- `field_comparisons` — dict of field name → `ComparisonType` or
  `FieldComparisonConfig`;
- `detect_hallucinations` — enables a `HallucinationDetector` (LLM strategy when
  the extractor has an LLM, otherwise heuristic);
- `track_costs` — enables `CostMetrics` token/cost tracking;
- `document_text_provider` — optional callable `(doc path) -> text` used for
  hallucination checks.

`evaluate(dataset, evaluation_name, skip_failures)` (`evaluator.py:145-...`)
resets all metrics, iterates `dataset.items()` (doc id, source, expected dict),
extracts each document with `_extract_document`, and aggregates results. It
returns an `EvaluationReport`.

### Report contents

`EvaluationReport` (`extract_thinker/eval/report.py:5-...`) is a Pydantic model
with `evaluation_name`, `dataset`, `model`, `timestamp`, `documents_evaluated`,
`metrics`, `field_metrics`, and optional `teacher_field_metrics`,
`field_improvements`, `comparison_configs`, `results`, `teacher_results`,
`cost_metrics`, and `hallucination_metrics`. `print_summary` emits either a
standard or teacher-student summary depending on whether
`teacher_document_accuracy` is present in `metrics`.

## Metrics

- `FieldMetrics` (`eval/metrics.py:4-...`) tracks per-field true/false
  positives and negatives and computes precision, recall, and F1.
- `DocumentMetrics` — document-level accuracy (`get_accuracy`, metrics.py:143-168).
- `SchemaValidationMetrics` — schema validation success rate (`get_success_rate`,
  metrics.py:178-204).
- `ExecutionTimeMetrics` — average per-document execution time (`get_average_time`,
  metrics.py:215-237).
- `CostMetrics` (`eval/cost_metrics.py`) — aggregates input/output/total tokens
  and costs per document and in total, using litellm cost helpers.

## Field comparison

`ComparisonType` (`extract_thinker/eval/field_comparison.py:7-...`) defines how
an extracted field value is compared to the expected value:

- `EXACT` — serialized equality (lists/dicts compared via sorted JSON);
- `FUZZY` — Levenshtein ratio ≥ `similarity_threshold` (default 0.8) with a
  fallback to exact when `python-Levenshtein` is missing;
- `SEMANTIC` — cosine similarity of sentence-transformers embeddings
  (`all-MiniLM-L6-v2`);
- `NUMERIC` — relative tolerance `numeric_tolerance` (default 0.01);
- `CUSTOM` — user-supplied comparator function.

`FieldComparisonConfig.is_match` dispatches to the selected strategy. Defaults
can be overridden per field via `Evaluator.set_field_comparison`.

## Hallucination detection

`HallucinationDetector` (`eval/hallucination.py`) compares extracted fields to
the source document text. Strategy selection
(`HallucinationDetectionStrategy`, `eval/HallucinationDetectionStrategy.py`)
defaults to `LLM` when an `LLM` is provided, else `HEURISTIC` (LLM strategy
raises `ValueError` without an LLM). Per field it produces a hallucination score
(0.0–1.0) via `_detect_field_hallucination`; fields scoring ≥ `threshold`
(default 0.7) are counted as contradicted. The overall document score follows the
"Confident AI" formulation:

```
Hallucination = contradicted fields / total fields
```

`detect_hallucinations` returns a `DocumentHallucinationResults` with
`overall_score`, `field_scores`, and `detailed_results`.

## Datasets

`EvaluationDataset` (abstract) yields `(doc_id, doc_path, expected)` items.
`FileSystemDataset` (`eval/dataset.py`) loads documents from `documents_dir`
using a glob `file_pattern` and expected outputs from a JSON `labels_path`. Its
`_validate_documents` raises `ValueError` if any document lacks a label, and the
constructor also detects labels without matching documents.

## Teacher-student evaluation

`TeacherStudentEvaluator` (`evaluator.py:427-...`) subclasses `Evaluator` and
runs a `teacher_extractor` (a superior model) alongside the student extractor
over the same dataset. It keeps separate teacher metrics, stores
`teacher_results`, and builds a report that includes per-field
`field_improvements` (percent F1 improvement, `inf` when the student F1 is 0 and
the teacher F1 is positive) and document-accuracy improvement
(`evaluator.py:716-756`).

## CLI

`extract_thinker_eval` (`eval/cli.py`, console script wired in
`eval/setup.py`) runs evaluations from a JSON config file:

- `--config <json>` — required; config contains `contract_path`,
  `documents_dir`, `labels_path`, optional `document_loader`/`llm`
  configuration, `vision`, `content`, and dataset name;
- `--output <file>` — where the report JSON is saved (default `eval_results.json`);
- `--detect-hallucinations` / `--track-costs` — enable the respective features.

`load_contract` dynamically imports the `Contract` subclass from a Python file,
and `setup_extractor` builds an `Extractor` from the config's loader/LLM
settings (`eval/cli.py`).

## Testing

`tests/test_evaluator.py` exercises the toolkit against a small dataset under
`tests/test_data/` (documents in `tests/test_data/documents/` with
`tests/test_data/labels/permanent_labels.json`).
