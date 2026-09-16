---
type: implementation-guide
title: Implementation and Maintenance Guide
description: How files-to-prompt collects and traverses input paths, applies hidden-file, .gitignore, and --ignore filtering, formats default/XML/Markdown output, handles decode errors, and where each behavior is pinned by tests.
tags: [implementation, cli, traversal, filtering, output-formats, testing]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T17:48:58.331Z
sources:
  - id: openwiki-source-4f2678f93d3fd3835f9f2909
    resource: repo://.github/workflows/test.yml
  - id: openwiki-source-f1576d5b1eaf5a9ea3c7079c
    resource: repo://files_to_prompt/cli.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-a1ba9eac6c28cb5edec62ce0
    resource: repo://tests/test_files_to_prompt.py
generated: { by: "opencode", at: "2026-09-14T17:48:58.331Z" }
---

All behavior lives in one module, `files_to_prompt/cli.py`. It runs via the `files-to-prompt` console script (entry point in `pyproject.toml`) or `python -m files_to_prompt`. The only runtime dependency is `click`.

## Path collection

`cli()` combines argument paths with stdin paths (`cli.py:300-303`). `read_paths_from_stdin()` (`cli.py:175-185`) returns `[]` when stdin is a TTY; otherwise it reads all of stdin and splits on NUL (with `--null`) or on whitespace, dropping empty entries. Arguments are validated by `click.Path(exists=True)`; stdin paths instead hit the explicit `os.path.exists` check that raises `click.BadArgumentUsage` (`cli.py:311-313`).

## Traversal and filtering

`process_path()` prints a single file directly, or walks directories with `os.walk`, applying filters per level in this order (`cli.py:121-155`):

1. Hidden entries: unless `--include-hidden`, names starting with `.` are pruned from dirs and files.
2. `.gitignore`: unless `--ignore-gitignore`, rules from `read_gitignore(root)` accumulate into one shared list from every visited root plus each top-level path's parent dir. `should_ignore()` (`cli.py:27-33`) matches with `fnmatch` against the basename, trying `name/` for directories. Rules persist for the whole run, so an early rule applies to later directories.
3. `--ignore` patterns: `fnmatch` against names; directories are pruned too unless `--ignore-files-only`.
4. Extensions: `f.endswith(extensions)` — a raw suffix match, so `-e py` matches any name ending in `py`.

Files are `sorted()` per directory, giving deterministic order within each directory.

## Formatting

`print_path()` prefers `--cxml`, then `--markdown`, then the default (`cli.py:55-61`):

- Default: path, `---`, content, blank line, `---`.
- cxml: `<documents>` is written once, before the first merged path only (no wrapper if no paths exist). Each file becomes `<document index="N">` with `<source>` and `<document_content>`; `N` comes from module-level `global_index` (`cli.py:7`), reset to 1 at each `cli()` start (`cli.py:295-297`).
- markdown: fence language comes from `EXT_TO_LANG` (`cli.py:9-24`) via the extension after the last dot (`yml` maps to `yaml`). The fence starts at three backticks and grows while the content contains that run, so content holding triple backticks is wrapped in quadruple backticks (`cli.py:90-92`).

`-n` numbering applies in all three formats: `add_line_numbers()` (`cli.py:46-52`) right-aligns numbers to the digit width of the final line, separated from the line by two spaces.

## Errors and output destination

A file raising `UnicodeDecodeError` is skipped with a red warning on stderr; the exit code stays 0. With `-o`, the writer is a `print` closure over a UTF-8 file opened in write mode (`cli.py:306-310`), leaving stdout empty.

## Maintenance guide

- Filtering order and gitignore accumulation: `process_path()` `cli.py:121-155`; pinned by `test_ignore_gitignore`, `test_mixed_paths_with_options`, `test_ignore_patterns`.
- Hidden-file default: `cli.py:123-125`; `test_include_hidden`.
- Extension filter: `cli.py:153-154`; `test_specific_extensions`.
- cxml indexing: `global_index` `cli.py:7`, reset at `cli.py:295-297`; `test_xml_format_dir`.
- Markdown fences/language: `cli.py:87-98`; `test_markdown`.
- Line numbers: `cli.py:46-52`; `test_line_numbers`.
- Binary-file skipping: `cli.py:118-120`, `cli.py:168-172`; `test_binary_file_warning`.
- Output file: `cli.py:306-310`, `cli.py:333-334`; `test_output_option`.
- stdin: `cli.py:175-185`, `cli.py:300-303`; `test_reading_paths_from_stdin`, `test_paths_from_arguments_and_stdin`.

Caveats: `global_index` is a module global, so interleaved in-process invocations share state — the per-invocation reset is what keeps tests green. `.gitignore` matching is basename-only fnmatch, not git's path-aware semantics, and `read_gitignore()` is line-based: it skips blanks and `#` comments and treats every remaining line as a rule, so negation (`!`) lines are not handled specially. CI installs `.[test]` and runs `pytest` on Python 3.9–3.13 (`.github/workflows/test.yml`).
