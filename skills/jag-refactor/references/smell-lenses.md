# Focused Refactoring Diagnostics

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

## Small Functions

Use for: small functions, long method, extract method.

- Flag methods with multiple abstraction levels, nested branches, or distinct phases.
- Prefer Extract Method when a block has a meaningful domain name.
- Prefer Split Phase when parsing/validation/calculation/persistence are interleaved.
- Keep recommendations behavior-preserving and incremental.

## God Object

Use for: God Object, Large Class, too many collaborators.

- Look for many unrelated methods, many collaborators, broad state ownership, and mixed domain concepts.
- Recommend incremental extraction by cohesive responsibility.
- Require characterization tests before risky legacy extractions.

## Spaghetti Code

Use for: spaghetti code, temporal coupling, hidden side effects.

- Flag tangled branches, implicit execution order, hidden side effects, and temporal coupling.
- Recommend guard clauses, Split Phase, Extract Method, or explicit state transitions.
- Never recommend a Big Bang rewrite.
