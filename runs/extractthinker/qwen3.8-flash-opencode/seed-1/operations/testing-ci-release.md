---
type: operations
title: "Testing, CI & Release"
description: "How the test suite is tiered (offline loader tests vs live-API behavior tests), what CI actually runs and skips, the manual PyPI publish and mkdocs deploy paths, and the lint/format configs with their stale bits."
tags: [testing, ci, poetry, release, linting]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T10:24:25.212Z
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
  - id: openwiki-source-dbdf465048aa8501845821eb
    resource: repo://tests/critical/test_critical_extraction.py
  - id: openwiki-source-4cb63d592f78f2cce122c033
    resource: repo://tests/test_document_loader_base.py
  - id: openwiki-source-4a128e0c974ec840efe2df56
    resource: repo://tests/test_document_loader_pypdf.py
  - id: openwiki-source-a6f692d25c6d9ff8f733af5d
    resource: repo://tests/test_document_loader_txt.py
  - id: openwiki-source-749f08e74a04a46f1629ea04
    resource: repo://tests/test_process.py
generated: { by: "opencode", at: "2026-09-11T10:24:25.212Z" }
---

# Testing, CI & Release

## Test tiers

`tests/` mixes two very different kinds of suites, and CI runs only a slice:

- **Offline loader suites** — `tests/test_document_loader_{txt,pypdf,pdfplumber,spreadsheet,doc2txt,data,...}.py` subclass `BaseDocumentLoaderTest` (`tests/test_document_loader_base.py:7-52`) and assert page shapes against fixtures in `tests/files/` (e.g., `CV_Candidate.pdf`, `ambiguous_credit_note.txt`). They make no model calls; they do require the loader's optional package (`pypdf`, `openpyxl`+`xlrd`, ...) and inherit the base's vision test, which asserts a legacy dict result shape (see the loader change guide).
- **Live-API suites** — `tests/test_extractor.py`, `test_classify.py`, `test_process.py`, `test_batch_extractor.py`, `test_ollama.py`, `test_markdown_converter.py`, `test_evaluator.py`, and `tests/critical/*` build real `Extractor`/`Process` objects pointed at `groq/...`, `gpt-4o...`, or `gemini/...` models and assert exact extracted values (e.g. `tests/critical/test_critical_extraction.py` expects invoice line "Consultation services", quantity 3). They need provider keys (`GROQ_API_KEY`, `OPENAI_API_KEY`, cloud credentials, a tesseract binary), typically via `python-dotenv` (`load_dotenv()`).
- **`tests/test_llm_backends.py`** is offline in spirit but stale: it references `llm_engine.LITELLM`, which the current `LLMEngine` enum does not define (`llm.py` backend selection uses `DEFAULT`/`PYDANTIC_AI`).

There is no pytest configuration in `pyproject.toml` and no conftest; several tests bootstrap with `sys.path.insert` (e.g., `tests/test_process.py:1-3`).

## CI (`workflow.yml`)

On pushes and PRs to `main`:

1. **build-and-test** (Python 3.10): `poetry install`, then `poetry add pypdf && poetry run pytest tests/critical/ -v` with `GROQ_API_KEY` from secrets — note `pypdf` is *not* a declared dependency in `pyproject.toml`; CI adds it ad hoc because `DocumentLoaderPyPdf` imports it lazily. The job then runs `poetry build`.
2. **test-python-versions** (matrix 3.9–3.13): only asserts `>=3.9,<4.0` and runs `poetry install`. **No tests execute in the version matrix**, and the workflow's own check (`<4.0`) is wider than the project constraint (`python = ">=3.9,<3.14"`).

The full `tests/` directory never runs in CI — only `tests/critical/`. The two critical files call live Groq models, so CI correctness depends on external services and secrets.

## Release and docs

- **PyPI publishing** is `manual-publish.yml`: `workflow_dispatch` with an optional version input, `poetry version`/`poetry build`, then `pypa/gh-action-pypi-publish` using `secrets.PYPI_API_TOKEN`. It has **no test gate** — it can publish whatever is on the selected ref.
- **Docs** deploy automatically: `documentation.yml` runs `mkdocs gh-deploy` on every push to `main` (the site content is `docs/`, nav in `mkdocs.yml`, build deps in `requirements-docs.txt`).
- Version truth lives in `pyproject.toml` (`version = "0.1.14"`).

## Lint, format, types

- **pre-commit** (`.pre-commit-config.yaml`): ruff v0.1.7. The `ruff --fix` lint hook is scoped with `files: ^(extractthinker|tests|examples)/`, and since the library directory is `extract_thinker` (underscore), that hook only ever touches `tests/` and `examples/`; the separate `ruff-format` hook has no such filter and does see the package. The `ci_type_mypy` hook curls an external omniverse script and targets `extractthinker/_types/_alias.py`, `extractthinker/cli/...` — paths that do not exist in this repository.
- **`.ruff.toml`**: line-length 88, target py39, rules `B`, `F401`, `E722`, `ARG`; `T201`/`T203` (print) are non-auto-fixable but not selected; its `[extend-per-file-ignores]` reference `instructor/distil.py` and other files from the upstream *instructor* project, not this repo.
- **`.flake8`** ignores only `E501` (line length).

## Practical validation advice

- The quietest meaningful check for a library change is the offline tier: `pytest tests/test_document_loader_txt.py tests/test_document_loader_pypdf.py` (given `pypdf` installed) exercises loader contracts without network.
- Behavior changes touching prompts/strategies can only be verified against live models (critical/live suites) or the `extract_thinker.eval` harness with a labeled dataset; the repo provides no mocking layer for LLM responses.
- Expect CI to be green-or-red based on live providers; a red `tests/critical` run on `main` may be provider flakiness, not code breakage — the repository does not encode retry or quarantine policy for that.

Related: [Quickstart](/openwiki/quickstart.md), [Evaluation Framework](/openwiki/architecture/evaluation.md), [How to Add a Document Loader](/openwiki/guides/adding-a-document-loader.md).
