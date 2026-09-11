---
type: operations
title: CI, Packaging, and Testing
description: How extract_thinker is built and released (Poetry, PyPI workflow), what CI actually runs (critical tests + version matrix), the mkdocs docs pipeline, test-suite layout, env-var gating, and lint configs.
tags: [ci, packaging, poetry, pytest, mkdocs, environment]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T09:51:57.297Z
sources:
  - id: openwiki-source-4fec08609dcfd67d2bcca1a7
    resource: repo://.github/workflows/documentation.yml
  - id: openwiki-source-5a4d75487a09a5a3ad194fe2
    resource: repo://.github/workflows/manual-publish.yml
  - id: openwiki-source-1d4891e6fe7afb64116aee2d
    resource: repo://.github/workflows/workflow.yml
  - id: openwiki-source-4d1645cb6317345817452838
    resource: repo://.pre-commit-config.yaml
  - id: openwiki-source-7e7568503fb5c5a0b62b4a59
    resource: repo://.ruff.toml
  - id: openwiki-source-519e2ff0dfca4ece03c9007a
    resource: repo://extract_thinker/__init__.py
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-757f2a5291d89612677f740d
    resource: repo://mkdocs.yml
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-517ed2876dce5f163a3e1d38
    resource: repo://requirements-docs.txt
  - id: openwiki-source-373640cd8a0886cee69db282
    resource: repo://requirements.txt
  - id: openwiki-source-03c94b87dc3801c3c293e463
    resource: repo://tests/critical/test_critical_classification.py
  - id: openwiki-source-dbdf465048aa8501845821eb
    resource: repo://tests/critical/test_critical_extraction.py
  - id: openwiki-source-aea937801f02b6f87071428c
    resource: repo://tests/test_batch_extractor.py
  - id: openwiki-source-ab84285606e1ddec667b96cc
    resource: repo://tests/test_document_loader_aws_textract.py
  - id: openwiki-source-759ebcb6448249d8008d376e
    resource: repo://tests/test_document_loader_azure_document_intelligence.py
  - id: openwiki-source-4cb63d592f78f2cce122c033
    resource: repo://tests/test_document_loader_base.py
  - id: openwiki-source-bee6c34ef120d8e09d60d805
    resource: repo://tests/test_document_loader_google_document_ai.py
  - id: openwiki-source-8dc53e44124fed5d3b4d2a05
    resource: repo://tests/test_evaluator.py
generated: { by: "opencode", at: "2026-09-11T09:51:57.297Z" }
---

# CI, Packaging, and Testing

## Build & packaging

The package is Poetry-managed: `pyproject.toml` declares name `extract_thinker`, version 0.1.14, Python `>=3.9,<3.14`, build backend `poetry-core`, and core runtime deps (pydantic, litellm, instructor, pillow, pypdfium2, python-dotenv, cachetools, pyyaml, tiktoken (with `python = ">=3.9,<3.13"` marker), python-magic, playwright, libmagic); dev group adds flake8, black, ipykernel, pytest, numpy (pyproject.toml:1-30). OCR/web/cloud SDKs (pytesseract, pypdf, docling, openpyxl, azure-*, boto3, google-*, …) are intentionally absent — callers install them per loader. `requirements.txt` mirrors a partial subset for pip users (note: `pytesseract` is listed twice, and it omits several core deps); `requirements-docs.txt` holds only the three mkdocs packages used by the docs job. Lockfile `poetry.lock` is committed.

Releases are manual: `manual-publish.yml` is a `workflow_dispatch` that optionally bumps `poetry version <input>`, runs `poetry build`, and publishes the dist via `pypa/gh-action-pypi-publish` with the `PYPI_API_TOKEN` secret (Python 3.9 runner). There is no tag-triggered release automation in the repo.

## Continuous integration (`.github/workflows/workflow.yml`)

Triggers: push/PR to `main`. Two jobs:

1. **build-and-test** (Python 3.10): `pip install poetry && poetry install`, then runs **only** `pytest tests/critical/` after `poetry add pypdf` (the critical tests need a loader not in core deps), with `GROQ_API_KEY` from repository secrets, then `poetry build`.
2. **test-python-versions** (matrix 3.9-3.13, `fail-fast: false`): a shell check that the interpreter satisfies the range plus `poetry install` — it does not run tests.

Consequences: behavior regressions are caught only by the two critical files (`test_critical_extraction.py`, `test_critical_classification.py`), which make real Groq LLM calls (`groq/llama-3.3-70b-versatile`) against fixtures in `tests/files/`; everything else is developer-runnable only.

