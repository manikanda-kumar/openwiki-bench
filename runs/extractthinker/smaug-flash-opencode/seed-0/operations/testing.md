---
type: concept
title: Testing Model
description: The layout and representative tests of the ExtractThinker suite, including loader tests, extraction tests, completion strategies, critical tests, and which require external credentials.
tags: [testing, pytest, loaders, integration]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:12:00.069Z
sources:
  - id: openwiki-source-d14c100cb1c28d349fc7a183
    resource: repo://extract_thinker/global_models.py
  - id: openwiki-source-6e74af83798eaa995f0676d2
    resource: repo://tests/__init__.py
  - id: openwiki-source-03c94b87dc3801c3c293e463
    resource: repo://tests/critical/test_critical_classification.py
  - id: openwiki-source-7a3dcc39a3d44050a2c8c686
    resource: repo://tests/models/invoice.py
  - id: openwiki-source-11d86d91351e7bfce90b0436
    resource: repo://tests/test_document_loader_tesseract.py
  - id: openwiki-source-ee28bd363b1cf645a390084a
    resource: repo://tests/test_extractor.py
generated: { by: "opencode", at: "2026-09-12T21:12:00.069Z" }
---

# Testing Model

ExtractThinker's tests live under `tests/` and use pytest. They cover document
loaders, the extractor, classification, process/splitting, completion
strategies, markdown conversion, batch processing, LLM backends, and
evaluation.

## Layout

- `tests/` root contains integration-style test modules per subsystem:
  `test_extractor.py`, `test_process.py`, `test_classify.py`,
  `test_batch_extractor.py`, `test_markdown_converter.py`,
  `test_evaluator.py`, `test_llm_backends.py`, `test_ollama.py`, and
  per-loader modules (`test_document_loader_*.py`).
- `tests/critical/` holds `test_critical_classification.py` and
  `test_critical_extraction.py` that exercise end-to-end classification and
  extraction against real documents (`tests/files/invoice.pdf`).
- `tests/models/` defines the Pydantic contract fixtures (`invoice.py`,
  `gdp_contract.py`, `handbook_contract.py`, `page_contract.py`, etc.).
- `tests/test_images/`, `tests/files/`, and `tests/test_data/` contain sample
  documents used as extraction inputs.

## Representative tests

- Loader tests extend a shared `BaseDocumentLoaderTest`
  (tests/test_document_loader_base.py) and add provider-specific assertions
  (e.g. Tesseract OCR of `test_images/invoice.png`).
- `test_extractor.py` covers vision extraction, the FORBIDDEN path with token
  limits, pagination and concatenation handlers, backend-specific extraction,
  spreadsheet data extraction, multiple-source merging, and thinking mode on
  Gemini Flash / GPT-4o Mini. It uses helpers from
  `extract_thinker/global_models.py` to select models.
- `test_process.py` and `test_classify.py` cover the Process orchestration and
  classification strategies.
- `tests/critical/test_critical_classification.py` classifies an invoice via
  `Process` with `groq/llama-3.3-70b-versatile` and asserts the result is
  `"Invoice"`.

## External dependencies

Many tests require real credentials or binaries not available in a clean
environment:

- LLM-backed tests need provider API keys loaded through `dotenv`
  (`load_dotenv()`) and environment configuration, observed throughout the
  suite.
- OCR tests require the Tesseract binary, read from `TESSERACT_PATH`.
- Provider loader tests (AWS Textract, Azure Form, Google Document AI, Mistral
  OCR) need their respective cloud credentials.
- `test_tesseract_specific_content` asserts OCR output directly against the
  sample invoice image.

These external dependencies mean a subset of the suite can only run in an
environment with the necessary keys and binaries configured.
