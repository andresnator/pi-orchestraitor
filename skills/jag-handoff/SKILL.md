---
name: jag-handoff
description: "Write a redacted, portable Markdown handoff for the next session's stated task."
disable-model-invocation: true
license: MIT
compatibility: "Pi 1.0.4; explicit user invocation; no durable execution recovery."
metadata:
  author: "Matt Pocock"
  adapted_by: "pi-orchestraitor"
  source: "https://github.com/mattpocock/skills"
  upstream_name: "handoff"
  source_path: "skills/productivity/handoff/SKILL.md"
  source_revision: "6fd947921b935b7e1e69293a200400f0fdd5c15f"
  version: "1.0.0"
  pi_adaptation: "2.0.0"
  status: testing
  modification_notice: "Adapted handoff for Pi with local .ai output, fresh-state checks and no execution authority."
---

# Portable Handoff

Only the user invokes this skill, for example `/skill:jag-handoff continue the adapter tests`. Do not route it through automatic registry loading or delegate it as a child skill. Read-only explanation, review and planning requests stay inline unless saving a handoff is explicitly authorized.

1. **Focus.** Treat supplied arguments as the next task. If the intended continuation is unclear, ask one focused question. Done: the next objective, scope, constraints, established decisions, exclusions and unresolved user decisions are explicit.
2. **Reference evidence.** Inspect current repository state and relevant artifacts. Reference canonical plans, ADRs, diffs and receipts rather than duplicating them. Record canonical repository/base identity, exact paths, branch/HEAD or other appropriate fingerprints, observed checks and unperformed checks. Done: the receiver can distinguish verified state from assumptions.
3. **Redact.** Remove secrets, credentials, personal data, sensitive source and unnecessary transcript detail; do not write them and then redact later. Use repository-relative paths where possible. Done: the handoff contains only necessary, non-sensitive context.
4. **Write.** Use [assets/handoff-template.md](assets/handoff-template.md); default to `.ai/handoffs/YYYY-MM-DD-<slug>.md`. Preserve existing artifacts and select a distinct filename on collision. Done: provide the saved path and explicitly label its verification limits.
5. **Set the receiving boundary.** Suggest native commands such as `/skill:<name>` only with current catalog evidence, labeling any unchecked availability. Suggested skills are candidates, not assumed available: the receiver searches native descriptions and loads only selected authorized names through `skill_registry`. A manual-only candidate needs its own explicit user command. Done: the receiver is instructed to recheck state, artifacts and authorization before continuing.

## Boundaries

This document is not execution authority or permission to resume a plan, apply edits, stage, commit, publish or cross project boundaries. It is portable context, not a durable execution ledger or recovery mechanism. It does not automatically switch session, compact context, activate a new skill, sync memory or start a child.

When canonical artifacts exist, keep the handoff short and point to them. Repository-relative references may need another checkout/base; disclose missing checkout, path or reference access rather than assuming portability. A receiving session must detect changed fingerprints and ask about stale or conflicting directions, rather than treating the handoff as current authorization.
