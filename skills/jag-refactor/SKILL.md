---
name: jag-refactor
description: "Select Fowler/Shvets refactoring techniques across languages; diagnose long methods/oversized functions, small functions/extraction, God Object/Large Class with too many collaborators, spaghetti code, temporal coupling and hidden side effects. Use for smells, SOLID, conditionals/classes/APIs or pasted code needing improvement; equivalent requests in any language apply."
license: MIT
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "2.1.1"
  modification_notice: "Modified for Pi by pi-orchestraitor."
  author: andresnator
  status: done
  version: "1.4.1"
---

# Refactoring Catalog (Multi-Language)

A comprehensive, technique-by-technique catalog of refactoring best practices for any language, sourced from Martin Fowler's *Refactoring: Improving the Design of Existing Code* (2nd Edition) and Alexander Shvets' *Refactoring in Java* (Refactoring Guru). Adapted for Python, TypeScript, Go, and Rust with idiomatic examples.

## Step 0: Detect Language

Before applying any technique, detect the project's stack:

| Project File | Language | Idiom Style |
|---|---|---|
| `pom.xml` / `build.gradle` | Java | OOP, Stream API |
| `pyproject.toml` / `requirements.txt` / `setup.py` | Python | Duck typing, comprehensions |
| `package.json` + `tsconfig.json` | TypeScript | Functional-OOP hybrid |
| `package.json` (no tsconfig) | JavaScript | Prototype-based, functional |
| `*.csproj` | C# | OOP, LINQ |
| `go.mod` | Go | Composition, implicit interfaces |
| `build.gradle.kts` | Kotlin | OOP + functional |
| `Gemfile` | Ruby | Duck typing, open classes |
| `composer.json` | PHP | OOP |
| `Cargo.toml` | Rust | Ownership, traits, no inheritance |
| `Package.swift` | Swift | Protocol-oriented |

If the language is **Java**, apply techniques with Java OOP, Stream API where appropriate, and the project's detected Java version constraints. Use `references/java-notes.md` for Java-specific constraints and the Java completion gate.

## Language Support Matrix

| Concept | Python | TypeScript | Go | Rust |
|---|---|---|---|---|
| Class / struct | `class` | `class` | `struct` + methods | `struct` + `impl` |
| Inheritance | `class Child(Parent)` | `extends` | Embedding (no inheritance) | Traits (no inheritance) |
| Interface / contract | `Protocol` / `ABC` | `interface` | `interface` (implicit) | `trait` |
| Encapsulation | `_private` convention | `private` keyword | Unexported (lowercase) | Private by default, `pub` |
| Polymorphism | Duck typing + ABC | Interfaces + classes | Implicit interfaces | Trait objects + generics |
| Generics | `typing.Generic[T]` | `<T>` | `[T any]` | `<T: Trait>` |
| Error handling | Exceptions | Exceptions | Error values (`error`) | `Result<T, E>` |
| Null safety | `None` / `Optional[T]` | `null` / `undefined` / `?` | `nil` (zero values) | `Option<T>` |
| Collections pipeline | Comprehensions / generators | Array methods (`.map`, `.filter`) | `for range` (no pipeline) | Iterator chain (`.filter().map()`) |
| Pattern matching | `match` (3.10+) | `switch` (no pattern matching) | `switch` (no pattern matching) | `match` (exhaustive) |
| Factory pattern | `@classmethod` / module function | Static method / function | `NewXxx()` function | `Type::new()` associated fn |
| Builder pattern | `__init__` + kwargs / dataclass | Fluent builder class | Functional options | Builder with consuming `self` |

For detailed concept-to-language mappings, see `references/language-idioms.md`.

## Core Philosophy

**Refactoring is the process of changing the internal structure of code without altering its observable behavior.** It is a disciplined technique, not a random cleanup. The golden rule is: Cover → Modify → Refactor (always have tests before you start).

## How to Use This Skill

1. **Detect** the language (Step 0 above)
2. **Diagnose first**: Identify the code smell (see `techniques/00-code-smells-diagnostic.md`)
3. **Check applicability**: See `references/language-applicability.md` for technique availability per language
4. **Select technique**: Each smell maps to one or more refactoring techniques; when several compete, use `references/selection-heuristics.md` for the ordered decision rules
5. **Read the technique file**: Each technique has multi-language examples (Python, TypeScript, Go, Rust)
6. **For Java**: Read `references/java-notes.md`, use Java OOP/Stream idioms, honor Java 8 versus Java 11+ API availability, and finish with the Java completion gate
7. **For language idiom mapping**: See `references/language-idioms.md`
8. **Apply incrementally**: Small steps; test after each change. Commit only when explicitly authorized by the user

## Focused Diagnostic Review

Read [references/smell-lenses.md](references/smell-lenses.md) only when diagnosing long methods, God Objects/Large Classes, or spaghetti code; apply only the matching sections. Preserve their evidence, characterization-test and incremental-change safeguards. A review-only request returns findings in the calling agent's output contract (or `no_findings`), not implementation; the application steps below require the user's change authorization.

## Technique Categories

Read `references/technique-catalog.md` only when the diagnostic does not identify a technique or when browsing alternatives. Read only the selected technique files, not the whole catalog.

## Diagnostic Guide

Start with `techniques/00-code-smells-diagnostic.md` to identify which techniques apply to your code. The diagnostic maps 24 code smells to their recommended refactoring techniques.

## Applying the Skill

When given code to refactor:

1. Detect the language (Step 0)
2. Read `techniques/00-code-smells-diagnostic.md` to identify the smells present
3. For each identified smell, read the corresponding technique file(s)
4. Check `references/language-applicability.md` — if the technique doesn't apply to the target language, the table shows the alternative
5. Apply techniques in small steps, always testing between changes
6. Provide idiomatic examples for the detected language
7. Explain WHY each refactoring improves the code, not just HOW to do it
8. For Java, report the `references/java-notes.md` Java completion gate verdict
9. For language-specific idiom translations, consult `references/language-idioms.md`

## Key Principles

These principles underpin every technique in the catalog:

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
| `references/language-idioms.md` | Refactoring concept → {Python, TypeScript, Go, Rust} equivalents |
| `references/language-applicability.md` | 62-technique × language applicability matrix with alternatives |
| `references/java-notes.md` | Java-specific constraints, Java 8 vs 11+ notes, and the Java completion gate |
| `references/smell-lenses.md` | Conditional small-function, God Object and spaghetti-code review criteria |
| `references/selection-heuristics.md` | Ordered decision rules when several techniques compete: conditionals tree, smell directionality, falsifiable micro-tests, inheritance→delegation triggers |
| `references/technique-to-pattern.md` | Which refactoring techniques land on which GoF pattern (Kerievsky bridge) |
