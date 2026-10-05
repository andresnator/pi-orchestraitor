# Verification evidence

The package targets Pi 1.0.0, Node 22.19+, and Engram 3.0.0. Run the commands below against the installed host before upgrading or distributing it.

| Command | Claim checked |
| --- | --- |
| `npm test` | Native tool regressions, instructions and personality injection, tarball resources and 61 skill names, prompt expansion, MCP overrides, migration, rollback, and restoration. |
| `npm run test:mcp` | Real Context7 and Engram calls through native codemode, extension hooks, and project separation in temporary memory storage. |
| `npm run test:personality` | Configured-model responses in fresh isolated sessions, with predefined criteria and synthetic receipts for manual scoring. |
| `npm run install:pi -- --dry-run` | Complete lexical discovery inventory, including aliases hidden by native deduplication, and proposed standalone-skill moves, without migration or registration. |
| `npm pack --dry-run --ignore-scripts` | Distributed resource inventory and exclusion of tests, local reports, and personal data. |

## Evidence boundaries

Structural tests prove resource discovery, wiring, and regression behavior. They do not guarantee instruction compliance by every model. The bounded personality check evaluates concrete responses against language, tone, disagreement, and artifact-language criteria; slang is optional.

The package's established test convention is `node:test` and `node:assert`. That repository convention takes precedence over the skill's default fluent assertion preference.

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
