---
type: subsystem
title: Evaluation Framework
description: The extract_thinker.eval subsystem — Evaluator and TeacherStudentEvaluator over datasets, per-field comparison types, hallucination detection, cost tracking, reports, and the eval CLI.
tags: [evaluation, metrics, hallucination, teacher-student, cli]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:51:57.297Z
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
  - id: openwiki-source-5d4b871e9c654d6fa460c740
    resource: repo://extract_thinker/eval/report.py
  - id: openwiki-source-f388e22431a1a1afe07448ea
    resource: repo://extract_thinker/eval/setup.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-8dc53e44124fed5d3b4d2a05
    resource: repo://tests/test_evaluator.py
generated: { by: "opencode", at: "2026-09-11T09:51:57.297Z" }
---

# Evaluation Framework

`extract_thinker/eval/` is a self-contained benchmarking layer exported from `extract_thinker/eval/__init__.py` (Evaluator, TeacherStudentEvaluator, EvaluationDataset/FileSystemDataset, four metric classes, HallucinationDetector, CostMetrics, EvaluationReport, and the field-comparison trio). It drives a configured `Extractor` over a labeled dataset and produces a structured `EvaluationReport`.

## Datasets

`EvaluationDataset` is an ABC whose `items()` yields `(doc_id, document_source, expected_dict)` triples (dataset.py:8-45). `FileSystemDataset` pairs a `documents_dir` (globbed with `file_pattern`, default `*.*`) with a JSON `labels_path` keyed by document **basename**, and at construction validates both directions — missing labels or orphan labels each raise `ValueError` listing the offenders (dataset.py:48-108). The repo ships a fixture pair (`tests/test_data/documents/invoice.pdf` + `tests/test_data/labels/permanent_labels.json`) used by "permanent labels" tests.

## Evaluator pipeline

`Evaluator(extractor, response_model, vision, content, field_comparisons, detect_hallucinations, track_costs, document_text_provider)` (evaluator.py:34-117):

