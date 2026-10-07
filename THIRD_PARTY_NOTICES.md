# Attribution

This package adapts **agents-orchestrator**, revision `e90b11a4d5fb77bfebcf5f5c96da9471014c17ab`, copyright (c) 2026 Jose Andrés González Guevara. The root package uses its MIT license, retained in [LICENSE](LICENSE).

- `extensions/compact-tools.ts` and its regression tests came from the user's existing Pi configuration. Native execution and the Node test/assert convention are preserved.
- `extensions/btw/` and its 71 imported regression cases came from the user's standalone Pi extension. The import preserves temporary conversations and 70% sizing, translates UI labels to English, and ports tests to the repository's Node test/assert convention. The source supplied no separate upstream repository or license notice.
- BTW declares [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) 1.1.3 as a runtime dependency, licensed MIT, copyright (c) 2026 Craft Docs. Its source and license remain in the installed dependency; they are not redistributed in this tarball.
- `instructions/` and `prompts/` adapt the source's global rules, Agent Personality, Orchestraitor, planning, review, and Absorb contracts.
- The 56 native bundled skills (54 automatic and two explicit-only) expose short `jag-*` names. Their original names remain in provenance; authors, upstream source metadata, and declared MIT or Apache-2.0 licenses are retained. [The catalog](docs/skills.md) and [machine-readable provenance](docs/skills-provenance.json) identify each source path, revision, version, license, resource, and adaptation. Multi-domain copies are materialized once.
- Ten former Apache-2.0 review skills are consolidated into three conditional references under `jag-practices`, `jag-refactor`, and `jag-patterns`. Their gentle-ai authorship, andresnator adaptation, license and modification notices are retained in those files and in provenance. The recipients' MIT frontmatter licenses do not relicense these Apache-2.0 references.
- The original package's MIT terms and copyright holder are retained in [licenses/MIT.txt](licenses/MIT.txt); direct-source notices below remain separate. Apache-2.0 terms are included in [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt). Modified Apache files identify their Pi adaptation in frontmatter or a modification notice.
- Upstream skill authors include andresnator, gentleman-programming, abdi, and the authors retained in individual frontmatter and resources. Their attribution is preserved; adaptation does not imply their endorsement.

## Direct Matt Pocock adaptations and layered PR credit

Five new skills (`jag-agent-docs`, `jag-pr`, `jag-handoff`, `jag-research`, `jag-teach`) adapt [Matt Pocock's skills](https://github.com/mattpocock/skills) at revision `6fd947921b935b7e1e69293a200400f0fdd5c15f` (package/plugin 1.3.1; individual skills are unversioned). Their MIT copyright notice, **Copyright (c) 2026 Matt Pocock**, is reproduced completely in [licenses/mattpocock-MIT.txt](licenses/mattpocock-MIT.txt). `jag-domain` retains its historical Agents Orchestrator import identity; the same direct source was consulted separately for its update.

The PR visual menu also derives from **Dex Horthy / HumanLayer**, `plugins/show-me/skills/show-me/SKILL.md` in [humanlayer/skills](https://github.com/humanlayer/skills) at revision `ca7c8088db69e315a8b2deea43820270457f8f3c`. The complete MIT notice, **Copyright (c) 2026 HumanLayer**, is retained in [licenses/humanlayer-MIT.txt](licenses/humanlayer-MIT.txt). [PR credits](skills/jag-pr/CREDITS.md) preserve this layered attribution; no `show-me` installation or browser integration is required.

Pi adaptations change invocation, output destinations, evidence qualifications and authorization boundaries. They preserve source ownership and do not imply endorsement by Matt Pocock, Dex Horthy, HumanLayer or any historical author. Per-entry source revisions and materialized-resource fingerprints remain in provenance.

The installer also registers [@heyhuynhgiabuu/pi-pretty](https://github.com/heyhuynhgiabuu/pi-pretty), version 0.6.30, licensed MIT, through native Pi package management. Its source and dependencies remain in the separately installed upstream package; they are not redistributed in this tarball.

No OpenCode runtime or plugin, personal credential, model store, session, or Engram database is distributed.
