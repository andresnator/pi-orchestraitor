---
name: jag-jira
description: "Draft/refine Jira User Stories, Tasks and Spikes in Jira Markup: product outcomes, technical/maintenance/operational work, or research and investigation, with acceptance criteria and developer/SDD readiness. Supports optional section review."
license: MIT
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "3.0.0"
  modification_notice: "Modified for Pi by pi-orchestraitor; merged the Jira User Story, Task and Spike skills and added optional section review."
  author: andresnator
  status: testing
  version: "3.0.0"
---

# Jira Ticket

## Scope

Use this skill only to generate Jira User Story, Task or Spike ticket content.

- A User Story describes a user capability and the benefit it provides.
- A Task describes bounded work with an expected outcome and verifiable completion criteria.
- A Spike is research work that answers a question, explores uncertainty, and produces evidence for a later decision.

This skill outputs Jira Markup in chat only. It does not create Jira issues through the Jira API.

## Optional Interactive Mode

Use only on explicit requests for `interactive mode`, `section by section`, or equivalent intent. Otherwise keep defaults below. In this mode, replace draft timing and question limits only; preserve templates, validation, evidence, language, format and save/publication rules.

1. Confirm section order. Reuse context; ask one missing-input question at a time and wait.
2. Draft one section. Request approval or edits; wait for explicit approval before advancing. Answering intake questions, cancellation and unavailable UI are not approval. Use available Pi choice UI for closed choices, otherwise chat.
3. Carry approved text and visible open items forward. Keep progress brief; do not reprint the whole draft.
4. Reopen affected sections when earlier decisions change; never silently rewrite approved text.
5. After all sections are approved and validation passes, assemble approved text into the complete document for final review. Approval never authorizes saving or publishing.

Pause or exit on request; report approved/pending sections without inventing missing state.

## Ticket Type

- When the user names the type (story, task, spike, or an equivalent in the user's language), use it and do not switch it.
- Otherwise infer it: a user capability with a benefit is a User Story; bounded technical, maintenance or operational work is a Task; research, investigation or an open question is a Spike.
- If the type cannot be inferred safely, ask one direct question before anything else. Use Pi's available UI choice mechanism when available; otherwise ask in chat. Do not ask when the type is clear.
- Load only the selected type's templates:

| Type | Quick Creation template | Refinement template |
| --- | --- | --- |
| User Story | [assets/story-quick.md](assets/story-quick.md) | [assets/story-refinement.md](assets/story-refinement.md) |
| Task | [assets/task-quick.md](assets/task-quick.md) | [assets/task-refinement.md](assets/task-refinement.md) |
| Spike | [assets/spike-quick.md](assets/spike-quick.md) | [assets/spike-refinement.md](assets/spike-refinement.md) |

## Operating Rules

- Quick Creation is the default mode.
- Refinement activates only when explicitly requested by the user.
- SDD-ready is a variant of Refinement, not a third mode.
- Follow the user's language during conversation.
- Generate the final Jira ticket in English by default unless the user explicitly requests another artifact language.
- Final ticket must be a single Jira Markup code block.
- Omit empty sections and placeholders.
- Use `Assumptions and TBD` only for real unresolved non-blocking gaps.
- Besides the ticket-type question, Quick Creation may ask only when missing information blocks Title, Description, or Objective.
- Quick Creation blocking questions must be direct interrogative questions ending with `?` or using Spanish `¿...?` when the conversation language is Spanish.
- In Quick Creation, include Acceptance Criteria or Implementation Notes only if the user explicitly provided useful content for those sections.
- Refinement asks one question at a time, waits for the user, and does not generate until an explicit generation request.
- Ask open-ended Quick Creation and Refinement questions directly in normal chat. Add `Recommendation: ...` only when it helps the user respond.
- Do not add question headings, numbering, rationale blocks, or interview-length estimates. Use Pi's available UI choice mechanism for closed choices when available; otherwise ask in chat.
- If refining an existing ticket, preserve useful existing content and improve only missing/unclear parts.
- When refining an existing ticket, include a brief change summary before the final ticket, outside the Jira block.
- Codebase exploration applies only to Refinement / SDD-ready when it can answer factual questions or validate assumptions; not to Quick Creation by default unless explicitly requested.
- Codebase exploration is light by default (search/read a few relevant files); deep exploration requires explicit confirmation.
- Evidence Summary is required before the Jira block when exploration happened or the output makes technical/factual claims. It must include Reviewed, Found, Evidence, Confidence, Unverified. Confidence levels: High, Medium, Low.
- This skill only generates Jira Markup content; it does not create Jira issues through the Jira API.

## Modes

### Quick Creation

Use Quick Creation unless the user explicitly asks for refinement. Load the selected type's Quick Creation template before generating.

Generate directly when the user provided enough information for:

- Title
- Description
- Objective

Ask only one blocking question if any of those three cannot be inferred safely. Keep the lead-in minimal before the Jira block.

### Refinement

Use Refinement only when the user explicitly asks to refine, improve, complete, add detail, clarify, make developer-ready, add acceptance criteria, or equivalent intent in the user's language.

Use SDD-ready Refinement when the user explicitly asks for SDD-ready, ready for SDD, prepare for SDD, as SDD input, or equivalent intent in the user's language.

Load the selected type's Refinement template before generating. Ask one question at a time using this minimal shape:

```markdown
[Direct interrogative question?]

Recommendation: [Short suggested answer when useful.]
```

Omit the recommendation line when it adds no value.

Do not generate until the user explicitly asks to generate, create, print, or finalize the ticket.

## Refinement Guidance

Open Questions are especially useful for SDD-ready output when unresolved decisions affect scope, design, or acceptance.

### User Story

Required refined sections:

- Title
- User Story
- Description
- Acceptance Criteria

Optional refined sections:

- Implementation Notes
- Test Notes
- Open Questions
- Assumptions and TBD

The User Story section must use this shape: `As a [user], I want [capability], so that [benefit].`

Acceptance Criteria should use Given/When/Then by default.

Implementation Notes must be conservative. Include only real technical context, constraints, dependencies, risks, or SDD inputs. Avoid premature implementation design, invented architecture, step-by-step plans, or subtasks disguised as design.

### Task

Required refined sections:

- Title
- Description
- Expected Outcome
- Acceptance Criteria

Optional refined sections:

- Implementation Notes
- Test Notes
- Open Questions
- Assumptions and TBD

Acceptance Criteria should use Given/When/Then by default. Verifiable bullets are allowed for pure technical work when Given/When/Then would be artificial.

Implementation Notes may include technical guidance, constraints, dependencies, risks, known technical context, or SDD inputs. They must not become a step-by-step implementation plan, invented architecture, or subtasks disguised as design.

### Spike

Required refined sections:

- Title
- Research Question
- Context
- Scope
- Expected Deliverable

Optional refined sections:

- Acceptance Criteria
- Implementation Notes
- Test Notes
- Open Questions
- Assumptions and TBD

Acceptance Criteria should be evidence or deliverable bullets by default. Use Given/When/Then only when it fits naturally.

Implementation Notes must stay investigatory: areas to inspect, constraints, known risks, dependencies, or SDD inputs. They must not assume the solution, prescribe architecture, list subtasks, or become a step-by-step build plan.

## Evidence Summary

When required, place this before the Jira block:

Evidence Summary
Reviewed: Files, docs, or sources reviewed.
Found: Facts discovered.
Evidence: Specific references.
Confidence: High | Medium | Low
Unverified: Claims or assumptions not validated.

If no exploration happened and no technical or factual claims are made, omit the Evidence Summary.
