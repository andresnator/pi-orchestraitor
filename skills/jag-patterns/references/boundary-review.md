# Extension and Dependency Boundary Review

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

## Open-Closed Principle

Use for: open closed principle, OCP, strategy, policy, polymorphism.

- Look for repeated conditionals by type, state, operation, or strategy.
- Suggest strategy, policy, or polymorphism only when new variants are likely or already present.
- Block pattern use when a simple conditional is clearer.

## Dependency Inversion

Use for: dependency inversion, DIP, ports, interfaces, adapters.

- Flag direct dependencies on frameworks, gateways, clients, persistence, or external systems when they hurt testing or coupling.
- Introduce ports/interfaces only for real variation, test seams, or architectural boundaries.
- Do not wrap stable internal classes by default.
