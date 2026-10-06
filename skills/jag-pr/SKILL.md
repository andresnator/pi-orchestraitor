---
name: jag-pr
description: "Draft a pull request body from an inspected change, with concise visuals, observed verification evidence, reversibility and merge risk."
license: MIT
compatibility: "Pi 1.0.4; use available local inspection tools; no publishing integration required."
metadata:
  author: "Matt Pocock"
  adapted_by: "pi-orchestraitor"
  source: "https://github.com/mattpocock/skills"
  upstream_name: "pr"
  source_path: "skills/engineering/pr/SKILL.md"
  source_revision: "6fd947921b935b7e1e69293a200400f0fdd5c15f"
  credits_author: "Dex Horthy"
  credits_organisation: "HumanLayer"
  credits_source: "https://github.com/humanlayer/skills"
  credits_path: "plugins/show-me/skills/show-me/SKILL.md"
  credits_revision: "ca7c8088db69e315a8b2deea43820270457f8f3c"
  version: "1.0.0"
  pi_adaptation: "2.0.0"
  status: testing
  modification_notice: "Adapted PR/show-me guidance for Pi with evidence qualifications and no automatic publication."
---

# Pull Request Body

Draft inline by default. Save to `.ai/pr/<slug>.md` only when requested. Inspect the destination first and choose a distinct filename on collision; never overwrite implicitly. Writing a body does not authorize staging, committing, pushing or publishing a PR.

1. **Inspect scope.** Read the actual diff, requested base/head, repository conventions and any PR template. If the comparison is materially ambiguous, ask before drafting. Done: name the comparison and distinguish existing/unrelated changes.
2. **Summarize.** Use the smallest useful visual from [references/visuals.md](references/visuals.md), adjacent to a short explanation. Use an existing domain glossary only when relevant. Done: the visual explains the actual affected behavior or ownership, not an imagined change.
3. **Collect evidence.** Cite observed checks with exact command, result and relevant before/after receipts. Label failed, unperformed, unavailable and inferred checks. Screenshots require an existing authorized capture path; do not install or launch a browser automatically. Done: every claim has evidence or an explicit limitation.
4. **Assess Merge Danger.** State a one-way or two-way door, the reversal mechanism and its limits. Describe blast radius, affected consumers, data or migration implications, and remaining unknowns. Done: reversibility is justified, not guessed from diff size.
5. **Deliver.** Use [assets/pr-template.md](assets/pr-template.md), or map its information into the repository's required PR structure. Done: concise body with Summary, Evidence and Merge Danger, plus any required local sections; no publication side effect.

## Evidence Rules

An explanatory pseudocode or sketch is not execution evidence. A before/after claim needs observed results for the relevant states; do not invent RED/GREEN history from the final diff. For prose-only changes, report proportionate structural checks and the limits instead.

Read [CREDITS.md](CREDITS.md) when changing or redistributing visual guidance. Preserve Matt Pocock, Dex Horthy/HumanLayer attribution and applicable license notices.
