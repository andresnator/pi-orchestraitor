# Pattern Forces, Contraindications, and Relations

Companion to `pattern-selection.md`. Three lenses that keep pattern advice honest: what redesign pressure calls for a pattern, when a specific pattern is the wrong answer, and how patterns combine.

## Redesign causes → candidate patterns (GoF §1.6)

| Cause of redesign | Candidate patterns |
|---|---|
| Creating an object by naming its concrete class | Abstract Factory, Factory Method, Prototype |
| Dependence on specific operations | Chain of Responsibility, Command |
| Dependence on hardware/software platform | Abstract Factory, Bridge |
| Dependence on object representation or implementation | Abstract Factory, Bridge, Memento, Proxy |
| Algorithmic dependencies (algorithm likely to change) | Strategy, Template Method, Visitor, Iterator |
| Tight coupling between classes | Facade, Mediator, Observer, Chain of Responsibility |
| Extending functionality only by subclassing | Bridge, Composite, Decorator, Observer, Strategy |
| Inability to alter classes conveniently (closed/third-party source) | Adapter, Decorator, Visitor |

Use the table as a checklist over the *evidence of change pressure*, never as permission to pre-install flexibility.

## What each pattern encapsulates

A pattern earns its cost by isolating one concept that varies. If that concept is not actually varying, the pattern is decoration:

- Strategy → the algorithm. Composite → the simple/composite distinction. Bridge → the low-level implementation. Abstract Factory → the product family. Decorator → additive responsibilities. Iterator → the traversal. Visitor → operations over a stable hierarchy. Observer → who reacts to a change.

## Per-pattern contraindications (when NOT)

- **Singleton**: hides dependencies (invisible coupling through global access), carries two responsibilities (instance control + its real job), hinders mocking and test isolation, needs multi-thread care. Justified only for a genuinely shared resource with a single source of truth — prefer one instance wired by injection.
- **Strategy**: overkill when the branches never change independently or there are only two stable cases — a conditional is cheaper to read.
- **Template Method**: pays the inheritance tax (fragile base class, one axis of variation only); prefer composition/Strategy when steps vary independently.
- **Decorator**: stacks are hard to debug and order-sensitive; wrong when the "layers" never combine at runtime.
- **Visitor**: wrong when the element hierarchy still changes — it freezes the hierarchy to free the operations. Right only with a stable hierarchy and growing operations.
- **Factory / Abstract Factory**: unnecessary while there is a single product or family; a constructor is not a design flaw.
- **Observer**: implicit control flow — hard to trace who fires what; wrong for essential, ordered workflows that deserve explicit orchestration.

## Relations and combinations

- **Abstract Factory vs Bridge**: two different portabilities that can coexist — AF varies *which family* of objects gets created; Bridge varies *the implementation beneath* a stable abstraction.
- **Iterator + Visitor**: traversal and operation split cleanly — Iterator owns the walk, Visitor owns what happens at each node.
- **Facade → Singleton**: facades and abstract factories are often the legitimate single instances.
- **MVC** is a combination, not a pattern: Observer (view updates) + Composite (nested views) + Strategy (controller behavior).
- **Composite + Decorator** share shape (recursive wrapping) but differ in intent: aggregation vs augmentation; they combine well over the same component interface.

## Timing (Foote's phases)

Designs pass through prototyping (inheritance-heavy, white-box, exploratory) → expansion → consolidation (refactoring toward composition, black-box). Patterns are a *target for refactoring in the consolidation phase* — when real variation is proven — not a scaffold to erect during prototyping. This is the pattern-level restatement of KISS/YAGNI.
