# Bundled development skills

The package ships 56 unique native skills: 54 automatically selectable and two explicit-only in an isolated package profile. The historical 51-skill base comes from non-learning domains of `agents-orchestrator`, revision `e90b11a4d5fb77bfebcf5f5c96da9471014c17ab`; five direct Matt Pocock adaptations are added, including the explicitly requested teaching exception. Other native sources and configuration filters may change an effective catalog. Public names use the short `jag-*` namespace (at most 15 characters). Original names are recorded in provenance; authors, licenses, and supporting resources are retained. All skill directories are materialized; none depends on a link to the source repository. Ten former review lenses are retained as conditional reference material rather than standalone skills.

## Names and upgrades

Directory basenames and frontmatter names match. Use the new identifiers in `/skill:<name>`, `skill_registry`, child selections and plan `Skills:` fields. This is a breaking rename without old-name aliases. Run native `/reload` after upgrading; refresh alone cannot authorize the new names. Update any explicit skill paths or package resource filters in your own configuration. Existing plans and historical reports are not rewritten automatically. Prompt commands (`/plan`, `/absorb`, `/review`, `/orchestraitor`) are unchanged. The later domain-default change below is separate from the namespace rename and never relocates existing artifacts.

## Adapted workflows

Matt Pocock is credited in the YAML metadata of all six workflows. The five new skills use local version 1.0.0 and direct-source revision `6fd947921b935b7e1e69293a200400f0fdd5c15f`; their upstream individual versions are absent, not invented. `jag-domain` retains its original 1.0.4 import identity in provenance, with local version 2.0.0 / adaptation 3.0.0 for the changed output/authorization contract. PR visual guidance additionally retains Dex Horthy/HumanLayer credits and both complete MIT notices.

| Skill | Invocation | Default generated output |
| --- | --- | --- |
| `jag-agent-docs` | Automatic or explicit; audit is not editing permission | Authorized audit/draft: `.ai/agent-docs/YYYY-MM-DD-<slug>.md` |
| `jag-pr` | Automatic or explicit; drafting only | Inline, or requested `.ai/pr/<slug>.md` |
| `jag-handoff` | User `/skill:jag-handoff <next task>` only | `.ai/handoffs/YYYY-MM-DD-<slug>.md` |
| `jag-research` | Automatic or explicit; parent-led | Authorized report: `.ai/research/YYYY-MM-DD-<slug>.md` |
| `jag-domain` | Automatic or explicit; writes require authorization | `.ai/domain/CONTEXT.md`, multi-context map/contexts, and separate `.ai/adr/` |
| `jag-teach` | User `/skill:jag-teach <topic>` only | Markdown mission/resources/glossary, lessons, records and references under `.ai/learning/<topic>/` |

Manual-only entries are rejected by automatic lookup and child selection; native explicit commands remain available after user `/reload`. Existing canonical documents and collisions are checked before writes. Read-only requests remain inline; no relocation, dependency installation, background researcher, browser launch or publication is implied. Handoffs provide context, not durable execution recovery or permission.

Teaching is one concrete confirmed mission per topic, trusted sources and conversational retrieval/practice feedback. Records distinguish demonstrated understanding, self-reported knowledge and exposure; attendance is not mastery or measured retention. Optional notes retain only useful non-sensitive preferences. HTML/JS widgets, remote assets, telemetry and community posting are outside this first version.

Generated documents under `.ai/` remain local ignored artifacts, not packaged definitions. These source-level contracts, native checks and packaging tests do not demonstrate general model reliability or educational effectiveness.

## Consolidated review lenses

These ten names are no longer supplied as standalone skills or aliases by this package. Use the owning skill and request the named lens; it reads the matching reference only when relevant. Other native sources may still provide their own copies, which this package does not disable or move.