## Docs pipeline

`documentation.yml` runs on push to `main`: installs `mkdocs-material` and executes `mkdocs gh-deploy --force`, publishing the `mkdocs.yml` site (site_name ExtractThinker, extensive nav over `docs/core-concepts/**`, `docs/getting-started/`, `docs/examples/`, repo_url `enoch3712/ExtractThinker`, site_url GitHub Pages, pygments style). `docs/` is user documentation; treat `extract_thinker/` and `tests/` as authoritative.

## Test-suite layout (`tests/`)

- `tests/critical/` — the CI gate (above).
- `tests/test_document_loader_*.py` — one file per loader; `BaseDocumentLoaderTest` (test_document_loader_base.py) provides shared load/vision/cache checks most of them subclass.
- `tests/test_extractor.py`, `test_process.py`, `test_classify.py`, `test_batch_extractor.py`, `test_markdown_converter.py`, `test_evaluator.py`, `test_llm_backends.py`, `test_ollama.py`, `test_document_loader_data.py`, `test_document_loader_word.py`, plus `tests/test_data/` (dataset/labels fixture) and `tests/test_evals/`.
- `tests/models/` — reusable Contract classes (InvoiceContract, driver_license, gdp/handbook/page contracts) shared across suites.
- `tests/files/`, `tests/test_images/`, `tests/test_data/` — fixture documents (PDFs, docx, xlsx, images, txt). `tests/create_test_spreadsheet.py` regenerates `test_spreadsheet.xlsx`.
- `tests/notes.txt` is a scratch file, not fixtures.

## Environment gating

Tests call `load_dotenv()` and read credentials at runtime rather than using skip markers, so un-gated tests **fail** (not skip) without the env vars. Observed variables:

| Variable | Used by |
|---|---|
| `TESSERACT_PATH` | Tesseract loader tests, batch/extractor/eval tests |
| `GROQ_API_KEY` | CI critical tests (workflow secret) |
| `OPENAI_API_KEY` | batch jobs (`batch_job.py:19`), OpenAI-backed tests |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION_NAME` | Textract tests |
| `AZURE_SUBSCRIPTION_KEY` / `AZURE_ENDPOINT` | Azure DI tests |
| `DOCUMENTAI_PROJECT_ID` / `_LOCATION` / `_PROCESSOR_ID` / `_GOOGLE_CREDENTIALS` | Google DocAI tests |
| `MISTRAL_API_KEY` | Mistral OCR tests / markdown converter helper |
| `SKIP_END_TO_END` | only opt-out flag found in the suite; skips `test_end_to_end_cli_execution` via `pytest.mark.skipif` (test_evaluator.py:809) |

Provider model strings (gemini/gpt) come from `extract_thinker/global_models.py`, so those tests additionally need `GEMINI_API_KEY`/`OPENAI_API_KEY` in litellm's expected naming.

## Lint & format tooling

- `.flake8`: only `ignore = E501` (line length is handled elsewhere); flake8 is a dev dep.
- `.ruff.toml`: line-length 88 (Black-compatible), `target-version = "py39"`, selects B/F401/E722/ARG/ARG005, ignores B006/B018, unfixable T201/T203.
- `.pre-commit-config.yaml`: ruff-pre-commit v0.1.7 (`ruff --fix` + `ruff-format`) scoped by `files: ^(extractthinker|tests|examples)/` and a local mypy hook that curls a third-party script with `CUSTOM_PACKAGES="extractthinker/..."`. **Caution: both reference `extractthinker/` paths that don't exist** (the package directory is `extract_thinker/`), and the per-file ignores reference files from a different project (instructor-style `tests/test_distil.py` etc.) — the config appears copied and the main package is not matched by the ruff hook. Black is in dev deps but no black hook is configured.
- No mypy/pytest configuration files exist beyond dev deps; pytest is run as `poetry run pytest <path>`.

## Local verification recipe

```bash
poetry install
poetry add pypdf                        # loader used by critical tests
export GROQ_API_KEY=...                 # real-model calls
poetry run pytest tests/critical/ -v
poetry build
```

Add per-subsystem env vars from the table above before running the corresponding suites. (Matches the CI steps; no other gate is defined in workflows.)

## Related pages

- `/openwiki/quickstart.md` — minimal local setup
- `guides/change-playbooks.md` — verification checklist per change type
- `architecture/overview.md`
