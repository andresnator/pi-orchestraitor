# Bundled development skills

The package ships 61 unique skills from the non-learning domains of `agents-orchestrator`, revision `e90b11a4d5fb77bfebcf5f5c96da9471014c17ab`. Original names, authors, licenses, and supporting resources are retained. All skill directories are materialized; none depends on a link to the source repository.

## Pi adaptations

- Every skill declares Pi compatibility and a separate `pi_adaptation` version. Original versions remain in provenance.
- Skill routing uses Pi's native names and concise descriptions; full skill bodies and resources are unchanged by catalog compaction. Executors read the selected catalog path using available file tools.
- Closed questions use an available Pi UI choice mechanism, with ordinary chat as the fallback. No OpenCode question tool is assumed.
- `execution-plan` and its template target sequential Orchestraitor execution, unchanged plans, and working-tree delivery. Unsupported SDD, TCR, and automatic Git delivery are reported as blockers.
- `skill-creator` uses the Pi package layout and discovery checks, and includes an actual skill template. It has no source-installer or manual-catalog dependency.
- Absorb compares the destination's actual runtime. Refactoring instructions require explicit authorization for commits.
- Descriptions, references, and templates use English. Replies and explicitly requested artifact languages follow the user.

## External prerequisites

| Work | Prerequisite |
| --- | --- |
| Source inspection and planning | Repository files and available native Pi tools. |
| Java testing and build checks | The target repository's Java version and Maven/Gradle/test dependencies. |
| Dependency security checks | Relevant package tooling and advisory-service access; disclose unavailable checks. |
| GitHub issues and PR inspection | Configured GitHub integration or authenticated `gh`; posting requires the user's publishing instruction. |
| Jira artifact drafting | No Jira account needed for text drafts; a connected service is required for publishing. |
| Current technical documentation | Context7, or installed version-compatible documentation when unavailable. |
| Code graphs | Optional configured graph integration; normal source inspection is the fallback. No graph indexer is installed or launched. |
| Knowledge-base publishing | Optional configured destination, with explicit publishing authorization. |

Missing optional tooling limits that operation, without inventing tools or silently installing software.

## Catalog

Each entry links to the shipped skill and records its original version and license. The [provenance file](skills-provenance.json) contains all domain paths, resource fingerprints, and changed resource names.

