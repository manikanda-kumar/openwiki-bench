---
type: operations
title: "Evaluation Harness"
description: "The extract_thinker.eval subpackage: Evaluator and TeacherStudentEvaluator flows over EvaluationDataset/FileSystemDataset, field comparison types, precision/recall/F1 and schema/time metrics, hallucination detection strategies, cost tracking, EvaluationReport output, and the extract_thinker-eval CLI."
tags: [eval, metrics, hallucination, cost, cli, teacher-student]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T11:01:32.247Z
sources:
  - id: openwiki-source-20348fa03582863679d141a9
    resource: repo://extract_thinker/eval/cli.py
  - id: openwiki-source-6be05bf068c9ce8ab967bdf7
    resource: repo://extract_thinker/eval/cost_metrics.py
  - id: openwiki-source-b027d6219be9dca2cec9b76a
    resource: repo://extract_thinker/eval/dataset.py
  - id: openwiki-source-133628c45549243bd429b181
    resource: repo://extract_thinker/eval/DocumentHallucinationResults.py
  - id: openwiki-source-72ce7d92abd4e848a4171b49
    resource: repo://extract_thinker/eval/evaluator.py
  - id: openwiki-source-6dca7475707e06d60e40fcef
    resource: repo://extract_thinker/eval/field_comparison.py
  - id: openwiki-source-1a8829a408e6b8676a90fdbb
    resource: repo://extract_thinker/eval/hallucination.py
  - id: openwiki-source-ad1fb45a0c2c65e9bf10fb00
    resource: repo://extract_thinker/eval/HallucinationResult.py
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
generated: { by: "opencode", at: "2026-09-11T11:01:32.247Z" }
---

# Evaluation Harness

`extract_thinker/eval/` is an offline measurement layer around `Extractor`: run a configured extractor over labeled documents, compare every contract field, and emit a structured report. Its public exports are listed in `eval/__init__.py`.

## Core loop: `Evaluator`

`Evaluator(extractor, response_model, vision, content, field_comparisons, detect_hallucinations, track_costs, document_text_provider)` (`eval/evaluator.py:26-117`) wires four metric collectors and a `FieldComparisonManager`, then `evaluate(dataset)` (`evaluator.py:145-215`) iterates `dataset.items()` and runs `_extract_document` per document.

For each document (`evaluator.py:217-413`):

1. **Grounding text** (only when hallucination detection is on) comes from `document_text_provider(doc_path)` if supplied, else from the extractor's own `document_loader.load()` joined page contents; failures print warnings and detection is skipped for that document.
2. `extractor.extract(doc_path, response_model, vision, content)` is timed; success means `schema_valid=True`, an exception means schema failure — raised, or with `skip_failures=True` recorded as a failure result (`evaluator.py:307-326`).
3. Each expected field is compared with `FieldComparisonManager.compare_values(field, expected, predicted)`; missing predicted fields count as present=False (false negatives). All-fields correctness drives `DocumentMetrics` (`evaluator.py:332-354`).
4. When `track_costs`, token usage is read from `extracted._response.usage` and priced with `litellm.completion_cost` — i.e. it depends on instructor attaching the raw response, so non-instructor paths just warn and record zeros (`evaluator.py:289-305`; `eval/cost_metrics.py:6-50` aggregates totals/averages per document).
5. Hallucination detection (when enabled and grounding text exists) scores the predicted dict against the document text.

The report bundles: documents tested, document accuracy, schema-validation rate, average precision/recall/F1, average execution time, plus cost keys when tracked (`evaluator.py:185-213`). `FieldMetrics` computes per-field precision = TP/(TP+FP), recall = TP/(TP+FN), F1, accuracy; `SchemaValidationMetrics` and `ExecutionTimeMetrics` are counters/means (`eval/metrics.py`).

## Field comparison

