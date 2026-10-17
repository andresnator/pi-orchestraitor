---
name: jag-evidence
description: "Discover repository evidence and decisions for deep, evidence-first planning."
disable-model-invocation: true
license: MIT
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "2.0.0"
  modification_notice: "Modified for Pi by pi-orchestraitor."
  author: andresnator
  status: in-progress
  version: "5.0.4"
---

## Contract

Plan before implementation. Read relevant code and contracts; never edit production code, build, install, test, commit, or push. Planning artifacts are the only writes.

## Method

1. **Evidence first.** Verify implementations, callers, tests, tool versions, and reusable `path:symbol` elements. Cite `path:line` or mark `hypothesis`. Code proves current behavior, not business requirements. Record business rules, compliance, SLAs, pricing, retention, priorities or target users found in code as open questions until the user or an authoritative product document confirms them.
2. **Ask only decisions.** Explore repository facts. Ask each unresolved open-ended scope, product, acceptance, or risk choice directly in normal chat and wait. Add `Recommendation: ...` only when useful; use an available Pi UI choice mechanism for closed choices, or ask in chat.
3. **Validate edges.** Every edge is handled, out of scope, or an open question. Use `references/edge-validation.md`.
4. **Stay proportional.** Keep only information that changes execution; record meaningful rejected alternatives briefly.
5. **Prove the flow.** End with executable commands or an observable end-to-end check and its expected result.

## Wayfinder discovery

Use `assets/discovery-template.md`. Write one `.ai/deep-planner/discoveries/<slug>.md`. Do not add status, phase, or readiness markers. Keep evidence and decisions current. A precise question remains an open question even when blocked; record its prerequisite when useful. Put in-scope areas that cannot yet be phrased as a precise question under **Not yet specified**, without prematurely decomposing them. Keep **Out of scope** separate; out-of-scope work returns only through a user-approved scope change. Move a vague area into open questions only when a precise question emerges, without duplicating it. Preserve the three edge dispositions above; no tracker, claims, scheduler or second discovery artifact. Resolve relevant business questions and clarify relevant unspecified areas before proposing a final executable plan. When the destination is clear, suggest converting the discovery into a plan.

## Deep Plan

Load `jag-plan` and write one `.ai/deep-planner/plans/<slug>.md`. Large efforts remain one plan with ordered steps. Do not create roadmaps, slices, readiness markers, or companion phase documents.

## Outputs

- Wayfinder: one discovery file and no plan.
- Deep Plan: one plan file and no discovery, roadmap, or change file.

Before returning, check evidence, edges, proportionality, exact paths, and end-to-end verification. Report only the artifact path and next route.

## Resources

- `assets/discovery-template.md`
- `references/edge-validation.md`
- `references/question-economy.md`
