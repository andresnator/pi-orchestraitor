<!-- Consulted Matt Pocock's improve-codebase-architecture at 49dd158d1076134a641b33efb035946536778336; rewritten for Pi under MIT. -->

# Architecture Candidate Survey

Use only for a requested survey of architecture improvements, not an already-authorized design/ADR task.

1. **Bound the survey.** Identify the user-selected area, pain and relevant files. Keep inspection bounded; ask for a narrower target if the scope is unclear. Use relevant recent history only as a prioritization hint: change frequency is not proof of poor design.
2. **Inspect the actual friction.** Cite callers, dependencies, testing difficulty and current behavior. Read relevant domain vocabulary and ADRs. Record an ADR conflict explicitly; do not override a prior decision by inference. Reuse existing domain terms rather than imposing a new architectural vocabulary.
3. **Compare a small set of candidates.** Return a Markdown table with evidence paths, concrete problem, alternative, expected benefit labelled as a hypothesis, trade-offs, confidence, ADR conflicts and first reversible validation. A diagram is optional and is a proposal, not measured evidence. Keep precise blocked questions separate from vague in-scope areas and exclusions, using the existing [discovery guidance](../../jag-evidence/SKILL.md#wayfinder-discovery), without starting another tracker or discovery artifact.
4. **Stop for a decision.** Recommend a candidate or report **no material candidates** when the evidence does not justify change. Ask which candidate, if any, deserves further discussion. Selection is not authorization to implement, write design artifacts or change scope.

Return inline by default. Save only when explicitly requested, under a user-approved path or `.ai/architect/surveys/<slug>.md`; inspect the exact path and preserve collisions. No automatic ADR, plan, glossary edits, browser opening, CDN scripts, test deletion or prescribed subagent count. Preserve tests unless a separately authorized refactor establishes equivalent behavioral coverage. Any later design or implementation request uses its own authorization and verification contract.
