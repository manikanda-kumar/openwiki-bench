---
type: "Reference"
title: "Implementation"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T18:27:25.941Z
sources:
  - id: openwiki-source-f2608d0d515da097485b6ec5
    resource: repo://.github/workflows/publish.yml
  - id: openwiki-source-4f2678f93d3fd3835f9f2909
    resource: repo://.github/workflows/test.yml
  - id: openwiki-source-1b08e55cc2b2155af8681cf0
    resource: repo://files_to_prompt/__main__.py
  - id: openwiki-source-f1576d5b1eaf5a9ea3c7079c
    resource: repo://files_to_prompt/cli.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-a1ba9eac6c28cb5edec62ce0
    resource: repo://tests/test_files_to_prompt.py
generated: { by: "opencode", at: "2026-09-14T18:27:25.941Z" }
---


## Layout

All behavior lives in one click command, `cli` (`files_to_prompt/cli.py:188`). It is exposed as the `files-to-prompt` console script (`pyproject.toml:22-23`) and via `python -m files_to_prompt` (`files_to_prompt/__main__.py`).

## Input traversal

`process_path` (`files_to_prompt/cli.py:101-172`) branches: a single file is opened and emitted directly; a directory is walked with `os.walk` (line 122). For each directory visited, filters are applied in this order:

1. Hidden entries are dropped unless `--include-hidden` is set — subdirectories (pruned via in-place `dirs[:]` so `os.walk` never descends in) and files (lines 123-125).
2. `.gitignore` rules (lines 127-138).
3. `--ignore` fnmatch patterns, which also prune directories unless `--ignore-files-only` is given (lines 140-151).
4. Extension filter, keeping only names ending in any `-e` value (line 154).

Remaining files are emitted in `sorted(files)` order (line 156).

## Hidden files and ignore handling

Hidden names (starting with `.`) are excluded by default in both directories and files; `--include-hidden` re-includes them (`files_to_prompt/cli.py:123-125`; `tests/test_files_to_prompt.py:32-46`).

`.gitignore` support is line-based, not git-based: `read_gitignore` (`files_to_prompt/cli.py:36-43`) keeps only non-empty, non-`#` lines. Rules accumulate into a single shared list: the parent of each top-level path contributes before walking (lines 314-315), and every walked directory extends the same list (line 128), so rules persist across all input paths; `--ignore-gitignore` disables it.

`should_ignore` (`files_to_prompt/cli.py:27-33`) matches rules against the entry's *basename* only, via `fnmatch`, and additionally matches `basename + "/"` for directories so trailing-slash directory rules such as `build/` take effect. The nested `.gitignore` case in `test_ignore_gitignore` pins this behavior (`tests/test_files_to_prompt.py:49-90`). Full gitignore semantics (anchored paths, negation, `**`) are not implemented; the code and tests contain no evidence for them.

`--ignore` patterns use the same fnmatch semantics against basenames.

## Formatting

`print_path` dispatches cxml → markdown → default (`files_to_prompt/cli.py:55-61`).

- **Default** (lines 64-71): path, `---`, content, blank line, `---`.
- **Claude XML** (lines 74-84): each file becomes a `<document index="N">` / `<source>` / `<document_content>` block. `N` comes from the module-level `global_index` (line 7), reset to 1 at the start of each run (lines 295-297; the code comment notes the reset exists "for pytest"). The whole run is wrapped in a single `<documents>` pair (lines 316-317, 331-332).
- **Markdown** (lines 87-98): the fence language comes from the `EXT_TO_LANG` map (lines 9-24) keyed on the last dot-separated name segment; unknown extensions get no language tag. The fence starts at three backticks and is extended one backtick at a time while the current fence string occurs inside the file's content, so a file containing triple backticks is wrapped in four (verified by `test_markdown`, `tests/test_files_to_prompt.py:407-441`).
- **Line numbers** (lines 46-52): each line gets a 1-based number padded to the width of the total line count, followed by two spaces.

## Error handling

Files failing UTF-8 decoding raise `UnicodeDecodeError` on read; it is caught in both the single-file and directory branches, a red warning is written to stderr, and the file is skipped — the run continues with exit code 0 (`files_to_prompt/cli.py:114-120, 158-172`; `tests/test_files_to_prompt.py:237-258`). Other read exceptions are not explicitly caught. Paths arriving via stdin are not validated by click (only positional arguments use `click.Path(exists=True)`, line 189), so a nonexistent stdin path raises `click.BadArgumentUsage` at line 313.

## Maintenance guide

- **Tests**: pytest drives the real CLI via click's `CliRunner` in `tmpdir` fixtures (`tests/test_files_to_prompt.py:1-7`); `test_xml_format_dir` asserts exact cxml output.
- **Local setup**: `pip install -e '.[test]'` then `pytest` (README; `test` extra at `pyproject.toml:25-26`).
- **CI**: `.github/workflows/test.yml` runs pytest on Python 3.9–3.13 for every push/PR; `publish.yml` re-runs tests, then builds and publishes to PyPI on release.
- **Gotchas**: `global_index` (lines 7, 295-297) is shared across invocations in one process; the gitignore rule list is mutated in place across all input paths (line 305); directory pruning relies on in-place `dirs[:]` (lines 124, 129, 142).
