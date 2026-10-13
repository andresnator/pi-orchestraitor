---
name: jag-wait-what
description: "Re-explain a confusing answer with the missing context in plain language."
disable-model-invocation: true
license: MIT
compatibility: "Pi 1.0.4; explicit user invocation; inline explanation only."
metadata:
  author: "Matt Pocock"
  adapted_by: "pi-orchestraitor"
  source: "https://github.com/mattpocock/skills"
  upstream_name: "wait-what"
  source_path: "skills/productivity/wait-what/SKILL.md"
  source_revision: "49dd158d1076134a641b33efb035946536778336"
  version: "1.0.0"
  pi_adaptation: "2.0.0"
  status: testing
  modification_notice: "Adapted wait-what for Pi with user-language replies, optional canonical vocabulary and no continuation authority."
---

# Re-explain

Only the user invokes this skill, for example `/skill:jag-wait-what explain the decision`. Do not load it through automatic registry lookup or delegate it as a child skill.

Pause and re-explain the supplied point, or the most recent relevant answer when no point is supplied. If there is no prior answer or passage available, ask for it. Restore the missing premise or context before the conclusion; use plain, short sentences in the user's language. Preserve conditions, caveats, negations, evidence and uncertainty. Define unavoidable technical terms and add a small example only when it helps; do not merely shorten the answer. Redact sensitive material.

Reuse canonical domain vocabulary already available; narrowly inspect its authoritative document only when useful. Respect existing `CONTEXT.md`/`CONTEXT-MAP.md` (including `.ai/domain/`) or `GLOSSARY.md`/`GLOSSARY-MAP.md` conventions. Missing glossaries are fine: explain without one. Do not create or update domain documents just to clarify an answer.

Return an inline explanation only. Do not continue the original task, change task status, delegate, write files, compact or switch sessions, or infer approval to act. Stop after the re-explanation.
