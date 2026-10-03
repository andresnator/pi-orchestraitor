---
name: grilling
description: "Interview the user relentlessly about a plan or design. Use when the user wants to stress-test a plan before building, or uses any 'grill' trigger phrases."
license: MIT
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "1.0.0"
  modification_notice: "Modified for Pi by pi-orchestraitor."
  author: Matt Pocock
  adapted_by: Agents Orchestrator maintainers
  source: https://github.com/mattpocock/skills
  status: testing
  version: "2.0.0"
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

Ask open-ended questions directly in normal chat, one at a time, and wait for feedback before continuing. Add a `Recommendation: ...` line only when it helps the user decide or respond. Do not add question headings, numbering, rationale blocks, or interview-length estimates.

Use Pi's available UI choice mechanism for closed choices when available; otherwise ask in chat. Asking multiple questions at once is bewildering.

If a question can be answered by exploring the codebase, explore the codebase instead.

## Attribution

Original skill by Matt Pocock from <https://github.com/mattpocock/skills>.
