---
description: Review a concrete scope without modifying it
argument-hint: "<files, diff, or scope>"
---
Review only the supplied scope. If it is missing, ask for the target before reviewing.
Inspect source and relevant checks without changing files or Git state. Load programming-practices-core only if available and relevant.
Return evidence-backed findings with path:line, severity, concrete failure and fix intent; then a brief verdict and checks performed. Distinguish correctness defects from preferences. Do not fix findings unless the user separately authorizes implementation.
This is a single-session review, not blind dual review or independent verification.

Scope: $ARGUMENTS
