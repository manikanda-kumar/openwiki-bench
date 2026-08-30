# OpenWiki Bench blind-judging rubric

Judge one page at a time using only the supplied page. Score every axis from 0–4. Do not infer quality from length, formatting polish, or prior knowledge of the repository. A citation is not proof unless the page explains what the cited code establishes.

## Taxonomy fit

- **0:** No coherent owner; substantially duplicates two or more other page-shaped topics.
- **1:** Topic is recognizable but mixes unrelated responsibilities or lacks a stable boundary.
- **2:** Mostly coherent, with notable overlap or missing ownership boundaries.
- **3:** Clear owner and scope; only minor overlap or misplaced material.
- **4:** One precise owner, explicit boundaries, and useful routing to adjacent topics without duplication.

## Code grounding

- **0:** Non-obvious technical claims are uncited or citations are decorative.
- **1:** A minority of important claims are traceable to specific source evidence.
- **2:** Most major claims are cited, but important details remain unsupported or evidence is vague.
- **3:** Nearly every non-obvious claim has specific evidence and the prose distinguishes fact from inference.
- **4:** Every non-obvious claim is tied to exact evidence; multi-file conclusions identify each supporting boundary and no citation is stretched beyond what it establishes.

## Reasoning depth

- **0:** Restates names, signatures, or file layout without explaining behavior.
- **1:** Describes local mechanics but derives no consequences.
- **2:** Explains common flows and a few implications, with important invariants left implicit.
- **3:** Derives meaningful invariants, failure behavior, ordering, or cross-module consequences.
- **4:** Builds a precise causal model: invariants, state transitions, concurrency or security consequences, and why the implementation has those constraints.

## Change usefulness

- **0:** A developer could not use the page to make or review a change.
- **1:** Names relevant concepts but not concrete change locations or checks.
- **2:** Identifies likely files and a basic change path, but omits ordering or failure modes.
- **3:** Names concrete files/boundaries, implementation order, and the main tests or failure modes.
- **4:** Enables a real change safely: exact ownership, dependency order, invariants to preserve, validation steps, and rollback/debugging signals.

## Style

- **0:** Unstructured, confusing, or dominated by raw identifiers and repetition.
- **1:** Understandable only with substantial rereading; weak hierarchy or excessive prose.
- **2:** Generally readable but uneven, repetitive, or poorly prioritized.
- **3:** Scannable and concise, with effective headings/lists/tables and little repetition.
- **4:** Exceptional information design: answers the likely question quickly, reveals detail progressively, uses diagrams/tables only when they clarify, and stops when complete.

## Correctness

- **0:** Contains a direct source contradiction that invalidates the page’s central model.
- **1:** Contains multiple material contradictions or one severe operationally dangerous error.
- **2:** Mostly correct but has a material error, conflation, or unsupported certainty.
- **3:** No material contradiction found; at most minor imprecision.
- **4:** No contradiction found and the page explicitly handles subtle exceptions, edge cases, and uncertainty correctly.

## Output contract

Return one JSON object and nothing else:

```json
{
  "scores": {
    "taxonomy_fit": 0,
    "code_grounding": 0,
    "reasoning_depth": 0,
    "change_usefulness": 0,
    "style": 0,
    "correctness": 0
  },
  "rationale": "Brief evidence-based explanation."
}
```
