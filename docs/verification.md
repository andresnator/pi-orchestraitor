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

## Latest run

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
