---
type: operations
title: "Testing and CI"
description: "How the pytest suite is organized (unit, per-loader, live-model, critical CI subset), what environment it needs (API keys, Tesseract, Ollama), what the GitHub workflows actually run, and the stale linting/tooling configs to know before relying on them."
tags: [testing, pytest, ci, github-actions, poetry, linting]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T11:01:32.247Z
sources:
  - id: openwiki-source-4fec08609dcfd67d2bcca1a7
    resource: repo://.github/workflows/documentation.yml
  - id: openwiki-source-5a4d75487a09a5a3ad194fe2
    resource: repo://.github/workflows/manual-publish.yml
  - id: openwiki-source-1d4891e6fe7afb64116aee2d
    resource: repo://.github/workflows/workflow.yml
  - id: openwiki-source-4d1645cb6317345817452838
    resource: repo://.pre-commit-config.yaml
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-0bb2d607395087d4b60226f1
    resource: repo://tests/create_test_spreadsheet.py
  - id: openwiki-source-03c94b87dc3801c3c293e463
    resource: repo://tests/critical/test_critical_classification.py
  - id: openwiki-source-dbdf465048aa8501845821eb
    resource: repo://tests/critical/test_critical_extraction.py
  - id: openwiki-source-aea937801f02b6f87071428c
    resource: repo://tests/test_batch_extractor.py
  - id: openwiki-source-3ae1799582a4bef238a4bc15
    resource: repo://tests/test_data/labels/permanent_labels.json
  - id: openwiki-source-4cb63d592f78f2cce122c033
    resource: repo://tests/test_document_loader_base.py
  - id: openwiki-source-4a128e0c974ec840efe2df56
    resource: repo://tests/test_document_loader_pypdf.py
  - id: openwiki-source-8dc53e44124fed5d3b4d2a05
    resource: repo://tests/test_evaluator.py
  - id: openwiki-source-7e448649cb7992e07c84564f
    resource: repo://tests/test_markdown_converter.py
  - id: openwiki-source-7a642dbc4c0ac0458f24b380
    resource: repo://tests/test_ollama.py
generated: { by: "opencode", at: "2026-09-11T11:01:32.247Z" }
---

# Testing and CI

## Suite layout

`tests/` contains one module per subsystem plus fixture directories:

- **Fixture data**: `tests/files/` (PDFs, docx, xlsx, txt — e.g. `invoice.pdf`, `Regional_GDP_per_capita_2018_2.pdf`, `family_budget.xlsx`), `tests/test_images/` (invoice.png, driver_license.png...), `tests/test_data/{documents,labels}/` (eval dataset fixture), and `tests/models/` — Pydantic *contract* classes shared by tests (Invoice, contracts, Chart/Page models). `tests/create_test_spreadsheet.py` regenerates `tests/files/test_spreadsheet.xlsx`.
- **Loader tests**: `test_document_loader_*.py` (13 modules) subclass the `BaseDocumentLoaderTest` mixin from `test_document_loader_base.py` (basic load, vision mode, cache timing) and add per-format assertions.
- **Pipeline tests**: `test_extractor.py`, `test_classify.py`, `test_process.py`, `test_batch_extractor.py`, `test_markdown_converter.py`, `test_evaluator.py`, `test_llm_backends.py`, `test_ollama.py`.
- **CI-critical subset**: `tests/critical/test_critical_extraction.py` (PyPDF + invoice → asserts line description/quantity/amount from `tests/files/invoice.pdf`) and `test_critical_classification.py` (`Process` consensus classification of an invoice vs driver license) — both run against **`groq/llama-3.3-70b-versatile`** (`tests/critical/*.py:41-55,19-30`).

## What runs where

`.github/workflows/workflow.yml` (push/PR to `main`, Python 3.10): installs Poetry deps, then runs **only** `poetry run pytest tests/critical/ -v` with `GROQ_API_KEY` from secrets, plus `poetry build`. A second job matrix-checks Python 3.9–3.13 by asserting the version bound and doing `poetry install` — it does **not** execute tests (`workflow.yml:5-59`). So the bulk of the suite only runs locally/with keys.

Other workflows: `documentation.yml` deploys the MkDocs Material site via `mkdocs gh-deploy --force` on pushes to main (`documentation.yml:1-27`); `manual-publish.yml` is a `workflow_dispatch` job that optionally bumps `poetry version`, builds, and publishes to PyPI with a token secret (`manual-publish.yml:1-37`). (`openwiki-update.yml` is an OpenWiki-managed integration file, excluded from evidence.)

## Running tests locally

```bash
pip install poetry && poetry install
poetry run pytest tests/critical/          # needs GROQ_API_KEY
TESSERACT_PATH=/usr/bin/tesseract poetry run pytest tests/test_document_loader_tesseract.py
```

Requirements by area (established from the test code, not assumed):

- **Live LLM providers** for most pipeline tests: `gpt-4o-mini`/`gpt-4o` (batch, Azure-style tests), `global_models.get_lite_model()/get_big_model()` (Gemini/GPT names), OpenAI keys for embeddings used by concatenation comparisons (`tests/test_extractor.py:253-259`) — so treat `tests/` beyond `critical/` as integration tests needing provider keys and network.
- **Tesseract binary** (`TESSERACT_PATH`) for Tesseract loader and several extractor/batch tests (`tests/test_batch_extractor.py:14-16`).
- **Cloud credentials** for the Azure/AWS/Google/Mistral loader tests.
- **Local Ollama** at `API_BASE=http://localhost:11434` for `test_ollama.py`.
- **Env toggles**: `SKIP_END_TO_END=true` skips the live eval CLI test (`tests/test_evaluator.py:808-812`); tests calling `load_dotenv()` pick up `.env` files (`tests/test_batch_extractor.py:3`).
- `@pytest.mark.slow` marks live-provider Markdown tests (`tests/test_markdown_converter.py:112-264`); there is no marker registration or default-deselect config in the repo, so `-m "not slow"` works but the marker currently carries no enforcement.

## Known-bad tooling config (verify before trusting)

- `.pre-commit-config.yaml` configures ruff lint+format for `files: ^(extractthinker|tests|examples)/` and a mypy hook over `extractthinker/...` paths — but the package directory is `extract_thinker/` (underscore). Those patterns therefore skip the library itself, and the referenced `extractthinker/cli/...` files don't exist; the config looks copied from another project. Similarly `.ruff.toml`'s per-file ignores mention `instructor/...` and `examples/task_planner/...` paths not present here (`pre-commit`, `.ruff.toml`). Lint/typing state of the package is consequently **not established by the repository**.
- `tests/test_llm_backends.py` is stale against the current backend enum (see llm-layer caveats).
- Flake8 config is minimal (`ignore = E501`), and `black ^24` + `flake8 ^7` are dev deps; no CI job runs them.

The reliable local validation recipe: run `pytest` on the modules touching your change with the credentials you have, plus `tests/critical/` (Groq key) as the pipeline smoke test — that exact command is what CI enforces.
