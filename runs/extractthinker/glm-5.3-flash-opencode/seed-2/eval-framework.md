---
type: subsystem
title: Evaluation Framework
description: The extract_thinker.eval subsystem — Evaluator runs extraction against labeled datasets, with configurable field comparison, hallucination detection, cost tracking, teacher-student benchmarking, and a config-file CLI.
tags: [evaluation, testing, hallucination, cost-tracking, cli]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:45:03.808Z
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
  - id: openwiki-source-f388e22431a1a1afe07448ea
    resource: repo://extract_thinker/eval/setup.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-8dc53e44124fed5d3b4d2a05
    resource: repo://tests/test_evaluator.py
generated: { by: "opencode", at: "2026-09-11T09:45:03.808Z" }
---

# Evaluation Framework

`extract_thinker/eval/` is a self-contained subsystem for measuring extraction quality against labeled datasets. It is separate from the runtime extraction path but reuses `Extractor` directly.

## Core components

- **`Evaluator`** (`extract_thinker/eval/evaluator.py#L29-L425`): the main class. Constructed with an `Extractor`, the `Contract`/response model, and optional flags — `detect_hallucinations`, `track_costs`, per-field comparisons (`field_comparisons`), and a `document_text_provider` callback for supplying document text without additional loads.
- **`EvaluationDataset` / `FileSystemDataset`** (`extract_thinker/eval/dataset.py`): abstract dataset yielding `(doc_id, doc_path, expected)` triples; `FileSystemDataset` pairs a directory of documents with label files and validates the pairing in `_validate_documents`.
- **`FieldComparisonManager` / `ComparisonType`** (`extract_thinker/eval/field_comparison.py#L6-L176`): five per-field comparison modes — `EXACT`, `FUZZY` (Levenshtein-based), `SEMANTIC`, `NUMERIC` (tolerance-aware), and `CUSTOM` (caller-supplied comparator). Defaults are initialized from the response model types; `Evaluator.set_field_comparison` overrides per field with `similarity_threshold` (default 0.8) and `numeric_tolerance` (default 0.01).
- **`HallucinationDetector`** (`extract_thinker/eval/hallucination.py`): flags extracted values that the source document doesn't support. Strategies come from `HallucinationDetectionStrategy`: `LLM` (asks the model to verify the value against document text) or `HEURISTIC` (pattern matching fallback). The detector runs per field, recursing into lists and dicts, and skips fields (e.g., empty values) via `_should_skip_field`.
- **`CostMetrics`** (`extract_thinker/eval/cost_metrics.py`): token and dollar-cost accumulation per document, fed by litellm's `token_counter` and `completion_cost` when the extractor's response object carries `_response.usage` (`extract_thinker/eval/evaluator.py#L268-L297`).
- **`EvaluationReport`** (`extract_thinker/eval/report.py`): serialized metrics, per-field precision/recall/F1, and per-document results, with `print_summary`.

## Evaluate flow

`Evaluator.evaluate(dataset, evaluation_name, skip_failures)` (`extract_thinker/eval/evaluator.py#L148-L249`):

1. Resets all metrics.
2. For each dataset item, `_extract_document` optionally loads document text (via provider, or the extractor's loader as fallback) for hallucination checks, times the extraction, calls `extractor.extract(doc_path, response_model, ...)`, and compares the prediction to the expected dict using the field comparison configs.
3. On extraction failure: schema metrics get a failure; the exception is re-raised unless `skip_failures=True`, in which case a placeholder result with `predicted: None` is recorded.
4. Aggregates documents tested, document accuracy, schema validation rate, precision/recall/F1 averages, execution time, and (optionally) costs into an `EvaluationReport`.

Note: cost tracking depends on the returned model carrying a private `_response` attribute with usage; standard extraction paths don't guarantee it, and failures there degrade to printed warnings, not errors (`evaluator.py#L268-L297`).

## Teacher-student benchmarking

`TeacherStudentEvaluator` (`extract_thinker/eval/evaluator.py#L427`) extends `Evaluator` to compare a "student" extractor against a stronger "teacher" extractor — benchmarking where the student's outputs mismatch a more capable model's outputs, and its report printer has a dedicated `_print_teacher_student_summary` (`extract_thinker/eval/report.py#L122`).

## CLI

`extract_thinker/eval/cli.py` provides `main()` with two required arguments (`extract_thinker/eval/cli.py#L95-L149`):

- `--config` — a YAML/JSON configuration file naming the document loader (imported dynamically by class name from `extract_thinker.document_loader`), LLM config, contract module, labels, and dataset paths. The contract class is discovered by finding the first `Contract` subclass in the target module (`cli.py#L15-L30`).
- `--output` — where to write the results JSON (default `eval_results.json`).

`extract_thinker/eval/setup.py` wires the entry point `extract_thinker-eval=extract_thinker.eval.cli:main`, but note this file is a fallback setuptools config — the canonical project packaging is Poetry (`pyproject.toml`).

## Tests

`tests/test_evaluator.py` exercises the evaluator with a real extractor (PyPdf loader, models from `get_lite_model`) against temporary datasets, including comparison config scenarios, plus exported hallucination result models and `TeacherStudentEvaluator` from the eval package (`tests/test_evaluator.py#L15-L45`).

Related: [Extractor and Extraction Flow](/openwiki/extractor-and-extraction-flow.md) · [LLM Layer](/openwiki/llm-layer.md)
