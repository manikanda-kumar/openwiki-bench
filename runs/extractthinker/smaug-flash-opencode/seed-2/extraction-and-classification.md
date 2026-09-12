---
type: concept
title: Extraction and Classification
description: The Extractor and Process workflows for structured extraction from documents, classification strategies, classification trees, and the universal content pipeline in ExtractThinker.
tags: [extraction, classification, extractor, process, workflow]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:22:48.987Z
sources:
  - id: openwiki-source-80ac776afff46dd86a9f455f
    resource: repo://extract_thinker/exceptions.py
  - id: openwiki-source-c9e2dbf7ec6feebaa5d97d90
    resource: repo://extract_thinker/extractor.py
  - id: openwiki-source-a2ad0cecc3781b040423f249
    resource: repo://extract_thinker/models/classification_response.py
  - id: openwiki-source-9b040ddd08f40366f527dfa0
    resource: repo://extract_thinker/models/classification.py
  - id: openwiki-source-5c6eeb00aeb30bd5afb36a0b
    resource: repo://extract_thinker/process.py
  - id: openwiki-source-9aa4982ff9c07c0b5b894ced
    resource: repo://extract_thinker/utils.py
generated: { by: "opencode", at: "2026-09-12T21:22:48.987Z" }
---

# Extraction and Classification

The `Extractor` class (in `extract_thinker/extractor.py`) is the central engine for turning a document source into structured output, and also performs document/section classification. The `Process` class (in `extract_thinker/process.py`) offers a higher-level workflow that composes loading, splitting, classification, and extraction.

## The extraction pipeline

`Extractor.extract(source, response_model, vision=False, content=None, completion_strategy=FORBIDDEN)` (`extract_thinker/extractor.py:193-336`):

1. If a dict source is given with no document loader, sets `DocumentLoaderData()`.
2. `_validate_dependencies` (`extractor.py:139-157`) requires an LLM, a DocumentLoader (unless vision), and a `response_model` that subclasses `BaseModel` or `Contract`.
3. In vision mode, `_handle_vision_mode` configures the loader (or falls back to `DocumentLoaderLLMImage`); otherwise image keys are removed from list content.
4. If the completion strategy is not `FORBIDDEN`, it delegates to `extract_with_strategy`.
5. For a **list** source, each element is loaded, mapped to the universal format, merged with a `--- Document Separator ---`, page counts summed into metadata, and images merged; then `_extract` is called.
6. For a **single** source, the loader loads content (unless `_skip_loading` is set for split-provided content), it is mapped to the universal format, page count is set on the LLM for token budgeting, then `_extract` runs.

`_map_to_universal_format` (`extractor.py:337-432`) produces `{"content": str, "images": [...], "metadata": {...}}`.

`_extract` (`extractor.py:1115-1147`):

1. Runs any registered `LlmInterceptor`s.
2. Builds messages via `_build_message_content` (text and/or base64 image_url content for vision) and `_build_messages` (`extractor.py:1149-1366`).
3. Appends optional `extra_content`.
4. Dispatches by completion strategy: `FORBIDDEN` → `LLM.request`; `PAGINATE` → `PaginationHandler`; `CONCATENATE` → `ConcatenationHandler`.

### Error handling

- Under `FORBIDDEN`, an `IncompleteOutputException`, a `ValidationError`/`JSONDecodeError` (or json_invalid style message) surfaces as `ExtractThinkerError("Incomplete output received and FORBIDDEN strategy is set")` (`extractor.py:1144-1147`, `318-335`).
- Vision-related LiteLLM `BadRequestError` is re-raised as a `VisionError` (`utils.py:542-563`, `exceptions.py`).
- Other failures are wrapped as `ExtractThinkerError(f"Failed to extract from source: ...")` unless they are `IncompleteOutputException`/JSON errors already handled.

### Vision handling

When `vision=True`, the loader is put into vision mode so pages include rendered images. If the requested input is a vision model but a BadRequestError occurs, `classify_vision_error` re-raises as `VisionError` advising the model may not support vision. If no loader is configured, `_handle_vision_mode` constructs `DocumentLoaderLLMImage(llm=self.llm)` as a fallback (`extractor.py:1398-1409`, `92-126`).

## Classification

Classification labels a document (or page) with one of a set of `Classification` objects. Each `Classification` (`extract_thinker/models/classification.py`) carries `name`, `description`, optional `contract`/`extraction_contract`, optional reference `image`, an optional `extractor`, and a stable `uuid`.

`Extractor.classify(input, classifications, vision)` (`extractor.py:774-807`):

1. Resolves a loader via `get_document_loader_for_file`.
2. If vision, sets `is_classify_image=True` and enables the loader's vision mode.
3. Loads content. In vision mode, ensures an `'image'` key exists.
4. Dispatches to `_classify` (`extractor.py:536-607`):
   - **text-only**: `_classify_text_only` builds a single prompt listing all classifications (name/description/structure) and parses a `ClassificationResponseInternal` (name + confidence 1–10), then matches the returned name to a `Classification`.
   - **image**: `_classify` compares the document image against each classification's reference image (`_classify_one_image_with_ref`) or, without a reference image, to a no-ref prompt (`_classify_one_image_no_ref`). It returns the classification with the highest confidence, or `Unknown` as a fallback.

`ClassificationResponse` (models/classification_response.py) extends `ClassificationResponseInternal` with the matched `Classification` object. Confidence is an integer 1–10.

### Process-level classification

`Process.classify_async(file, classifications, strategy, threshold, image)` (`extract_thinker/process.py:81-125`) supports **multiple extractor layers**, trying each group of extractors until one satisfies the strategy:

- `CONSENSUS` — all extractors in the layer agree on the same name.
- `HIGHER_ORDER` — returns the classifier with highest confidence.
- `CONSENSUS_WITH_THRESHOLD` — consensus AND all confidences >= `threshold` (1–10).

If no layer yields a result, it raises `ValueError`. `threshold` must be an int 1–10.

### Classification trees

`Process.classify_async` also accepts a `ClassificationTree` (models/classification_tree.py: `nodes: List[ClassificationNode]`, each node holding a `Classification` and `children`). `_classify_tree_async` (`process.py:127-188`):

1. Classifies among the current level's nodes' classifications using the first extractor group.
2. If confidence is below `threshold`, raises `ValueError`.
3. Matches the chosen classification to a node by `uuid`; if the node has children, descends to those children; otherwise stops.
4. Returns the best `ClassificationResponse`; `None` result raises `ValueError`.

This enables hierarchical, coarse-to-fine classification (see `mkdocs.yml` documentation on "Tree-Based Classification").

## Validation and dependency checks

Both `Extractor.extract` and `Extractor.classify` validate that an LLM is set (`Load LLM` via `load_llm`) and that a suitable DocumentLoader is available for the source. When no loader can handle the input, extraction/classification raises a `ValueError` ("No suitable document loader found...").
