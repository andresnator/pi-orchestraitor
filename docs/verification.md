# Verification evidence

The current deterministic baseline is Pi 1.0.4, Node 22.19+, and pnpm 12.9.1. Engram 3.0.0 is required only for memory. Development checks use the locked local host; rerun them before upgrading or distributing the package.

| Command | Claim checked |
| --- | --- |
| `pnpm test` | Native tool regressions, instructions and personality injection, tarball resources and 56 native / 54 automatic / two explicit-only skill names, adapted workflow contracts/credits, consolidated review criteria/discovery, prompt expansion, MCP overrides, migration, rollback, and restoration. |
| `pnpm run test:mcp` | Real Context7 and Engram calls through native codemode, extension hooks, and project separation in temporary memory storage. |
| `pnpm run test:personality` | Configured-model responses in fresh isolated sessions, with predefined criteria and synthetic receipts for manual scoring. |
| `pnpm run install:pi --dry-run` | Complete lexical discovery inventory, including aliases hidden by native deduplication, and proposed standalone-skill moves, without migration or registration. |
| `pnpm pack --dry-run --ignore-scripts` | Distributed resource inventory and exclusion of tests, local reports, and personal data. |

## Initial private Git distribution and CI

The package is distributed through the private `andresnator/pi-orchestraitor` GitHub repository. `private: true` prevents accidental npm publication; the explicit Pi manifest and host-provided peers remain unchanged.

Fresh local checks on Pi 1.0.4 and Node 24.20.0:

- Before the fixture repair: `npm test` passed 431/432; the synthetic codemode loadout omitted `getPromptGuidelines`.
- After adding the callback from the real tool definition: the focused codemode suite passed 11/11 and `npm test` passed 432/432, with no skipped tests.
- `npm pack --dry-run --ignore-scripts` includes 247 files, including `docs/usage.md`, and excludes tests, `.ai`, and `.github`.
- `git diff --check` passed. Changes remain unstaged; no commit, push, publication, or personal Pi registration was performed.

`.github/workflows/ci.yml` runs deterministic tests and package inventory checks on Ubuntu with Node 22.19.0 and 24.20.0, using pinned Pi 1.0.4. Live MCP, Pretty, real-model personality checks, and visible terminal acceptance are not CI gates. At this initial preparation checkpoint, GitHub-hosted execution and the Node 22/Linux matrix had not yet run; local success was not remote CI evidence. Historical failed-fixture receipts below remain unchanged.

Official packaging reference: [Pi packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md). Installed Pi 1.0.4 documentation was the version-specific authority; Context7's indexed Pi versions did not include 1.0.4.

## pnpm development migration — 2026-10-07