| Retired name | Use instead | Preserved reference |
| --- | --- | --- |
| `jag-kiss` | `jag-practices` | [Simplicity](../skills/jag-practices/references/review-lenses.md#simplicity) |
| `jag-dry` | `jag-practices` | [Duplicated Knowledge](../skills/jag-practices/references/review-lenses.md#duplicated-knowledge) |
| `jag-naming` | `jag-practices` | [Naming](../skills/jag-practices/references/review-lenses.md#naming) |
| `jag-srp` | `jag-practices` | [Single Responsibility](../skills/jag-practices/references/review-lenses.md#single-responsibility) |
| `jag-coupling` | `jag-practices` | [Cohesion and Coupling](../skills/jag-practices/references/review-lenses.md#cohesion-and-coupling) |
| `jag-functions` | `jag-refactor` | [Small Functions](../skills/jag-refactor/references/smell-lenses.md#small-functions) |
| `jag-god-object` | `jag-refactor` | [God Object](../skills/jag-refactor/references/smell-lenses.md#god-object) |
| `jag-spaghetti` | `jag-refactor` | [Spaghetti Code](../skills/jag-refactor/references/smell-lenses.md#spaghetti-code) |
| `jag-ocp` | `jag-patterns` | [Open-Closed Principle](../skills/jag-patterns/references/boundary-review.md#open-closed-principle) |
| `jag-dip` | `jag-patterns` | [Dependency Inversion](../skills/jag-patterns/references/boundary-review.md#dependency-inversion) |

Run native `/reload` to remove stale package commands/catalog entries. Update explicit resource paths/filters and existing plan `Skills:` fields yourself; immutable plans and historical reports are not rewritten. A replacement name does not automatically satisfy an old plan's contract: check the assigned behavior and routing rules before changing it.

The references retain evidence/confidence rules, caller-owned output, behavior preservation, validation/rollback, real-variation gates, temporal-coupling checks and characterization-test safeguards. They do not authorize code changes during a review. Jira, product/PRD/USM, reading, security, testing and legacy workflows are unchanged.

The `skills` array in [provenance](skills-provenance.json) lists active resources. `consolidatedSkills` retains each retired source's original metadata, last instruction fingerprint and replacement skill/path/section. These derived references remain Apache-2.0 even under MIT skill bodies. Structural tests verify retention, discovery and search; they do not prove equivalent model behavior or provider savings.

## Lazy registry

The default `--orchestraitor-skills lazy` mode hides native skill advertisements from the prepared prompt without removing the host's catalog or manual commands. The model searches a small result set and loads only selected names. Inspection reads instructions/resources locally for fingerprints; only selected bodies enter model context. Use `--orchestraitor-skills native`, `/orchestraitor:skills native`, or exclude `extensions/skill-registry.ts` to retain native headers. Disabling the lookup tool also leaves native advertisements intact.

```text
/orchestraitor:skills status
/orchestraitor:skills refresh
/orchestraitor:skills native
/orchestraitor:skills lazy
```

Commands change the current mode; startup/reload uses the invocation flag again. They do not save configuration.

Model tool examples:

```json
{"operation":"search","query":"java testing","limit":5}
{"operation":"load","name":"jag-java-test"}
```

Search uses English substring terms against names/descriptions, not embeddings or a model selector. The default is five matches, maximum twenty; queries are limited to 500 characters and returned descriptions to 512. No whole-index injection or automatic reading of the registry is needed. Search quality, extra turns and actual provider savings remain unmeasured.

### Sources and refresh

**Pi's resolved catalog is the authority.** Package resources, native directories, configured paths, exclusions, precedence and project trust remain host decisions. This extension never grants eligibility merely because a file exists.

For additional global sources, configure Pi yourself, preserving existing settings and exclusions. For example, add the needed entries to the native `skills` array:

```json
{
  "skills": [
    "~/.agents/skills",
    "~/.claude/skills",
    "~/.config/opencode/skills"
  ]
}
```

Use your actual OpenCode config path when `XDG_CONFIG_HOME` differs; use Pi's effective agent directory when `PI_CODING_AGENT_DIR` differs. Trusted project `.agents/skills`, `.claude/skills` and `.opencode/skills` are included only when Pi authorizes them. The extension neither scans HOME nor edits personal/global configuration. Claude/OpenCode instructions may depend on incompatible harness features; loading does not adapt or install them.

| Change | Availability |
| --- | --- |
| New source/name, or changed native filters | Configure Pi and run native `/reload`; refresh alone cannot authorize it. |
| Authorized body, description or supporting resource edit/removal | Revalidated before the next request, search, load or selected child delegation. |
| Retargeted alias after its first validation | Unavailable until native `/reload`; the previously validated canonical target is pinned. |
| Renamed, invalid or missing skill | Unavailable until fixed/reloaded; stale registry rows cannot enable it. |
| Manual-only metadata | Preserved from both native and current metadata; use an explicit `/skill:<name>`, not automatic lookup/delegation. |

There is no idle watcher. Public extension APIs do not expose every authoritative discovery input, so unrestricted live registration was deliberately excluded rather than implemented through private hooks. New native command autocomplete may also require reload.

### Generated file and limits

Startup creates a pending `<nearest Git root>/.ai/skills/registry.md` (otherwise under cwd); the first request or explicit refresh resolves it. An existing owned snapshot is preserved during pending startup. The file records names, descriptions, source/origin/scope, canonical paths, status and content/resource fingerprints, never bodies. It is a generated diagnostic view, not an availability authority; another session may publish a different complete context, identified by its signature.

Writes are atomic and idempotent, serialized in-process and through the host mutation queue when available. Unchanged text leaves the file untouched. Owned corruption is repaired, foreign files and unsafe symlink destinations are preserved, and unavailable persistence falls back to memory with a diagnostic. Untrusted projects do not persist. `.ai/` is excluded from this repository/package; review ignore rules in other repositories. No cross-process locking or OS sandbox is promised.

Inspection caps the native catalog at 1,000 entries, instructions at 40 KiB, individual resources at 1 MiB, and each skill at 1,000 files / 8 MiB / 2,000 enumerated entries / 32 directory levels. Hidden entries and `node_modules` are skipped; resource symlinks and special files make that skill unavailable. Standalone Markdown skills include only their instruction file and known resource directories. These limits can reject otherwise native-valid skills; native mode is the explicit fallback. Selected project skills below protected metadata roots must live in skill subdirectories for child delegation.

See [offline savings and limitations](performance.md) and [child resolution](subagents.md).

## Pi adaptations

- Every skill declares Pi compatibility and a separate `pi_adaptation` version. The namespace rename baseline is 2.0.0; consolidation recipients use 2.1.1 after the discovery-vocabulary correction, with the `jag-code` pointer correction at 2.0.1. Original upstream versions remain in provenance.
- Skill routing uses native-authorized names and descriptions via `skill_registry`, or the native catalog when unavailable. Catalog suppression does not rewrite source bodies/resources; executors load selected names. The routing adaptation is 2.0.0.
- Closed questions use an available Pi UI choice mechanism, with ordinary chat as the fallback. No OpenCode question tool is assumed.
- `jag-plan` and its template target sequential Orchestraitor execution, unchanged plans, and working-tree delivery. Unsupported SDD, TCR, and automatic Git delivery are reported as blockers.
- `jag-skill` uses the Pi package layout/discovery checks and a bundled template. Its conditional `jag-agent-docs` pointer loads shared writing guidance only when natively available; it creates no runtime, installer or manual-catalog dependency. `jag-prompts` keeps its no-tool evaluation contract.
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

Each entry maps the shipped name to its original name, version and SKILL.md license; consolidated reference licenses are noted above. The [provenance file](skills-provenance.json) contains all domain paths, resource fingerprints, and changed resource names.

| Skill | Upstream name | Upstream version | License | Source domain(s) |
| --- | --- | --- | --- | --- |
| [jag-absorb](../skills/jag-absorb/SKILL.md) | `absorb` | 1.2.4 | MIT | meta |
| [jag-adr](../skills/jag-adr/SKILL.md) | `adr` | 2.0.0 | MIT | architecture, docs |
| [jag-arch-ideas](../skills/jag-arch-ideas/SKILL.md) | `architecture-ideation` | 4.0.0 | MIT | architecture |
| [jag-arch-impact](../skills/jag-arch-impact/SKILL.md) | `architecture-impact-review` | 1.1.3 | Apache-2.0 | plan |
| [jag-arch-map](../skills/jag-arch-map/SKILL.md) | `architecture-map` | 2.0.1 | MIT | architecture |
| [jag-arch-state](../skills/jag-arch-state/SKILL.md) | `architecture-state` | 2.0.1 | MIT | architecture |
| [jag-behavior](../skills/jag-behavior/SKILL.md) | `behavior-characterization` | 1.1.0 | Apache-2.0 | orchestration, plan |
| [jag-issue](../skills/jag-issue/SKILL.md) | `buildable-issue` | 2.1.3 | MIT | docs |
| [jag-test-scope](../skills/jag-test-scope/SKILL.md) | `characterization-test-scoping` | 2.2.1 | Apache-2.0 | plan |
| [jag-code](../skills/jag-code/SKILL.md) | `code-conventions` | 2.0.1 | MIT | architecture, common, orchestration, plan, review |
| [jag-docs](../skills/jag-docs/SKILL.md) | `cognitive-doc-design` | 1.0.2 | Apache-2.0 | docs, orchestration |
| [jag-refine](../skills/jag-refine/SKILL.md) | `cognitive-output-refiner` | 2.0.0 | MIT | common |
| [jag-big-o](../skills/jag-big-o/SKILL.md) | `complexity-big-o` | 1.0.0 | Apache-2.0 | common, plan |
| [jag-seams](../skills/jag-seams/SKILL.md) | `dependency-seam-detection` | 1.1.1 | Apache-2.0 | plan |
| [jag-dep-audit](../skills/jag-dep-audit/SKILL.md) | `dependency-security-audit` | 2.1.2 | MIT | architecture |
| [jag-patterns](../skills/jag-patterns/SKILL.md) | `design-patterns-pragmatic` | 1.1.0 | MIT | architecture, common, plan |
| [jag-domain](../skills/jag-domain/SKILL.md) | `domain-modeling` | 1.0.4 | MIT | common, plan |
| [jag-evidence](../skills/jag-evidence/SKILL.md) | `evidence-first-planning` | 5.0.0 | MIT | plan |
| [jag-plan](../skills/jag-plan/SKILL.md) | `execution-plan` | 1.1.1 | MIT | architecture, common, plan |
| [jag-grill](../skills/jag-grill/SKILL.md) | `grilling` | 2.0.0 | MIT | common, plan |
| [jag-routing](../skills/jag-routing/SKILL.md) | `implementation-skill-routing` | 3.0.0 | MIT | architecture, common, orchestration, plan |
| [jag-validation](../skills/jag-validation/SKILL.md) | `input-validation-preconditions` | 1.0.0 | Apache-2.0 | common, plan |
| [jag-java-api](../skills/jag-java-api/SKILL.md) | `java-api-design` | 1.0.4 | MIT | plan |
| [jag-java-errors](../skills/jag-java-errors/SKILL.md) | `java-exception-robustness` | 1.0.4 | MIT | plan |
| [jag-java-model](../skills/jag-java-model/SKILL.md) | `java-immutability-modeling` | 1.0.4 | MIT | plan |
| [jag-java-naming](../skills/jag-java-naming/SKILL.md) | `java-naming-readability` | 1.0.1 | Apache-2.0 | plan |
| [jag-java-secure](../skills/jag-java-secure/SKILL.md) | `java-secure-coding` | 1.0.4 | MIT | plan |
| [jag-java-test](../skills/jag-java-test/SKILL.md) | `java-testing` | 3.2.1 | MIT | architecture, orchestration, plan |
| [jag-jira-spike](../skills/jag-jira-spike/SKILL.md) | `jira-spike` | 2.0.0 | MIT | docs |
| [jag-jira-task](../skills/jag-jira-task/SKILL.md) | `jira-task` | 2.0.0 | MIT | docs |
| [jag-jira-story](../skills/jag-jira-story/SKILL.md) | `jira-user-story` | 2.0.0 | MIT | docs |
| [jag-legacy](../skills/jag-legacy/SKILL.md) | `legacy-code-safety` | 1.1.1 | Apache-2.0 | orchestration, plan |
| [jag-logs](../skills/jag-logs/SKILL.md) | `logging-observability` | 1.0.0 | Apache-2.0 | common, plan |
| [jag-nulls](../skills/jag-nulls/SKILL.md) | `null-safety` | 1.0.1 | Apache-2.0 | plan |
| [jag-prd](../skills/jag-prd/SKILL.md) | `prd` | 2.0.0 | MIT | docs |
| [jag-prd-lite](../skills/jag-prd-lite/SKILL.md) | `prd-light` | 2.0.0 | MIT | docs |
| [jag-practices](../skills/jag-practices/SKILL.md) | `programming-practices-core` | 1.0.4 | MIT | common, review |
| [jag-prompts](../skills/jag-prompts/SKILL.md) | `prompt-structure-writer` | 1.1.0 | MIT | meta |
| [jag-refactor](../skills/jag-refactor/SKILL.md) | `refactor` | 1.3.0 | MIT | plan |
| [jag-repo-issues](../skills/jag-repo-issues/SKILL.md) | `repo-issues` | 2.1.1 | MIT | architecture |
| [jag-rfc](../skills/jag-rfc/SKILL.md) | `rfc` | 2.0.0 | MIT | docs |
| [jag-risk](../skills/jag-risk/SKILL.md) | `risk-assessment` | 1.1.0 | Apache-2.0 | common, plan |
| [jag-scope](../skills/jag-scope/SKILL.md) | `scope-analysis` | 1.0.2 | Apache-2.0 | plan |
| [jag-boundaries](../skills/jag-boundaries/SKILL.md) | `service-boundary-analysis` | 2.0.0 | MIT | architecture |
| [jag-skill](../skills/jag-skill/SKILL.md) | `skill-creator` | 2.0.1 | Apache-2.0 | meta |
| [jag-summary](../skills/jag-summary/SKILL.md) | `summarize` | 1.0.3 | MIT | docs |
| [jag-debug](../skills/jag-debug/SKILL.md) | `systematic-debugging` | 1.0.0 | MIT | common, orchestration |
| [jag-tools](../skills/jag-tools/SKILL.md) | `tooling-audit` | 1.0.3 | Apache-2.0 | plan |
| [jag-tool-matrix](../skills/jag-tool-matrix/SKILL.md) | `tooling-compatibility-matrix` | 1.1.1 | Apache-2.0 | plan |
| [jag-types](../skills/jag-types/SKILL.md) | `type-contracts` | 1.0.1 | Apache-2.0 | plan |
| [jag-usm](../skills/jag-usm/SKILL.md) | `usm` | 2.0.0 | MIT | docs |
| [jag-agent-docs](../skills/jag-agent-docs/SKILL.md) | `writing-for-agents` | unversioned | MIT | Matt Pocock: productivity |
| [jag-pr](../skills/jag-pr/SKILL.md) | `pr` | unversioned | MIT | Matt Pocock: engineering; HumanLayer visual credit |
| [jag-handoff](../skills/jag-handoff/SKILL.md) | `handoff` | unversioned | MIT | Matt Pocock: productivity |
| [jag-research](../skills/jag-research/SKILL.md) | `research` | unversioned | MIT | Matt Pocock: engineering |
| [jag-teach](../skills/jag-teach/SKILL.md) | `teach` | unversioned | MIT | Matt Pocock: productivity |

## Excluded capabilities

The historical source's learning-domain skills remain excluded; the direct, explicit-only `jag-teach` addition above is the user-selected exception. `ask-matt`, `jag-guide`, and the external navigation map are not adopted. `graphify-cli`, `judgment-day`, `sdd-cold-verification`, `tcr`, `work-unit-commits`, `chained-pr`, `caveman`, `grill`, `slidev-retro-deck`, and `whisper-extract` are excluded from this delivery. `jag-grill` (upstream `grilling`) is a distinct, included design interview skill. Existing user copies of excluded names are left in place.
