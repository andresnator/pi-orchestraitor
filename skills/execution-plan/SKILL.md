---
name: execution-plan
description: "Trigger: execution plan, executable plan, deep plan. Draft one verifiable plan for sequential execution in Pi."
license: MIT
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "1.0.0"
  modification_notice: "Modified for Pi by pi-orchestraitor."
  author: andresnator
  version: "1.1.1"
  status: testing
---

## Contract

Create exactly one plan for the requested outcome. The plan may be small or large. Use `assets/plan-template.md`.

## Rules

- Use short complete sentences. Keep paths, symbols, commands, URLs, technical terms, numbers, and Markdown exact.
- Omit empty sections and filler. Keep the artifact clear to a human; do not use cryptic A2A fragments inside it.
- Before writing, check the exact destination. Update an existing plan only when the user supplied its exact path or the active conversation already created or selected it. On any other slug collision, ask one closed choice: reuse the existing plan or generate a new slug. Never overwrite implicitly.
- Qualify behavior identifiers as `<capability>/<requirement>` when canonical specs matter. Use observable `WHEN` and `THEN` scenarios.
- Default delivery is unstaged working-tree changes. If the user explicitly requests a delivery field, write `Delivery: working-tree` once after the title. Record an explicit request for commits as a later user-directed step; this package does not provide automatic Git delivery or TCR.
- Do not make unsupported subagents, durable SDD, TCR, or independent verification required execution steps. Record such requirements as blockers and propose a compatible scope.
- Use ordered work groups with explicit dependencies. Keep one file even when groups span sessions.
- Every work group requires `Files:` and `Skills:`. Select names with `implementation-skill-routing`; use names, never paths.
- Keep delivery and Git skills out of `Work groups → Skills:`.
- Include `Execution guidance` with `Route: sequential`, a reason, and `/orchestraitor execute the plan <path>`.
- Write artifacts in English. Only the plan file may change; A plan is executed only after an explicit user instruction. Never edit production code, stage, commit, or push during planning.

## Self-check

- One file contains every required section from the template.
- Every claim is evidenced or explicitly marked as an open question.
- Every task is actionable and verifiable; behavior changes do not hide in tasks.
- Every work group names its implementation skills or `none`.
- `Delivery`, when present, appears once immediately after the title and reflects explicit user language.
- Dependencies are explicit and acyclic.
- Risks contain only real rollback conditions or execution hazards.

## Resource

- `assets/plan-template.md`
