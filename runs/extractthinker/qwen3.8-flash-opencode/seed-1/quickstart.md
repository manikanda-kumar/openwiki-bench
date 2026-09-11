---
type: quickstart
title: "Quickstart"
description: "Install ExtractThinker, run a first LLM extraction against a PDF, verify offline with loader tests, and route into the architecture and change-guide pages."
tags: [quickstart, install, extraction, testing]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T10:24:25.212Z
sources:
  - id: openwiki-source-1d4891e6fe7afb64116aee2d
    resource: repo://.github/workflows/workflow.yml
  - id: openwiki-source-0f73334137b59c6f274e2951
    resource: repo://examples/extractor_basic.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-373640cd8a0886cee69db282
    resource: repo://requirements.txt
  - id: openwiki-source-dbdf465048aa8501845821eb
    resource: repo://tests/critical/test_critical_extraction.py
  - id: openwiki-source-a6f692d25c6d9ff8f733af5d
    resource: repo://tests/test_document_loader_txt.py
generated: { by: "opencode", at: "2026-09-11T10:24:25.212Z" }
---

# Quickstart

ExtractThinker extracts structured data from documents by pairing a document loader with an LLM and validating the answer against a Pydantic contract. This page gets a first run working and points at the deeper docs.

## Install

PyPI package: `pip install extract_thinker` (`README.md:35-38`). From source, the project is Poetry-managed (`poetry install`; build backend `poetry.core.masonry.api`) and requires Python `>=3.9,<3.14` (`pyproject.toml:8-9`).

Two dependency lists coexist deliberately:

- Core runtime (pyproject): `pydantic`, `litellm`, `instructor`, `pillow`, `pypdfium2`, `python-dotenv`, `cachetools`, `pyyaml`, `python-magic`, `playwright` (`pyproject.toml:10-21`; `tiktoken` is pinned to `>=3.9,<3.13`).
- Loader extras listed only in `requirements.txt` — `pytesseract`, `python-docx`, `xlrd` — plus `pypdf`, `openpyxl`, `azure-*`, `boto3`, `easyocr`, `docling`, etc., which loaders import lazily and which surface `ImportError` with a pip hint at use time.

## Provider credentials

Model strings are passed through to litellm, so the environment must satisfy the chosen provider (`OPENAI_API_KEY` for OpenAI models, `GROQ_API_KEY` for `groq/...`, etc.). The repo ships no `.env`; tests and examples call `load_dotenv()` (`tests/critical/test_critical_extraction.py:2,36`). Local models work via an endpoint variable, e.g. `os.environ['API_BASE'] = "http://localhost:11434"` with `LLM('ollama/phi3')` (`README.md:249-252`). The batch path is the exception: it talks to OpenAI directly and needs `OPENAI_API_KEY` regardless of provider prefixes (`extract_thinker/batch_job.py:19`).

## First extraction

```python
import os
from dotenv import load_dotenv
from extract_thinker import Extractor, DocumentLoaderPyPdf, Contract

load_dotenv()

class InvoiceContract(Contract):
    invoice_number: str
    invoice_date: str

extractor = Extractor()
extractor.load_document_loader(DocumentLoaderPyPdf())   # pip install pypdf first
extractor.load_llm("gpt-4o-mini")                        # or any litellm model string

result = extractor.extract("tests/files/invoice.pdf", InvoiceContract)
```

(reduced from `README.md:46-70`; the repo-local `tests/files/invoice.pdf` doubles as the critical-test fixture). The loader reads the PDF, `Extractor` joins page text into one `##Content` prompt, instructor validates the JSON reply against your contract, and any failure arrives as `ExtractThinkerError`. `examples/extractor_basic.py` shows the same flow OCR'd through Tesseract instead (`extractor_basic.py:16-24`).

## Verify your setup

- **Offline sanity check (no API keys):** `pytest tests/test_document_loader_txt.py tests/test_document_loader_pypdf.py` — these loader suites assert page content against local fixtures and never call a model.
- **End-to-end check (needs keys):** `pytest tests/critical/ -v` with `GROQ_API_KEY` — this is exactly what CI runs (`workflow.yml:26-29`, which additionally installs `pypdf` first). Expect live-model variance in these assertions.

## Where to go next

| Task | Read |
|---|---|
| Understand the pipeline end to end | [Architecture Overview](/openwiki/architecture.md) |
| Pick/build a loader | [Document Loaders](/openwiki/architecture/document-loaders.md) · [Add a Document Loader](/openwiki/guides/adding-a-document-loader.md) |
| Long/truncated outputs | [Completion Strategies](/openwiki/architecture/completion-strategies.md) |
| Model choice, thinking budgets | [LLM Integration](/openwiki/architecture/llm-integration.md) · [Tuning Extraction Quality](/openwiki/guides/tuning-extraction-quality.md) |
| Multi-document scans (classify/split) | [Classification & Splitting](/openwiki/architecture/classification-and-splitting.md) |
| Bulk offline jobs | [Batch Processing](/openwiki/architecture/batch-processing.md) |
| Regression measurement | [Evaluation Framework](/openwiki/architecture/evaluation.md) |
| Something broke | [Debugging Extraction Failures](/openwiki/guides/debugging-extraction-failures.md) |
| Contribute/CI/release | [Testing, CI & Release](/openwiki/operations/testing-ci-release.md) |
