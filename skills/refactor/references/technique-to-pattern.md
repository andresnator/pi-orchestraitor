# Technique → Pattern Bridge

Some techniques in this catalog, taken to completion, land the code on a GoF pattern. Knowing the landing spot keeps the refactor honest: you introduce the pattern because a sequence of evidence-driven steps arrived there, not because the pattern was the goal ("refactoring to patterns", Kerievsky). Pair with the `design-patterns-pragmatic` skill for whether the pattern is worth it at all.

| Technique | Lands on | When the landing is right |
|---|---|---|
| Replace Conditional with Polymorphism (31) | Strategy / State | Type-driven branching; State when the type changes over the object's lifetime, Strategy when the caller picks it |
| Form Template Method (52) | Template Method | Stable algorithm skeleton, varying steps — check the inheritance cost first |
| Replace Constructor with Factory (43) | Factory Method | Creation must vary by type/family or hide the concrete class |
| Introduce Special Case (32) | Null Object | Repeated null checks with a sensible default behavior |
| Replace Inheritance with Delegation (55) | Decorator / Proxy | The wrapper adds behavior around a stable interface (Decorator) or controls access (Proxy) |
| Replace Function with Command (44) | Command | The operation needs queuing, undo, or logging as data |
| Combine Functions into Transform (57) | — enrichment pipeline | Derived data computed in one place; no pattern needed, resist the urge |
| Hide Delegate (12) | Facade (at module scale) | Many clients navigating the same object chain |

Direction matters: the table reads technique→pattern, never pattern→technique. If the smell evidence does not call for the technique, the pattern has no entry point.
