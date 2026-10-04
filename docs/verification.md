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
