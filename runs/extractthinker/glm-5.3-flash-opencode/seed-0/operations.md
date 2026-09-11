---
type: operations
title: Packaging, CI, and Operations
description: How ExtractThinker is packaged (Poetry), validated in CI (critical tests, multi-Python install checks), published to PyPI, linted/formatted (ruff, flake8, pre-commit), and documented (mkdocs-material site).
tags: [ci, packaging, poetry, pypi, mkdocs, linting]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T08:46:09.069Z
sources:
  - id: openwiki-source-36e51f1a116ba26adcbe79ec
    resource: repo://.flake8
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
  - id: openwiki-source-757f2a5291d89612677f740d
    resource: repo://mkdocs.yml
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-517ed2876dce5f163a3e1d38
    resource: repo://requirements-docs.txt
  - id: openwiki-source-373640cd8a0886cee69db282
    resource: repo://requirements.txt
generated: { by: "opencode", at: "2026-09-11T08:46:09.069Z" }
---

# Packaging, CI, and Operations

## Packaging

The project uses Poetry (`pyproject.toml`). Package metadata: name `extract_thinker`, version `0.1.14`, README long-description, built with `poetry-core` (`pyproject.toml:1-7`, `pyproject.toml:30-32`).

- **Python support**: `>=3.9,<3.14` (`pyproject.toml:9`).
- **Runtime dependencies**: `pydantic >=2.11.5`, `litellm >=1.71.1`, `pillow >=11.2.1,<12.0`, `pypdfium2 >=4.30.1`, `instructor >=1.8.3`, `python-dotenv`, `cachetools`, `pyyaml`, `tiktoken` (marked for Python `>=3.9,<3.13` only), `python-magic`, `playwright >=1.52.0`, and `libmagic` (`pyproject.toml:8-21`).
- **Dev group**: flake8, black, ipykernel, pytest, numpy (`pyproject.toml:23-28`).
- A loose `requirements.txt` also exists (unpinned core packages, with `pytesseract` duplicated); it is not what CI uses — CI installs via Poetry.

Note that `libmagic` (the system library binding) is listed as a Poetry dependency while `python-magic` provides the Python side; environments without the native magic library will fail at import of `document_loader.py`.

## CI workflows (`.github/workflows/`)

### `workflow.yml` — build and test (push/PR to `main`)

1. **build-and-test**: installs Poetry, runs `poetry add pypdf && poetry run pytest tests/critical/ -v` with `GROQ_API_KEY` from secrets, then `poetry build` (` .github/workflows/workflow.yml:12-32`). Note the CI *modifies* `poetry.lock`/`pyproject.toml` in the runner by adding `pypdf` — `pypdf` is a lazy import inside the PyPdf loader, not a declared dependency.
2. **test-python-versions**: a matrix over Python 3.9–3.13 that verifies the interpreter satisfies `>=3.9,<4.0` and runs `poetry install` as an installation smoke test (` .github/workflows/workflow.yml:34-60`).

### `documentation.yml` — docs deploy (push to `main`)

Installs `mkdocs-material` and runs `mkdocs gh-deploy --force`, publishing the docs site to GitHub Pages with a weekly-keyed cache ( `.github/workflows/documentation.yml:1-25`).

### `manual-publish.yml` — PyPI release (workflow_dispatch)

Optionally bumps the version via `poetry version <input>`, runs `poetry build`, and publishes with `pypa/gh-action-pypi-publish` using the `PYPI_API_TOKEN` secret ( `.github/workflows/manual-publish.yml:1-27`). Releases are manual; there is no tag-triggered publish.

## Linting and formatting

- **Ruff** (`.ruff.toml`): line length 88 (Black-compatible), target `py39`, selected rule groups: bugbear (`B`), unused imports (`F401`), bare excepts (`E722`), unused arguments (`ARG`); mutable-default rules `B006`/`B018` are ignored and auto-fix for print statements (`T201`/`T203`) is disabled.
- **flake8** (`.flake8`): ignores `E501` (line length) only.
- **pre-commit** (`.pre-commit-config.yaml`): runs `ruff` (with `--fix`) and `ruff-format` on `extractthinker|tests|examples` paths, plus a local `mypy` hook that pipes a remote script from an external repository (pinned by commit hash) — note this hook references an `extractthinker/` package layout and CLI files that do not exist in this repository's `extract_thinker/` layout, so the mypy hook is likely vestigial/broken here.

## Documentation site

`mkdocs.yml` configures a Material-themed site built from `docs/` with a hand-maintained nav: Getting Started, Concepts & Components (Document Loaders with one page per loader, LLM Integration, Classification, Completion Strategies, Contracts, Extractors, Process, Splitters, Evals, Markdown Conversion), and Examples (cloud stacks, local processing). Some nav entries are placeholders (`'#'`) for loaders not yet implemented (Adobe PDF Services, ABBYY, PaddleOCR, etc.) (`mkdocs.yml:1-60`). Docs dependencies live in `requirements-docs.txt` (`mkdocs`, `mkdocs-material`, `mkdocstrings[python]`); assets are under `docs/assets/`.

## Operational notes

- The library has no server, daemon, or deployment artifacts; "operations" here means CI, releases, and docs.
- CI secrets in use: `GROQ_API_KEY` (tests), `PYPI_API_TOKEN` (publish). Provider keys for other loaders are the host application's concern.
- The scheduled OpenWiki workflow (`openwiki-update.yml`) refreshes this wiki and is an OpenWiki-owned integration file — not project documentation.

## Related pages

- [Testing Guide](testing.md)
- [Quickstart](quickstart.md)
- [Architecture and Component Map](architecture.md)
