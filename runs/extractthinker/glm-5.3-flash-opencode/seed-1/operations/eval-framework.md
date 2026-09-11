---
type: operations-tooling
title: Evaluation Framework
description: Evaluator, datasets, metrics, hallucination detection, cost tracking, report output, and the extract-thinker-eval CLI workflow.
tags: [evaluation, metrics, hallucination, cost-tracking, cli]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:40:03.572Z
sources:
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
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
generated: { by: "opencode", at: "2026-09-11T09:40:03.572Z" }
---

# Evaluation Framework

`extract_thinker/eval/` is a self-contained evaluation subsystem for measuring extraction quality of an `Extractor` + `Contract` combination against labeled datasets.

## Components

| Module | Responsibility |
|---|---|
| `evaluator.py` (`Evaluator`) | Run extraction over a dataset, compute metrics, build `EvaluationReport` |
| `dataset.py` (`EvaluationDataset`, `FileSystemDataset`) | Source documents + expected labels; hard validation that labels and documents match exactly (extract_thinker/eval/dataset.py:48-90) |
| `metrics.py` (`FieldMetrics`, `DocumentMetrics`, `SchemaValidationMetrics`, `ExecutionTimeMetrics`) | Precision/recall/F1, document accuracy, schema-valid rate, timing |
| `field_comparison.py` (`FieldComparisonManager`, `ComparisonType`) | Per-field comparison strategies (exact, similarity, numeric tolerance, custom comparators), thresholded floats defaulting to 0.8 similarity / 0.01 numeric tolerance (extract_thinker/eval/evaluator.py:119-143) |
| `hallucination.py` (`HallucinationDetector`) | Field-level hallucination scoring |
| `cost_metrics.py` (`CostMetrics`) | Token/cost accounting |
| `report.py` (`EvaluationReport`) | Result container with `print_summary` and serialization |
| `cli.py` | `extract-thinker-eval`-style command-line driver |

## Evaluation flow

`Evaluator.evaluate(dataset, evaluation_name, skip_failures)` (extract_thinker/eval/evaluator.py:145-215) iterates `dataset.items()` yielding `(doc_id, doc_path, expected)`. For each document `_extract_document`:

1. Optionally fetches document text for hallucination via the injected `document_text_provider` callback, falling back to reading the extractor's own `document_loader`; unavailability emits a warning, not a failure (extract_thinker/eval/evaluator.py:232-249).
2. Calls the standard `extractor.extract(doc_path, self.response_model, vision, content)`; note the evaluator does not return exceptions — extraction failure marks `schema_valid=False`, raises if `skip_failures=False`, else records a failed result and continues (extract_thinker/eval/evaluator.py:307-319).
3. Dumps extraction with `dict()` trying `model_dump` as fallback for Pydantic v2 (extract_thinker/eval/evaluator.py:279-286).
4. Cost tracking (only with `track_costs=True`) prefers usage from `extracted._response` (instructor-attached raw response) and computes cost through `litellm.completion_cost`; token counting uses `litellm.token_counter` for the input text estimate (extract_thinker/eval/evaluator.py:259-305).

Metrics aggregated include `documents_tested`, `overall_document_accuracy`, `schema_validation_rate`, `average_precision/recall/f1`, and `average_execution_time_s`; cost metrics attach when enabled. The model name comes from `extractor.llm.model`, defaulting to `"unknown"`.

## Hallucination detection

`HallucinationDetector` (
extract_thinker/eval/hallucination.py:15-49) follows the Confident-AI-style formula *contradicted fields / total fields*, with configurable threshold (default 0.7). Two strategies:

- `LLM` — requires an `LLM` instance (raises `ValueError` otherwise); asks the model to classify each extracted field against document text as contradicted/not, returning `HallucinationCheckResponse{is_contradicted, score 0.0-1.0, reasoning}` (extract_thinker/eval/hallucination.py:9-49).
- `HEURISTIC` — regex/normalization-based checking without an LLM.

The evaluator selects `LLM` when the extractor carries an LLM, otherwise HEURISTIC; detector construction failure prints a warning and continues with detection disabled rather than aborting the run (extract_thinker/eval/evaluator.py:88-110).

## CLI

`cli.py` (extract_thinker/eval/cli.py:95-152) takes `--config` (JSON with extractor/contract/dataset definition, `detect_hallucinations`, `track_costs`, `skip_failures`) plus `--output` (default `eval_results.json`), `--detect-hallucinations`, `--track-costs` flags that union with config flags. It:

- Dynamically imports the loader class from `extract_thinker.document_loader` by name in config (extract_thinker/eval/cli.py:60-71).
- Loads the Contract class from an external `contract_path` file via importlib, matching the first `Contract` subclass (extract_thinker/eval/cli.py:14-40).
- Builds `FileSystemDataset(documents_dir, labels_path, ... )` from JSON labels.
- Prints a summary and saves `evaluator.save_report(report, output)`.

There is no formal console-script entry (`[tool.poetry.scripts]` is absent in pyproject.toml), so the CLI is invoked as `python -m ...`-style/module script, not an installed binary — installing `extract_thinker` does not add a shell command.

## Tests

tests/test_evaluator.py and tests/test_evals/ exercise the framework with fixture contract/datasets; the detector strategy-choice and skip-failures paths are covered there.
