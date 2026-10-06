# Code Quality Review Lenses

License: [Apache-2.0](../../../licenses/Apache-2.0.txt).
Source author: gentle-ai; adapted by andresnator from gentle-ai/plan-refactor via agents-orchestrator.
Modified for Pi by pi-orchestraitor: consolidated standalone review lenses into a conditional reference.
Original paths, versions and fingerprints remain in [provenance](../../../docs/skills-provenance.json).

## Shared Review Contract

Read this reference only for the lens selected by the owning skill; inspect the target and nearby tests only as needed for that lens. The calling request owns scope and authorization.

- Preserve observable behavior; label functional changes as follow-up.
- Require evidence for every recommendation, or mark it as a hypothesis.
- Concrete findings cite file, lines, symbol, benefit, validation and rollback. Recommend the smallest safe behavior-preserving refactor.
- When evidence is incomplete, mark as hypothesis and lower confidence.
- Omit cosmetic or speculative recommendations unless maintainability benefit is clear.
- Use the calling agent's output contract; it wins over any local field list. Return `no_findings` when the selected lens has no material issue.
- Review recommendations do not authorize implementation, extra files, or a wider inspection scope.

## Simplicity

Use for: KISS, YAGNI, overengineering, speculative abstraction.

- Prefer explicit code until variation is proven.
- Reject abstractions for hypothetical future cases.
- Recommend deletion of unused speculative structure only when safe and validated.

## Duplicated Knowledge

Use for: DRY, duplicated business knowledge, duplication.

- Prioritize duplicated rules, validations, formulas, permissions, mappings, or invariants.
- Do not merge coincidentally similar code with different meanings.
- State the business knowledge that would become single-sourced.

## Naming

Use for naming and readability where no dedicated language naming guidance applies.

### Review goals

- Prefer names that reveal intent and domain meaning.
- Flag misleading abbreviations, overloaded terms, and hidden units or formats.
- Distinguish readability issues from purely stylistic preferences.
- Avoid mass renames unless the evidence shows concrete maintenance benefit.

### Confidence rules

- Use high confidence only when the issue is directly visible from the code or symbol names.
- Lower confidence when the recommendation depends on ecosystem or language-specific naming conventions that are not proven in the repository.
- If the code is too small or names are already clear, return no findings instead of inventing polish work.

### Output notes

- Evidence must cite concrete file/line/symbol examples.
- Cosmetic-only rename suggestions belong out of executable work unless maintainability value is explicit.

## Single Responsibility

Use for: single responsibility, SRP, reasons to change.

- Identify separate business rules, orchestration, IO, mapping, validation, and formatting responsibilities.
- Recommend Extract Class or Move Method only when cohesion improves.
- Avoid splitting code merely because it is long.

## Cohesion and Coupling

Use for: cohesion, coupling, circular dependency, layer mixing.

- Flag classes whose methods use disjoint state subsets.
- Flag layer violations, circular dependencies, high fan-out, and excessive collaborator knowledge.
- Prefer Move Method, Extract Class, Facade, or Port/Adapter only with concrete coupling evidence.
