---
type: testing-guide
title: Testing Guide
description: How the ExtractThinker test suite is organized (critical, per-loader, component, evaluator tests), which tests need live API keys versus offline fixtures, and how to run them locally and in CI.
tags: [testing, pytest, ci, api-keys, fixtures]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T08:46:09.069Z
sources:
  - id: openwiki-source-1d4891e6fe7afb64116aee2d
    resource: repo://.github/workflows/workflow.yml
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-03c94b87dc3801c3c293e463
    resource: repo://tests/critical/test_critical_classification.py
  - id: openwiki-source-dbdf465048aa8501845821eb
    resource: repo://tests/critical/test_critical_extraction.py
  - id: openwiki-source-40175a0c3b308e331b804ec9
    resource: repo://tests/notes.txt
  - id: openwiki-source-aea937801f02b6f87071428c
    resource: repo://tests/test_batch_extractor.py
  - id: openwiki-source-11ca4d71d0bcafa6689655ef
    resource: repo://tests/test_classify.py
  - id: openwiki-source-4cb63d592f78f2cce122c033
    resource: repo://tests/test_document_loader_base.py
  - id: openwiki-source-64ad4ba13a1462b220f2db30
    resource: repo://tests/test_document_loader_mistral_ocr.py
  - id: openwiki-source-4a128e0c974ec840efe2df56
    resource: repo://tests/test_document_loader_pypdf.py
  - id: openwiki-source-b7dad2513cc0b58e69ad3b4f
    resource: repo://tests/test_document_loader_spreadsheet.py
  - id: openwiki-source-8dc53e44124fed5d3b4d2a05
    resource: repo://tests/test_evaluator.py
  - id: openwiki-source-ee28bd363b1cf645a390084a
    resource: repo://tests/test_extractor.py
  - id: openwiki-source-aa326a6e338619f95df6a4ce
    resource: repo://tests/test_llm_backends.py
  - id: openwiki-source-7a642dbc4c0ac0458f24b380
    resource: repo://tests/test_ollama.py
generated: { by: "opencode", at: "2026-09-11T08:46:09.069Z" }
---

# Testing Guide

The test suite lives in `tests/` and is pytest-based (`pytest ^8.2.0` in the dev dependencies, `pyproject.toml:23-28`). Most tests are **integration tests against live LLM providers**; only a minority run fully offline.

## Suite organization

| Area | Files | Nature |
|---|---|---|
| Critical | `tests/critical/test_critical_extraction.py`, `test_critical_classification.py` | End-to-end extraction/classification via PyPdf + Groq (`groq/llama-3.3-70b-versatile`) — these are what CI runs |
| Loaders | `tests/test_document_loader_*.py` (one per loader) | Loader behavior against fixture files in `tests/files/` (12 fixtures: PDFs, DOCX, XLSX, TXT) |
| Base loader contract | `tests/test_document_loader_base.py` | Shared `BaseDocumentLoaderTest` mixin: basic load, vision mode, cache speedup |
| Components | `tests/test_extractor.py`, `test_process.py`, `test_classify.py`, `test_batch_extractor.py`, `test_llm_backends.py`, `test_markdown_converter.py`, `test_evaluator.py`, `test_ollama.py` | Orchestrators, classification, batch, backend selection, markdown, eval |
| Test models | `tests/models/` | Reusable contracts (`InvoiceContract`, `DriverLicense`, `GDPContract`, …) |
| Eval fixtures | `tests/test_evals/` | Dataset inputs |

## API-key and environment dependencies

- **CI critical tests** run with `GROQ_API_KEY` from repository secrets: `poetry add pypdf && poetry run pytest tests/critical/ -v` (`.github/workflows/workflow.yml:12-32`). The critical tests hardcode `groq/llama-3.3-70b-versatile` and load `.env` via `python-dotenv` (`tests/critical/test_critical_extraction.py:1-52`).
- **Local runs** need keys in the environment (typically a `.env` file loaded by `load_dotenv()`): provider keys for whichever LLM/loader a test uses — `MISTRAL_API_KEY`, AWS/Azure/Google credentials for cloud loaders, `OPENAI_API_KEY` for batch tests, and `TESSERACT_PATH` pointing at a local Tesseract binary for OCR-based tests (`tests/test_classify.py:21`, `tests/test_extractor.py:145`).
- **Graceful skips**: Mistral loader tests skip when `MISTRAL_API_KEY` is unset or fixture files are missing/too large (50MB API limit) (`tests/test_document_loader_mistral_ocr.py:23-157`); pydantic-ai tests skip when the package isn't installed (`tests/test_extractor.py:380`); spreadsheet conversion tests skip without matplotlib/pandas/fpdf (`tests/test_document_loader_spreadsheet.py:264-284`).
- **End-to-end eval opt-out**: `tests/test_evaluator.py` gates its end-to-end test behind `SKIP_END_TO_END=true` (`tests/test_evaluator.py:808-820`).
- **Ollama tests** (`tests/test_ollama.py`) require a local Ollama server at `http://localhost:11434` (`tests/test_ollama.py:71`).

## Fully offline tests

`tests/test_llm_backends.py` constructs `LLM` objects without making network calls (backend selection, router rejection, invalid backend) — it only needs the `pydantic_ai` import check, which it skips gracefully (`tests/test_llm_backends.py:4-33`). Loader tests that only exercise parsing/caching of local fixture files (e.g. PyPdf content assertions) also run without LLM access (`tests/test_document_loader_pypdf.py:32-45`).

## Running tests locally

```bash
poetry install
poetry run pytest tests/critical/ -v          # what CI runs
poetry run pytest tests/test_extractor.py -v  # a single module
```

Set the required environment variables (or a `.env`) for whichever module you run. Expect network calls and provider latency/billing for anything beyond the offline set. `tests/notes.txt` records contributor notes about path setup (`sys.path` insertion) and test-image locations.

## CI behavior recap

`workflow.yml` runs the critical suite on every push/PR to `main` (adding `pypdf` on the fly) plus a Python 3.9–3.13 `poetry install` matrix; there is no full-suite CI run — the broader suite is exercised manually by contributors (`.github/workflows/workflow.yml:12-59`). See [Packaging, CI, and Operations](operations.md) for the workflow details.

## Guidance for new tests

- Reuse contracts from `tests/models/` rather than redefining schemas.
- For loader tests, subclass `BaseDocumentLoaderTest` and add loader-specific cases (see the [loader guide](guides/adding-a-document-loader.md)).
- Skip explicitly (with a reason) when optional credentials or heavy dependencies are absent, following the Mistral/spreadsheet patterns.
- Keep fixture documents small; `tests/files/` is the convention for shared fixtures.

## Related pages

- [Quickstart](quickstart.md)
- [Evaluation Framework](eval-framework.md)
- [Packaging, CI, and Operations](operations.md)
