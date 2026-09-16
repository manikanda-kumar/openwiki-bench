---
type: "Reference"
title: "Quickstart"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T18:27:25.941Z
sources:
  - id: openwiki-source-f1576d5b1eaf5a9ea3c7079c
    resource: repo://files_to_prompt/cli.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-a1ba9eac6c28cb5edec62ce0
    resource: repo://tests/test_files_to_prompt.py
generated: { by: "opencode", at: "2026-09-14T18:27:25.941Z" }
---


## Installation

`files-to-prompt` is a Python CLI published to PyPI (Apache-2.0, Python 3.8+):

```bash
pip install files-to-prompt
```

The package installs a `files-to-prompt` console script bound to `files_to_prompt.cli:cli` (`pyproject.toml:22-23`).

## Inputs

Pass one or more file or directory paths; directories are traversed recursively:

```bash
files-to-prompt src docs/notes.md
```

Paths can also be piped in on stdin, whitespace-separated by default (a terminal stdin is detected and not read, so interactive runs never block):

```bash
find . -name "*.py" | files-to-prompt
```

Use NUL separation (`--null`/`-0`) when filenames may contain spaces: `find . -name "*.txt" -print0 | files-to-prompt --null`. Arguments and stdin paths may be mixed; arguments come first (`files_to_prompt/cli.py:299-303`). A nonexistent stdin path fails with `BadArgumentUsage`, because click's `exists=True` validation covers only positional arguments (`files_to_prompt/cli.py:189, 311-313`). The source has no special handling for symlinks, and no test pins symlink behavior, so treat it as unverified.

## Filtering

- `-e`/`--extension` keeps only files whose names end with the given value (no dot required; repeatable): `files-to-prompt src -e py -e md`. Matching is plain `str.endswith` (`files_to_prompt/cli.py:153-154`), so `-e py` would also match a file named `xpy`.
- `--ignore` accepts fnmatch patterns (`*`, `?`, `[...]`) matched against file and directory basenames; by default it prunes whole directories too. `--ignore-files-only` applies patterns to files only:

  ```bash
  files-to-prompt src --ignore "*.log" --ignore "tmp*"
  ```

- Hidden files and directories (names starting with `.`) are skipped unless you pass `--include-hidden`.
- `.gitignore` files are honored by default, with each directory's rules applying to entries found as the walk proceeds; `--ignore-gitignore` includes everything.

For example, on a directory containing `file1.txt`, `temp.log`, and `subdirectory/`, `files-to-prompt my_directory --ignore "*.log"` outputs `file1.txt` and the files under `subdirectory/` but not `temp.log` (README, Example).

## Output formats

By default, each file is printed as its path, `---`, the content, a blank line, and `---` (`files_to_prompt/cli.py:64-71`).

`--cxml`/`-c` emits Claude-style XML: one `<document index="N">` with `<source>` and `<document_content>` per file, wrapped in a single `<documents>` pair:

```bash
files-to-prompt src --cxml
```

`--markdown`/`-m` wraps each file in a fenced code block, guessing the language tag from the extension (`python`, `javascript`, ...; no tag for unknown extensions). If the content itself contains triple backticks, the fence gains one extra backtick so the block stays valid:

```bash
files-to-prompt src --markdown
```

`--line-numbers`/`-n` prefixes every line with a right-aligned number and two spaces, in any format:

```
files_to_prompt/cli.py
---
  1  import os
  2  import sys
```

## Output file

Output goes to stdout unless you pass `-o`/`--output`, which writes the same content to a UTF-8 file and prints nothing:

```bash
files-to-prompt src -o prompt.txt
```

Non-UTF-8 files never abort a run: each is skipped with a red `Warning: Skipping file ... due to UnicodeDecodeError` on stderr, and the exit code stays 0 (`files_to_prompt/cli.py:118-120, 168-172`).
