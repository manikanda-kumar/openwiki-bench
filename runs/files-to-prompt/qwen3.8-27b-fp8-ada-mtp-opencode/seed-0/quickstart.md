---
type: "Reference"
title: "Quickstart"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T17:48:58.331Z
sources:
  - id: openwiki-source-4f2678f93d3fd3835f9f2909
    resource: repo://.github/workflows/test.yml
  - id: openwiki-source-1b08e55cc2b2155af8681cf0
    resource: repo://files_to_prompt/__main__.py
  - id: openwiki-source-f1576d5b1eaf5a9ea3c7079c
    resource: repo://files_to_prompt/cli.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-a1ba9eac6c28cb5edec62ce0
    resource: repo://tests/test_files_to_prompt.py
generated: { by: "opencode", at: "2026-09-14T17:48:58.331Z" }
---


## Installation

Install from PyPI:

```bash
pip install files-to-prompt
```

The package installs the `files-to-prompt` console script (`pyproject.toml:22-23`); the package can also be run as `python -m files_to_prompt`.

## Basic usage

Pass one or more files or directories:

```bash
files-to-prompt path/to/file_or_directory [more paths...]
```

The default format prints each file's path, a `---` line, its contents, and a closing `---` (`cli.py:64-71`):

```
my_directory/file1.txt
---
Contents of file1.txt

---
```

Paths can also come from stdin, mixed with arguments (`cli.py:300-303`):

```bash
find . -mtime -1 | files-to-prompt
find . -name "*.py" -print0 | files-to-prompt --null
```

`--null`/`-0` splits stdin on NUL instead of whitespace, so filenames containing spaces work (`cli.py:175-185`).

## Filtering

- `-e/--extension`: keep only names with the given suffix, repeatable (`files-to-prompt dir -e py -e md`). The match is a raw suffix, so `-e py` keeps any name ending in `py` (`cli.py:153-154`).
- `--ignore PATTERN`: repeatable fnmatch patterns applied to files and directory names; a matching directory is pruned with its contents unless you also pass `--ignore-files-only` (`cli.py:140-151`).
- `--include-hidden`: include dotfiles. Without it, hidden files and directories are skipped by default (`cli.py:123-125`).
- `.gitignore` files are honored by default, including nested ones encountered during traversal; `--ignore-gitignore` turns this off (`cli.py:127-138`). Matching is fnmatch on the basename only, not git's full path-aware semantics.

## Combining options

A representative run: collect Python sources, skip logs, number the lines, and write the result to a file:

```bash
files-to-prompt src -e py --ignore "*.log" -n -o prompt.txt
```

Argument and stdin paths are processed in the order given; within each directory, files are emitted in sorted order (`cli.py:311-330`, `cli.py:156-157`).

## Output formats

`--cxml` wraps every file for LLM context, following Anthropic's long-context formatting guidance: a single `<documents>` element containing numbered `<document index="N">` entries with `<source>` and `<document_content>` children (`cli.py:74-84`, `cli.py:223-226`, `README.md:194-215`).

`--markdown` emits each file as a fenced code block, guessing the language from the extension (`.py` → python, `.yml` → yaml, via `EXT_TO_LANG`). If the content itself contains triple backticks, the fence is grown to four or more backticks so it stays unambiguous (`cli.py:87-98`).

`-n/--line-numbers` prepends right-aligned line numbers (two spaces before the text) to the content in any format (`cli.py:46-52`).

## Writing to a file

`-o/--output FILE` redirects all output to a UTF-8 file, leaving stdout empty (`cli.py:306-310`):

```bash
files-to-prompt src -o prompt.txt
```

## Notes

- Files that cannot be decoded as text are skipped with a red warning on stderr; the exit code stays 0 (`cli.py:118-120`).
- For development, install with `pip install -e '.[test]'` and run `pytest` (`pyproject.toml:25-26`, `.github/workflows/test.yml:23-27`).
