---
name: jag-skill
description: "Create AI skills, agent instructions or reusable pattern guidance using the Agent Skills spec."
disable-model-invocation: true
license: Apache-2.0
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "2.1.0"
  modification_notice: "Modified for Pi by pi-orchestraitor."
  author: gentleman-programming
  adapted_by: andresnator
  source: gentleman-programming/sdd-agent-team
  version: "2.1.1"
  status: in-progress
---

# Skill Creator

## When a Skill Earns Its Place

Create a skill only when it carries something a current model cannot apply on its own:

- project or personal conventions that differ from common practice;
- a workflow contract: ordered steps, stopping conditions and authorization boundaries;
- templates, schemas, scripts or fixtures the output must follow;
- facts about a tool, harness or service that cannot be inferred.

Do not create one for general engineering knowledge (best practices, textbook catalogs, language idioms), for a one-off task, or for content that already lives in documentation; reference that instead. Extend an existing skill before adding a near-duplicate.

## Layout

```
skills/<skill-name>/
├── SKILL.md      # required; at most 40 KiB
├── assets/       # generated material: templates, schemas, fixtures, examples
├── references/   # explanatory material read only under a stated condition
└── scripts/      # helpers the workflow runs
```

Inside this package use `skills/<skill-name>`; elsewhere use Pi's user or project skill directory. Only these resource directories are inspected. Link resources with paths relative to the skill directory, never web URLs.

## Frontmatter

Start from [assets/skill-template.md](assets/skill-template.md).

| Field | Rule |
|---|---|
| `name` | Lowercase with hyphens; equals the directory basename. Bundled skills here use `jag-<topic>`, at most 15 characters; do not impose that namespace on other packages. |
| `description` | One quoted English line saying what the skill does and when to load it. `skill_registry` matches English substrings of names and descriptions and returns at most 512 characters, so use the words a request would contain. The body is not searched; never add a Keywords section. |
| `disable-model-invocation` | `true` for manual-only skills invoked with `/skill:<name>`; automatic lookup and child selection reject them. |
| `license`, `compatibility` | The declared license; `Pi <version>` plus optional prerequisites. |
| `metadata` | `author`, strict SemVer `version`, `status` (`backlog`, `in-progress`, `testing`, `done`) and `pi_adaptation`. Adapted skills add `adapted_by`, `source` and `modification_notice`. |

## Body

- Lead with the contract: the outcome, its boundaries and what the skill never authorizes.
- Number workflow steps and end each with an observable `Done:` condition.
- Use tables for decisions and keep examples minimal.
- Put branch-specific detail in a reference with a "read when" condition instead of inlining it.
- State each rule once; do not repeat it across sections.

## Shared Agent-writing Guidance (Conditional)

When authoring agent-consumed steps, context pointers or shared references, read [../jag-agent-docs/references/agent-writing.md](../jag-agent-docs/references/agent-writing.md) when it is bundled. If it is missing, keep this skill's local guidance; do not install it or assume a newly written definition is authorized. This is a conditional reference, not a runtime dependency. Audit requests do not authorize editing.

## Behavioral Evaluation (Conditional)

Pi skill discovery and package tests validate frontmatter, resources, and loading; they do not prove model behavior. When a high-impact discipline skill shows a reproducible agent failure despite being available, run the bounded evaluation pilot in [references/behavioral-evaluation.md](references/behavioral-evaluation.md): pre-written criteria, a no-guidance control, multiple fresh-context runs per arm, preserved raw receipts, manual scoring, and reported variance and cost. It is never a routine step or a CI gate.

## Versioning and Registration

Use a patch bump for wording, path and template fixes, a minor bump for new capabilities or optional flows, and a major bump for breaking activation or output changes; keep `status` accurate. A package exposes its `skills/` directory through `pi.skills` in `package.json` and includes the resources in `files`; it must contain them rather than link to another repository. Run native `/reload` and check the discovery diagnostics and name collisions.

Adding, removing or changing a skill in this package also requires:

- its `docs/skills-provenance.json` entry, whose `resources` list every file with its sha256 (the tarball test compares them);
- its catalog row in `docs/skills.md`, plus credits in `THIRD_PARTY_NOTICES.md` for third-party material;
- the skill-count constants in `tests/` (search for the previous count) when the total changes;
- a passing `pnpm test`.

## Checklist

- [ ] No existing skill covers it (Pi's active catalog and `skills/*/SKILL.md`), and it passes "When a Skill Earns Its Place".
- [ ] `name` equals the directory basename and `description` contains the request's trigger words.
- [ ] Every linked resource exists under a recognized resource directory.
- [ ] `version`, `status` and `pi_adaptation` reflect the change.
- [ ] When behavior changes, the existing manual coverage key is updated or one new immutable manual case is added.