| Skill | Upstream version | License | Source domain(s) |
| --- | --- | --- | --- |
| [absorb](../skills/absorb/SKILL.md) | 1.2.4 | MIT | meta |
| [adr](../skills/adr/SKILL.md) | 2.0.0 | MIT | architecture, docs |
| [architecture-ideation](../skills/architecture-ideation/SKILL.md) | 4.0.0 | MIT | architecture |
| [architecture-impact-review](../skills/architecture-impact-review/SKILL.md) | 1.1.3 | Apache-2.0 | plan |
| [architecture-map](../skills/architecture-map/SKILL.md) | 2.0.1 | MIT | architecture |
| [architecture-state](../skills/architecture-state/SKILL.md) | 2.0.1 | MIT | architecture |
| [behavior-characterization](../skills/behavior-characterization/SKILL.md) | 1.1.0 | Apache-2.0 | orchestration, plan |
| [buildable-issue](../skills/buildable-issue/SKILL.md) | 2.1.3 | MIT | docs |
| [characterization-test-scoping](../skills/characterization-test-scoping/SKILL.md) | 2.2.1 | Apache-2.0 | plan |
| [code-conventions](../skills/code-conventions/SKILL.md) | 2.0.1 | MIT | architecture, common, orchestration, plan, review |
| [cognitive-doc-design](../skills/cognitive-doc-design/SKILL.md) | 1.0.2 | Apache-2.0 | docs, orchestration |
| [cognitive-output-refiner](../skills/cognitive-output-refiner/SKILL.md) | 2.0.0 | MIT | common |
| [cohesion-coupling](../skills/cohesion-coupling/SKILL.md) | 1.0.0 | Apache-2.0 | common, plan |
| [complexity-big-o](../skills/complexity-big-o/SKILL.md) | 1.0.0 | Apache-2.0 | common, plan |
| [dependency-inversion](../skills/dependency-inversion/SKILL.md) | 1.0.0 | Apache-2.0 | common, plan |
| [dependency-seam-detection](../skills/dependency-seam-detection/SKILL.md) | 1.1.1 | Apache-2.0 | plan |
| [dependency-security-audit](../skills/dependency-security-audit/SKILL.md) | 2.1.2 | MIT | architecture |
| [design-patterns-pragmatic](../skills/design-patterns-pragmatic/SKILL.md) | 1.1.0 | MIT | architecture, common, plan |
| [domain-modeling](../skills/domain-modeling/SKILL.md) | 1.0.4 | MIT | common, plan |
| [dry-business-knowledge](../skills/dry-business-knowledge/SKILL.md) | 1.0.0 | Apache-2.0 | common, plan |
| [evidence-first-planning](../skills/evidence-first-planning/SKILL.md) | 5.0.0 | MIT | plan |
| [execution-plan](../skills/execution-plan/SKILL.md) | 1.1.1 | MIT | architecture, common, plan |
| [general-naming-readability](../skills/general-naming-readability/SKILL.md) | 1.0.0 | Apache-2.0 | common, plan |
| [god-object-detection](../skills/god-object-detection/SKILL.md) | 1.0.0 | Apache-2.0 | common, plan |
| [grilling](../skills/grilling/SKILL.md) | 2.0.0 | MIT | common, plan |
| [implementation-skill-routing](../skills/implementation-skill-routing/SKILL.md) | 3.0.0 | MIT | architecture, common, orchestration, plan |
| [input-validation-preconditions](../skills/input-validation-preconditions/SKILL.md) | 1.0.0 | Apache-2.0 | common, plan |
| [java-api-design](../skills/java-api-design/SKILL.md) | 1.0.4 | MIT | plan |
| [java-exception-robustness](../skills/java-exception-robustness/SKILL.md) | 1.0.4 | MIT | plan |
| [java-immutability-modeling](../skills/java-immutability-modeling/SKILL.md) | 1.0.4 | MIT | plan |
| [java-naming-readability](../skills/java-naming-readability/SKILL.md) | 1.0.1 | Apache-2.0 | plan |
| [java-secure-coding](../skills/java-secure-coding/SKILL.md) | 1.0.4 | MIT | plan |
| [java-testing](../skills/java-testing/SKILL.md) | 3.2.1 | MIT | architecture, orchestration, plan |
| [jira-spike](../skills/jira-spike/SKILL.md) | 2.0.0 | MIT | docs |
| [jira-task](../skills/jira-task/SKILL.md) | 2.0.0 | MIT | docs |
| [jira-user-story](../skills/jira-user-story/SKILL.md) | 2.0.0 | MIT | docs |
| [kiss-yagni](../skills/kiss-yagni/SKILL.md) | 1.0.1 | Apache-2.0 | architecture, common, plan |
| [legacy-code-safety](../skills/legacy-code-safety/SKILL.md) | 1.1.1 | Apache-2.0 | orchestration, plan |
| [logging-observability](../skills/logging-observability/SKILL.md) | 1.0.0 | Apache-2.0 | common, plan |
| [null-safety](../skills/null-safety/SKILL.md) | 1.0.1 | Apache-2.0 | plan |
| [open-closed-principle](../skills/open-closed-principle/SKILL.md) | 1.0.0 | Apache-2.0 | common, plan |
| [prd](../skills/prd/SKILL.md) | 2.0.0 | MIT | docs |
| [prd-light](../skills/prd-light/SKILL.md) | 2.0.0 | MIT | docs |
| [programming-practices-core](../skills/programming-practices-core/SKILL.md) | 1.0.4 | MIT | common, review |
| [prompt-structure-writer](../skills/prompt-structure-writer/SKILL.md) | 1.1.0 | MIT | meta |
| [refactor](../skills/refactor/SKILL.md) | 1.3.0 | MIT | plan |
| [repo-issues](../skills/repo-issues/SKILL.md) | 2.1.1 | MIT | architecture |
| [rfc](../skills/rfc/SKILL.md) | 2.0.0 | MIT | docs |
| [risk-assessment](../skills/risk-assessment/SKILL.md) | 1.1.0 | Apache-2.0 | common, plan |
| [scope-analysis](../skills/scope-analysis/SKILL.md) | 1.0.2 | Apache-2.0 | plan |
| [service-boundary-analysis](../skills/service-boundary-analysis/SKILL.md) | 2.0.0 | MIT | architecture |
| [single-responsibility](../skills/single-responsibility/SKILL.md) | 1.0.0 | Apache-2.0 | common, plan |
| [skill-creator](../skills/skill-creator/SKILL.md) | 2.0.1 | Apache-2.0 | meta |
| [small-functions](../skills/small-functions/SKILL.md) | 1.0.0 | Apache-2.0 | common |
| [spaghetti-code-detection](../skills/spaghetti-code-detection/SKILL.md) | 1.0.0 | Apache-2.0 | common, plan |
| [summarize](../skills/summarize/SKILL.md) | 1.0.3 | MIT | docs |
| [systematic-debugging](../skills/systematic-debugging/SKILL.md) | 1.0.0 | MIT | common, orchestration |
| [tooling-audit](../skills/tooling-audit/SKILL.md) | 1.0.3 | Apache-2.0 | plan |
| [tooling-compatibility-matrix](../skills/tooling-compatibility-matrix/SKILL.md) | 1.1.1 | Apache-2.0 | plan |
| [type-contracts](../skills/type-contracts/SKILL.md) | 1.0.1 | Apache-2.0 | plan |
| [usm](../skills/usm/SKILL.md) | 2.0.0 | MIT | docs |

## Excluded capabilities

Learning-domain skills and `graphify-cli`, `judgment-day`, `sdd-cold-verification`, `tcr`, `work-unit-commits`, `chained-pr`, `caveman`, `grill`, `slidev-retro-deck`, and `whisper-extract` are excluded from this delivery. `grilling` is a distinct, included design interview skill. Existing user copies of excluded names are left in place.
