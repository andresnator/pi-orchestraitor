---
name: jag-practices
description: "Review clean-code quality, KISS/YAGNI, overengineering/speculative abstractions, DRY duplication, naming/identifiers/readability, maintainability, SRP/single responsibility, cohesion/coupling, circular dependencies and mixed layers across languages."
license: MIT
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "2.1.1"
  modification_notice: "Modified for Pi by pi-orchestraitor."
  author: andresnator
  status: backlog
  version: "1.1.1"
---

# Skill: jag-practices

## Activation Contract

Use this skill when asked to review, explain, or improve general programming practices across languages: readability, maintainability, duplication, cohesion, coupling, naming, simplicity, and safe evolution.

Do **not** use this skill when the request is only formatting, framework setup, performance tuning, security auditing, testing, or language-specific API usage with no broader design-quality question.

## Responsibility

This skill teaches a bounded code-quality review workflow. It does not choose tools, call other skills, rewrite whole systems, or replace domain requirements supplied by the user.

## Required Context

- Target language and code snippet/files, if available.
- Intended behavior and current pain point.
- Constraints: legacy-code safety, public API compatibility, deadline, or team conventions.
- Whether the user wants diagnosis only or an improvement plan.

## Context Budget

- Keep this `SKILL.md` focused on the executable contract.
- Use `references/principles.md` only when the request needs deeper tradeoff language.
- Read [references/review-lenses.md](references/review-lenses.md) only when reviewing simplicity, duplicated knowledge, naming, single responsibility, or cohesion/coupling; apply only the matching sections.

## Hard Rules

- Prefer clarity over cleverness.
- Treat DRY as “avoid duplicating knowledge,” not “remove every repeated line.”
- Do not recommend abstractions before identifying a stable concept or repeated reason to change.
- Preserve observable behavior unless the user explicitly asks for behavior change.
- Name tradeoffs: simplicity, coupling, cohesion, testability, discoverability, and change cost.
- Ask one clarifying question only when missing context could change the recommendation materially.

## Decision Gates

| Condition | Action |
|---|---|
| Code is hard to read but behavior is clear | Recommend naming, extraction, structure, and intent-revealing changes. |
| Duplication exists | Classify it as duplicated knowledge, coincidental repetition, or premature abstraction risk. |
| User asks for “best practices” with no code | Give a principle map and ask for code/context before prescribing changes. |
| Proposed improvement adds indirection | Justify the indirection with a real change scenario or reject it. |

## Execution Steps

1. Identify the code’s purpose and current change pressure.
2. Separate readability issues from design issues.
3. Classify duplication and abstraction opportunities.
4. Recommend the smallest behavior-preserving improvement first.
5. Explain the tradeoff and what not to change yet.
6. Return a prioritized plan or focused review.

## Output Contract

For a focused review inside another request, use the calling agent's output contract, cite evidence or mark hypotheses, and return `no_findings` when there is no material issue. Otherwise return:

- Summary verdict: `healthy`, `needs_cleanup`, or `design_risk`.
- Top issues, ordered by impact.
- Recommended changes with reasoning.
- Tradeoffs and risks.
- One next step.

## References

- `references/principles.md` — Core principles and tradeoff language.

## Assets

- None.
