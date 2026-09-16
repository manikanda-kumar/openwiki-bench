---
type: "Reference"
title: "Quickstart: Installing and Using files-to-prompt"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T17:07:48.192Z
sources:
  - id: openwiki-source-f1576d5b1eaf5a9ea3c7079c
    resource: repo://files_to_prompt/cli.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-a1ba9eac6c28cb5edec62ce0
    resource: repo://tests/test_files_to_prompt.py
generated: { by: "opencode", at: "2026-09-14T17:07:48.192Z" }
---


# Quickstart: Installing and Using files-to-prompt

files-to-prompt concatenates a directory of files into a single prompt suitable for an LLM, with each file's contents preceded by its path. It is a small Python package whose only runtime dependency is `click` (repo://pyproject.toml#L12-L14), requiring Python 3.8 or later.

## Installation

```bash
pip install files-to-prompt
```

This installs the `files-to-prompt` console script (repo://pyproject.toml#L22-L23).

## Basic invocation

```bash
files-to-prompt path/to/file_or_directory [more paths...]
```

The default output is each file's path, a `---` line, its contents, and a closing `---`. Directories are traversed recursively and multiple paths are processed in the order given (repo://files_to_prompt/cli.py#L64-L71, repo://tests/test_files_to_prompt.py#L93-L112).

Paths can also come from stdin, mixed with arguments:

```bash
find . -mtime -1 | files-to-prompt README.md
```

Stdin is split on whitespace by default; use `--null`/`-0` to read NUL-separated paths when filenames may contain spaces:

```bash
find . -name "*.txt" -print0 | files-to-prompt --null
```

When stdin is a terminal, no stdin reading happens at all, so interactive use never blocks (repo://files_to_prompt/cli.py#L175-L185).

## Filtering

- Keep only certain extensions (repeatable): `files-to-prompt docs -e md -e py`
- Include hidden files and directories (excluded by default): `files-to-prompt src --include-hidden`
- Exclude by fnmatch pattern (repeatable): `files-to-prompt repo --ignore "*.log" --ignore "temp*"`. By default a matching directory is skipped entirely; `--ignore-files-only` keeps walking into it: `files-to-prompt repo --ignore "*dir*" --ignore-files-only`
- `.gitignore` files are honored by default: rules from the top-level directory and from nested `.gitignore` files apply as the walk descends. `--ignore-gitignore` disables this and includes everything.

These behaviors are pinned by tests such as `test_specific_extensions`, `test_ignore_patterns`, `test_mixed_paths_with_options`, and `test_ignore_gitignore` (repo://tests/test_files_to_prompt.py#L49-L234).

## Output formats

Default:

```
src/app.py
---
import os
---
```

`-c`/`--cxml` emits the structured format Anthropic recommends for long-context prompts: each file becomes a numbered `<document index="N">` with `<source>` and `<document_content>` elements inside `<documents>` (repo://files_to_prompt/cli.py#L74-L84):

```bash
files-to-prompt repo -c > prompt.xml
```

`-m`/`--markdown` wraps each file in a fenced code block with a language tag guessed from the extension; unknown extensions get an untagged fence (repo://files_to_prompt/cli.py#L87-L98):

```bash
files-to-prompt notes -m > notes.md
```

Both formats honor `-n`/`--line-numbers`, which prefixes every line with a right-aligned line number (padded to the last line's number, followed by two spaces) (repo://files_to_prompt/cli.py#L46-L52):

```
src/app.py
---
  1  import os
  2
  3  import click
---
```

## Writing to a file

`-o`/`--output` writes the result to a file instead of stdout (repo://files_to_prompt/cli.py#L306-L310):

```bash
files-to-prompt repo -o prompt.txt
```

The file is opened as UTF-8 and nothing is printed to stdout while writing to it (repo://tests/test_files_to_prompt.py#L294-L323).

## Error behavior

Files that do not decode as text are skipped with a red warning on stderr; the rest of the run continues and the exit code stays 0 (repo://files_to_prompt/cli.py#L158-L172, repo://tests/test_files_to_prompt.py#L237-L258). Paths that do not exist are rejected with a `click.BadArgumentUsage` error (repo://files_to_prompt/cli.py#L311-L313).
