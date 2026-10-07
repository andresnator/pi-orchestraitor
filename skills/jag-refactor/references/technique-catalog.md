## Technique Categories

The techniques are organized in 7 groups. Each technique has its own file in the `techniques/` directory.

### Group 1: Composing Methods (techniques/01-XX)
Techniques for building clean, well-structured methods. The foundation of all refactoring.
- `01-extract-method.md` — Extract a code fragment into a named function
- `02-inline-method.md` — Replace a function call with the function body
- `03-extract-variable.md` — Give a name to a complex expression
- `04-inline-variable.md` — Remove a variable that adds no clarity
- `05-replace-temp-with-query.md` — Replace temp variables with function calls
- `06-replace-method-with-method-object.md` — Turn a complex function into its own class/struct
- `07-substitute-algorithm.md` — Replace an algorithm with a clearer version

### Group 2: Moving Features (techniques/02-XX)
Techniques for placing code where it truly belongs.
- `08-move-method.md` — Move a function to where it has more cohesion
- `09-move-field.md` — Move a field to the type that uses it most
- `10-extract-class.md` — Split a type with multiple responsibilities
- `11-inline-class.md` — Merge a type that does too little
- `12-hide-delegate.md` — Encapsulate chain navigation behind a simpler interface
- `13-remove-middle-man.md` — Remove unnecessary delegation
- `14-move-statements.md` — Move statements into/out of functions, slide statements
- `15-split-loop.md` — Separate a loop that does multiple things
- `16-replace-loop-with-pipeline.md` — Use declarative pipelines instead of imperative loops
- `17-remove-dead-code.md` — Delete unused code

### Group 3: Organizing Data (techniques/03-XX)
Techniques for enriching data with behavior and protecting internal state.
- `18-encapsulate-variable.md` — Wrap data access with getters/functions
- `19-encapsulate-record.md` — Convert data structures into objects/structs
- `20-encapsulate-collection.md` — Protect collections from external mutation
- `21-replace-primitive-with-object.md` — Create domain types instead of using raw primitives
- `22-split-variable.md` — Give each purpose its own variable
- `23-rename-field.md` — Improve field names for clarity
- `24-replace-derived-variable-with-query.md` — Calculate values on demand
- `25-change-reference-to-value.md` — Make objects immutable (Value Objects)
- `26-change-value-to-reference.md` — Share a single instance across consumers
- `27-replace-type-code-with-subclasses.md` — Convert type codes to polymorphic hierarchy

### Group 4: Simplifying Conditionals (techniques/04-XX)
Techniques for taming conditional complexity.
- `28-decompose-conditional.md` — Name condition and branches
- `29-consolidate-conditional.md` — Merge related conditions
- `30-replace-nested-conditional-with-guard-clauses.md` — Early returns for special cases
- `31-replace-conditional-with-polymorphism.md` — Use polymorphism instead of switch/if-type
- `32-introduce-special-case.md` — Null Object pattern for default behavior
- `33-introduce-assertion.md` — Document invariants with executable assertions
- `34-replace-control-flag.md` — Replace boolean flags with break/return

### Group 5: Simplifying Method Calls / API Design (techniques/05-XX)
Techniques for building self-documenting interfaces.
- `35-change-function-declaration.md` — Rename functions and change parameters
- `36-introduce-parameter-object.md` — Group related parameters into an object
- `37-parameterize-function.md` — Unify similar functions with a parameter
- `38-remove-flag-argument.md` — Replace boolean params with named functions
- `39-preserve-whole-object.md` — Pass the object instead of extracted values
- `40-replace-parameter-with-query.md` — Let the function calculate what it needs
- `41-replace-query-with-parameter.md` — Pass value as param for purity/testability
- `42-remove-setting-method.md` — Make properties read-only
- `43-replace-constructor-with-factory.md` — Use factory functions for flexible creation
- `44-replace-function-with-command.md` — Encapsulate function as object
- `45-separate-query-from-modifier.md` — CQS: separate reads from writes

### Group 6: Dealing with Generalization (techniques/06-XX)
Techniques for refactoring type hierarchies and shared behavior.
- `46-pull-up-method.md` — Move duplicated functions to shared parent/trait/interface
- `47-push-down-method.md` — Move specialized functions to specific types
- `48-pull-up-constructor-body.md` — Unify constructor/initialization logic
- `49-extract-superclass.md` — Create common parent for shared behavior
- `50-extract-interface.md` — Define a contract without implementation
- `51-collapse-hierarchy.md` — Merge unnecessary hierarchy levels
- `52-form-template-method.md` — Template Method pattern
- `53-replace-subclass-with-delegate.md` — Composition over inheritance
- `54-replace-superclass-with-delegate.md` — Replace extends with has-a
- `55-replace-inheritance-with-delegation.md` — General inheritance to delegation

### Group 7: Additional Techniques (techniques/07-XX)
Cross-cutting techniques from both sources.
- `56-combine-functions-into-class.md` — Group functions that share data
- `57-combine-functions-into-transform.md` — Enrich read-only data
- `58-split-phase.md` — Separate code into processing phases
- `59-introduce-foreign-method.md` — Extend third-party types you can't modify
- `60-introduce-local-extension.md` — Wrapper or subclass for library extension
- `61-replace-error-code-with-exception.md` — Modernize error handling
- `62-replace-exception-with-test.md` — Don't use exceptions for control flow

