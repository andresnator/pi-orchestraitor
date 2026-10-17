---
name: jag-prd
description: "Create PRDs: rigorous technical specs for high-stakes, cross-team, regulated or security-sensitive work, or a light mode for MVPs, internal tools and early ideas. Supports optional section review."
disable-model-invocation: true
license: MIT
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "2.1.0"
  modification_notice: "Modified for Pi by pi-orchestraitor; added optional section review."
  author: andresnator
  status: testing
  version: "2.2.0"
---

# Technical PRD

## Activation Contract

Use this skill to build a full technical PRD through an interactive, phase-by-phase conversation. A full PRD is appropriate when the work needs strong alignment, explicit tradeoffs, measurable outcomes, quality/security coverage, dependency mapping, risks, acceptance criteria, and traceability from goals to delivery.

Always read `assets/prd-template.md` at the start of the session and use it as the final document skeleton.

Use [Light Mode](#light-mode) instead when the user asks for a light PRD or the work is an MVP, internal tool, small-to-medium feature or early idea. Ask which mode only when the stakes are unclear.

## Optional Interactive Mode

Use only on explicit requests for `interactive mode`, `section by section`, or equivalent intent. Otherwise keep defaults below. In this mode, replace draft timing and question limits only; preserve templates, validation, evidence, language, format and save/publication rules.

1. Confirm section order. Reuse context; ask one missing-input question at a time and wait.
2. Draft one section. Request approval or edits; wait for explicit approval before advancing. Answering intake questions, cancellation and unavailable UI are not approval. Use available Pi choice UI for closed choices, otherwise chat.
3. Carry approved text and visible open items forward. Keep progress brief; do not reprint the whole draft.
4. Reopen affected sections when earlier decisions change; never silently rewrite approved text.
5. After all sections are approved and validation passes, assemble approved text into the complete document for final review. Approval never authorizes saving or publishing.

Pause or exit on request; report approved/pending sections without inventing missing state.

## Hard Rules

- Work one phase at a time; do not dump the whole template as a questionnaire.
- Ask one focused question at a time where possible.
- Ask open-ended questions directly in normal chat; use Pi's available UI choice mechanism for closed choices when available; otherwise ask in chat.
- Add `Recommendation: ...` only when it helps the user respond. Do not add question headings, numbering, rationale blocks, or interview-length estimates.
- At a phase boundary, give a brief summary of accumulated decisions and open items before asking the next phase's first question. Do not summarize after every question.
- Validate the current phase before advancing.
- Challenge vague, unverifiable, or contradictory requirements with a concrete reason.
- Do not invent unknown facts; preserve uncertainty as open questions, assumptions, or explicit `TBD` items.
- Allow `N/A` only with a short justification, and push back when skipping would hide material risk.
- Keep the document rigorous but usable; avoid decorative tables that add no decision value.
- Maintain traceability across problem, goals, requirements, acceptance criteria, metrics, risks, and delivery.
- Use the reference template for the final artifact.
- Ask where to save the PRD after presenting the final draft; suggest `PRD-{product-name}-v{version}.md` if the user wants a default.

## Conversation Format

Use this minimal shape for open interview questions:

```markdown
[Direct question]

Recommendation: [short recommended/default answer when useful]
```

Omit the recommendation line when it adds no value.

## Decision Gates

| Situation | Action |
| --- | --- |
| Missing intent or product area | Ask what product, feature, or decision the PRD should cover. |
| Problem is vague or solution-first | Ask who has the problem, what hurts today, and why now. |
| Acceptance criteria are missing | Stop advancement for functional requirements until each must-have has verifiable criteria. |
| Metrics are not measurable | Ask for target, baseline if known, measurement method, or mark the metric as `TBD` with an owner. |
| Security, compliance, data, or dependency section is marked `N/A` | Require a short justification and record it in the PRD. |
| Existing PRD is being resumed | Ask for the path, read it, identify complete/incomplete sections, summarize state, then continue from the first incomplete phase. |
| User cannot answer a detail yet | Capture an open question with owner/due date if known; continue only if the missing detail does not block validation. |

## Execution Steps

1. Read `assets/prd-template.md`.
2. Establish document metadata: product/feature name, version, author, date, status.
3. Phase 1, Overview: capture problem, context, scope, out-of-scope, stakeholders, and assumptions.
4. Phase 2, Goals and Success: capture goals, non-goals, measurable metrics, and how success will be checked.
5. Phase 3, Users and Use Cases: capture user groups, core scenarios, edge/error paths, and use-case priorities.
6. Phase 4, Requirements and Acceptance: capture functional requirements, priorities, and acceptance criteria.
7. Phase 5, Quality, Security, and Dependencies: capture relevant non-functional requirements, data/security/compliance needs, dependencies, integrations, and fallback expectations.
8. Phase 6, Architecture and Interfaces: capture architecture, data flow, API/interface contracts, and ownership only where relevant to build or review decisions.
9. Phase 7, Risks and Open Questions: capture risks, mitigations, assumptions, unresolved questions, owners, and due dates where known.
10. Phase 8, Delivery and Traceability: capture MVP/release slices, milestones, rollout/rollback needs, and trace requirements back to goals and acceptance criteria.
11. Generate the final PRD from the template, replacing placeholders with collected content and marking justified gaps clearly.
12. Present the final PRD for review and ask where to save it.

## Validation Rules

- The problem statement names affected users and current pain.
- Scope includes both in-scope and out-of-scope boundaries.
- Each goal has at least one measurable or explicitly `TBD` success signal.
- Each must-have functional requirement has acceptance criteria.
- Quality requirements use numbers where numbers matter.
- Security and compliance coverage matches the data and user access model.
- External dependencies include impact and fallback or degradation behavior.
- Risks are connected to requirements, architecture, dependencies, delivery, or unknowns.
- Delivery plan accounts for must-have requirements and known blockers.
- Open questions are visible rather than hidden in prose.

## Output Contract

Return the complete PRD document in Markdown using `assets/prd-template.md`.

After the draft, include a short final review request covering:

- Confirmed sections.
- Remaining `TBD`, assumptions, and open questions.
- Suggested save path or a question asking where to save the file.

## Light Mode

A useful, lightweight PRD for shared direction without formal review ceremony. Read `assets/prd-light-template.md` instead of the full template. Optional Interactive Mode and Conversation Format still apply; these rules replace the full-mode Hard Rules, Decision Gates, Execution Steps, Validation Rules and Output Contract.

- Keep the conversation brief and practical. Work one phase at a time and ask at most one follow-up per phase unless missing information fully blocks the document.
- Phases: (1) Context and Goals: problem, goal, scope, non-goals, success signals. (2) Users and Scenarios. (3) Requirements: priority and plain-language acceptance criteria; Given/When/Then is optional. (4) Approach and Constraints: approach, key constraints, dependencies, relevant technical notes. (5) Risks, Open Questions and Delivery: risks, assumptions, open questions, MVP or first release, next milestones.
- Skip non-relevant details and accept `N/A` without heavy justification. When the discussion becomes ceremonial, collapse detail into bullets, record open questions and move on. Produce a useful draft fast; do not invent unknowns.
- Validate: the problem and outcome are plain; scope names the first useful version and at least one boundary; success is observable; requirements are concrete enough to start; each must-have has acceptance criteria and connects to a goal or scenario; constraints appear only when they change delivery or design; risks and open questions are visible; the MVP or first release is identified.
- Output a concise PRD Light from the template, then ask about anything still `TBD` or open, whether the MVP feels right, and where to save it (default `PRD-Light-{product-name}-v{version}.md`).

## References

- `assets/prd-template.md` — full technical PRD template.
- `assets/prd-light-template.md` — light PRD template.
