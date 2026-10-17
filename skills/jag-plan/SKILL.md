---
name: jag-plan
description: "Draft a short, verifiable plan for a change before implementing it."
license: MIT
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "2.0.0"
  modification_notice: "Modified for Pi by pi-orchestraitor."
  author: andresnator
  version: "2.0.0"
  status: testing
---

## Contract

Write one plan for the requested outcome with `assets/plan-template.md`. Keep it as short as the change allows; it states intent and checks, not a script for the executor.

## Rules

- Use short complete sentences. Keep paths, symbols, commands and technical terms exact. Omit empty sections and filler.
- Before writing, check the destination. Update an existing plan only when the user supplied its path or this conversation created it; on any other collision, ask whether to reuse it or pick a new name.
- Steps are small and verifiable. Name files or skills only when they help the executor.
- Write in English. Only the plan file may change; never edit code, stage, commit or push while planning. The plan runs only after an explicit user instruction.

## Self-check

- Every claim is evidenced or marked as an open question.
- Business requirements cite the user or a product document, not code.
- Required behavior avoids "correctly", "securely", "fast", "robust" or "intuitive" unless it states observable evidence; otherwise mark it as human review.
- Risks contain only real rollback conditions or execution hazards.

## Resource

- `assets/plan-template.md`