The previous npm-based hosted CI passed both Node jobs with zero annotations in [run 37535400922](https://github.com/andresnator/pi-orchestraitor/actions/runs/37535400922). The new pnpm-based workflow has not been pushed or executed on GitHub.

| Fresh local check | Observed result |
| --- | --- |
| Release cooldown | All eight previously blocked Pi/chord 1.0.4 versions exceeded 24 hours; no age exceptions added. |
| Dependency script gate | First install rejected genai 2.21.0, esbuild 0.28.2 and protobufjs 7.6.6 scripts. Each exact version was explicitly denied; no scripts approved. |
| Frozen installation | Passed with the complete lockfile; a fresh temporary offline install also passed and used Pi 1.0.4 without changing the lockfile. |
| Negative policy probes | A stale manifest failed with `ERR_PNPM_OUTDATED_LOCKFILE`; an unreviewed esbuild script failed a fresh install with `ERR_PNPM_IGNORED_BUILDS`. Both probes used temporary directories. |
| Compatibility RED/GREEN | Observed shim-based host discovery and missing nested dependency imports before adapting test-only host fixtures. A new pnpm packing case also failed on its absolute output filename before normalization. |
| Final `pnpm test` | 439/439 passed, zero skipped, on Node 24.20.0 and the locked Pi 1.0.4 SDK. Includes four host-layout tests, two policy tests and both pnpm/npm extracted-package cases. |
| Packing | pnpm dry-run includes 247 resource files; tests, development modules, lockfile, workspace policy, `.ai` and `.github` remain excluded. Both extracted tarballs load resources and the child bootstrap without bundled host dependencies. |
| Dependency audit | `pnpm audit` reported zero known advisories at check time. One transitive dependency, `node-domexception@1.0.0`, has a deprecation notice; it was not independently replaced. Audit is not a safety guarantee. |

The CI host now comes from `pnpm install --frozen-lockfile`, not an untracked global npm installation. Checkout, setup-node and pnpm setup are pinned by commit SHA and use Node 24 runtimes; the runner remains `ubuntu-24.04` and the test matrix remains Node 22.19.0/24.20.0. Cache is disabled. CI checks that installation/testing did not rewrite the lockfile or policy.

The pnpm 12 lockfile contains separate YAML documents for package-manager and project dependencies. Test fixtures resolve private host dependency paths through the selected host's module tree, covering npm's nested and pnpm's sibling layouts. The production extension and installer behavior is unchanged; runtime peers remain `*`, with Pi only in `devDependencies`. See [development security](usage.md#development-security) for the install policy and its limits.

This migration has no commit, push, publication, live MCP/model/Pretty checks or visible-terminal acceptance. The assistant did not stage or unstage files. The index initially contained three migration files; final verification observed all migration changes staged externally, and that state was left intact. Node 22/Linux execution of the pnpm workflow remains unperformed.

## pnpm installer entry point — 2026-10-07

The recommended entry point is `pnpm run install:pi --dry-run`, then `pnpm run install:pi`. A fresh checkout first needs `pnpm install --frozen-lockfile` to obtain the locked local CLI.

The previous migration adapted test fixtures but left production host discovery unable to recognize pnpm's `.bin` shim. Fixture propagation of `PI_TEST_PACKAGE_DIR` hid the normal invocation failure. Two new checks failed before the production fix: selected-shim discovery and a real pnpm installer invocation with the SDK override removed.

`scripts/pi-host.mjs` now validates and canonically resolves the linked host package beside the PATH-selected shim. Existing npm-style symlink/global discovery and explicit overrides are retained; an incorrectly named sibling package is rejected. Installer help and setup/recovery examples use pnpm argument forwarding without an extra `--` separator.

- Targeted discovery, installation and migration checks: **16/16 passed**, zero skipped.
- The new real-command check previews the default Pretty plan without writes/downloads, then registers with `--without-pretty` in a temporary project/profile. No personal Pi configuration or shared skills are modified.
- Latest full suite: **516/516 passed**, zero skipped. At this turn's baseline, concurrent BTW work produced six unrelated failures in a smaller suite; that work was not modified by this installer correction and subsequently passed. These changing test counts are not an attributable improvement claim for the installer fix.
- Latest pnpm package dry-run: **255 files**, excluding tests, development modules, pnpm lock/policy and local state. The resource count includes concurrent BTW work.
- No commit, push, publication or hosted CI rerun was performed. Existing concurrent changes were preserved; the Git index was empty at this correction's start.

## BTW repository integration — 2026-10-07

Imported the user's standalone BTW into `extensions/btw/`, retaining its 70% width/height and temporary, tool-free side-conversation contract. UI/diagnostics are translated to English; replies still follow the user's language. The 71 existing Vitest cases were ported to the repository's Node test/assert convention without adding a second test runner.

| Fresh local check | Observed result |
| --- | --- |
| Standalone baseline | 71/71 tests and its existing TypeScript check passed before import. |
| Package registration RED/GREEN | Two targeted tests failed before the import/manifest entry, then passed with one bundled BTW owner and exact exclusion of the standalone index. |
| Imported cases | 71/71 passed using Pi's native TypeScript/peer mapping and fake providers. |
| Extracted tarballs | Both pnpm/npm cases initially failed on missing `beautiful-mermaid`; frozen offline production-only dependency provisioning fixed the fixture. Package suite passed 6/6. |
| Full `pnpm test` | 516/516 passed, zero skipped, on Node 24.20.0 and the locked Pi 1.0.4 host, including concurrent pnpm-related work preserved in the checkout. |
| Imported-source typecheck | Passed using the standalone extension's installed TypeScript compiler and a temporary `/tmp/pi-btw-tsconfig.json` mapping peers to the locked host. This is not a new CI gate or a packaged compiler dependency. |
| Frozen install / packing / whitespace | `pnpm install --frozen-lockfile`, `pnpm pack --dry-run --ignore-scripts`, and `git diff --check` passed. BTW's seven source files and guide are packed; tests, host/dependency modules, and personal configuration are not. |

The manifest adds pinned `beautiful-mermaid@1.1.3` and an optional host-provided `pi-ai` peer. The original global extension is retained and excluded by its index path in this user's settings; reload/restart is required. Other installations must disable their own original copy through `pi config`. No live provider, visual terminal acceptance, hosted Node 22/Linux CI, commit, push, or publication was performed for this integration. See [BTW operations](btw.md).

## NAN repository integration — 2026-10-07

Added `extensions/nan.ts` as an additional native provider with the seven chat definitions from NAN's official Pi guide. The extension uses Pi 1.0.4's `createProvider`, `envApiKeyAuth`, and lazy `openAICompletionsApi` via the host-mapped `pi-ai/compat` entrypoint. No dependency, personal configuration, credential, or default-provider change is part of this integration. Context7 had no indexed 1.0.4 documentation; installed documentation/types supplied exact-version API evidence.

| Fresh local check | Observed result |
| --- | --- |
| Registration/reload RED/GREEN | Two targeted cases failed before the source/manifest entry, then passed with one NAN provider and unchanged settings/session model. |
| Provider regressions | **11/11 passed**: official metadata, unavailable-without-key, environment fallback, secret API-key prompt, stored-key precedence, logout, cancellation before/during login, text/tool SSE, request auth/compatibility/usage, reload, and personal model overrides. |
| Targeted provider/package/UI suite | **35/35 passed**, zero skipped; pnpm/npm extracted tarballs register the native NAN provider and seven models. |
| Full `pnpm test` | **527/527 passed**, zero skipped, on Node 24.20.0 and the locked Pi 1.0.4 host. Existing BTW/pnpm/host changes were preserved. |
| Source typecheck | Strict `noEmit` check passed using existing TypeScript 5.9.3 and a temporary `/tmp/pi-nan-tsconfig.json` mapping declarations to the locked host. No new compiler dependency or CI gate. |
| Frozen install / packing / whitespace | `pnpm install --frozen-lockfile`, `pnpm pack --dry-run --ignore-scripts`, and `git diff --check` passed. The source and NAN guide are packed; tests, host modules, local state, and credentials are not. |

Keys in tests are synthetic and native transport responses are mocked; no real NAN login, membership/quota validation, inference, visible TUI acceptance, hosted Node 22/Linux CI, commit, push, or publication was performed. The Git index remains empty. `/login nan` requires a user-provided dashboard API key; native login stores it locally without remote validation. Zero per-token rates cannot represent membership fees or quota. See [NAN operations](nan.md).

## Evidence boundaries

Structural tests prove resource discovery, wiring, and regression behavior. They do not guarantee instruction compliance by every model. The bounded personality check evaluates concrete responses against language, tone, disagreement, and artifact-language criteria; slang is optional.

The package's established test convention is `node:test` and `node:assert`. That repository convention takes precedence over the skill's default fluent assertion preference.

## Historical review-lens consolidation — 51-skill baseline

The earlier consolidation reduced the package to 51 active names, retaining ten standalone review skills as conditional references under `jag-practices`, `jag-refactor` and `jag-patterns`. Fresh local checks passed 421/421 tests with no failures or skips, including native catalog diagnostics, twenty discovery queries, rejection of retired activation names, reference criteria/attribution/fingerprints, tarball loading and isolated installation/migration. Three new consolidation checks failed before implementation; an expanded discovery check also failed before missing routing terms were restored.

Follow-up discovery correction: `tests/skill-consolidation.test.mjs` adds a separate regression case for `overengineering`, `identifiers`, `speculative`, `oversized`, `extraction`, `collaborators`, and `extension pressure`. All seven lookups failed before the description fix; afterward all 27 bounded discovery queries pass and a fresh local suite passes 422/422 with no failures or skips. Recipient metadata uses `pi_adaptation` 2.1.1 with matching resource fingerprints; registry search logic and conditional reference content are unchanged.

The retired source records remain in `consolidatedSkills` with previous instruction hashes and replacement sections; active resources remain in `skills`. The Apache-2.0 references retain their original author/adaptation notices. Jira, PRD/USM and reading skills were not changed. Historical results below are preserved at their original counts. Interactive `/reload`, live MCP and real-model behavior were not rerun for this consolidation; structural tests do not establish equivalent model task quality or token savings.

## Matt Pocock workflow adaptations — 2026-10-06

Executed `.ai/deep-planner/plans/mattpocock-skill-adaptations.md` against HEAD `a9a42fdb5316ed5ef88d71c59a7383e1aedd401e`, with Pi 1.0.4 and Node 24.20.0. The original plan/checkboxes remain unchanged, SHA-256 `3803feb20495cb62bc710667730bd32a894603947a35ed3033f1dd822e5048dd`. Changes are unstaged; no runtime, configuration, dependency, prompt command or Git delivery change is included.

| Check | Observed result |
| --- | --- |
| Unchanged full-suite baseline | 421/422 passed; one pre-existing codemode fixture failure, zero skipped. |
| Initial structural RED | Ten new tests failed before implementation: missing skills/licenses and unchanged domain, inventory/provenance and authoring-pointer contracts. |
| Group checks | Agent-docs/authoring pointer 2/2; PR, handoff, research, domain and teaching targeted checks passed. Exact-path/metadata correction: three RED cases, then six contract checks GREEN. |
| Bounded final readers | Two read-only reviewers terminated without writes. Parent confirmed three textual PR/handoff gaps, observed two targeted RED cases, and checked GREEN 2/2 after one correction pass. No independent/blind review claim. |
| Final integration command | Exit 0: 29/29 passed, zero failures/skips; exact extracted tarball resources, all SHA-256 values, native discovery and explicit-only rejection. |
| Final `npm test` | Exit 1: 431/432 passed, one unchanged baseline failure, zero skipped. |
| Final package/diff/scope/hash | Dry-run exit 0: 246 files, including separate notices and all skill resources, excluding tests/`.ai`/personal state. Diff/changed-file whitespace checks passed; 16 modified tracked files and 22 new untracked files, zero staged. Original plan hash unchanged. |
| Preservation and source comparison | All 17 freshly pinned files matched prior source caches. Historical root/consolidation records and 49 unrelated provenance entries are unchanged; original domain/skill-creator import identities retained. Runtime, prompts, installer/dependencies, original license notices, `jag-adr` and `jag-prompts` unchanged. |

The only full-suite failure observed before and after implementation is `shouldCompactRealCodemodeProgressAndRestoreNativeDetailsAndStoreOnExpansion` in `tests/compact-orchestration.test.mjs:54,84`: the fixture omits `getPromptGuidelines`, required by installed Pi 1.0.4. This pre-existing host/fixture mismatch is outside the plan; it remains unchanged and the full suite is not described as passed.

The package adds `jag-agent-docs`, `jag-pr`, explicit-only `jag-handoff`, parent-led `jag-research` and explicit-only `jag-teach`, updating `jag-domain` defaults/authorization while retaining its historical import identity. Complete pinned MIT notices and layered Dex Horthy/HumanLayer PR credit are preserved. Native catalog/registry checks verify 56 total, 54 automatic and two manual-only with no diagnostics; source-level contracts and template checks do not establish general model compliance or learning effectiveness.

Seventeen source/license files were retrieved from the two pinned revisions for source/hash comparison. The conditional `jag-skill` pointer was authored with G2 rather than its G8 integration slot, then revalidated in G8; overall file authority was unchanged. Attribution/resource fingerprints and historical benchmark/consolidation identities remain intact. Detailed concise receipts are local at `.ai/verification/mattpocock-skill-adaptations/checks.md`, excluded from distribution.

Live MCP/personality/model/browser/publication checks and interactive new-command activation were not run for this change. After delivery, the user runs `/reload`, then inspects `/skill:jag-handoff`, `/skill:jag-teach` and the other commands. New files or registry refresh alone do not authorize new names. Prior audits, plans and historical receipts are preserved; `jag-adr` and `jag-prompts` are unchanged.

## English audit

Repository documentation, code, comments, skill instructions, templates, diagnostics, and compact-tool labels use English. Intentional literal exceptions are copyright holder names, the source personality's quoted Colombian expressions, Spanish punctuation examples, and multilingual inputs/outputs in behavioral receipts. These literals do not change the language of explanatory prose or generated repository artifacts.

## Initial package run

Verified on 2026-10-03:

| Check | Result |
| --- | --- |
| Local regression suite | 72/72 passed, including native project installation, repeated installation, restore preview, protected configuration roots, configured symlink trees, repository ownership, duplicate aliases, and home-relative registration rollback in temporary configuration. |
| Tarball loading | All 61 names load from the extracted package, with no personal skill dependency or selected-name collisions; all resource fingerprints and local Markdown references resolve. |
| MCP integration | 1/1 passed: real Context7 query and Engram save/search through native codemode, four nested tool-call hooks, and separate alpha/beta memory results. |
| Personality wiring | One automatic section across repeated turns, all four host modes, and extension reload; host and project instructions preserved. |
| Personality behavior | 4/4 manually assessed scenarios passed using the configured `openai-codex/gpt-6-astra` model: Spanish explanation, English disagreement, formal Spanish correspondence, and English README/code/comments. |
| English audit | Repository and bundled-resource text inspected; remaining non-English strings are the documented intentional literals. |
| Personal state after initial checks | The 29 original shared skills were present; personal Pi `packages` was empty. No personal package installation was retained by those checks. |

The installer review fixes added 29 regression tests. Native installation fixtures reproduced the original failures before the fixes and now verify successful migration or exact rollback. The complete suite was rerun after the fixes; the MCP and model results above come from the earlier run on the same date. These installer checks use temporary settings and do not install the package into personal configuration.

The inventory adapter uses Pi's own discovery and filtering before canonical-path deduplication. It retains configured boundaries and every lexical alias, and keeps native effective-resource resolution for final verification. Required private host hooks are checked before migration; revalidate this adapter after a Pi upgrade.

The model run used 12,795 reported tokens and reported an estimated cost of USD 0.132878. It used one fresh session per scenario, so the result describes this bounded run. Synthetic criteria, raw receipts, and manual assessment are retained under `.ai/verification/personality/2026-10-03T10-26-49.340Z/` and excluded from Git and the package.

The native installation test excludes the real shared catalog with Pi's `!pattern` syntax and asserts the complete preview before any mutation. An initial isolation test used exact-path exclusion syntax with a wildcard; it temporarily moved the 29 shared skills and restored them before returning. Restoration and the unchanged personal package list were verified, and the corrected test passes with only temporary skill paths.

## Review, error rendering and subagents — initial deterministic run

Verified on 2026-10-03 with Pi 1.0.0 and Node 24.20.0:

- `npm test`: **117 passed, 0 failed, 0 skipped**. This includes extracted-package loading and bootstrap, native tool preservation, narrow terminals and Unicode, terminal control stripping, selected-resource isolation, parent tool selection, model selection, filesystem guards, overlapping readers, exclusive writers, fragmented/duplicated RPC, provider/empty-response failures, startup and task deadlines, cancellation and confirmed termination.
- A native SDK/RPC child was started, its guard and `get_state` checked, and its input closed to confirm exit. **No model prompt was sent.** Other process behavior uses local fixtures. An unconfirmed-exit fixture verifies that new launches remain blocked and the process reference is retained.
- The new collapsed-error and terminal-control tests failed before the presentation fix and passed afterward. Case-alias protection and global-context filtering likewise have observed failing and passing runs. Initial policy tests first failed because the new module did not exist; this is creation evidence, not a pre-existing behavioral regression. Prompt/documentation changes were checked through package discovery and diff inspection rather than an artificial RED/GREEN claim.
- `git diff --check` passed; changes remain unstaged. The original `.ai/absorb/2026-10-03-gentle-shell.md` analysis was retained unchanged (SHA-256 `d5362c0a470ed838e4d18eb43038a0512994fe53bd6a793876cf8de2bbcc667b`).

The historical MCP/personality results above were **not rerun** for this change. Real-model subagent scenarios are listed separately in [subagents.md](subagents.md#manual-checks-with-a-real-model--not-run-automatically) and remain pending. Tool guards are not an operating-system sandbox; external same-user processes can race path validation. Child responses and operation ledgers still require parent inspection and verification. Cross-session recovery remains outside this delivery.

### Changed-file inventory

- `README.md`
- `docs/skills-provenance.json`
- `docs/subagents.md`
- `docs/verification.md`
- `extensions/compact-tools.ts`
- `extensions/subagent/child.mjs`
- `extensions/subagent/controller.mjs`
- `extensions/subagent/guard.mjs`
- `extensions/subagent/policy.mjs`
- `extensions/subagent/runtime.mjs`
- `extensions/subagents.ts`
- `instructions/core.md`
- `instructions/orchestraitor.md`
- `package.json`
- `prompts/orchestraitor.md`
- `prompts/plan.md`
- `prompts/review.md`
- `skills/absorb/SKILL.md`
- `skills/execution-plan/SKILL.md`
- `tests/compact-tools.test.mjs`
- `tests/fixtures/subagent-child.mjs`
- `tests/fixtures/subagent-native-child.mjs`
- `tests/mcp.test.mjs`
- `tests/package.test.mjs`
- `tests/subagent-controller.test.mjs`
- `tests/subagent-extension.test.mjs`
- `tests/subagent-policy.test.mjs`
- `tests/subagent-runtime.test.mjs`


## First review comment fixes

Verified on 2026-10-03 with Pi 1.0.0 and Node 24.20.0:

- Reproduced all three review findings before the fixes: native read/write/edit redirected a validated Unicode-space path to a symlink, a native read filename fallback reached a symlink, the implementer prompt omitted its editable paths, and a temporary-directory failure permanently blocked a retry with no child process.
- Native file operation callbacks now validate the actual resolved destination, including image detection and write-directory creation. Tests verify rejection before outside or unassigned files change and preserve native image results. Write observations name the final validated path and start only when the file write is attempted.
- The implementer prompt includes its complete editable-file list. The controller tracks process creation and confirmed exit across exception handling; temporary-directory, prompt and synchronous spawn failures allow a retry, while the existing unconfirmed-exit test still requires a retained process and blocked launches.
- `npm test`: **128 passed, 0 failed, 0 skipped**. The six initial reproduction checks failed before implementation and passed afterward; five additional checks cover unassigned normalized destinations, image results, and other pre-spawn failure paths.
- `git diff --check` passed. No real-model calls were made. Changes remain unstaged and uncommitted; the original absorb report retains SHA-256 `d5362c0a470ed838e4d18eb43038a0512994fe53bd6a793876cf8de2bbcc667b`.

Files changed for these fixes: `extensions/subagent/guard.mjs`, `extensions/subagent/controller.mjs`, `extensions/subagents.ts`, `tests/subagent-runtime.test.mjs`, `tests/subagent-controller.test.mjs`, `tests/subagent-extension.test.mjs`, `docs/subagents.md`, and `docs/verification.md`.


## Cancellation and Windows review fixes — current deterministic run

Verified on 2026-10-03 with Pi 1.0.0 and Node 24.20.0 on macOS:

- Five targeted checks failed before these fixes: cancellation and timeout omitted a changed file from the returned ledger, and three Windows path checks rejected valid native paths, lost normalized assignments or bypassed the intended link/assignment diagnostics.
- The controller now records only validated, assigned write notifications during teardown and drains the IPC channel after process exit. Completed phases remain completed when attempted phases arrive again. Late control results, invalid phases and out-of-scope writes are ignored. The drain remains bounded and reports an unconfirmed drain.
- Native SDK/RPC child fixtures with a local mock provider execute a real guarded file write, queue its notifications until abort, and verify cancelled/timed-out results include the changed file. A separate fixture delivers its write notification after `exit` and before IPC closure. These tests use no remote model calls.
- Windows path checks use Node's `path.win32` semantics and injected filesystem metadata for root-level, nested, absolute, mixed-separator and selected-skill paths. They also check normalized ledger paths, traversal, drive-relative paths, protected metadata, symlinks, hardlinks and unassigned destinations. **Native Windows execution was not available**; its manual check is listed in `docs/subagents.md`.
- `npm test`: **136 passed, 0 failed, 0 skipped**. `git diff --check` passed. Changes remain unstaged and uncommitted. The original absorb report retains SHA-256 `d5362c0a470ed838e4d18eb43038a0512994fe53bd6a793876cf8de2bbcc667b`.

Files changed for these fixes: `extensions/subagent/controller.mjs`, `extensions/subagent/policy.mjs`, `extensions/subagent/guard.mjs`, `extensions/subagents.ts`, `tests/subagent-controller.test.mjs`, `tests/subagent-policy.test.mjs`, `tests/fixtures/subagent-child.mjs`, new `tests/fixtures/subagent-native-child.mjs`, `docs/subagents.md`, and `docs/verification.md`.

## Compact orchestration output — 2026-10-04

| Check | Result |
| --- | --- |
| `npm test` | 142/142 passed, no skipped cases. |
| `npm run test:mcp` | 1/1 passed with real Context7 and Engram, four nested MCP calls and project-separated synthetic memories in a temporary database. The first restricted-network attempt could not connect to Context7; the network-enabled rerun passed. |
| Native presentation | Real Pi 1.0.0 `ToolExecutionComponent` checks cover one-row live codemode progress, completed output, caught nested failures, script error causes, subagent completion/failure summaries, narrow widths, full expansion and collapse restoration. |
| Native execution and reload | The bound codemode executor runs the real sandbox and nested read pipeline, preserves `store()` across calls and user loadout settings, and continues working after reload. |
| Real CLI startup | An isolated CLI profile loads this package with built-in codemode; a handled extension command verifies the effective codemode source and selected tools without prompting a model. |
| Configured profile discovery | Only this package's compact renderer remains effective after excluding the legacy standalone global copy; other settings are preserved. |

Normal tools use unboxed rows; failures keep a bounded error preview. Codemode expansion delegates to Pi's native renderers. Subagent presentation uses deterministic controller-shaped outcomes; existing subprocess, isolation and lifecycle regressions remain in the full suite. No chat-model calls were made, and these checks do not claim new model-backed subagent acceptance evidence.

Files changed for this presentation update: `extensions/compact-tools.ts`, `extensions/subagents.ts`, `tests/compact-tools.test.mjs`, new `tests/compact-orchestration.test.mjs`, `README.md`, and `docs/verification.md`. Activation also adds an exact exclusion for the legacy global renderer in Pi's user settings; the original extension file is retained and the previous settings were backed up.

## Subagent handoffs and usage — 2026-10-04

Executed `.ai/deep-planner/plans/subagent-handoffs-and-usage.md` sequentially against baseline HEAD `90b146fa60bc6f40a3f12dd6e5834589eff3bf54`, with Pi 1.0.0 and Node 24.20.0 on macOS. The plan remained unchanged: SHA-256 `f3758e20e4a23e810f8cf92e53a434240dbad3e6c563fbc68920c81230b93ea1`. Changes are unstaged; no installation, personal configuration change or Git delivery was performed.

### Deterministic evidence

| Check | Observed result |
| --- | --- |
| Baseline `npm test` | 142 passed, no failures or skips. |
| Handoff regression | Missing shared handoff failed before the suffix change; extension/instruction/resource/package checks then passed 20/20. |
| Usage regression | Initial controller/extension/native-parent checks had 29 expected failures for missing accounting. Final focused controller, extension, runtime, policy and compact-orchestration suite passed 95/95. |
| Cleanup regression | A bounded reader identified loss of accumulated usage when temporary cleanup throws. Parent reproduced it with a mocked filesystem failure, then verified retained totals and diagnostics after the fix. |
| Final `npm test` | 170 passed, no failures or skips, including extracted-package checks and the updated `absorb` resource digest. |
| `git diff --check` | Passed. |

Tests cover repeated and identical responses, streaming/event duplicates, invalid/missing data, subset counters, cancellation/timeout, stdout after IPC disconnect, unconfirmed drains, late-result immutability and native session persistence. Native child fixtures use a local mock provider with real guarded writes and nonzero finalized usage; native parent fixtures exercise actual tool calls and session statistics, not just direct `execute()` calls.

The native parent cancellation test initially assumed one assistant message, then an `aborted` terminal message. Installed Pi instead persists an additional zero-usage `error` message with `This operation was aborted`. The test now checks that observed host behavior; accounting was already correct. No SDK behavior was changed. The reader's report was not independent verification; the parent ran and inspected every command.

### Real-model evidence in a new pane

The user authorized Herdr operation. Original pane `w37:pW`; newly created pane `w37:p15`, TTY `/dev/ttys014`. The live session started at `2026-10-04T07:03:18.495Z`, with `openai-codex/gpt-6-astra`, effective `minimal` reasoning and only the explicitly loaded `instructions.ts` and `subagents.ts` extensions. The [launch procedure](subagents.md#verify-handoffs-and-accounting-in-a-new-pane) used a synthetic workspace, fresh native receipt directory and existing credentials. Child registry availability was checked without exposing credentials.

| Case | Parent-observed evidence | Child tokens / accounting |
| --- | --- | --- |
| L1: two readers | Ordered explore/review outcomes cite `sample.txt:2` marker `HERD-USAGE-ACCEPTANCE-73` and line 3's unknown release date. Coordinator reread the original file and checked unchanged bytes. No writes; both children terminated. | 1,199 + 1,185 = **2,384**, complete. |
| L2: inaccessible evidence | Reader reports `Path outside project and selected skills`; no guessed outside marker. Runtime completed, while marker-discovery acceptance remained blocked. The deterministic policy test separately verifies enforcement. | **1,267**, complete accounting—not successful task acceptance. |
| L3: exclusive writer | Only `note.txt:1` changed: `teh` → `the`. Coordinator checked exact bytes, including the retained article/newline, unchanged `sample.txt`, no extra workspace files and the completed write ledger. No fabricated test claims. | **2,592**, complete. |
| L4: cancellation | Coordinator observed child PID 1098 and its matching workspace/task ID, sent Escape during work, inspected the native cancelled result and confirmed PID disappearance. Late observed usage survived; no writes. | **3,624**, incomplete. |
| L4: recovery | A subsequent reader completed with the correct marker/unknown-value handoff and confirmed termination; no launch lock remained. | **1,177**, complete. |

All five native tool-result aggregates equal the sum of their ordered child outcomes, with batch completeness matching child completeness. Native `/session` displayed **69,432 tokens** and **$0.403**. Reconciliation using the installed native `getSessionStats()` method over the actual receipt entries confirmed:

| Attribution | Tokens | Reported cost (USD) |
| --- | ---: | ---: |
| Parent assistant responses | 58,388 | 0.261152 |
| Child work, counted once through tool results | 11,044 | 0.142240 |
| Other usage entries | 0 | 0 |
| Session total | **69,432** | **0.403392** |

Session components: 24,334 uncached input, 42,752 cache-read, 2,346 output and zero cache-write tokens. Cost differences were checked within floating-point rounding. These are provider-reported estimates, not invoice validation; interrupted work may consume more than reported.

### Local receipts and boundaries

Receipts are retained locally under `/private/tmp/subagent-validation.oXy4OP/receipts/`, not published or included in the package:

| Receipt | SHA-256 |
| --- | --- |
| `2026-10-04T07-03-18-495Z_01a105b9-64df-721e-95df-63f0f8573009.jsonl` | `2f8a28ef45f8df82f984c72baab023f6461245d2979dbad6c35762adfea07c9a` |
| `accounting.json` — per-case native statistics and reconciliation | `143c6fd1f1325b60806eefbf8c243b9de5f0a413c597ec947ef76d05d39b4155` |
| `L4-recovery-pane.txt` — expanded native output and final `/session` | `b5ecd37586d2906e71270c5770eafc5757ed28a95d41430c1c298c60f25f9df0` |
| `source-hashes.json` — loaded extension/instruction fingerprints | `5ecd93506e4a7a7ca72f0ba5808dd266940db09d880e9e15b4f6625b125f158d` |

`launch.txt`, `L4-process.json`, earlier pane snapshots and test logs retain the exact invocation, process observation and command output. Production fingerprints remained unchanged throughout live validation: `extensions/subagents.ts` = `bffda63b32c70e5b7382c6f00c47416ee7c58f05edb54cac836a8e53b2baa53c`; `extensions/subagent/controller.mjs` = `d4238234adddc75b5607201de15ed06199355965c9a14b06897ea40a58353b83`.

The in-pane assistant correctly noted that child-internal read traces are not returned and rendered text alone cannot prove byte preservation. The coordinating parent verified cited content and actual bytes directly; this run does **not** claim an independent syscall audit or persist new child traces. Broader alternate-model, reload, extracted-package OAuth and native Windows live scenarios remain outside this run; historical MCP/personality checks were not rerun. Synthetic receipts may disappear with temporary-directory cleanup.

Changed paths: `extensions/subagents.ts`, `extensions/subagent/controller.mjs`, `tests/fixtures/subagent-child.mjs`, `tests/fixtures/subagent-native-child.mjs`, `tests/subagent-controller.test.mjs`, `tests/subagent-extension.test.mjs`, `tests/subagent-runtime.test.mjs`, `instructions/orchestraitor.md`, `skills/absorb/SKILL.md`, `docs/skills-provenance.json`, `docs/subagents.md`, and `docs/verification.md`.

## Interactive harness UI — 2026-10-04

Groups 1–7 of `.ai/deep-planner/plans/interactive-harness-ui.md` are implemented and verified, including actual V1–V6 terminal/model evidence. V6 initially paused after a native CLI settings side effect; the user explicitly approved continuation through the public SDK with non-persistent settings. That incident remains disclosed below. The original plan retains SHA-256 `baefb3905a8c6a7384f6d3b1ecc544a673dbc9abd1b000178fb8fe9f15e6a786`. Verified host: Pi CLI/SDK 1.0.2, Node 24.20.0, macOS. Changes remain unstaged and uncommitted.

| Gate | Fresh evidence |
| --- | --- |
| Deterministic checks | Group 6 focused 45/45; full suite 276/276, no failures or skips. |
| MCP services | `npm run test:mcp`: 1/1 with real Context7/Engram and isolated synthetic memory storage. |
| Personality | Four fresh `openai-codex/gpt-6-astra` scenarios; parent inspected and accepted all predefined criteria, including language, respectful disagreement, formal correspondence and English artifacts. No model substitution. |
| Package | Dry-run inventory: 223 files, five extension entrypoints, four UI modules and the canonical guide; no tests, private evidence, settings, credentials or sessions. Strict extracted-package tests pass. |
| V1–V4 | Actual text and ANSI viewports in fullscreen/dark and regular/light: agents, task transitions/evidence/reopening, reviewed/corrected questions, cancellation, restored editor input and foreign widget/status coexistence. |
| V5 | Actual widths 52/130/182, 13-row temporary collapse, light/system theme transitions, native scrolling, Unicode, reload replay, tree task revision 5→1 and a fresh empty session. |
| V6 | Actual configured-model SDK native TUI, no fixture: two ordered readers, inspected citations/bytes, evidence-backed tasks, one explicit harmless choice, agents/tasks and native `/session`. Personal settings hash unchanged throughout the approved SDK run. |

### Separate terminal and execution evidence

Owned Herdr pane `w37:p1S` was created beside caller `w37:p1B`; an owned empty resize pane was used briefly for the short-height check. Both were closed, and the caller's original 260×50 layout/focus was restored. Viewports, timestamps, dimensions, modes, themes, source/record hashes and session identities are retained locally in `.ai/verification/interactive-harness-ui/screens.jsonl`; `evidence.json`, `checks.txt` and `consistency.md` retain checks and limitations. They are excluded from the package, not published or synced.

Synthetic providers exercised native model-only tools and actual production guarded child processes. Both modes preserved exact marker bytes and the partial `typo.txt` written before interruption; native cancelled results retain a completed write ledger, incomplete observed usage and confirmed exit. The parent verified disappearance of the observed child processes and successful subsequent readers. Exact question receipts preserve opaque values and Unicode text; cancellation has no submitted answers. Native accounting equals top-level delegated usage once: fullscreen **275 tokens**, regular **325 tokens**, with zero synthetic cost. The actual regular `/session` viewport agrees; these are not real-model billing measurements.

Failed startup/timing probes remain in the local record and are **not** acceptance frames. In particular, regular-mode startup initially matched stale visible content and received input too early. Later fresh-session frames and native receipts establish the accepted cases. Editor focus was checked by typing after submission; this does not claim an OS-level IME test or native Windows execution. Offline scratch startup reported optional ripgrep unavailable; nothing was downloaded or installed.

### Blocker and host limitations

Installed Pi's `getChangelogForDisplay()` calls `SettingsManager.setLastChangelogVersion(VERSION)` on fresh startup. The normal-profile V6 launch updated `lastChangelogVersion` to `1.0.2`, contrary to the plan's no-personal-settings-change constraint. No exact pre-launch settings snapshot exists, so no blind rollback was attempted. This native host side effect is not a UI-extension write. The initial owned process was stopped before live prompts. The user then explicitly approved the public SDK route: `InteractiveMode` over `AgentSessionRuntime`, with `SettingsManager.inMemory`, all five production extensions, native built-ins and existing auth/model-file references. No mock provider, credential copy, private host patch or model substitution was used. The personal settings SHA-256 matched before startup, after the real run and after shutdown; the earlier CLI metadata write was not undone.

Pi 1.0.2 also distinguishes dynamic active-tool changes from persistent `tools`/`excludeTools` filters: native reload can reactivate dynamically deactivated default-active extension tools, including the pre-existing launcher. Exact persistent allowlist/denylist checks pass in TUI, RPC, JSON and print. The harness does not patch the host or reset selection. All historical plans/absorb fingerprints remain unchanged. See the [UI guide](interactive-ui.md) for contracts and the acceptance procedure.

### Approved real-model V6 result

The real run used `openai-codex/gpt-6-astra`, inherited `minimal` reasoning, fresh synthetic workspace/session data and owned pane `w37:p1V`. Both ordered readers cited `marker.txt:1` and `:2` correctly. The coordinator reread the file after their confirmed exits; an external parent check verified exact unchanged bytes, no workspace writes and stable `inspect`/`verify` task IDs with done evidence. One explicitly submitted harmless choice preserved `marker-choice` → `opaque-alpha`. Actual agents/tasks/question-review and `/session` frames are retained locally.

The first real parent request supplied `files: []` for readers and was correctly rejected by the existing guard. One bounded scenario correction omitted optional editable-file fields; no production code or safety assertion was weakened. Failed launch observations remain visible alongside the successful results. Cancellation/partial-write/exit/retry were already exercised with actual production child runtimes in both V1 modes; no additional remote-model cancellation was needed.

| Native attribution | Tokens | Reported cost (USD) |
| --- | ---: | ---: |
| Parent assistant responses | 139,661 | 0.42533 |
| Delegated work, once through native tool usage | 1,915 | 0.02807 |
| Session total | **141,576** | **0.45340** |

The actual native `/session` agrees. Components: 28,435 uncached input, 112,000 cache-read, 1,141 output and zero cache-write tokens. Costs are provider-reported estimates, not invoice validation. Both children terminated, no child remains, the owned SDK process/pane was closed and the caller layout/focus restored. The new UI adds no accounting store or dashboard. Final local receipts include the exact approved launch, source/record hashes, settings-hash comparison and observed limitations.

## Retired Herdr integration — 2026-10-05

The user requested removal of the optional workbench and its publisher. Historical acceptance receipts and immutable plans remain private under `.ai/verification/herdr-workbench/` and `.ai/deep-planner/plans/`; they describe a removed implementation and are not current package acceptance. Native Pi UI and child accounting remain supported.

Removal verification: **315 passed, 0 failed, 0 skipped** in the full deterministic suite. The 88 removed tests covered the retired integration; native projection-cache and plan-drift checks now use actual Pi sessions. Extracted-package inventory and child bootstrap checks passed, with no companion files in the tarball. All local documentation links resolve. Seven offline benchmark rounds retained prompt/task sizes and zero unchanged-history scans; see [performance](performance.md#native-ui-after-integration-removal). No provider or MCP requests were made for this removal.

The local `pi.orchestraitor` plugin was unlinked from the active Herdr profile. Registry comparison verified that the remaining enabled Reviewr plugin was unchanged; `config.toml` was byte-identical and had no workbench shortcut. The plugin's empty configuration directory was removed. No active companion pane was present. Existing Pi processes must reload or restart to unload the previous publisher; no foreign sessions were interrupted.

## Harness efficiency — 2026-10-05

- Fresh deterministic suite: **403 passed, 0 failed, 0 skipped**, including package inventory/resource hashes, benchmark isolation, provider Responses serialization, task revisions/full historical receipts, projection invalidation, external plan drift and expanded subagent metadata. Response-shape assertions now use the documented compact schema; original native accounting and child safety assertions remain.
- Before-change checks reproduced full-board responses, repeated child metadata, unchanged-history scans and heartbeat view rebuilds; focused checks and the complete suite pass afterward. All 61 skill bodies were compared byte-for-byte against the baseline and preserved; only their descriptions and matching distribution fingerprints changed.
- Seven offline benchmark rounds per configuration: fixed instructions/catalog are 23.8% smaller in characters, complete fixture prompt 21.8% smaller and a one-task response on 20 tasks 83.4% smaller. Unchanged hook branch/usage scans fall from 35/35 to 0/0 with the simulated publisher enabled. Startup remains within the plan's 5% median tolerance; no startup speedup is claimed.
- Private raw reports, test logs, source hashes and limitations are retained in `.ai/verification/performance/`. See [methodology and prepared A/B](performance.md). No remote model/MCP calls or personal installations were made. Prior personality/live acceptance receipts predate instruction compaction; configured-model behavior and actual provider-token savings are not revalidated by these deterministic checks.

## pi-pretty integration — 2026-10-05

`install:pi` registers the separate upstream `@heyhuynhgiabuu/pi-pretty@0.6.30` companion in the selected scope and adds `bash` to Pretty's `disableTools`. `compact-tools.ts` preserves foreign read owners and always registers native compact bash with effective shell settings and `defaultActive: false`. Conflicting bash ownership is reported and blocked. The integration adds no load adapter, forked upstream source or runtime dependency to this tarball.

- Directed P2 regressions: **99 passed, 0 failed, 0 skipped** across compact tools/orchestration, installer, Pretty configuration, package registration and tasks. Coverage includes absent/existing/custom/default configuration, repeated installation, incompatible environment rejection before mutation, preview without writes, exact rollback and concurrent preference retention; whitespace-padded npm sources, versions, filters and original positions; and a native result hook retaining candidate task details while replacing content with a rejection. Expanded errors preserve the explanation and rejected tasks remain absent from replayed state. Successful subagent batches still expose full details and individual failures.
- Full deterministic harness suite: **343 passed, 0 failed, 0 skipped**, including tarball inventory and native migration/recovery.
- Actual upstream integration: **8 passed, 0 failed, 0 skipped**, with Node 24.20.0 and Pi 1.0.3. Both load orders and reload selected harness bash, applied the configured custom shell and command prefix, retained actual Pretty read rendering and preserved full/read-only/empty tool selections. Actual FFF find/grep located the fixture marker, native tool components rendered expanded content, and the native RPC CLI selected Pretty read alongside harness bash/codemode/subagents. A conflicting Pretty environment override blocked native nested bash execution without creating the marker file; correcting it and reloading recovered harness ownership and prefix execution. No provider or MCP requests ran.
- `git diff --check` and the staged diff check passed.
- The final integration runner isolates HOME as well as Pi/pretty configuration because upstream FFF derives its default storage from HOME. Early probes exposed that boundary; their cache state is not isolated acceptance evidence. Personal settings were not rewritten by those probes.
- The initial user-profile installation verified all 61 bundled skills and pinned the existing Pretty registration before this bash ownership correction. This correction was verified in temporary profiles; rerun `install:pi` (or apply the documented manual bash exclusion) and reload/restart existing interactive Pi processes to update their Pretty configuration.

The [integration guide](pi-pretty.md) records ownership, disabling and verification. Component/RPC checks do not prove physical editor/activity-indicator acceptance or real model-token savings. Private install/check receipts remain under `.ai/verification/pi-pretty/` and are excluded from Git/package output.
