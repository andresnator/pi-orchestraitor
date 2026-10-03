---
name: general-naming-readability
description: "Trigger: naming, readability, identifiers, intent, clarity. Evaluate naming and readability with language-neutral principles."
license: Apache-2.0
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "1.0.0"
  modification_notice: "Modified for Pi by pi-orchestraitor."
  author: gentle-ai
  adapted_by: andresnator
  source: gentle-ai/plan-refactor
  version: "1.0.0"
  status: in-progress
---

Load this skill when reviewing refactor plans for naming and readability in languages without a dedicated naming skill.
## Review goals

- Prefer names that reveal intent and domain meaning.
- Flag misleading abbreviations, overloaded terms, and hidden units or formats.
- Distinguish readability issues from purely stylistic preferences.
- Avoid mass renames unless the evidence shows concrete maintenance benefit.

## Confidence rules

- Use high confidence only when the issue is directly visible from the code or symbol names.
- Lower confidence when the recommendation depends on ecosystem or language-specific naming conventions that are not proven in the repository.
- If the code is too small or names are already clear, return no findings instead of inventing polish work.

## Output notes

- Evidence must cite concrete file/line/symbol examples.
- Cosmetic-only rename suggestions belong out of executable work unless maintainability value is explicit.
