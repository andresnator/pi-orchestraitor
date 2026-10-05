---
name: architecture-ideation
description: "Explore refactors, target architecture, patterns, modular monoliths and restructuring; produce an ADR and neutral plan."
license: MIT
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "1.0.0"
  modification_notice: "Modified for Pi by pi-orchestraitor."
  author: andresnator
  version: "4.0.0"
  status: testing
---

## Contract

Design architecture-level change from verified state. Class or method refactors belong to Deep Plan. Write only one ADR and one plan; never edit source, commit, or push.

## Flow

1. Establish evidenced current architecture.
2. Shape modules from domain boundaries, not folders.
3. Compare 2-3 candidates by forces, trade-offs, migration cost, first reversible step. Recommend one; microservices must justify operational cost.
4. Converge on boundaries, incremental migration; no big bang.
5. Record decision and rejected candidates in one ADR.
6. Load `execution-plan` and `implementation-skill-routing`. Write one `.ai/architect/plans/<slug>.md`. Record selected names per work group. Group 1 creates fitness-function guardrails; later groups keep the build green.

Patterns need evidenced forces plus pragmatic and KISS gates. Each work item maps to an ADR decision or architecture gap and names real files. Return the chosen architecture, ADR path, plan path, first reversible step, and `/orchestraitor execute the plan <path>`.
