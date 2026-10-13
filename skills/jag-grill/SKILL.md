---
name: jag-grill
description: "Interview the user to stress-test a plan or design; activates on grill requests."
license: MIT
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "2.0.1"
  modification_notice: "Modified for Pi by pi-orchestraitor; clarified decision dependencies, recommendations and the understanding/authorization boundary."
  author: Matt Pocock
  adapted_by: Agents Orchestrator maintainers
  source: https://github.com/mattpocock/skills
  upstream_name: grilling
  pi_adapted_by: pi-orchestraitor
  consulted_source_path: "skills/productivity/grilling/SKILL.md"
  consulted_source_revision: "49dd158d1076134a641b33efb035946536778336"
  status: testing
  version: "2.0.1"
---

Interview the user about this plan, decision or idea until you reach a shared understanding. Track settled decisions, unresolved decisions and their dependencies as a design tree. Ask only the next decision whose prerequisites are settled. After each answer, reconsider downstream questions; reopen an earlier decision if the answer invalidates its assumptions.

Ask open-ended questions directly in normal chat, one at a time, and wait for feedback before continuing. Add a `Recommendation: ...` line only when it helps the user decide or respond. Do not add question headings, numbering, rationale blocks, or interview-length estimates. For a yes/no decision, word the question so "yes" accepts your recommendation, not its opposite.

Use Pi's available UI choice mechanism for closed choices when available; otherwise ask in chat. Asking multiple questions at once is bewildering. A cancelled, unavailable or busy UI result is not an answer; clarify in chat rather than inferring agreement.

Finding facts is your job; decisions belong to the user. Inspect available files and tools instead of asking for facts you can look up. Prefer direct inspection for small lookups. Bounded readers are optional only for independent exploration; inspect and collect their evidence before using it. Do not guess a dependent answer while its prerequisite remains unresolved.

When no unresolved decision remains within the agreed scope, summarize the settled choices and remaining limits, then ask the user to confirm shared understanding. Stop there: design agreement does not authorize implementation, file edits, staging, commits or publication. Further action requires the user's separate authorization.

## Attribution

Original skill by Matt Pocock from <https://github.com/mattpocock/skills>.