`ComparisonType` = `EXACT | FUZZY | SEMANTIC | NUMERIC | CUSTOM` (`eval/field_comparison.py:6-11`). Defaults per contract field: int/float → NUMERIC (relative difference ≤ `numeric_tolerance` 0.01, absolute at zero), everything else EXACT (string-stripped; lists/dicts via sorted JSON) (`field_comparison.py:57-76,126-143,163-178`). FUZZY needs the optional `python-Levenshtein` package and silently degrades to EXACT; SEMANTIC prefers a locally cached `sentence-transformers` `all-MiniLM-L6-v2` model, falls back to litellm `text-embedding-ada-002` embeddings (needs an API key), then to fuzzy (`field_comparison.py:66-124`). Custom behavior per field goes through `Evaluator.set_field_comparison(...)` or constructor `field_comparisons`, including `CUSTOM` with a `custom_comparator` callable (`evaluator.py:119-143`).

## Teacher–Student evaluation

`TeacherStudentEvaluator(student_extractor, teacher_extractor, ...)` evaluates both extractors per document and produces a comparative `EvaluationReport` with student/teacher document accuracy, schema rates, execution times, per-field F1 improvements (`improvement_pct`, with `inf` when the student scored zero), and per-field teacher metrics (`evaluator.py:427-780`). Note: its field matching uses the simple recursive `_values_match` (string/list/dict equality), **not** the configured `ComparisonType` machinery of the base evaluator (`evaluator.py:479-504`).

## Datasets

`EvaluationDataset` is an ABC yielding `(doc_id, source, expected_dict)`; `FileSystemDataset(documents_dir, labels_path, name, file_pattern="*.*")` glob-matches documents against a JSON label file keyed by filename and **fails at construction** on any missing label or orphan label (`eval/dataset.py:8-131`). The suite's fixture is `tests/test_data/documents/invoice.pdf` + `tests/test_data/labels/permanent_labels.json`.

## Hallucination detection

`HallucinationDetector(llm, threshold=0.7, strategy)` auto-picks `LLM` when an LLM instance is given, otherwise `HEURISTIC`; LLM strategy without an instance raises `ValueError` (`eval/hallucination.py:23-49`). `None` values and the metadata fields `doc_id`/`metadata`/`confidence` are skipped (`hallucination.py:99-109`). Per field:

- **Heuristic** scores by textual support: 0.0 exact substring, 0.3 all words present, 0.6 any 4-char fragment present, 0.9 no match (`hallucination.py:143-186`). Lists/dicts get dedicated element checks (`_list_hallucination_check`, `_dict_hallucination_check`).
- **LLM** asks for `HallucinationCheckResponse {is_contradicted, score 0..1, reasoning}`.

Fields with `score >= threshold` count as hallucinated; results aggregate to `DocumentHallucinationResults {doc_id, overall_score, field_scores, detailed_results}` (`hallucination.py:51-140`; result models `eval/HallucinationResult.py`, `eval/DocumentHallucinationResults.py`, strategy enum in `eval/HallucinationDetectionStrategy.py`).

## Reports

`EvaluationReport` (Pydantic) stores evaluation/dataset/model/timestamp, overall metrics, per-field metrics, teacher fields, comparison configs, per-document results, and optional cost/hallucination sections; `print_summary()` renders a human summary (standard or teacher-student), and `Evaluator.save_report` writes the report JSON-serialized to a chosen path (`eval/report.py:6-153`, `evaluator.py:415-425`).

## CLI

`extract_thinker/eval/cli.py` provides `main()`:

```
extract_thinker-eval --config eval.json [--output results.json]
                     [--detect-hallucinations] [--track-costs]
```

The JSON config supplies `document_loader: {type, params}` (class resolved dynamically from the `extract_thinker.document_loader` module namespace), `llm` (model string or `{model, params}` — an `api_base` param constructs an `LLM` directly, e.g. Ollama), `contract_path` (a Python file whose first non-base `Contract` subclass is loaded), plus dataset, vision/content/flags. The `extract_thinker-eval` console-script entry point is declared only in the auxiliary `eval/setup.py` package file, not in the root `pyproject.toml`, so the command exists only if that setup is installed; `tests/test_evaluator.py` invokes `cli.main()` via patched `sys.argv`, and its end-to-end run against real APIs can be turned off with `SKIP_END_TO_END=true` (`eval/cli.py:12-151`, `eval/setup.py:1-9`, `tests/test_evaluator.py:808-830`).
