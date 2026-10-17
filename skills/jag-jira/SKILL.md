---
name: jag-jira
description: "Draft/refine Jira User Stories, Tasks and Spikes in Jira Markup: product outcomes, technical/maintenance/operational work, or research and investigation, with acceptance criteria and developer/SDD readiness. Supports optional section review."
disable-model-invocation: true
license: MIT
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "3.0.1"
  modification_notice: "Modified for Pi by pi-orchestraitor; merged the Jira User Story, Task and Spike skills and added optional section review."
  author: andresnator
  status: testing
  version: "3.0.2"
---

# Jira Ticket

## Scope

Generate Jira User Story, Task or Spike ticket content as Jira Markup in chat. This skill does not create Jira issues through the Jira API.

- A User Story describes a user capability and the benefit it provides.
- A Task describes bounded work with an expected outcome and verifiable completion criteria.
- A Spike is research work that answers a question, explores uncertainty, and produces evidence for a later decision.

## Optional Interactive Mode

Use only on explicit requests for `interactive mode`, `section by section`, or equivalent intent. Otherwise keep defaults below. In this mode, replace draft timing and question limits only; preserve templates, validation, evidence, language, format and save/publication rules.

1. Confirm section order. Reuse context; ask one missing-input question at a time and wait.
2. Draft one section. Request approval or edits; wait for explicit approval before advancing. Answering intake questions, cancellation and unavailable UI are not approval. Use available Pi choice UI for closed choices, otherwise chat.
3. Carry approved text and visible open items forward. Keep progress brief; do not reprint the whole draft.
4. Reopen affected sections when earlier decisions change; never silently rewrite approved text.
5. After all sections are approved and validation passes, assemble approved text into the complete document for final review. Approval never authorizes saving or publishing.

Pause or exit on request; report approved/pending sections without inventing missing state.

## Ticket Type

Use the type the user names (story, task, spike, or an equivalent in the user's language) and do not switch it. Otherwise infer it: a user capability with a benefit is a User Story; bounded technical, maintenance or operational work is a Task; research, investigation or an open question is a Spike. Ask one direct question first only when the type cannot be inferred safely.

| Type | Quick Creation template | Refinement template |
| --- | --- | --- |
| User Story | [assets/quick.md](assets/quick.md) | [assets/story-refinement.md](assets/story-refinement.md) |
| Task | [assets/quick.md](assets/quick.md) | [assets/task-refinement.md](assets/task-refinement.md) |
| Spike | [assets/quick.md](assets/quick.md) | [assets/spike-refinement.md](assets/spike-refinement.md) |

## Operating Rules

- Quick Creation is the default mode.
- Refinement activates only when explicitly requested by the user.
- SDD-ready is a variant of Refinement, not a third mode.
- Follow the user's language during conversation; write the ticket in English unless the user explicitly requests another artifact language.
- Return the ticket as a single Jira Markup code block. Omit empty sections and placeholders; use `Assumptions and TBD` only for real unresolved non-blocking gaps.
- Ask one question at a time, directly in normal chat, as a direct interrogative ending with `?` (Spanish `¿...?` when the conversation is in Spanish). Add `Recommendation: ...` only when it helps the user respond. Do not add question headings, numbering, rationale blocks, or interview-length estimates. Use Pi's available UI choice mechanism for closed choices when available; otherwise ask in chat.
- When refining an existing ticket, preserve useful existing content, improve only missing/unclear parts, and put a brief change summary before the Jira block, outside it.
- Explore the codebase only in Refinement / SDD-ready, and only to answer factual questions or validate assumptions (Quick Creation only on explicit request). Keep it light (search/read a few relevant files); deep exploration requires explicit confirmation.

## Modes

### Quick Creation

Load the Quick Creation template. Generate directly when Title, Description and Objective can be inferred safely; otherwise ask only one blocking question (besides any ticket-type question). Include Acceptance Criteria or Implementation Notes only if the user explicitly provided useful content for them. Keep the lead-in before the Jira block minimal.

### Refinement

Use Refinement only when the user explicitly asks to refine, improve, complete, add detail, clarify, make developer-ready, add acceptance criteria, or equivalent intent in the user's language. Use SDD-ready Refinement when the user explicitly asks for SDD-ready, ready for SDD, prepare for SDD, as SDD input, or equivalent intent.

Load the selected type's Refinement template, then ask one question at a time and wait for each answer. Do not generate until the user explicitly asks to generate, create, print, or finalize the ticket.

## Refinement Guidance

Open Questions are especially useful for SDD-ready output when unresolved decisions affect scope, design, or acceptance.

### User Story

Required: Title, User Story, Description, Acceptance Criteria. Optional: Implementation Notes, Test Notes, Open Questions, Assumptions and TBD.

The User Story section must use this shape: `As a [user], I want [capability], so that [benefit].` Acceptance Criteria should use Given/When/Then by default.

Implementation Notes must be conservative. Include only real technical context, constraints, dependencies, risks, or SDD inputs. Avoid premature implementation design, invented architecture, step-by-step plans, or subtasks disguised as design.

### Task

Required: Title, Description, Expected Outcome, Acceptance Criteria. Optional: Implementation Notes, Test Notes, Open Questions, Assumptions and TBD.

Acceptance Criteria should use Given/When/Then by default. Verifiable bullets are allowed for pure technical work when Given/When/Then would be artificial.

Implementation Notes may include technical guidance, constraints, dependencies, risks, known technical context, or SDD inputs. They must not become a step-by-step implementation plan, invented architecture, or subtasks disguised as design.

### Spike

Required: Title, Research Question, Context, Scope, Expected Deliverable. Optional: Acceptance Criteria, Implementation Notes, Test Notes, Open Questions, Assumptions and TBD.

Acceptance Criteria should be evidence or deliverable bullets by default. Use Given/When/Then only when it fits naturally.

Implementation Notes must stay investigatory: areas to inspect, constraints, known risks, dependencies, or SDD inputs. They must not assume the solution, prescribe architecture, list subtasks, or become a step-by-step build plan.

## Evidence Summary

Place an Evidence Summary before the Jira block when codebase exploration happened or the ticket makes technical/factual claims; otherwise omit it.

Evidence Summary
Reviewed: Files, docs, or sources reviewed.
Found: Facts discovered.
Evidence: Specific references.
Confidence: High | Medium | Low
Unverified: Claims or assumptions not validated.