- Builds a `FieldComparisonManager` over the response model and applies any per-field `ComparisonType`/`FieldComparisonConfig` overrides; `set_field_comparison(...)` is the imperative alternative (evaluator.py:63-143).
- Initializes `FieldMetrics` (per-field TP/FP/FN counters derived from the contract's `__annotations__`, yielding precision/recall/F1/accuracy), `DocumentMetrics` (all-fields-correct rate), `SchemaValidationMetrics` (successful extractions rate), and `ExecutionTimeMetrics` (metrics.py:6-240).
- With `detect_hallucinations`, it picks strategy `LLM` when the extractor has an `llm` attribute else `HEURISTIC`, and swallows detector construction failures with a printed warning (evaluator.py:88-110).

`evaluate(dataset, evaluation_name, skip_failures=False)` resets metrics and calls `_extract_document` per item (evaluator.py:145-215). Per document (evaluator.py:217-413):

1. Optional document text for hallucination checks comes from `document_text_provider(doc_path)` or by loading pages through `extractor.document_loader` and joining `content` fields.
2. `extractor.extract(doc_path, response_model, vision, content)` runs, timed. A raised exception marks the schema invalid: re-raised unless `skip_failures`, in which case a failure record is returned.
3. Predicted output is dumped via `.dict()`/`.model_dump()`. Each expected field is compared through `FieldComparisonManager.compare_values`; missing predicted fields count as incorrect-and-absent; document accuracy is *all* fields correct.
4. Cost tracking, when enabled, reads `extracted._response.usage` and computes `litellm.completion_cost` — so per-document cost only appears if the underlying instructor response object is present.
5. Hallucination results (when enabled and text available) attach per-field scores plus an overall score.

The summary metrics dict covers document accuracy, schema-validation rate, average precision/recall/F1, and average execution time; `save_report` writes `report.json()` to disk (evaluator.py:185-215, 415-425).

## Field comparison

`ComparisonType` = `EXACT | FUZZY | SEMANTIC | NUMERIC | CUSTOM` with `FieldComparisonConfig` (default `similarity_threshold=0.8`, `numeric_tolerance=0.01`, `custom_comparator`) (field_comparison.py:6-20). Matching rules (field_comparison.py:22-142): None-vs-None is a match, one-None is not; EXACT compares stripped strings or key-sorted JSON for lists/dicts; FUZZY needs the optional `Levenshtein` package (falls back to EXACT); SEMANTIC prefers `sentence-transformers` `all-MiniLM-L6-v2` (class-level cached model), then `litellm.embedding` with `text-embedding-ada-002`, then falls back to FUZZY; NUMERIC uses relative tolerance (absolute when expected is 0) with EXACT fallback. `FieldComparisonManager._initialize_defaults` seeds int/float fields to NUMERIC and everything else to EXACT from the model's `__annotations__`; unknown fields default to EXACT at comparison time (field_comparison.py:145-214).

## Hallucination detection

`HallucinationDetector(llm, threshold=0.7, strategy)` follows the "Confident AI" ratio: **overall_score = contradicted fields / total fields** (score ≥ threshold counts as contradicted). It skips `None` values and `doc_id`/`metadata`/`confidence` keys; scalars go to the LLM check (prompt truncates document text to 2000 chars, asks for a 0-1 score + reasoning, and falls back to the heuristic check on LLM errors) or the heuristic check; lists and dicts get dedicated sub-checks; any other type yields score 0.5 "Unhandled field type". Choosing the LLM strategy without an `llm` raises `ValueError` (hallucination.py:15-141, 189-244). Heuristics score by text presence: exact substring → 0.0, all words present → 0.3, any 4-gram match → 0.6, otherwise 0.9 "considered hallucinated" (hallucination.py:142-189).

## Cost metrics

`CostMetrics` accumulates per-document input/output tokens and cost, exposing totals, averages, and a `get_metrics()` bundle that `evaluate` merges into the metrics dict when `track_costs` is on (cost_metrics.py:5-98; evaluator.py:196-198).

## Teacher–Student comparison

`TeacherStudentEvaluator(student_extractor, teacher_extractor, response_model, student/teacher vision and content)` initializes the base evaluator with the *student* and adds parallel teacher metric collectors (evaluator.py:427-477). `evaluate` runs both extractors per document through `_extract_with_extractor` and produces a comparative report with student/teacher document accuracy, improvement percentages per field F1 (infinite when student F1 is 0 but teacher > 0), and `model="Student: X, Teacher: Y"` (evaluator.py:506-780). Notable differences from the base path:

- Field scoring uses `_values_match`, a plain recursive equality — **not** the configured field comparisons (evaluator.py:479-504, 668-680).
- Predicted is read with `.dict()` only, and extraction failures never raise: they record `predicted={"error": ...}` (evaluator.py:645-648).
- The `doc_id` parameter default `str(uuid.uuid4())` is evaluated once at import/def time, so per-document identities collapse to one shared value when not passed explicitly (evaluator.py:586).

## CLI

`extract_thinker/eval/cli.py` exposes `main()` wired as the console script `extract_thinker-eval` in the separate `extract_thinker/eval/setup.py` — note the main `pyproject.toml` declares no scripts entry, so the console command exists only if that setup.py is installed separately. Flow: `--config` (required JSON) + `--output` (default `eval_results.json`) + `--detect-hallucinations`/`--track-costs` flags; the config names a `document_loader` class by attribute on the `extract_thinker.document_loader` module namespace with `params`, an `llm` as model string or `{model, params}` (api_base supported), `contract_path` scanned for the first non-base `Contract` subclass via `importlib`, and dataset paths (cli.py:14-93, 95-151). The run prints `report.print_summary()` (standard vs teacher-student layout chosen by metric keys, report.py:62-153) and saves the JSON report.

## Tests

`tests/test_evaluator.py` covers basic evaluation, hallucination and cost tracking, field comparison types, report saving, the permanent-labels fixtures, teacher-student evaluation, and CLI execution (including `test_cli_cmd_matches_docs` and `test_end_to_end_cli_execution`) against real model calls with temp datasets (tests/test_evaluator.py:83-812). None of these run in CI (`tests/critical/` only), and they require provider credentials in the environment.

## Related pages

- `core/extractor.md` — what the evaluator drives
- `core/llm-integration.md` — model/cost plumbing
- `operations/ci-packaging-testing.md` — how these tests are (not) gated
