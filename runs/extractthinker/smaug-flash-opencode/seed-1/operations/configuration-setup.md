---
type: "Reference"
title: "Configuration, Installation, and CI"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:16:59.187Z
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
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-497442b44f4fdc31ac3d40ab
    resource: repo://extract_thinker/document_loader/document_loader_aws_textract.py
  - id: openwiki-source-8837984946085fdb93153fa8
    resource: repo://extract_thinker/document_loader/document_loader_pypdf.py
  - id: openwiki-source-757f2a5291d89612677f740d
    resource: repo://mkdocs.yml
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
generated: { by: "opencode", at: "2026-09-12T21:16:59.187Z" }
---


# Configuration, Installation, and CI

This project (ExtractThinker) is a Poetry-packaged Python library. This page covers packaging, tooling configuration, documentation generation, and CI/publishing.

## Packaging (pyproject.toml)

`pyproject.toml` (`pyproject.toml:1`):

- Name `extract_thinker`, version `0.1.14`, description "Library to extract data from files and documents agnositicaly using LLMs". Apache authors.
- Build system: `poetry-core` masonry backend.
- **Runtime dependencies**: `pydantic>=2.11.5`, `litellm>=1.71.1`, `pillow`, `pypdfium2>=4.30.1`, `instructor>=1.8.3`, `python-dotenv`, `cachetools`, `pyyaml`, `tiktoken` (py <3.13 only), `python-magic`, `playwright`, `libmagic`.
- **Dev dependencies** (`poetry group dev`): `flake8`, `black`, `ipykernel`, `pytest`, `numpy`.
- **Python constraint**: `>=3.9,<3.14`.

Provider SDKs (boto3, azure-ai-formrecognizer, google-cloud-documentai, docling, openpyxl/xlrd, docx2txt, pytesseract, easyocr, pdfplumber, pypdf, markitdown) are intentionally **not** in the base dependency set — they are lazy-imported by their loaders and installed on demand.

## Lint and format tooling

### Ruff

`.ruff.toml`:

- `exclude` lists standard ignored dirs.
- `line-length = 88` (same as Black), `output-format = "grouped"`, `target-version = "py39"`.
- `[lint] select` includes bugbear (`B`), unused imports (`F401`), bare except (`E722`), unused arguments (`ARG`), and redefined variables (`ARG005`); `ignore` excludes `B006`/`B018`; `unfixable` disables auto-fix of `T201` (print) and `T203`.
- `ignore-init-module-imports = true`; per-file ignores are scoped to instructor/tests/examples.

### Flake8

`.flake8` sets `ignore = E501` (line length handled by Ruff).

### Pre-commit

`.pre-commit-config.yaml`:

- Ruff hook `rev: v0.1.7` (ruff lint with `--fix`, restricted to `^(extractthinker|tests|examples)/`, and ruff-format).
- A local `ci_type_mypy` hook that runs a mypy type check script fetched from the `gao-hongnan/omniverse` repo against a fixed set of package files.

## Documentation (MkDocs)

`mkdocs.yml` configures the `material` theme with navigation sections, search highlight, TOC follow, code copy, and a Roboto font. `nav` organizes the docs into Getting Started, Concepts & Components (document loaders, LLM integration, markdown conversion, classification, contracts, process, extractors, splitters, completions, evals), and Examples. `docs_dir: docs`, `site_url: https://enoch3712.github.io/ExtractThinker/`, and several `pymdownx` markdown extensions are enabledaren't (highlight, superfences, inlinehilite, snippets, tabbed, admonition, details, toc). `extra_css` loads `stylesheets/extra.css`.

## GitHub Actions workflows

### workflow.yml (Python package workflow)

`.github/workflows/workflow.yml`:

- Triggers on push/PR to `main`.
- **build-and-test** job (`ubuntu-latest`, Python 3.10): checkout → install poetry + deps → `poetry add pypdf && poetry run pytest tests/critical/ -v` (critical tests with a `GROQ_API_KEY` secret) → `poetry build`.
- **test-python-versions** job: matrix of Python 3.9 – 3.13, verifies the version meets `>=3.9, <4.0`, installs via poetry.

### documentation.yml

`.github/workflows/documentation.yml`:

- Triggers on push to `main`.
- Installs `mkdocs-material`, then runs `mkdocs gh-deploy --force` to publish the site to GitHub Pages. Uses a weekly cache keyed on a date-based `cache_id`.

### manual-publish.yml

`.github/workflows/manual-publish.yml`:

- `workflow_dispatch` only, with an optional `version` input.
- Installs poetry, optionally `poetry version <version>`, `poetry build`, and publishes to PyPI via `pypa/gh-action-pypi-publish` using a `PYPI_API_TOKEN` secret.

### openwiki-update.yml

An OpenWiki-generated workflow exists at `.github/workflows/openwiki-update.yml` (excluded from subject evidence per `.openwikiignore`).

## Environment/secrets

- Runtime LLM access relies on provider environment variables (e.g. OpenAI/Anthropic/Gemini keys read via `litellm` / `python-dotenv`; tests call `load_dotenv()`).
- CI uses `GROQ_API_KEY` (critical tests) and `PYPI_API_TOKEN` (manual publish) secrets.
- Batch processing requires `OPENAI_API_KEY` (default in `BatchJob`).

## Development commands

- Run tests: `pytest` (in the poetry venv).
- Lint: `ruff` / `ruff --fix`, plus the pre-commit hooks.
- Build: `poetry build`.
- Docs local: `mkdocs serve`.
