# Native subagents on Pi 1.2.0

The only delegation engine is the exact `npm:pi-subagents@0.78.0` companion. The harness supplies four native agent definitions in `agents/`, declared through `pi.subagents.agents`. It no longer supplies subagent_run, subagent_collect, /models-profiles, file guards, a provider bridge, or an agents panel. Old personal/project orchestraitor profiles remain on disk but inactive, with no migrator. `work daily` is outside this change.

## Current activation gate

Pi 1.2.0 is now the installed and locked development host. The user authorized release-age exceptions for the seven exact Pi 1.2.0 packages and pi-subagents 0.78.0 in `pnpm-workspace.yaml`; the 1440-minute cooldown remains for all other versions and dependencies. The isolated validation launcher and installer read that same policy. A native npm exclusion applies only during the install command for its exactly pinned, authorized source; it is not a permanent or future-version exemption.

Before moving skills or changing configuration, the installer checks Pi's effective `npmCommand` (default `npm`). Supported installation commands are npm >=11.19.0, whose exclusion support is verified, or the pinned pnpm 12.9.1. npm 10.9.3 bundled with Node 22.19.0 cannot honor this exception and is rejected with an actionable error. Node 22.19.0 remains supported with a compatible package manager; isolated pnpm validation alone does not establish npm compatibility.

Do not activate daily delegation before the isolated pinned checks pass. Pi 1.0.4 receipts remain historical evidence only.

