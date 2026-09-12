---
type: "Reference"
title: "Evaluation and Reliability"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:22:48.987Z
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
generated: { by: "opencode", at: "2026-09-12T21:22:48.987Z" }
---


# Evaluation and Reliability

ExtractThinker ships a self-contained evaluation (`eval`) framework under `extract_thinker/eval/` for measuring how well an `Extractor` recovers expected structured data from a corpus of documents. It is exposed via `extract_thinker.eval` (see `eval/__init__.py`).

## Evaluator configuration and flow

`Evaluator` (`extract_thinker/eval/evaluator.py`) is constructed with:

- an `Extractor` (already configured with a DocumentLoader and LLM),
- a `response_model` (`Contract`) defining the expected schema,
- optional `vision`, `content`, per-field `field_comparisons`, `detect_hallucinations`, `track_costs`, and a `document_text_provider`.

`Evaluator.evaluate(dataset, evaluation_name, skip_failures)` iterates each `(doc_id, doc_path, expected)` item in an `EvaluationDataset`, calls `extractor.extract` for each document, compares predicted vs expected fields, and produces an `EvaluationReport` (`evaluator.py:145-215`).

For each document `_extract_document` (`evaluator.py:217-413`):

1. Times the extraction and, if cost tracking is on, estimates input tokens.
2. Runs extraction; records schema validity (schema failure counts only as invalid, not an extraction error).
3. Computes per-field correctness using the `FieldComparisonManager`, updates `FieldMetrics`, and marks the document correct only if **all** fields match.
4. Optionally runs `HallucinationDetector` against the predicted result using the document's raw text.
5. Returns a result dict with expected, predicted, per-field comparison outcomes, schema validity, execution time, and (optionally) tokens/cost and hallucination results.

With `skip_failures=True`, extraction exceptions are captured as failure results instead of being re-raised. `FieldMetrics`, `DocumentMetrics`, `SchemaValidationMetrics`, and `ExecutionTimeMetrics` (in `extract_thinker/eval/metrics.py`) accumulate precision/recall/F1, document accuracy, schema success rate, and timing.

`Evaluator.save_report` writes the report JSON to a file.

## Datasets

`EvaluationDataset` (`extract_thinker/eval/dataset.py`) is an abstract iterator yielding `(doc_id, doc_path, expected)`. `FileSystemDataset` loads documents from a directory (glob `file_pattern`) and expected outputs from a JSON labels file, validating bidirectionally (every document has a label and vice versa), raising `ValueError` on missing labels/documents.

## Field comparison

`FieldComparisonConfig` + `FieldComparisonManager` (`extract_thinker/eval/field_comparison.py`) compare extracted values to expected values. `ComparisonType`:

- `EXACT` — string/value equality (JSON-serialized for list/dict).
- `FUZZY` — Levenshtein ratio (via the `Levenshtein` package) against `similarity_threshold`.
- `SEMANTIC` — sentence-transformer (`all-MiniLM-L6-v2`) or litellm embedding cosine similarity.
- `NUMERIC` — relative difference within `numeric_tolerance`.
- `CUSTOM` — a caller-supplied comparator.

Defaults are chosen by field type (numeric fields → `NUMERIC`, scalars → `EXACT`, complex → `EXACT`). Callers can override per-field via `set_field_comparison` or the constructor `field_comparisons` dict.

## Hallucination detection

`HallucinationDetector` (`extract_thinker/eval/hallucination.py`) follows the Confident AI metric: **Hallucination = contradicted fields / total fields**. Two strategies (`HallucinationDetectionStrategy`):

- `HEURISTIC` — string/article matching of the value against the document text; direct match → 0.0, word-level match → 0.3, partial 4-char match → 0.6, no match → 0.9.
- `LLM` — asks the configured LLM (`HallucinationCheckResponse` model) whether each field is contradicted/unsupported, falling back to the heuristic on error.

Fields equal to `doc_id`/`metadata`/`confidence` or `None` are skipped. Complex lists/dicts are averaged from their item checks. Results are `DocumentHallucinationResults` with `overall_score`, `field_scores`, and per-field `HallucinationResult`s.

## Cost tracking

`CostMetrics` (`extract_thinker/eval/cost_metrics.py`) aggregates per-document input/output tokens and USD cost (driven by litellm `completion_cost`), reporting totals and averages.

## Teacher-student evaluation

`TeacherStudentEvaluator` (`extract_thinker/eval/evaluator.py:427-781`) subclass runs a "student" extractor against a "teacher" (usually stronger) extractor on the same dataset, producing field-by-field and document accuracy improvements in a comparative `EvaluationReport`.

## CLI entrypoint

`extract_thinker/eval/cli.py` exposes a `main()` that:

- parses `--config` (JSON), `--output`, `--detect-hallucinations`, `--track-costs`;
- loads a Contract class dynamically from a Python file (`load_contract`);
- builds an Extractor from config (`setup_extractor`), choosing a DocumentLoader type by dynamic import and a model string or LLM config;
- constructs a `FileSystemDataset` from `documents_dir` and `labels_path`;
- runs `Evaluator.evaluate`, prints the summary, and saves the report.
