# Fitness Function Catalog

Choose the smallest guardrail protecting an evidenced boundary. Every proposal names its verification command.

## Go

- Go toolchain: package import cycles are rejected while loading packages. Verify with `go list ./...`.
- go-arch-lint: component boundaries and allowed dependency directions declared in `.go-arch-lint.yml`. Verify with `go-arch-lint check`.

## Java

- ArchUnit: no package cycles and allowed layer dependencies. Verify with `mvn test` or `./gradlew test`.
- Spring Modulith `ApplicationModules.of(Application.class).verify()`: module boundaries and cycles for Spring modular monoliths. Verify with `mvn test`.

## JavaScript and TypeScript

- dependency-cruiser: forbid circular dependencies and disallowed layer imports. Verify with `npx depcruise src --config .dependency-cruiser.cjs`.

## Python

- import-linter: `layers`, `independence`, or `forbidden` contracts. Verify with `lint-imports`.

## Order

1. No cycles between modules.
2. Allowed dependencies only.
3. Isolation for evidenced bounded contexts.
4. Size or complexity gates only when a measured gap justifies them.