To verify:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run test:pretty
pnpm run test:subagents
pnpm run install:pi --dry-run
pnpm run install:pi --subagents-validation .ai/absorb/pi-subagents-validation.json
```

`test:subagents` provisions the exact host and plugin plus their dependency graphs under the same release-age/build policy in a scratch directory and isolates HOME, agent configuration, models and sessions. It runs synthetic native-provider checks; it does not call real models. A stale, failed, or wrong-version receipt blocks installation. The installer rechecks the plugin against the committed release-age policy. The first stage verifies readers before exercising the writer. Installation always creates a restoration manifest, even if no skills move. `--restore <backup> --dry-run` previews recovery and `--restore <backup>` restores selected registrations, native configuration, Pretty's owned bash exclusion and moved skills, preserving unrelated operator edits.

The plugin stores its runtime configuration in `<agentDir>/extensions/subagent/config.json`, including when `install:pi --local` registers packages in project settings. The installer previews both destinations and rejects conflicting native configuration before mutation. Its new settings select only the necessary NaN and Claude Bridge provider extensions. User/project definitions and native settings can override package specialists; inspect effective tools and context before relying on those changes.

Restoration and failed-install rollback check the recorded configuration destinations before changing registrations. If a settings symlink was retargeted, recovery stops with both files untouched and leaves the backup pending. Restore the original link and retry; the same check applies to `--restore --dry-run`.

## Specialists and context

| Agent | Model | Conversation | Tools |
| --- | --- | --- | --- |
| scout | Parent model unless explicitly selected | Fresh | read, grep, find, ls |
| reviewer | Parent model unless explicitly selected | Fresh | read, grep, find, ls, watchdog_diff |
| oracle | Parent model unless explicitly selected | Fork when a suitable persisted parent session/leaf exists | read, grep, find, ls |
| worker | Parent model unless explicitly selected | Fresh | read, grep, find, ls, bash, edit, write |

Agents keep repository instructions, omit global context and the discovered skill catalog, and load only explicitly selected skills. They have no pinned model or thinking override. Oracle's implicit fork falls back to fresh when the parent cannot be forked; disclose that limitation. An explicit `context: "fork"` remains strict. Forked consultation is not blind review. Do not set a global defaultSubagentContext: it would override oracle's profile preference.

Native calls preserve the plugin's schema and renderers:

```js
// Load the selected native name with skill_registry first.
// Use delegation.taskPrefix and delegation.options from that result:
{ agent: "scout", task: delegation.taskPrefix + "Inspect the authentication flow with path/line evidence", async: false, options: { context: "fresh", ...delegation.options } }
{ agent: "oracle", task: "Challenge this design and explain remaining tradeoffs", async: false }
{ agent: "worker", task: "Implement the approved change; return patch and test evidence; do not commit or stash", worktree: true, async: false }
{ agent: "reviewer", task: "Review the actual patch and test evidence", async: false }
```

The registry's load result supplies `delegation.taskPrefix` with the native skill name, exact file path and resource directory, plus `delegation.options = { skill: false }`. For several skills, concatenate their prefixes. This explicit task handoff works in foreground and background runs and survives reload. Do not pass registry names directly to `options.skill`: pi-subagents 0.78.0 resolves directory names rather than Pi frontmatter names and may omit a selected skill or choose a different file. In native catalog mode, include the catalog's exact paths in the child task and set `options.skill: false`. The child reads those files using its native read tool. Manual-only, excluded and missing skills remain unavailable through the registry.

Builtins are disabled in this initial setup; only the four packaged specialists are intended for use. Nesting is capped at depth 1 and no specialist has delegation tools. Automatic watchdog, missions, schedules, workflow scripts and external-machine actions are disabled. Native concurrency caps bound each run and async slots to two; the one-writer rule and correction limit are coordinator instructions, not a replacement custom runtime scheduler. All specialists have a ten-minute run deadline. Default child extensions are explicit; readers never inherit parent Bash, MCP or AskClaude tools.

## Implementation and integration

Use scout → worker or parent → reviewer → correction, one writer and at most two independent readers. Allow at most two correction attempts. Before implementation inspect `git status --porcelain`.

- Clean repository: launch worker with `worktree: true`; the allocator is explicitly `native` Git. Review its full artifacts, changed paths, diff and test evidence before applying the patch. Validate the integrated result.
- Pending changes: the parent implements in the current directory and preserves those changes. Do not commit, stash or silently manufacture a clean checkout.

A worktree separates Git changes. It does not enforce the retired file allowlist, protect the host filesystem, or isolate processes as an OS sandbox. Worker Bash can run commands and tests in its worktree. Parent acceptance is still required, and native run completion cannot complete a task-board item.

## Fleet, results, lifecycle and cost

Use `/subagents-fleet` and the plugin's native Fleet widget for observation and control. The harness retains tasks, questions, BTW, compact builtin tools, skills and instructions; its footer contributes only question status. Pretty retains its own editor/read rendering while the harness continues to own configured native Bash. Do not wrap or replace native subagent renderers.

For asynchronous results use native notifications, `subagent({action:"status",id})`, `bg_wait({id})` or `bg_wait({all:true})`, and native stop controls. A wait timeout may mean only that its blocking window elapsed; work can still be active. Preserve and inspect complete output, JSONL transcript and metadata artifacts plus native input receipts (session storage with seven-day retention). In 0.78.0 the native input receipt redacts task text; raw event JSONL is disabled by the default executor, while the complete child transcript is retained as JSONL. Do not treat the advertised raw-event path as a guaranteed file. After timeout, cancellation or reload check native process/lifecycle evidence and partial changes before retrying. Never infer successful verification or clean process exit from a notification alone.

Combined cost is inspected with `/subagent-cost`. `/session` does not necessarily include all asynchronous child consumption. Native child and parent totals have different attribution; do not sum the same usage twice or infer free billing from catalog prices. See the [pinned upstream accounting reference](https://github.com/nicobailon/pi-subagents/blob/a4c8ced69a8176cdf4179b127feddc8875e3418f/docs/observability.md#usage-and-cost-accounting).

## Acceptance evidence

The [2026-10-13 absorb](../.ai/absorb/2026-10-13-pi-subagents.md) distinguishes current harness tests from native plugin tests and real-model acceptance. The isolated integration suite covers actual reader tool surfaces, selected skills, fresh/fork context, full artifacts, a native worker patch reviewed before integration, dirty-work preservation, timeout/abort/reload, background wait and Pretty/NaN/Claude Bridge loading. Until it runs successfully on 1.2.0, those assertions are a test procedure, not verified behavior.

Real-model acceptance is separate and remains pending: repeat reader evidence/skills/context checks with native provider credentials, test NaN and Claude Bridge children, inspect Fleet with Pretty in a visible terminal, cancel and retry both foreground and background work, compare native artifacts and /subagent-cost receipts, then exercise a harmless worker in a disposable Git repository. Do not activate from a 1.0.4 receipt or claim deterministic synthetic requests establish provider billing or visible UI acceptance.
