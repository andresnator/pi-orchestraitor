# Dependency-Breaking Catalog (WELC)

Techniques from *Working Effectively with Legacy Code* (Feathers, ch. 9, 19, 25) for getting untested code into a test harness. These are testability moves, not design refactorings: they may leave scars that later Deep Plan work cleans up. Always pick the least invasive technique that lets a test run.

## Four strategies

| Strategy | Idea | Techniques |
|---|---|---|
| Accept & Adapt | Change what the code receives so a test can supply it | Adapt Parameter, Parameterize Method, Parameterize Constructor, Primitivize Parameter, Pass Null |
| Subclass & Override | Use inheritance to substitute behavior at test time | Subclass and Override Method, Extract and Override Call, Extract and Override Getter, Extract and Override Factory Method, Template Redefinition, Push Down Dependency |
| Inject & Delegate | Introduce an explicit substitution point | Extract Interface, Extract Implementer, Introduce Instance Delegator, Supersede Instance Variable, Encapsulate Global References, Replace Global Reference with Getter, Introduce Static Setter |
| Brute force / below-code seams | Substitute without editing the code at that point | Expose Static Method, Break Out Method Object, Definition Completion, Link Substitution, Text Redefinition |

Notes per technique (only where the choice is non-obvious):

- **Pass Null** — quickest way past a constructor argument the test never exercises; statically typed languages fail fast if it is actually used.
- **Extract Interface** — the safest, most portable seam; cost grows with the number of clients. When there are too many clients, fall back to Subclass and Override.
- **Subclass and Override Method** — the workhorse; requires the method to be overridable (non-final, non-private).
- **Extract and Override Factory Method / Getter** — for object creation buried in constructors or accessors; the getter variant is the fallback when the constructor cannot be touched.
- **Parameterize Constructor / Method** — turns a hidden `new` into an injected collaborator; keep the old signature delegating to the new one to avoid touching all callers.
- **Supersede Instance Variable** — replace an already-constructed collaborator after construction. Contraindicated when the real construction itself is dangerous (side effects on `new`): the harmful work already ran before you supersede.
- **Introduce Static Setter** — a scar on a singleton for test substitution. Requires disciplined cleanup (reset in tearDown) or tests poison each other.
- **Encapsulate Global References / Replace Global Reference with Getter** — first step for global/static state; the getter version enables Subclass and Override.
- **Break Out Method Object** — for monster methods: move the method into its own class where its locals become fields and it can be tested directly.
- **Definition Completion / Link Substitution / Text Redefinition** — link- and preprocessor-level seams; mostly C/C++ (classpath shadowing is the JVM analogue). Last resort when code cannot be edited.

## Instantiation blockers → technique

When the class cannot even be constructed in a test harness (WELC ch. 9):

| Blocker | Shape | Break it with |
|---|---|---|
| Irritating Parameter | Constructor wants something expensive/impossible (connection, service) | Pass Null; Extract Interface for the parameter type |
| Hidden Dependency | Constructor internally does `new` on a hard dependency | Parameterize Constructor; Extract and Override Factory Method |
| Construction Blob | Constructor builds a large object graph | Supersede Instance Variable (see contraindication above) |
| Onion Parameter | Building the parameter requires building its own parameters, recursively | Pass Null at the outermost layer that the test never exercises; Extract Interface to cut the chain |
| Global Dependency | Class reaches into singletons/globals | Introduce Static Setter; Encapsulate Global References |

## Relationship to the design catalog

The `refactor` skill's Fowler/Shvets catalog covers design-improving refactorings performed *with* tests; this catalog covers dependency-breaking performed *to get* tests. In one execution plan, these techniques appear in a prerequisite minimal-seams group before design refactoring begins.
