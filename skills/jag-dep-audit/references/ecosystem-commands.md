# Ecosystem Audit Matrix

Use current advisory output when available. Inventory fallbacks never prove safety, vulnerability, freshness, or EOL status.

| Ecosystem | Evidence | Authorized audit | Inventory-only fallback |
|---|---|---|---|
| npm | `package.json`, `package-lock.json` | `npm audit --json` | Record declared and locked versions. |
| pnpm | `package.json`, `pnpm-lock.yaml` | `pnpm audit --json` | Record declared and locked versions. |
| yarn | `package.json`, `yarn.lock` | `yarn audit --json` | Record declared and locked versions. |
| Maven | `pom.xml` | `osv-scanner scan source -r .`; `mvn dependency:tree` is inventory only | Record properties and resolved tree when authorized. |
| Gradle | `build.gradle(.kts)`, version catalog | `osv-scanner scan source -r .`; dependency reports are inventory only | Record catalog/build versions and dependency report when authorized. |
| Python | `pyproject.toml`, requirements, lockfiles | `pip-audit` or `osv-scanner scan source -r .` | Record declared and locked versions. |
| Go | `go.mod`, `go.sum` | `govulncheck -json ./...` | Record required module versions and checksums; `go.sum` is not a lockfile. |

Runtime declarations include Node `engines` or `.nvmrc`, Java compiler/toolchain properties, and Python `requires-python`. Without a current authoritative support source, report `support status: unverified` and name the required check.

For Go, `go.mod` declares the minimum Go version with `go` and may suggest a toolchain with `toolchain`.
