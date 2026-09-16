---
type: "Reference"
title: "Implementation: Traversal, Filtering, Formatting, and Errors"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T17:07:48.192Z
sources:
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
generated: { by: "opencode", at: "2026-09-14T17:07:48.192Z" }
---


# Implementation: Traversal, Filtering, Formatting, and Errors

The entire tool is one Click command in `files_to_prompt/cli.py`. `pyproject.toml` wires the `files-to-prompt` console script to `files_to_prompt.cli:cli`, and `files_to_prompt/__main__.py` re-exports the same function for `python -m files_to_prompt`.

## Input handling

`cli()` accepts zero or more path arguments validated up front by `click.Path(exists=True)` (repo://files_to_prompt/cli.py#L188-L189). It then calls `read_paths_from_stdin()`, which returns `[]` when stdin is a TTY so interactive use never blocks; otherwise it splits stdin on NUL when `--null` is set, or on whitespace otherwise. Stdin paths are concatenated after the argument paths, and every combined path is rechecked with `os.path.exists`, raising `click.BadArgumentUsage` when missing — so stdin-supplied paths are validated at runtime rather than by Click (repo://files_to_prompt/cli.py#L299-L313).

## Traversal and filtering

Directories are walked with `os.walk`, and `process_path()` applies filters in a fixed order per directory:

1. **Hidden entries** — unless `--include-hidden`, dot-prefixed directories and files are removed first.
2. **`.gitignore` rules** — unless `--ignore-gitignore`, `read_gitignore(root)` rules are appended to a run-wide list, and entries whose basename fnmatches a rule are dropped. Rules are also preloaded from the parent directory of each top-level argument (repo://files_to_prompt/cli.py#L311-L315). Accumulation means a nested `.gitignore` constrains its own subtree and everything below it; `test_ignore_gitignore` pins this nested behavior. `read_gitignore()` keeps only non-empty non-`#` lines, and `should_ignore()` matches only basenames (plus `basename + "/"` for directories), so git path syntax, anchoring, and negation are not supported (repo://files_to_prompt/cli.py#L27-L43).
3. **`--ignore` patterns** — fnmatched against basenames; matched directories are pruned from the walk unless `--ignore-files-only` is given (repo://files_to_prompt/cli.py#L140-L151).
4. **Extensions** — `-e` values form a tuple passed to `str.endswith`, ORing multiple flags (repo://files_to_prompt/cli.py#L153-L154).

File basenames are emitted in `sorted()` order within a directory; directory order follows `os.walk`'s default order (repo://files_to_prompt/cli.py#L156).

## Formatting

`print_path()` dispatches to one of three writers, applying `add_line_numbers()` first when `-n` is set; that helper pads numbers to the width of the last line number and uses two spaces before the line text (repo://files_to_prompt/cli.py#L46-L52).

- **Default**: path, `---`, content, blank line, `---`.
- **`--cxml`**: wraps all output in `<documents>` and numbers each `<document>` with a module-level `global_index` that `cli()` resets to 1 on every invocation (repo://files_to_prompt/cli.py#L74-L84, repo://files_to_prompt/cli.py#L295-L297); `test_xml_format_dir` pins the exact output.
- **`--markdown`**: prints the path then a fenced block whose language comes from `EXT_TO_LANG` (14 mappings; unknown extensions get an empty tag); while the fence appears inside the content, one backtick is added per iteration to avoid collision, which `test_markdown` verifies with a quad-backtick input (repo://files_to_prompt/cli.py#L87-L98).

With `-o/--output`, the writer becomes `print` to a UTF-8 file handle opened for writing and closed at the end, and nothing goes to stdout (repo://files_to_prompt/cli.py#L306-L310, repo://files_to_prompt/cli.py#L333-L334).

## Error handling

Files are opened in text mode; a `UnicodeDecodeError` (binary content) is caught, a red warning goes to stderr, and the run continues with exit code 0 — `test_binary_file_warning` asserts the warning on stderr while sibling text files still appear (repo://files_to_prompt/cli.py#L158-L172, repo://tests/test_files_to_prompt.py#L237-L258).

## Maintenance guide

- **Add a language tag**: extend `EXT_TO_LANG` and add a case to `test_markdown`.
- **Change ignore semantics**: modify `should_ignore()`/`read_gitignore()`; `test_ignore_gitignore` and `test_mixed_paths_with_options` are the strongest existing pins for rule accumulation and the hidden/gitignore interplay.
- **Add tests**: the suite uses `click.testing.CliRunner` with `tmpdir.as_cwd()`, asserting on `result.output` (and `result.stderr` with `mix_stderr=False` for diagnostics). Install with `pip install -e '.[test]'` and run `pytest`; CI runs the same command on Python 3.9–3.13 for pushes and pull requests (repo://.github/workflows/test.yml#L7-L27).
