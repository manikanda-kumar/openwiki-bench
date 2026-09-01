# OpenWiki Bench blind-judging rubric

Judge one page at a time using only the supplied page. Score every axis from 0–4. Do not infer quality from length, formatting polish, or prior knowledge of the repository. A citation is not proof unless the page explains what the cited code establishes.

## Taxonomy fit

- **0:** No discernible topic boundary, or the page is an undifferentiated repository survey whose material belongs under multiple outline entries.
- **1:** A topic is recognizable, but the page gives equal weight to two or more independently owned systems or workflows from the outline.
- **2:** One topic dominates, but a substantial section belongs to an adjacent outline entry or the page never states what it owns.
- **3:** One stable system, concept, or workflow owns the page; scope is clear and any spillover is minor.
- **4:** Meets 3 and explicitly states the in-scope owner plus out-of-scope boundaries, routing adjacent concerns to the relevant outline topics without re-explaining them.

Judge overlap only from the supplied page and anonymous outline. Do not invent similarity to pages you cannot read. A cross-cutting workflow may legitimately mention several systems when the workflow—not those systems individually—is the clear owner.

Promotion rule: a clean page with good links is still a 3 unless its prose explicitly names both what it owns and what it excludes or delegates. A title, outline position, or list of “related pages” does not by itself establish an out-of-scope boundary.

## Code grounding

- **0:** Non-obvious technical claims are uncited or citations are decorative.
- **1:** A minority of important claims are traceable to specific source evidence.
- **2:** Most major claims are cited, but important details remain unsupported or evidence is vague.
- **3:** Nearly every non-obvious claim has specific evidence and the prose distinguishes fact from inference.
- **4:** Every non-obvious claim is tied to exact evidence; multi-file conclusions identify each supporting boundary and no citation is stretched beyond what it establishes.

Treat a source path, symbol name, or wiki cross-link without a line range or quoted excerpt as a locator, not evidence. First identify the page's load-bearing claims—the claims needed for its central model—then apply these promotion rules:

- **1 → 2:** at least half of the load-bearing claims have specific source evidence.
- **2 → 3:** every load-bearing claim and roughly 80% of other non-obvious claims have specific source evidence, with inference labeled as inference.
- **3 → 4:** no non-obvious claim lacks exact evidence and every multi-file conclusion cites every required boundary.

If even one load-bearing claim is unsupported, the maximum is 2. Do not count several citations supporting one claim as coverage of several claims.

## Reasoning depth

- **0:** Restates names, signatures, or file layout without explaining behavior.
- **1:** Describes local mechanics but derives no consequences.
- **2:** Explains common flows and a few implications, with important invariants left implicit.
- **3:** Derives meaningful invariants, failure behavior, ordering, or cross-module consequences.
- **4:** Builds a precise causal model: invariants, state transitions, concurrency or security consequences, and why the implementation has those constraints.

Stating that a fallback, restriction, or invariant exists is mechanics, not a derived consequence. A 3 requires at least two causal explanations that connect an implementation choice to an invariant, ordering rule, failure mode, or cross-module consequence. A 4 requires those explanations to form one coherent model and must cover the relevant state transitions plus any material concurrency or security consequences. If the page only lists flows and constraints, cap it at 2.

## Change usefulness

- **0:** A developer could not use the page to make or review a change.
- **1:** Names relevant concepts but not concrete change locations or checks.
- **2:** Identifies likely files and a basic change path, but omits ordering or failure modes.
- **3:** Names concrete files/boundaries, implementation order, and the main tests or failure modes.
- **4:** Enables a real change safely: exact ownership, dependency order, invariants to preserve, validation steps, and rollback/debugging signals.

Use this checklist rather than rewarding general orientation:

- **1:** concepts or broad packages only.
- **2:** concrete file/symbol locations plus either a plausible edit sequence or a named validation/failure check.
- **3:** concrete locations, an ordered edit sequence, and named tests or failure checks are all present.
- **4:** meets 3 and also states invariants to preserve plus rollback or debugging signals.

Links to a separate change guide do not transfer that guide's usefulness to the current page. Missing any required item caps the score at the preceding level.

## Style

- **0:** The page's purpose or main flow cannot be located reliably because structure, raw identifier dumps, or repetition obscures it.
- **1:** The main answer is recoverable only by rereading; headings do not route likely questions, or the same explanation is repeated across multiple sections.
- **2:** Coherent and readable, but one major answer is buried, hierarchy is uneven, or there is one substantial repetition/detour.
- **3:** The opening establishes purpose and scope; headings route likely questions; lists, tables, and diagrams are used only where they shorten comprehension; no major repetition remains.
- **4:** Meets 3 and uses progressive disclosure: a reader can get the ownership/flow answer from the opening, operational details from clearly named sections, and edge cases without scanning unrelated prose. Every section earns its place.

Do not reward Markdown decoration, length, or the mere presence of tables/diagrams. Score information retrieval and unnecessary reading.

A well-organized flat reference is a 3. Promote to 4 only when all three layers are present: the opening gives the ownership or flow answer, sections isolate operational detail, and edge cases are grouped where they can be found without scanning the main path. A closing list of related pages is not progressive disclosure by itself.

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
