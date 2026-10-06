---
name: jag-teach
description: "Teach one mission-scoped topic through Markdown lessons, conversational practice and evidence-qualified learning records."
disable-model-invocation: true
license: MIT
compatibility: "Pi 1.0.4; explicit user invocation; Markdown only; no browser integration."
metadata:
  author: "Matt Pocock"
  adapted_by: "pi-orchestraitor"
  source: "https://github.com/mattpocock/skills"
  upstream_name: "teach"
  source_path: "skills/productivity/teach/SKILL.md"
  source_revision: "6fd947921b935b7e1e69293a200400f0fdd5c15f"
  version: "1.0.0"
  pi_adaptation: "2.0.0"
  status: testing
  modification_notice: "Adapted teaching for topic-scoped Pi Markdown workspaces, conversational practice and qualified learning evidence."
---

# Mission-based Teaching

Only the user invokes this skill, for example `/skill:jag-teach learn to explain event sourcing`. Automatic registry loading and child skill assignment cannot substitute for explicit invocation.

## Workflow

1. **Establish the mission.** Ask what concrete real-world result the user wants and what they can already do. Confirm the mission and documentation scope before writing. Done: one topic, observable success criteria, useful non-sensitive constraints and exclusions. Use [assets/mission-template.md](assets/mission-template.md).
2. **Inspect state and sources.** Read the topic's existing mission, resources, vocabulary and learning records. Prefer trusted primary sources; record citations, version/access dates and missing access with [assets/resources-template.md](assets/resources-template.md). For current APIs, resolve the exact library in Context7, then query compatible docs; disclose unavailability/version mismatch and prefer installed compatible docs. Done: lesson claims have sources or explicit gaps, not unsupported certainty.
3. **Choose one small lesson.** Match the mission and observed starting point; treat claimed prior knowledge as self-reported, not demonstrated. Use [assets/lesson-template.md](assets/lesson-template.md) for one Markdown concept/example, an effortful retrieval or practical task, and feedback after the user's attempt. Done: the user can try one concrete action and ask follow-up questions.
4. **Practice and qualify.** Explain errors specifically and adapt the next task to observed performance. Suggest spaced retrieval or related mixed practice when useful, without a scheduler or promised retention. Done: distinguish demonstrated understanding, self-reported prior knowledge and mere exposure; one correct answer is not proof of durable mastery.
5. **Persist useful evidence only.** Use [assets/learning-record-template.md](assets/learning-record-template.md) for non-trivial demonstrated insights, explicitly labeled prior-knowledge claims, corrections or confirmed mission changes. Exposure alone is not a learning record. Confirm mission changes with the user before updating `MISSION.md`. Done: records cite a concise non-sensitive evidence summary, limitations and implications, not raw transcripts.
6. **Compress for reuse.** Use [assets/glossary-template.md](assets/glossary-template.md) for terms the user can use correctly, and [assets/reference-template.md](assets/reference-template.md) for concise Markdown reference notes with citations. Done: terminology is consistent and references do not claim the learner mastered everything they contain.

## Topic Workspace

Create files lazily under `.ai/learning/<topic>/` only after establishing the mission and write scope. Unrelated topics use separate directories. Inspect existing files first, preserve canonical state and never overwrite implicitly. Read-only requests stay conversational.

```text
.ai/learning/<topic>/
├── MISSION.md
├── RESOURCES.md
├── GLOSSARY.md
├── NOTES.md                       # optional non-sensitive preferences
├── learning-records/NNNN-<slug>.md
├── lessons/NNNN-<slug>.md
└── reference/<slug>.md
```

For `learning-records/` and `lessons/` independently, scan for the highest existing number and increment it; use at least four digits and a distinct slug. Correct or supersede a record by reference, preserving history rather than deleting it. Confirm mission changes and record the reason. Keep `NOTES.md` optional and restricted to useful non-sensitive learning preferences.

## First-version Boundaries

No automatic browser launch, HTML/JS widgets, remote assets, telemetry, community participation, external posting or unnecessary personal-data capture. Markdown and conversational feedback are sufficient; quiz choices need not have identical word counts. Resources may link primary sources for voluntary reading, but the skill does not open them automatically or enroll the user anywhere.

Teaching records are local ignored artifacts, not a durable recovery mechanism or automatic memory synchronization. Loading this skill does not authorize repository implementation, command execution, configuration changes, staging or publication. Do not infer mastery from attendance, coverage, fluency or a self-report, and do not claim measured learning effectiveness without suitable evidence.
