# Attribution

This package adapts **agents-orchestrator**, revision `e90b11a4d5fb77bfebcf5f5c96da9471014c17ab`, copyright (c) 2026 Jose Andrés González Guevara. The root package uses its MIT license, retained in [LICENSE](LICENSE).

- `extensions/compact-tools.ts` and its regression tests came from the user's existing Pi configuration. Native execution and the Node test/assert convention are preserved.
- `instructions/` and `prompts/` adapt the source's global rules, Agent Personality, Orchestraitor, planning, review, and Absorb contracts.
- The 51 active bundled skills expose short `jag-*` names. Their original names remain in provenance; authors, upstream source metadata, and declared MIT or Apache-2.0 licenses are retained. [The catalog](docs/skills.md) and [machine-readable provenance](docs/skills-provenance.json) identify each source path, revision, version, license, resource, and adaptation. Multi-domain copies are materialized once.
- Ten former Apache-2.0 review skills are consolidated into three conditional references under `jag-practices`, `jag-refactor`, and `jag-patterns`. Their gentle-ai authorship, andresnator adaptation, license and modification notices are retained in those files and in provenance. The recipients' MIT frontmatter licenses do not relicense these Apache-2.0 references.
- MIT terms are included in [licenses/MIT.txt](licenses/MIT.txt). Apache-2.0 terms are included in [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt). Modified Apache files identify their Pi adaptation in frontmatter or a modification notice.
- Upstream skill authors include andresnator, gentleman-programming, abdi, and the authors retained in individual frontmatter and resources. Their attribution is preserved; adaptation does not imply their endorsement.

The installer also registers [@heyhuynhgiabuu/pi-pretty](https://github.com/heyhuynhgiabuu/pi-pretty), version 0.6.30, licensed MIT, through native Pi package management. Its source and dependencies remain in the separately installed upstream package; they are not redistributed in this tarball.

No OpenCode runtime or plugin, personal credential, model store, session, or Engram database is distributed.
