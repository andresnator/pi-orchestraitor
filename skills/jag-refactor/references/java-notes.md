# Java Notes

Use these notes when the detected language is Java. They replace the former per-technique Java examples and keep only Java-specific constraints that affect refactor safety.

## Version Awareness

- Detect Java version from build files, wrapper configuration, `.java-version`, `.sdkmanrc`, `.tool-versions`, or compiler settings before choosing APIs.
- Java 8 projects cannot use records, `var`, `List.of`, `Optional.stream`, switch expressions, text blocks, or pattern matching.
- Java 11+ projects may use newer collection factories and `var` where local readability improves, but do not introduce newer APIs if the build target is lower.
- Prefer project style over generic modern Java advice when the codebase is consistent.

## Streams

- Use streams when they clarify map/filter/reduce transformations.
- Keep loops when mutation, early exits, checked exceptions, debugging clarity, or index-aware logic would make streams harder to read.
- Avoid stream chains with hidden side effects.
- Preserve ordering and laziness semantics when replacing loops.

## Checked Exceptions

- Preserve checked exception contracts unless the task explicitly allows API changes.
- Do not wrap checked exceptions in unchecked exceptions just to simplify signatures.
- When extracting methods, keep throws clauses honest and no broader than before.
- Use try-with-resources for ownership boundaries; do not move cleanup away from the resource owner.

## Records and Value Objects

- Use records only when the project targets Java 16+ and the type is truly transparent immutable data.
- Do not convert entities, mutable DTOs, framework-bound objects, or serialization-sensitive classes to records without explicit approval.
- Preserve equals/hashCode/toString semantics when replacing hand-written value objects.
- Defensively copy mutable collections at boundaries when ownership is unclear.

## Optional

- Use `Optional` for return values that may be absent, not for fields, parameters, or collection elements unless the project already does so deliberately.
- Do not replace null with Optional in public APIs unless an API change is approved.
- Prefer clear guard clauses when Optional chains obscure error handling.

## Java 8 vs 11+ Quick Checks

| Topic | Java 8 | Java 11+ |
|---|---|---|
| Local inference | Not available | `var` can be used locally when it preserves readability |
| Collection factories | Use constructors/builders | `List.of`, `Set.of`, `Map.of` available |
| Optional helpers | No `Optional.stream` | `Optional.stream` available in Java 9+ |
| Strings | No `isBlank`, `lines`, `strip` | Available in Java 11 |
| Records | Not available | Available in Java 16+ |

## Java Completion Gate

Before declaring a Java refactor complete, verify:

- Behavior preservation: no bug fix or externally observable behavior change is mixed into the refactor.
- Readability and naming: names explain intent; extracted methods/classes reduce cognitive load rather than hiding simple code.
- Cohesion: moved or extracted code belongs with the data and behavior that change together.
- SOLID restraint: apply SOLID principles only where real change pressure exists; avoid mechanical abstractions.
- Pragmatic patterns: choose the simplest design that handles known variation; do not introduce a pattern by default.
- API compatibility: public signatures, visibility, mutability, serialization, and caller contracts are preserved unless the task explicitly allows an API change.
- Exception robustness: do not swallow exceptions, broaden them unnecessarily, or use exceptions as normal control flow.
- Immutability/modeling: prefer clear ownership, defensive copies, records/value objects, or invariants when they simplify reasoning.
- Useful-only JavaDoc: add or keep JavaDoc only when it explains non-obvious intent, contracts, invariants, edge cases, threading/lifecycle expectations, or public API obligations.
