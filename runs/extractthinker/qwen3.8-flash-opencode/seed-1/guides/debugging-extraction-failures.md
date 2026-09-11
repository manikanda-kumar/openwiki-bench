---
type: change-guide
title: "Debugging Extraction Failures"
description: "Triage guide: map exception types and messages to root causes, understand the wrapping rules that hide causes, and account for the silent fallbacks that change results without raising."
tags: [debugging, error-handling, exceptions, fallbacks, diagnostics]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T10:24:25.212Z
sources:
  - id: openwiki-source-6b9feb028551b55b06cbae26
    resource: repo://extract_thinker/batch_job.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-dc7c494e3ba5af8a22fe54b1
    resource: repo://extract_thinker/image_splitter.py
  - id: openwiki-source-6c73b632ef55e7719ac65d5a
    resource: repo://extract_thinker/llm.py
  - id: openwiki-source-f087112619b9c50915a1e49c
    resource: repo://extract_thinker/markdown/markdown_converter.py
  - id: openwiki-source-3ed24b37fde18a7f8973b7b4
    resource: repo://extract_thinker/pagination_handler.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-cda8ee7e415b6ecdfb133cd9
    resource: repo://extract_thinker/text_splitter.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-11T10:24:25.212Z" }
---

# Debugging Extraction Failures

There is no logging framework in `extract_thinker` — diagnostics are ~147 `print()` calls and exception messages. This guide maps observable failures to their source, then lists the places where the library *swallows* problems.

## Step 1: Identify the failure family

| What you see | Where it originates | Meaning |
|---|---|---|
| `ValueError: Document loader is not set...` / `LLM is not set...` / `response_model must be a subclass...` | `Extractor._validate_dependencies` (`extractor.py:139-157`) | Misconfiguration before any I/O |
| `ValueError: No suitable document loader found...` | `extractor.py:90,244,299` or `process.py:214,266` | Loader resolution failed for the source type |
| `ExtractThinkerError: Incomplete output received and FORBIDDEN strategy is set` | `extractor.py:320-330` | Model output was truncated or invalid JSON while FORBIDDEN forbids partials |
| `ExtractThinkerError: Failed to extract from source: <x>` | `extractor.py:335` | Catch-all wrapper; inspect `__cause__` |
| `VisionError: Make sure that the model you're using supports vision features: ...` | `utils.classify_vision_error` (`utils.py:547-563`) | litellm `BadRequestError` during a vision call (wrong model or payload) |
| `InvalidVisionDocumentLoaderError` | `extractor.py:226-230` | Vision setup raised inside `_handle_vision_mode` |
| `Timeout`/provider errors | `LLM.TIMEOUT = 3000` ms passed to litellm/instructor (`llm.py:40,251,282`) | Raise `Extractor.set_timeout` or `LLM.set_timeout` only if requests legitimately exceed 3 s |
| `ValueError: Failed to extract from source: <e>` (from LLM) | `llm.py:200-201,311-312` | Pydantic-AI backend wraps *every* agent failure |

The INCOMPLETE message is overloaded: it fires not only for instructor's `IncompleteOutputException` but also for any exception whose string contains `"ValidationError"`, `"JSONDecodeError"`, or `"json_invalid"` (`extractor.py:327-330`). A field your contract declares `int` but the model returns `"3"` as string will surface as "Incomplete output". Always inspect the wrapped `__cause__` before trusting the message.

Also note `extractor.py:332` uses `vision & is_vision_error(e)` where `is_vision_error` indexes `e.args[0]` — an argument-less exception in a vision run dies with `IndexError` inside error handling.

## Step 2: Process/workflow errors

- `Threshold must be an integer between 1 and 10` — `process.py:75-76,89-90`.
- `No consensus could be reached on the classification ... across any layer` — every extractor layer disagreed or failed; look for the printed `Layer failed with error: ...` lines (`process.py:119-125`).
- `Classification failed at the current level` / `Classification confidence X ... below the threshold` / `No matching node found ...` — tree mode (`process.py:155-181`).
- `No splitter loaded` / `Document must have at least 2 pages` / `Document Type does not support lazy splitting. for now only pdf is supported` — split preconditions (`process.py:207-236`).
- `Document groups have not been initialized` — call `split()` before `extract()` (`process.py:244-245`).
- `Extractor not found for classification` — a doc group was classified with a name absent from the `Classification` list passed to `split` (typically the splitter's `unknown` fallback; see below) (`process.py:260-261`).
- Batch: `Batch processing is not supported with the PYDANTIC_AI backend`, `Model ... does not support batch processing`, `File already exists: ...` — `extractor.py:969-1004`.

## Step 3: Silent behaviors to rule out before blaming the model

These do not raise; they change results:

- **Splitter fallbacks.** A failed page-pair comparison yields `belongs_to_same_document=True` and both pages get `classifications[0].name` (`image_splitter.py:107-113`, `text_splitter.py:66-72`); a failed eager split returns **one group of all pages classified `"unknown"`** (`image_splitter.py:215-222`) — which then trips "Extractor not found for classification" in `extract()` or mis-routes contracts.
- **Vision classification fallback** returns `name="Unknown", confidence=1` when every per-classification comparison fails (`extractor.py:600-605`).
- **PAGINATE drops failed pages** silently (error printed; merge proceeds without them) and its conflict-resolution context can mispair pages after out-of-order completion (`pagination_handler.py:55-69`). "Missing list entries" often means pages were dropped, not unseen by the model.
- **CONCATENATE retries up to 3** before raising; watch the printed request failures.
- **Markdown fallback**: `to_markdown` catches everything and returns `_basic_to_markdown` output (or error-comment strings per page) when a loader is configured — empty/garbage markdown with no exception (`markdown_converter.py:593-602,640-648`).
- **Batch**: upload/create failures print the real error, then raise generic `ValueError`; `get_status` maps any retrieval exception to `"failed"` (`batch_job.py:98-111`).
- **Cloud loaders**: credential/SDK problems are `ImportError`s at first use, not at import time.

## Step 4: Practical probes

- Reproduce with `LLM(model, token_limit=...)` or `set_page_count` to shrink/grow the budget; the FORBIDDEN-vs-truncation boundary is the easiest failure to reproduce deterministically (`tests/test_extractor.py:143-154` shows the token-limit trick).
- Use `print`-visible output directly: the pipeline tags layers (`Layer failed with error`), pages (`Error processing page`), chunks (`Error processing chunk`), and cache/batch cleanups — capture stdout with your traceback.
- For loader issues, call `loader.can_handle(source)` and `load()` standalone: path handling and stream mime sniffing are separate code paths (`document_loader.py:68-82`).
- Check `Extractor` reuse: `extra_content`, `completion_strategy`, `allow_vision`, and `is_classify_image` persist on the instance between calls (`extractor.py:221-233,796`), so a "previous call's" strategy/vision flag can be leaking into the failing one.

Related: [Extractor Core](/openwiki/architecture/extractor.md), [Completion Strategies](/openwiki/architecture/completion-strategies.md), and [Classification & Splitting](/openwiki/architecture/classification-and-splitting.md).
