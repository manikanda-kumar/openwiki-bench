---
type: evaluation-framework
title: Evaluation Framework
description: The extract_thinker.eval subpackage — Evaluator metrics, field comparisons, hallucination detection, cost tracking, datasets, reports, and the extract_thinker-eval CLI.
tags: [evaluation, metrics, hallucination, cost-tracking, cli]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T08:46:09.069Z
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
generated: { by: "opencode", at: "2026-09-11T08:46:09.069Z" }
---

# Evaluation Framework

The `extract_thinker/eval/` subpackage measures extraction quality against labeled datasets: per-field precision/recall/F1, document-level accuracy, schema validation rates, execution time, optional hallucination detection, and optional token/cost tracking. It is distributed as a separate installable entry point (`extract_thinker-eval`) via `extract_thinker/eval/setup.py`, which registers `extract_thinker.eval.cli:main` as a console script (`extract_thinker/eval/setup.py:1-8`).

## Evaluator

`Evaluator(extractor, response_model, vision=False, content=None, field_comparisons=None, detect_hallucinations=False, track_costs=False, document_text_provider=None)` wraps a caller-supplied, fully configured `Extractor` (`extract_thinker/eval/evaluator.py:29-110`). Per-document text for hallucination detection is sourced from an optional `document_text_provider` callable, falling back to the extractor's own document loader; if neither works, a warning is printed and hallucination detection proceeds without document text (`extract_thinker/eval/evaluator.py:250-274`).

`evaluate(dataset, evaluation_name, skip_failures=False)` iterates `dataset.items()` (doc id, path, expected dict), extracts each document through the extractor, and aggregates metrics into an `EvaluationReport` containing overall accuracy, schema validation rate, average precision/recall/F1, average execution time, optional cost metrics, per-field metrics, and the comparison configurations used (`extract_thinker/eval/evaluator.py:140-205`). With `skip_failures=True`, extraction/schema failures are recorded as failed results instead of aborting the run (`extract_thinker/eval/evaluator.py:311-330`).

## Metrics modules

- **FieldMetrics** — per-field true positives/false positives/false negatives derived from field-level comparisons, aggregated into precision, recall, and F1 (`extract_thinker/eval/metrics.py:6-60`).
- **DocumentMetrics** — document-level accuracy.
- **SchemaValidationMetrics** — whether extraction produced a schema-valid result.
- **ExecutionTimeMetrics** — per-document timing.
- **CostMetrics** — token and cost accumulation per document (`extract_thinker/eval/cost_metrics.py:6-40`).

## Field comparisons

`ComparisonType` defines five comparison modes: `EXACT`, `FUZZY` (Levenshtein-style string similarity), `SEMANTIC` (embedding-based similarity, requiring numpy), `NUMERIC` (tolerance-based), and `CUSTOM` (caller-supplied comparator) (`extract_thinker/eval/field_comparison.py:5-12`). Each field can be configured through `FieldComparisonConfig` with `similarity_threshold` (default 0.8) and `numeric_tolerance` (default 0.01), either at construction or later via `Evaluator.set_field_comparison(...)` (`extract_thinker/eval/evaluator.py:112-138`). `None` equals `None`; a single `None` never matches (`extract_thinker/eval/field_comparison.py:37-44`).

## Hallucination detection

`HallucinationDetector` scores each extracted field against the source document text, following the "Confident AI" formula: overall hallucination = contradicted fields / total fields (`extract_thinker/eval/hallucination.py:19-104`). Two strategies exist (`extract_thinker/eval/HallucinationDetectionStrategy.py:1-6`):

- **LLM** — asks the model whether a field value is contradicted by the document, returning `is_contradicted`, a 0.0–1.0 score, and reasoning; requires an `LLM` instance (`extract_thinker/eval/hallucination.py:11-51`).
- **HEURISTIC** — pattern matching and other heuristics, no LLM needed.

Strategy selection in `Evaluator.__init__` is driven by whether the extractor has an LLM: with one, `HallucinationDetectionStrategy.LLM` is used; without, `HEURISTIC` (`extract_thinker/eval/evaluator.py:89-110`). Detector initialization failures degrade to a printed warning rather than aborting construction. Scalar fields are checked by the active strategy; lists and dicts recurse; unhandled types get a neutral 0.5 score; `None` and metadata fields (`doc_id`, `metadata`, `confidence`) are skipped; a field counts as hallucinated when its score meets or exceeds the detector threshold (default 0.7) (`extract_thinker/eval/hallucination.py:60-140`).

## Cost tracking

With `track_costs=True`, the evaluator reads token usage from the extraction response's `_response.usage` (input/output tokens) and computes cost via `litellm.completion_cost`, feeding `CostMetrics` per document; when usage is unavailable it falls back to estimating input tokens with `litellm.token_counter` over the document text. Failures are warnings, not errors (`extract_thinker/eval/evaluator.py:276-308`).

## Datasets

`EvaluationDataset` is the abstract source of `(doc_id, doc_path, expected)` tuples (`extract_thinker/eval/dataset.py:8-38`). `FileSystemDataset` loads documents from a directory (glob pattern, default `*.*`) and expected outputs from a JSON labels file, and validates bijection at construction: documents without labels or labels without documents raise `ValueError` (`extract_thinker/eval/dataset.py:41-115`).

## Reports and teacher-student comparison

`EvaluationReport` is a Pydantic model with optional `teacher_field_metrics` and `field_improvements` fields, supporting teacher/student comparison runs (e.g. comparing a stronger model against a cheaper one) (`extract_thinker/eval/report.py:9-40`). Reports print a summary and are saved by `Evaluator.save_report(report, path)` as JSON.

## CLI

`extract_thinker-eval` takes `--config` (JSON), `--output` (default `eval_results.json`), plus `--detect-hallucinations` and `--track-costs` flags that merge with config-file settings (`extract_thinker/eval/cli.py:85-160`). The config specifies the document loader (dynamically imported by class name from `extract_thinker.document_loader` with params), the LLM (string model name or `{model, params}` object with optional `api_base`), `contract_path` (a Python file scanned for a `Contract` subclass), `documents_dir`, `labels_path`, and optional dataset/evaluation naming (`extract_thinker/eval/cli.py:42-83`).

## Representative tests

`tests/test_evaluator.py` exercises the evaluator against fixture documents; like the rest of the suite it requires provider API keys for live extraction runs.

## Related pages

- [Extractor: Extraction and Classification Engine](extractor.md)
- [LLM Integration Layer](llm-integration.md)
- [Testing Guide](testing.md)
