---
type: operations-tooling
title: Testing and CI
description: Test suite organization, critical credential-gated tests, pytest markers/skips, and the GitHub Actions build/test/publish workflows.
tags: [testing, ci, github-actions, pytest, pypi]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:40:03.572Z
sources:
  - id: openwiki-source-5a4d75487a09a5a3ad194fe2
    resource: repo://.github/workflows/manual-publish.yml
  - id: openwiki-source-1d4891e6fe7afb64116aee2d
    resource: repo://.github/workflows/workflow.yml
  - id: openwiki-source-4d1645cb6317345817452838
    resource: repo://.pre-commit-config.yaml
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-36d2c775c5660dafaee342f9
    resource: repo://extract_thinker/document_loader/document_loader_tesseract.py
  - id: openwiki-source-757f2a5291d89612677f740d
    resource: repo://mkdocs.yml
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-373640cd8a0886cee69db282
    resource: repo://requirements.txt
  - id: openwiki-source-03c94b87dc3801c3c293e463
    resource: repo://tests/critical/test_critical_classification.py
  - id: openwiki-source-dbdf465048aa8501845821eb
    resource: repo://tests/critical/test_critical_extraction.py
  - id: openwiki-source-4cb63d592f78f2cce122c033
    resource: repo://tests/test_document_loader_base.py
  - id: openwiki-source-4a128e0c974ec840efe2df56
    resource: repo://tests/test_document_loader_pypdf.py
  - id: openwiki-source-ee28bd363b1cf645a390084a
    resource: repo://tests/test_extractor.py
generated: { by: "opencode", at: "2026-09-11T09:40:03.572Z" }
---

# Testing and CI

## Test suite organization

Tests live under `tests/` with per-concern modules:

- **Loader tests** — one per concrete loader (`test_document_loader_*.py`), most subclassing `BaseDocumentLoaderTest` from `tests/test_document_loader_base.py` for uniform contract tests (basic load, vision mode, cache speed).
- **Core tests** — `test_extractor.py` (extract/classify/strategies/vision, uses `pytest.skip` for pydantic-ai absence and missing fixtures, extract_thinker/test_extractor.py:380-413 equivalent at tests/test_extractor.py:380, 413), `test_process.py`, `test_classify.py`, `test_batch_extractor.py`, `test_llm_backends.py`, `test_ollama.py`.
- **Critical subset** — `tests/critical/test_critical_extraction.py` and `tests/critical/test_critical_classification.py` are what CI actually runs, requiring a live `GROQ_API_KEY` (see workflow below); note the critical tests exercise network model calls, making the “critical” gate integration-style rather than hermetic unit tests.
- **Evaluator tests** — `test_evaluator.py` plus fixtures under `tests/test_evals/` (e.g. invoice.pdf).
- **Auxiliaries** — `tests/files/` (fixture PDFs/images like `CV_Candidate.pdf`), `tests/test_data/`, `tests/test_images/`, `tests/models/`, and `tests/notes.txt` (developer scratch notes about fixed paths, not test logic).
- `tests/create_test_spreadsheet.py` is a helper script generating spreadsheet fixtures.

Dependencies outside pinned core (pypdf, pytesseract, cloud SDKs, pydantic-ai) are required by specific tests; CI explicitly `poetry add`s pypdf before the critical run (workflow.yml). Without the engine or network locally, the broader suite typically fails at construction-time dependency checks — plan for per-test environment requirements rather than a one-shot full-suite run.

## Credential and environment gating

- CI: only `GROQ_API_KEY` is injected into the critical tests.
- Locally relevant env vars referenced by the code: `OPENAI_API_KEY` (batch defaults), `TESSERACT_PATH` container override, `API_BASE` for local Ollama examples. Test files call live services for cloud loaders; inspect each test module before running it against a paid provider.

## GitHub Actions workflows

- **workflow.yml** ("Python package workflow", .github/workflows/workflow.yml): on push/PR to `main`. Job `build-and-test` on ubuntu + Python 3.10 — poetry install, run `pytest tests/critical/ -v` with `GROQ_API_KEY` secret, then `poetry build`. Job `test-python-versions` — **despite the name**, this job only poetry-installs and asserts the Python version is in [3.9, 4.0); it runs the version check script for 3.9–3.13 in the matrix, therefore 3.13 should behave the same as the others (the version-assertions step is the sole matrix action — actual tests do not run there).
- **manual-publish.yml** (Manual PyPI Publish): `workflow_dispatch` with optional `version` input that runs `poetry version ${{ inputs.version }}` when non-empty, `poetry build`, and publishes to PyPI using `pypa/gh-action-pypi-publish@v1.4.2` with `PYPI_API_TOKEN` secret — publishing is manual, not tag-driven.
- **documentation.yml** builds the MkDocs site (mkdocs.yml + docs/ + requirements-docs.txt).
- **openwiki-update.yml** is the generated OpenWiki scheduled refresh; treat it as OpenWiki-owned infrastructure (do not hand-edit).

## Packaging reality check

- Project build backend is `poetry-core` (pyproject.toml), though a `requirements.txt` (85 bytes) exists for a lighter install path — read it before trusting parity with the poetry lock.
- README installation instructions (`pip install extract_thinker`) refer to the published PyPI distribution; the source repo itself publishes only via the manual workflow above. Deployment of services is out of scope: this is a library, with no server process defined in the repository.

## Lint/tooling

- `.ruff.toml` and `.flake8` configure style checks; `.pre-commit-config.yaml` wires hooks — run pre-commit on changed files before CI push to `main`.
