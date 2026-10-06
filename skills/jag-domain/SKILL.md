---
name: jag-domain
description: "Define domain terminology and ubiquitous language; record domain-model architecture decisions."
license: MIT
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "3.0.0"
  modification_notice: "Modified for Pi by pi-orchestraitor; changed default output roots and added explicit write/canonical-document boundaries."
  author: Matt Pocock
  adapted_by: Agents Orchestrator maintainers
  pi_adapted_by: pi-orchestraitor
  source: https://github.com/mattpocock/skills
  upstream_name: domain-modeling
  upstream_version: "1.0.4"
  consulted_source_path: "skills/engineering/domain-modeling/SKILL.md"
  consulted_source_revision: "6fd947921b935b7e1e69293a200400f0fdd5c15f"
  status: testing
  version: "2.0.0"
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline — challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* `CONTEXT.md` for vocabulary is not this skill — that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## Authorization and canonical documents

Inspect existing root/context `CONTEXT.md`, `CONTEXT-MAP.md`, glossaries, maps and ADR conventions before writing. Reference the authoritative documents wherever they live. If locations conflict or authority is unclear, ask which is canonical before a write; never create a competing glossary automatically.

Read-only explanation, planning and review requests remain inline. A resolved term does not itself authorize documentation changes. Only create/update a document within explicitly authorized scope. Never move, delete or relocate existing documents automatically; this skill changes defaults, not existing artifacts.

## File structure

With no conflicting canonical document, a single context defaults to `.ai/domain/CONTEXT.md`. Multiple contexts default to `.ai/domain/CONTEXT-MAP.md` with vocabulary under `.ai/domain/contexts/<context>/CONTEXT.md`:

```text
.ai/
├── domain/
│   ├── CONTEXT.md                  # single-context alternative
│   ├── CONTEXT-MAP.md              # multiple-context alternative
│   └── contexts/
│       ├── ordering/CONTEXT.md
│       └── billing/CONTEXT.md
└── adr/
    ├── 0001-event-sourced-orders.md
    └── 0002-postgres-for-write-model.md
```

Do not create both alternatives by default. The map points to each context and its relationships. Scope an ADR explicitly to a context when relevant; keep decisions separate from vocabulary.

Create files lazily — only after a term or qualifying decision is resolved and documentation writes are authorized. Create `.ai/domain/` for the first term and `.ai/adr/` for the first ADR only when no authoritative competing destination exists. Inspect target files and never overwrite implicitly.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Capture resolved vocabulary

When a term is resolved and documentation edits are authorized, update the canonical `CONTEXT.md` promptly. Otherwise present the proposed definition inline. Use the format in [CONTEXT-FORMAT.md](./assets/CONTEXT-FORMAT.md).

`CONTEXT.md` should be totally devoid of implementation details. Do not treat `CONTEXT.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Offer the decision first and write only when authorized, using [ADR-FORMAT.md](./assets/ADR-FORMAT.md) and the canonical ADR destination (default `.ai/adr/NNNN-<slug>.md`). Leave `jag-adr` and unrelated documentation untouched.

## Attribution

Original skill by Matt Pocock from <https://github.com/mattpocock/skills>.
