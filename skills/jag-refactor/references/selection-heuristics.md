# Selection Heuristics

Ordered decision rules for when several techniques compete. Diagnose the smell from code evidence first; this file decides *which technique first*.

## Conditionals: decision order

Work down this list and stop at the first match:

1. The condition is validation or an edge case guarding the real work → **Guard Clauses**.
2. Several branches produce the same result or check fragments of one rule → **Consolidate Conditional**.
3. The branching key is a type code — the type determines the behavior → **Replace Conditional with Polymorphism**.
4. The checks are null/absent-object checks repeated across callers → **Introduce Special Case / Null Object**.
5. The conditional is complex but not type-driven → **Decompose Conditional**.

## Smell directionality (differential diagnosis)

Direction distinguishes look-alike smells and picks the technique:

- **Divergent Change** — many kinds of change hit ONE class → split it (Extract Class, Split Phase). A within-class SRP problem.
- **Shotgun Surgery** — ONE kind of change touches MANY classes → gather the knowledge (Move Method, Move Field, Inline Class). Cross-class; high regression risk because it is easy to forget one affected class — weigh this in risk gates.
- **Feature Envy** — one-directional: a method uses another object's data more than its own → a *placement* problem (Move Method).
- **Inappropriate Intimacy** — bi-directional: two classes reach into each other → a *mutual design* problem (Move Method/Field toward one side, Extract Class, or Change Bidirectional Association to Unidirectional).

## Falsifiable micro-tests

Quick tests that turn "smells bad" into a checkable claim:

- **Long method**: more than ~10 lines deserves the question; the answer is a named extraction, not a rule violation.
- **Long parameter list**: more than 3-4 parameters → Introduce Parameter Object.
- **Data clumps**: remove one value of the suspected group — if the others lose meaning, it is a clump → Introduce Parameter Object / Extract Class. If they still make sense alone, it is harmless similarity.
- **Middle man**: the class delegates almost everything and adds no value of its own → Remove Middle Man. If it adds access control, defaults, or translation, it earns its keep.

## Inheritance → delegation triggers

Apply Replace Subclass/Superclass/Inheritance with Delegate when:

- the subclass uses only a fraction of the inherited surface (the Stack-extends-Vector shape), or
- the subclass violates substitutability — callers of the parent would break on the child, or
- independent dimensions of variation are multiplying subclasses: N independent axes force ~2^N leaf classes → model each axis as a composed collaborator instead (delegation; at pattern level this becomes Strategy/Bridge).
