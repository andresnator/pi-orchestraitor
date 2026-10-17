---
name: jag-arch-ideas
description: "Explore architecture changes; survey candidates on request, or design a chosen change with an ADR and plan."
license: MIT
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "2.0.0"
  modification_notice: "Modified for Pi by pi-orchestraitor."
  author: andresnator
  version: "4.1.1"
  status: testing
---

## Contract

Design architecture-level change from verified state. Class or method refactors belong to Deep Plan. Never edit source, commit, or push.

## Select the Mode

For an explicit survey or candidate-review request (including equivalent wording in the user's language), follow [references/candidate-survey.md](references/candidate-survey.md) and stop after presenting candidates. Return inline unless saving the survey is explicitly requested; do not create an ADR or plan. If the requested mode is unclear, ask one focused question before writing artifacts.

Design mode retains one ADR and one plan for a requested architecture design. Use the flow below; selecting a survey candidate alone does not authorize design artifacts or implementation.

## Design Flow

1. Establish evidenced current architecture.
2. Shape modules from domain boundaries, not folders.
3. Compare 2-3 candidates by forces, trade-offs, migration cost, first reversible step. Recommend one; microservices must justify operational cost.
4. Converge on boundaries, incremental migration; no big bang.
5. Record decision and rejected candidates in one ADR.
6. Load `jag-plan`. Write one `.ai/architect/plans/<slug>.md`. Step 1 creates fitness-function guardrails; later steps keep the build green.

Patterns need evidenced forces plus pragmatic and KISS gates. Each work item maps to an ADR decision or architecture gap and names real files. Return the chosen architecture, ADR path, plan path, first reversible step, and `/orchestraitor execute the plan <path>`.
