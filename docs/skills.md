# Bundled development skills

The package ships 37 unique native skills: 33 automatically selectable and four explicit-only in an isolated package profile. The historical 51-skill base comes from non-learning domains of `agents-orchestrator`, revision `e90b11a4d5fb77bfebcf5f5c96da9471014c17ab`; 28 of those remain after the [retirements](#retired-skills) below. Seven direct Matt Pocock adaptations are added, including the explicitly requested teaching exception and manual retrospective. Two media skills adapt a newer Agents Orchestrator snapshot as documented below. Other native sources and configuration filters may change an effective catalog. Public names use the short `jag-*` namespace (at most 15 characters). Original names are recorded in provenance; authors, licenses, and supporting resources are retained. All skill directories are materialized; none depends on a link to the source repository. Ten former review lenses are retained as conditional reference material rather than standalone skills.

## Names and upgrades

Directory basenames and frontmatter names match. Use the new identifiers in `/skill:<name>`, `skill_registry`, child selections and plan `Skills:` fields. This is a breaking rename without old-name aliases. Restart Pi after upgrading (`/reload` keeps the cached `.mjs` modules); refresh alone cannot authorize the new names. Update any explicit skill paths or package resource filters in your own configuration. Existing plans and historical reports are not rewritten automatically. Prompt commands (`/plan`, `/absorb`, `/review`, `/orchestraitor`) are unchanged. The later domain-default change below is separate from the namespace rename and never relocates existing artifacts.

## Adapted workflows

Matt Pocock is credited in the skill definitions, centralized provenance and third-party notices. The five earlier direct adaptations retain their original source revision `6fd947921b935b7e1e69293a200400f0fdd5c15f`. The explicit-only `jag-wait-what` addition uses source revision `49dd158d1076134a641b33efb035946536778336`; upstream individual versions are absent, not invented. `jag-grill` clarifies dependencies, recommendations and authorization, consulting the latter source while preserving its original import identity and one-question interaction. Both skills use minimal frontmatter; authorship, source details and resource fingerprints remain in provenance and notices. `jag-domain` retains its original 1.0.4 import identity in provenance, with local version 2.0.0 / adaptation 3.0.0 for the changed output/authorization contract. PR visual guidance additionally retains Dex Horthy/HumanLayer credits and both complete MIT notices.

| Skill | Invocation | Default generated output |
| --- | --- | --- |
| `jag-agent-docs` | Automatic or explicit; audit is not editing permission | Authorized audit/draft: `.ai/agent-docs/YYYY-MM-DD-<slug>.md` |
| `jag-pr` | Automatic or explicit; drafting only | Inline, or requested `.ai/pr/<slug>.md` |
| `jag-retro` | User `/skill:jag-retro [session/scope]` only; inline when requested | Learning and proposals: `.ai/retrospectives/YYYY-MM-DD-<slug>.md` |
| `jag-handoff` | User `/skill:jag-handoff <next task>` only | `.ai/handoffs/YYYY-MM-DD-<slug>.md` |
| `jag-research` | Automatic or explicit; parent-led | Authorized report: `.ai/research/YYYY-MM-DD-<slug>.md` |
| `jag-domain` | Automatic or explicit; writes require authorization | `.ai/domain/CONTEXT.md`, multi-context map/contexts, and separate `.ai/adr/` |
| `jag-teach` | User `/skill:jag-teach <topic>` only | Markdown mission/resources/glossary, lessons, records and references under `.ai/learning/<topic>/` |
| `jag-grill` | Automatic or explicit; one decision at a time | Inline interview and confirmed understanding; no implementation authority |
| `jag-wait-what` | User `/skill:jag-wait-what [point]` only | Inline re-explanation; no generated files or task continuation |

Manual-only entries are rejected by automatic lookup and child selection; native explicit commands remain available after user `/reload`. Existing canonical documents and collisions are checked before writes. Read-only requests remain inline; no relocation, dependency installation, background researcher, browser launch or publication is implied. Handoffs provide context, not durable execution recovery or permission.

Use a handoff for portable next-task context when the work moves to another agent or workspace; use native `/compact` for ordinary context compression within the same conversation. The handoff's existing output, redaction, fingerprint and receiving-authorization contract is unchanged.

`jag-wait-what` restores the premise or context behind a confusing answer in the user's language, preserving caveats and evidence rather than merely shortening it. It consumes optional canonical vocabulary without creating glossaries and stops after the explanation. Invoke the native skill command after `/reload`; no `/wait-what` prompt or runtime alias is supplied.

Teaching is one concrete confirmed mission per topic, trusted sources and conversational retrieval/practice feedback. Records distinguish demonstrated understanding, self-reported knowledge and exposure; attendance is not mastery or measured retention. Optional notes retain only useful non-sensitive preferences. HTML/JS widgets, remote assets, telemetry and community posting are outside this first version.

Generated documents under `.ai/` remain local ignored artifacts, not packaged definitions. These source-level contracts, native checks and packaging tests do not demonstrate general model reliability or educational effectiveness.

### Manual productivity checks (not run automatically)

These stable cases require user-run conversations; structural/native tests do not establish real-model clarity or obedience.

| Key | Request / context | Expected outcome |
| --- | --- | --- |
| WW1 | `/skill:jag-wait-what` after a confusing Spanish answer, without a glossary | Restores the missing premise in plain Spanish, retains caveats/evidence, and stops without files or task continuation. |
| WW2 | `/skill:jag-wait-what explain the decision` with canonical context vocabulary | Clarifies the requested decision with the existing terms; does not invent a competing glossary or edit domain documents. |
| GR1 | Stress-test an idea with dependent decisions and an inspectable fact | One question at a time; checks the fact directly, waits for the user's decision and revisits downstream assumptions. |
| GR2 | Confirm the interview's understanding without authorizing implementation | Summarizes settled choices and limits, then stops; agreement does not initiate edits or Git delivery. |

## Session evidence workflows

The manual `jag-retro` adaptation uses Matt Pocock's `retro` at revision `49dd158d1076134a641b33efb035946536778336`. After user `/reload`, invoke `/skill:jag-retro` for the current session. Explicit invocation authorizes only the learning report; use `/skill:jag-retro current session, inline only` for no writes. It is not automatically selected after a task, and does not apply its proposals.

The report records scope, redacted evidence, supported learning, hypotheses, ranked proposed changes and verification limits. Historical logs need explicit bounded scope/access; missing or stale evidence stays unknown. Existing output files are preserved on collision. No transcript export, production access, memory sync, checks execution, installation, Git operation or environment repair follows automatically.

The three existing workflow owners receive small, separate updates:

- `jag-agent-docs` 1.1.0 owns check-versus-prose classification. Inspect existing checks and wiring before adding instructions; distinguish missing, unwired, broken, effective and unknown. Effective requires relevant execution evidence. Retro reuses this guidance rather than duplicating it.
- `jag-evidence` 5.0.3 keeps one discovery file and separates precise blocked questions, not-yet-specified in-scope areas and exclusions. Existing edge dispositions and user-owned business decisions remain unchanged. No tracker is added.
- `jag-arch-ideas` 4.1.1 adds an explicitly requested candidate-survey mode. It returns inline alternatives with evidence, ADR conflicts, expected benefits labelled as hypotheses and a first reversible validation. It may conclude that no change is justified. It stops before ADR/plan creation or implementation. The ordinary design mode still produces one ADR and one plan.

All three retain their original import identities; provenance records the separate source consultations. No new Grill/Domain wrapper or Chief of Staff coordinator is added.

### Manual coverage (not run automatically)

| Key | Request / context | Expected outcome |
| --- | --- | --- |
| RETRO-01 | `/skill:jag-retro` with a session mistake and an existing unwired check | Saves one redacted learning report; proposes wiring the existing guard rather than another rule/check; applies no repair and runs no check. |
| RETRO-02 | Request an unavailable historical session, then an inline-only review; repeat a saved report basename | Requests only bounded source access or records missing coverage, never scans other projects; inline mode writes nothing; saved collisions preserve the original artifact. |
| RETRO-03 | A judgment rule, missing guard, suspected instruction no-op and stale check receipt | Distinguishes remedy types and observations/hypotheses; stale effectiveness is unknown; no invented benefit or automatic repair. |
| DISCOVERY-01 | One precise blocked decision, one vague in-scope area and one explicit exclusion | Records each separately in one discovery; no premature decomposition or scope expansion; relevant uncertainty blocks final planning. |
| ARCH-SURVEY-01 | Request candidate review of an area with an ADR, then inspect an area without evidenced friction | Reports evidence and ADR conflicts, asks for a choice and stops; no automatic artifacts, browser or implementation. No material candidates is valid. |

These manual cases are not executed by text/discovery tests. Passing structural checks does not prove model behavior or future learning efficacy.

## Media workflows

`jag-slidev` and `jag-whisper` adapt Agents Orchestrator revision `ea3158595b56d832e79b41c4c16175f45cd67ea2`, retaining upstream versions 1.2.0 and 1.1.1 in provenance. Both local versions are 2.0.0, adaptation 2.0.0, status `testing`. New names require native `/reload`; registry refresh alone does not authorize them.

- **Slidev:** generated decks use a chosen directory, three bundled retro themes and explicit expected-diagram counts. The helper validates a documented fence subset; HTML comments/YAML, nested and imported diagrams require separate coverage. Full PNG export and inspection of every slide in each used scheme remain mandatory before a verified completion claim.
- **Whisper:** local recording transcription uses a private per-run directory. Transcript-only assembly avoids model ingestion; optional summary processing requires an explicit provider/privacy boundary and tracked coverage. The local Node assembler preserves recognized text in a safe fence, rejects malformed/empty/oversized inputs and refuses output overwrites. Recognition is fallible; no invented speakers or automatic content persistence.
- Runtime prerequisites are optional, not newly installed harness dependencies. No browser, model, dependency, publication or active-configuration change follows merely from discovery.

### Manual media checks (not run automatically)

| Key | Preconditions and request | Expected outcome |
| --- | --- | --- |
| MEDIA-SLIDEV-01 | Authorized disposable deck with installed Slidev, matching Mermaid and Chromium; choose each theme in light/dark | Check diagram count/parse, then full export and inspect cover/content/diagram slides in all six combinations. Record fonts, counts, scheme and defects. Missing dependencies/image access yields incomplete verification, not installation or a false done. |
| MEDIA-WHISPER-01 | Authorized nonsensitive recording and local Whisper/model/ffmpeg; compare transcript-only and authorized summary requests | Transcript-only exposes metadata, not recording/log text, to the model. Summary mode discloses provider processing and records coverage. Raw JSON text is retained; repeated/concurrent basenames use distinct private runs and output collisions stop safely. |
| MEDIA-WHISPER-02 | Silent/invalid media, unavailable model, long transcript and cancellation | Report actual failure or partial coverage; do not invent text, download a model, use a cloud fallback, clear a shared directory or delete recording/run files. |

Synthetic helper tests and native discovery do not establish transcription accuracy, browser rendering, real-model compliance or network isolation.

## Optional document authoring

Build a document together by requesting `interactive mode`, `section by section`, or equivalent wording in your language. Supported skills:

- `jag-docs`, `jag-prd`, `jag-prd-lite`, `jag-rfc`, `jag-adr`, `jag-usm`.
- `jag-jira` (User Story, Task, Spike).

```text
/skill:jag-rfc interactive mode: propose asynchronous email delivery
```

Confirm the section order, answer one missing-input question at a time, and review each section's draft. The agent waits for explicit approval before advancing and carries approved text forward. Earlier decision changes reopen affected sections. After every section is approved and validation passes, the agent assembles the complete document for final review. Pause or leave the mode at any time.

Existing defaults remain unchanged, including Jira Quick Creation and explicit Refinement. Templates, evidence, validation, artifact language and output formats still apply. Section approval does not authorize file writes or publication. No new command, skill or Test Plan skill is added. Local versions are 1.1.0 for `jag-docs`, 3.0.1 for `jag-jira` and 2.1.0 for the other five; adaptation 2.1.0 (`jag-jira` 3.0.1), status `testing`.

### Manual coverage: DOC-SECTION-01

Not run yet. For each supported skill, compare an explicit interactive request with a normal request:

- Answer a question without approving the draft; expect no advancement. Edit and approve; expect the next section to reuse approved content.
- Revise an earlier decision; expect affected sections to need approval again. Pause and continue from available context; expect no invented state.
- Cancel a closed-choice prompt; expect no approval. Without choice UI, expect a chat question instead.
- Complete the sections; expect the full document in its required format, preserved validation gates and no unauthorized save/publication. The normal request must retain its existing workflow.

Structural tests check these instructions and preserved defaults, not live model behavior.

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

The references retain evidence/confidence rules, caller-owned output, behavior preservation, validation/rollback, real-variation gates, temporal-coupling checks and characterization-test safeguards. They do not authorize code changes during a review. The consolidation itself left the other workflows unchanged; later removals are listed under [Retired skills](#retired-skills). The optional document mode above adds section review only when requested.

The `skills` array in [provenance](skills-provenance.json) lists active resources. `consolidatedSkills` retains each retired source's original metadata, last instruction fingerprint and replacement skill/path/section. These derived references remain Apache-2.0 even under MIT skill bodies. Structural tests verify retention, discovery and search; they do not prove equivalent model behavior or provider savings.

## Retired skills

These 24 names are no longer shipped. Twenty-one restated general engineering knowledge that current models already apply without a skill: the gentle-ai review lenses expected a planning orchestrator this package does not ship, and no prompt, instruction or routing rule loaded them. The three Jira skills were 93% identical and are now one `jag-jira`. Git history keeps the removed text.

| Retired name | Reason | Replacement |
| --- | --- | --- |
| `jag-arch-impact`, `jag-behavior`, `jag-big-o`, `jag-java-naming`, `jag-legacy`, `jag-logs`, `jag-nulls`, `jag-risk`, `jag-scope`, `jag-seams`, `jag-test-scope`, `jag-tool-matrix`, `jag-tools`, `jag-types`, `jag-validation` | Redundant general knowledge (gentle-ai lenses) | None |
| `jag-java-api`, `jag-java-errors`, `jag-java-model`, `jag-java-secure` | Redundant general Java knowledge | None; `jag-java-test` and the `jag-refactor` Java gate remain |
| `jag-prompts`, `jag-refine` | Redundant prompt-writing and summarizing | None |
| `jag-jira-story` | Merged | [`jag-jira` User Story](../skills/jag-jira/SKILL.md#user-story) |
| `jag-jira-task` | Merged | [`jag-jira` Task](../skills/jag-jira/SKILL.md#task) |
| `jag-jira-spike` | Merged | [`jag-jira` Spike](../skills/jag-jira/SKILL.md#spike) |

`jag-refactor` and `jag-java-test` also dropped their bundled textbook catalogs (Fowler's technique files and the legacy-testing references); their own workflow, conventions, selection heuristics, smell lenses, Java gate and setup references remain.

Run native `/reload` after upgrading. Copies of these names from other sources are not moved or disabled. Update explicit resource paths/filters and plan `Skills:` fields yourself; immutable plans and historical reports are not rewritten. The `retiredSkills` array in [provenance](skills-provenance.json) keeps each name's upstream identity, author, license, last instruction fingerprint, reason and replacement.

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
| Renamed, invalid or missing skill | Unavailable until fixed/reloaded; a stale index entry cannot enable it. |
| Manual-only metadata | Preserved from both native and current metadata; use an explicit `/skill:<name>`, not automatic lookup/delegation. |

There is no idle watcher. Public extension APIs do not expose every authoritative discovery input, so unrestricted live registration was deliberately excluded rather than implemented through private hooks. New native command autocomplete may also require reload.

### In-memory index and limits

The index lives only in the extension's memory for the current session; nothing is written to the project, its Git root or Pi's agent directory. Startup records a pending index; the first request or explicit refresh resolves it. Entries hold names, descriptions, source/origin/scope, canonical paths, status, content/resource fingerprints and diagnostics. `/orchestraitor:skills status` reports counts, and loading an unavailable name returns its diagnostic. Earlier versions wrote `<nearest Git root>/.ai/skills/registry.md`; that file is no longer read or updated and can be deleted.

Inspection caps the native catalog at 1,000 entries, instructions at 40 KiB, individual resources at 1 MiB, and each skill at 1,000 files / 8 MiB / 2,000 enumerated entries / 32 directory levels. Hidden entries and `node_modules` are skipped; resource symlinks and special files make that skill unavailable. Standalone Markdown skills include only their instruction file and known resource directories. These limits can reject otherwise native-valid skills; native mode is the explicit fallback. Selected project skills below protected metadata roots, including packages installed in the project under `.pi/npm` or `.pi/git`, must live in skill subdirectories for child delegation.

See [offline savings and limitations](performance.md) and [child resolution](subagents.md).

## Pi adaptations

- Every skill declares Pi compatibility and a separate `pi_adaptation` version. The namespace rename baseline is 2.0.0; consolidation recipients use 2.1.1 after the discovery-vocabulary correction, with the `jag-code` pointer correction at 2.0.1. Dropping the textbook catalogs moved `jag-refactor` to 2.2.0 and `jag-java-test` to 2.1.0; the merged `jag-jira` uses 3.0.1. Original upstream versions remain in provenance.
- Skill routing uses native-authorized names and descriptions via `skill_registry`, or the native catalog when unavailable. Catalog suppression does not rewrite source bodies/resources; executors load selected names. The routing adaptation is 2.0.0.
- Closed questions use an available Pi UI choice mechanism, with ordinary chat as the fallback. No OpenCode question tool is assumed.
- `jag-plan` and its template produce a short plan: outcome, scope, steps, checks and risks. Plans are executed only after an explicit user instruction and never commit on their own.
- `jag-skill` uses the Pi package layout/discovery checks and a bundled template. Its conditional `jag-agent-docs` pointer loads shared writing guidance only when natively available; it creates no runtime, installer or manual-catalog dependency.
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
| Current technical documentation | Installed docs, types and source for installed packages, Pi included; Context7 for libraries that are not installed, disclosed when unavailable. |
| Code graphs | Optional configured graph integration; normal source inspection is the fallback. No graph indexer is installed or launched. |
| Knowledge-base publishing | Optional configured destination, with explicit publishing authorization. |
| Slidev decks | Authorized deck-local Slidev/Seriph, Playwright Chromium, fonts and Mermaid checker dependencies; image inspection is a completion gate. |
| Media transcription | Local openai-whisper, ffmpeg and authorized cached/downloaded weights; Node >=22.19 for private artifact assembly. Provider processing needs explicit authorization for summaries. |

Missing optional tooling limits that operation, without inventing tools or silently installing software.

## Catalog

Each entry maps the shipped name to its original name, version and SKILL.md license; consolidated reference licenses are noted above. The [provenance file](skills-provenance.json) contains all domain paths, resource fingerprints, and changed resource names.

| Skill | Upstream name | Upstream version | License | Source domain(s) |
| --- | --- | --- | --- | --- |
| [jag-absorb](../skills/jag-absorb/SKILL.md) | `absorb` | 1.2.4 | MIT | meta |
| [jag-adr](../skills/jag-adr/SKILL.md) | `adr` | 2.0.0 | MIT | architecture, docs |
| [jag-arch-ideas](../skills/jag-arch-ideas/SKILL.md) | `architecture-ideation` | 4.0.0 | MIT | architecture |
| [jag-arch-map](../skills/jag-arch-map/SKILL.md) | `architecture-map` | 2.0.1 | MIT | architecture |
| [jag-arch-state](../skills/jag-arch-state/SKILL.md) | `architecture-state` | 2.0.1 | MIT | architecture |
| [jag-issue](../skills/jag-issue/SKILL.md) | `buildable-issue` | 2.1.3 | MIT | docs |
| [jag-code](../skills/jag-code/SKILL.md) | `code-conventions` | 2.0.1 | MIT | architecture, common, orchestration, plan, review |
| [jag-docs](../skills/jag-docs/SKILL.md) | `cognitive-doc-design` | 1.0.2 | Apache-2.0 | docs, orchestration |
| [jag-dep-audit](../skills/jag-dep-audit/SKILL.md) | `dependency-security-audit` | 2.1.2 | MIT | architecture |
| [jag-patterns](../skills/jag-patterns/SKILL.md) | `design-patterns-pragmatic` | 1.1.0 | MIT | architecture, common, plan |
| [jag-domain](../skills/jag-domain/SKILL.md) | `domain-modeling` | 1.0.4 | MIT | common, plan |
| [jag-evidence](../skills/jag-evidence/SKILL.md) | `evidence-first-planning` | 5.0.0 | MIT | plan |
| [jag-plan](../skills/jag-plan/SKILL.md) | `execution-plan` | 1.1.1 | MIT | architecture, common, plan |
| [jag-grill](../skills/jag-grill/SKILL.md) | `grilling` | 2.0.0 | MIT | common, plan |
| [jag-routing](../skills/jag-routing/SKILL.md) | `implementation-skill-routing` | 3.0.0 | MIT | architecture, common, orchestration, plan |
| [jag-java-test](../skills/jag-java-test/SKILL.md) | `java-testing` | 3.2.1 | MIT | architecture, orchestration, plan |
| [jag-jira](../skills/jag-jira/SKILL.md) | `jira-user-story`, `jira-task`, `jira-spike` | 2.0.0 | MIT | docs |
| [jag-prd](../skills/jag-prd/SKILL.md) | `prd` | 2.0.0 | MIT | docs |
| [jag-prd-lite](../skills/jag-prd-lite/SKILL.md) | `prd-light` | 2.0.0 | MIT | docs |
| [jag-practices](../skills/jag-practices/SKILL.md) | `programming-practices-core` | 1.0.4 | MIT | common, review |
| [jag-refactor](../skills/jag-refactor/SKILL.md) | `refactor` | 1.3.0 | MIT | plan |
| [jag-repo-issues](../skills/jag-repo-issues/SKILL.md) | `repo-issues` | 2.1.1 | MIT | architecture |
| [jag-rfc](../skills/jag-rfc/SKILL.md) | `rfc` | 2.0.0 | MIT | docs |
| [jag-boundaries](../skills/jag-boundaries/SKILL.md) | `service-boundary-analysis` | 2.0.0 | MIT | architecture |
| [jag-skill](../skills/jag-skill/SKILL.md) | `skill-creator` | 2.0.1 | Apache-2.0 | meta |
| [jag-summary](../skills/jag-summary/SKILL.md) | `summarize` | 1.0.3 | MIT | docs |
| [jag-debug](../skills/jag-debug/SKILL.md) | `systematic-debugging` | 1.0.0 | MIT | common, orchestration |
| [jag-usm](../skills/jag-usm/SKILL.md) | `usm` | 2.0.0 | MIT | docs |
| [jag-agent-docs](../skills/jag-agent-docs/SKILL.md) | `writing-for-agents` | unversioned | MIT | Matt Pocock: productivity |
| [jag-pr](../skills/jag-pr/SKILL.md) | `pr` | unversioned | MIT | Matt Pocock: engineering; HumanLayer visual credit |
| [jag-handoff](../skills/jag-handoff/SKILL.md) | `handoff` | unversioned | MIT | Matt Pocock: productivity |
| [jag-retro](../skills/jag-retro/SKILL.md) | `retro` | unversioned | MIT | Matt Pocock: engineering; explicit-only |
| [jag-research](../skills/jag-research/SKILL.md) | `research` | unversioned | MIT | Matt Pocock: engineering |
| [jag-teach](../skills/jag-teach/SKILL.md) | `teach` | unversioned | MIT | Matt Pocock: productivity |
| [jag-wait-what](../skills/jag-wait-what/SKILL.md) | `wait-what` | unversioned | MIT | Matt Pocock: productivity |
| [jag-slidev](../skills/jag-slidev/SKILL.md) | `slidev-retro-deck` | 1.2.0 | MIT | docs; media adaptation |
| [jag-whisper](../skills/jag-whisper/SKILL.md) | `whisper-extract` | 1.1.1 | MIT | docs; media adaptation |

## Excluded capabilities

The historical source's learning-domain skills remain excluded; the direct, explicit-only `jag-teach` addition above is the user-selected exception. `ask-matt`, `jag-guide`, and the external navigation map are not adopted. `graphify-cli`, `judgment-day`, `sdd-cold-verification`, `tcr`, `work-unit-commits`, `chained-pr`, `caveman`, and `grill` are excluded from this delivery. `jag-grill` (upstream `grilling`) is a distinct, included design interview skill. Existing user copies of excluded names are left in place.
