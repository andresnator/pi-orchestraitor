---
description: Review a concrete scope without modifying it
argument-hint: "<files, diff, or scope>"
---
Review only the supplied scope. If it is missing, ask for the target before reviewing.
Inspect source and relevant checks without changing files or Git state. Load jag-practices only if available and relevant.
Return evidence-backed findings with path:line, severity, concrete failure and fix intent; then a brief verdict and checks performed. Distinguish correctness defects from preferences. Do not fix findings unless the user separately authorizes implementation.
This is a single-session review, not blind dual review or independent verification.

Scope: $ARGUMENTS

Before reviewing, record the repository's canonical directory, base commit/reference, reviewed target, and included paths. For uncommitted work, capture SHA-256 content fingerprints (including relevant untracked/new files and deletion markers); HEAD alone does not identify a working-tree change. Record staged and unstaged scope separately when applicable.
Before the verdict, recheck the same scope and fingerprints. If content changed, review the changed content or mark the verdict stale and state the gap.
For every finding, label evidence as observed or inferred, explain the supporting observation, and classify its origin as introduced, aggravated, pre-existing, or unknown. Compare against the base before attributing a defect to this change. State any base or verification limitations.
