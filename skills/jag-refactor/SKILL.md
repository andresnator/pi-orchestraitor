---
name: jag-refactor
description: "Select Fowler/Shvets refactoring techniques across languages; diagnose long methods/oversized functions, small functions/extraction, God Object/Large Class with too many collaborators, spaghetti code, temporal coupling and hidden side effects. Use for smells, SOLID, conditionals/classes/APIs or pasted code needing improvement; equivalent requests in any language apply."
license: MIT
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "2.2.0"
  modification_notice: "Modified for Pi by pi-orchestraitor; dropped the bundled technique catalog and language matrices."
  author: andresnator
  status: done
  version: "1.5.1"
---

# Refactoring

**Refactoring is the process of changing the internal structure of code without altering its observable behavior.** It is a disciplined technique, not a random cleanup. The golden rule is: Cover → Modify → Refactor (always have tests before you start). Technique names follow Martin Fowler's *Refactoring* (2nd Edition) and Alexander Shvets' *Refactoring Guru*; their catalog is not bundled.

## Workflow

1. **Detect the stack** from build files (`pom.xml`, `build.gradle`, `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml` and similar) and honor its language version and idioms.
2. **Diagnose first**: name the smell from code evidence before choosing a technique.
3. **Select the technique**: when several compete, apply [references/selection-heuristics.md](references/selection-heuristics.md) in order.
4. **Adapt to the language**: when a technique relies on a feature the language lacks (inheritance in Go or Rust, for example), use the idiomatic alternative and say so.
5. **For Java**: read [references/java-notes.md](references/java-notes.md), honor Java 8 versus Java 11+ API availability, and report its Java completion gate verdict.
6. **Apply incrementally**: small steps; test after each change. Commit only when explicitly authorized by the user.
7. **Explain WHY** each refactoring improves the code, not just HOW.

## Focused Diagnostic Review

Read [references/smell-lenses.md](references/smell-lenses.md) only when diagnosing long methods, God Objects/Large Classes, or spaghetti code; apply only the matching sections. Preserve their evidence, characterization-test and incremental-change safeguards. A review-only request returns findings in the calling agent's output contract (or `no_findings`), not implementation; the workflow steps require the user's change authorization.

## Pattern Landings

Some techniques, taken to completion, land the code on a design pattern (Replace Conditional with Polymorphism on Strategy/State, Replace Constructor with Factory on Factory Method, Introduce Special Case on Null Object). Read the direction technique→pattern, never pattern→technique: if the smell evidence does not call for the technique, the pattern has no entry point. To judge whether the pattern is worth it at all, read [../jag-patterns/references/pattern-selection.md](../jag-patterns/references/pattern-selection.md).

## Key Principles

These principles underpin every technique:

1. **Names matter more than length** — a well-named 1-line function is better than an inline expression
2. **Small steps** — extract small fragments and test. Commit only when explicitly authorized by the user
3. **Intention over implementation** — code should communicate WHAT, not HOW
4. **Data and logic that change together should live together** — cohesion is king
5. **Prefer composition over inheritance** — delegation is more flexible than extends
6. **Immutability is a powerful preservative** — immutable data is easier to reason about
7. **CQS (Command-Query Separation)** — a function either returns a value or modifies state, never both

## Reference Files

| File | Content |
|---|---|
| `references/selection-heuristics.md` | Ordered decision rules when several techniques compete: conditionals tree, smell directionality, falsifiable micro-tests, inheritance→delegation triggers |
| `references/java-notes.md` | Java-specific constraints, Java 8 vs 11+ notes, and the Java completion gate |
| `references/smell-lenses.md` | Conditional small-function, God Object and spaghetti-code review criteria |
