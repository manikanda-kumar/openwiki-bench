---
type: change-guide
title: "Tuning Extraction Quality"
description: "Change guide for improving extraction accuracy: contract-to-prompt rendering, completion strategy trade-offs, thinking budgets and temperature, classification consensus, and measuring with the eval framework."
tags: [tuning, contracts, prompts, completion-strategies, evaluation]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T10:24:25.212Z
sources:
  - id: openwiki-source-e9ebd8673ce94833101e27ed
    resource: repo://extract_thinker/concatenation_handler.py
  - id: openwiki-source-964e22fb6c2de60a25515dfc
    resource: repo://extract_thinker/document_loader/document_loader_llm_image.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-72ce7d92abd4e848a4171b49
    resource: repo://extract_thinker/eval/evaluator.py
  - id: openwiki-source-6dca7475707e06d60e40fcef
    resource: repo://extract_thinker/eval/field_comparison.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-d14c100cb1c28d349fc7a183
    resource: repo://extract_thinker/global_models.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-3ed24b37fde18a7f8973b7b4
    resource: repo://extract_thinker/pagination_handler.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-11T10:24:25.212Z" }
---

# Tuning Extraction Quality

Knobs that the source actually supports, ordered by leverage. Verify each change with the eval harness at the end — the pipeline is stochastic at model boundaries even at temperature 0.

## 1. Design the contract for the prompt, not just validation

The LLM never sees your Pydantic docstrings: `add_classification_structure` renders only `Name, Type, Attributes: required=...` per field, recursing into nested models and list/dict element types (`extract_thinker/utils.py:268-328`). That rendering feeds three prompt paths:

- classification prompts, which explicitly tell the model to *increase confidence when contract fields are found* in the document (`extract_thinker/extractor.py:744-749`);
- the CONCATENATE system prompt, which demands the exact structure (`concatenation_handler.py:121-130`);
- dynamic mode's JSON-structure request (`llm.py:211-219`), and splitter prompts via `Classification.contract` (`image_splitter.py:224-254`).

Consequences: field *names* carry all the semantics (rename ambiguous fields rather than adding descriptions); a `Contract` with fewer, precisely named fields classifies and parses better. `Classification.extraction_contract` lets the classification prompt use a rich `contract` while extraction validates a lighter one (`process.py:253-258`).

## 2. Pick the completion strategy per document shape

`Extractor.extract(..., completion_strategy=...)` defaults to `FORBIDDEN` (one request; truncated output becomes `ExtractThinkerError`). From `extract_thinker/models/completion_strategy.py` and the handlers:

- **PAGINATE** — one parallel request per page with all fields optional, then deterministic merge (list-key merging on `country/region/id/name`) and an extra LLM arbitration request only when scalars disagree (`pagination_handler.py:28-69,144-204,270-305`). Best when each page repeats the same schema (line items, forms). Cost scales with page count; remember failed pages are silently dropped — compare per-page coverage.
- **CONCATENATE** — sequential raw completions stitched into one JSON, up to 3 continuations (`concatenation_handler.py:30-60`). Best for one deeply nested answer that exceeds a single completion window.
- **FORBIDDEN** — cheapest and most deterministic; raise the output room first (see knob 3) before abandoning it.

## 3. Token budgets, temperature, and thinking

- `LLM(model, token_limit=N)` clamps `max_completion_tokens`; default is `DEFAULT_MAX_COMPLETION_TOKENS = 8000` — truncation symptoms ("Incomplete output ... FORBIDDEN") often mean this is too low for a big contract (`llm.py:50-53,348-356`).
- Thinking mode: `Extractor.enable_thinking_mode()` (sets `LLM.set_thinking`), budget scaled by `Extractor.set_page_count` or automatic page counting from loader metadata; formula is `page_count * 1500 / 3`, clamped `[1200, 64000]` with content cap 120000 (`llm.py:155-181`). `set_thinking` **also forces temperature 1** — if you need thinking plus determinism, that combination does not exist in this codebase.
- Default `temperature` is 0 (`DEFAULT_TEMPERATURE`); tune per-model via `set_temperature` (`llm.py:127-133`).
- Dynamic parsing (`LLM.set_dynamic(True)`) tolerates `<think>` prose before the JSON via `extract_thinking_json` (`llm.py:144-153,228-236`) at the cost of instructor's per-request validation.

## 4. Classification: layers and thresholds

- `Process.classify(file, classifications, strategy, threshold)` defaults to `CONSENSUS` with `threshold=9` (`process.py:74-79`). Single-extractor consensus always returns its answer (unanimity over a 1-element set), so the threshold only bites with `CONSENSUS_WITH_THRESHOLD` (`process.py:111-114`).
- Multiple extractor layers (`add_classify_extractor([[a, b], [c]])`) give cheap-first, expensive-fallback routing: layer one must disagree before layer two is consulted (`process.py:96-117`); each layer costs one classify request per extractor.
- Mixed-model consensus is the intended diversity play, but note `get_lite_model()` and `get_big_model()` currently return the same Gemini string (`global_models.py:1-9`) — verify your presets actually differ before believing your consensus is multi-model.
- `ClassificationTree` hierarchical classification trades one request per level for precision on large label sets and matches by UUID (`process.py:127-188`).

## 5. Loader-side quality

OCR/layout quality gates everything downstream:

- `TesseractConfig(psm=..., oem=..., lang=...)` — segmentation mode materially changes text extraction; defaults are psm 3 / oem 3 (`document_loader_tesseract.py:34-42`).
- Vision rendering defaults: PDF→image scale `300/72` (~300 DPI) in `convert_to_images`, optional `set_max_image_size` downscale, and `LLMImageConfig(compression_quality=85)` re-encoding (`document_loader.py:92-99`, `document_loader_llm_image.py:16-40`).
- Prefer structured loaders (pypdf/pdfplumber text, spreadsheet sheets) over image+vision paths when the source is natively digital.

## 6. Measure with the eval harness

Before/after runs with `extract_thinker.eval` (details: [Evaluation Framework](/openwiki/architecture/evaluation.md)):

- `Evaluator(extractor, Contract, field_comparisons={...})` + `FileSystemDataset` over a labeled folder gives per-field precision/recall/F1 and all-fields-correct document accuracy (`metrics.py`, `evaluator.py:185-215`).
- Choose per-field comparators deliberately: ints/floats default to NUMERIC (1% tolerance); text fields usually need `ComparisonType.FUZZY`/`SEMANTIC` (optional Levenshtein/sentence-transformers installs) or a `custom_comparator` (`field_comparison.py:163-199`).
- `detect_hallucinations=True` adds the contradiction ratio per document (LLM strategy grades with the *same* model that extracted — treat as a smell test, not ground truth) (`evaluator.py:91-110`, `hallucination.py:69-97`).
- `track_costs=True` reports tokens and litellm `completion_cost` per document so quality changes can be priced (`evaluator.py:289-305`).
- `TeacherStudentEvaluator` quantifies a model upgrade: it reports student/teacher document accuracy, schema rates, timing, and per-field improvement percentages (`evaluator.py:427-781`).
