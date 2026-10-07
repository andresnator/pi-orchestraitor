# Usage and operations

A personal Pi package with **56 development/workflow skills** (54 automatic, two explicit-only), a lazy native-authorized skill registry, compact tool output, temporary `/btw` side conversations, optional interactive work UI, a bundled NaN model provider, Context7, Engram, and Orchestraitor for scoped changes and sequential plan execution. It automatically loads the source harness's Colombian architect personality: direct answers, practical explanations, respectful disagreement, and occasional Colombian expressions when the conversation supports them.

## Install

Use **pnpm 12.9.1** and **Node 22.19+**. The checkout's lockfile supplies **Pi 1.0.4**; it is not installed globally or bundled in the distributed package. Engram **3.0.0** is required only for memory. See [development security](#development-security) for the install policy.

From this repository:

```bash
pnpm install --frozen-lockfile # Once on a fresh checkout
pnpm run install:pi --dry-run
pnpm run install:pi
```

`pnpm run` puts the local Pi CLI on PATH. The installer recognizes its `.bin` shim and resolves the linked package's canonical SDK root; no `PI_TEST_PACKAGE_DIR` override is needed. The selected executable still controls host discovery, so npm-style symlink/global installations continue to work. Keep the checkout available; use `pnpm exec pi` if you want to start the local CLI.

The preview lists every matching standalone skill, including multiple discovery aliases for the same source, and any blocking conflicts. Installation moves matching entries into a recoverable backup, registers this directory through native `pi install`, and verifies that all 56 skills resolve to the bundled adaptations. It also installs `@heyhuynhgiabuu/pi-pretty@0.6.30` through native Pi package management in the same user/project scope. Restart Pi or run `/reload` afterward.

The installer adds `bash` to Pretty's `disableTools`, preserving other preferences, so the harness honors `shellPath` and `shellCommandPrefix`. It uses `PRETTY_CONFIG_DIR` or Pretty's default `$HOME/.pi/agent/`, independently of installation scope. A nonempty `PRETTY_DISABLE_TOOLS` list must include `bash`; an incompatible override stops installation before file changes. Use `--without-pretty` to install only the harness; this leaves any existing Pretty registration and configuration intact. `--dry-run` lists companion packages and the planned configuration path/adjustment without writes or downloads.

For a project installation:

```bash
pnpm run install:pi --local --cwd /path/to/project --dry-run
pnpm run install:pi --local --cwd /path/to/project
```

Local installation uses Pi's native `--approve` flag for the selected project's package registration. The package remains at its current path, so keep that directory available.

If you already have the original global `compact-tools` or `btw` extension, disable that copy through `pi config` before loading this package. Keep its files available for recovery. The installer does not migrate standalone extensions; see [BTW migration](btw.md#migrating-a-standalone-copy).

### Skill conflicts and recovery

Conflicts are matched by the declared skill name, including user, project, ancestor `.agents/skills`, and configured paths. Matching standalone directories and files are moved out of discovery. For symbolic links, only the link is moved; its target stays in place. Unrelated skills are preserved.

The shared `~/.agents/skills` directory is also used by other agents. Moving a skill from there removes it from their discovery until you restore the backup. The installer prints exact paths and a backup directory under Pi's agent directory, in `pi-orchestraitor-backups/`.

Another package's skills and source repository files require configuration changes. The installer reports the package source, scope, and path; disable the conflicting skills through `pi config` or remove the explicit skill path, then rerun. It never moves managed package contents.

Migration stays within each configured skill discovery root. It preserves configuration roots, checks the skill directory itself for repository ownership, and moves a configured symlink tree by its link. If the host cannot establish a discovery boundary, installation stops before moving files.

A failed registration or skill-loading check rolls back both package declarations, the Pretty bash exclusion and the moved skills. Original source text, versions, resource filters and package order are restored; downloaded npm cache files may remain. Rollback recognizes Pi's local path forms, including `~/` sources, and whitespace after `npm:`, while preserving unrelated concurrent settings and Pretty preferences. If a new entry occupies an original path, rollback keeps it and reports the backup requiring attention. Repeated installation finds no further moves once conflicts are gone.

To uninstall and recover:

```bash
pi remove /absolute/path/to/pi-orchestraitor
# Remove the companion separately if desired:
pi remove npm:@heyhuynhgiabuu/pi-pretty
# Add --local when removing a project installation.
pnpm run install:pi --restore /absolute/path/to/backup --dry-run
pnpm run install:pi --restore /absolute/path/to/backup
```

Restoration refuses to overwrite existing entries. Restore multiple backups in reverse installation order. Re-enable the original compact extension if needed, then restart Pi. A stale migration lock is reported with its exact path; inspect any interrupted migration before removing that lock.

Native `pi install /path/to/package` also discovers bundled skills, but does not perform this migration or install/configure the separate Pretty companion. Manual Pretty installations must disable its bash tool; see the [Pretty integration guide](pi-pretty.md). Use `install:pi` for conflict removal and effective-loading verification.

## First use

```text
/orchestraitor fix the behavior of X within Y
/plan prepare change Z
/orchestraitor execute the plan .ai/deep-planner/plans/change.md
/review src/module.ts
/absorb /path/to/another/harness
/skill:jag-debug investigate this failure
```

Skills use **lazy discovery by default**: `skill_registry` searches native-authorized descriptions and loads only selected bodies. `.ai/skills/registry.md` is generated as a body-free diagnostic snapshot, not injected into the prompt. `/skill:<name>` remains an explicit native command. Use `/orchestraitor:skills status|refresh` to inspect/refresh, or `native` to restore native headers (`lazy` switches back).

The Matt Pocock adaptations include `jag-pr`, `jag-research`, `jag-agent-docs`, and the updated `jag-domain`. `jag-handoff` and `jag-teach` require explicit user commands (`/skill:jag-handoff <next task>` and `/skill:jag-teach <topic>`); automatic lookup/delegation rejects them. Generated workflow documents default to `.ai/`; teaching uses topic-scoped Markdown, not browser widgets. Existing domain documents are never migrated automatically. See [adapted workflows](skills.md#adapted-workflows).

Ten former micro-review skills are consolidated into conditional references under `jag-practices`, `jag-refactor`, and `jag-patterns`; see the [replacement map](skills.md#consolidated-review-lenses). Their criteria remain available, but this package no longer supplies their standalone commands.

All bundled skill names begin with `jag-` and contain at most 15 characters. Original identifiers remain in provenance; old skill commands and plan Skills fields must use the new names. Reload Pi after upgrading, and update any explicit skill paths or resource filters in your own configuration. Prompt commands such as `/plan` and `/absorb` are unchanged.

New sources/names require native Pi configuration and `/reload`; edits and removals of already authorized skills are checked on the next request or lookup. Claude/OpenCode directories are not silently enabled. See the [skill registry and catalog](skills.md) for source configuration, limits and fallback.

Orchestraitor is the execution contract in the main session. It supports direct changes and ordered work groups in a supplied plan. It checks the original plan's SHA-256, preserves the plan, and runs its assigned checks. Planning and review requests keep their own scope. Delivery defaults to unstaged working-tree changes; commits require an explicit current user instruction.

The personality applies automatically through `extensions/instructions.ts`; no slash command is needed. Replies follow the user's language. Repository documentation, code, comments, and labels are in English. Professional and sensitive exchanges use a restrained tone. The architect's experience is a role, without an invented human biography.

## Package resources

| Resource | Purpose |
| --- | --- |
| `extensions/compact-tools.ts` | Compact bash/edit/write/codemode presentation, plus a read fallback. Bash uses effective shell settings; conflicting owners are reported and blocked. Expand to inspect arguments, results and error explanations. |
| `@heyhuynhgiabuu/pi-pretty@0.6.30` | Separately installed companion: highlighted reads, FFF-backed find/grep, prompt editor and activity indicators. Its bash tool is disabled for harness ownership. |
| `extensions/btw/index.ts` | Temporary 70% side-conversation panel; no tools or local history, explicit `/bring` imports only. |
| `extensions/instructions.ts` | Adds core, execution, and personality sections while preserving Pi and project instructions. |
| `extensions/mcp.ts` | Registers Context7 and Engram defaults through native MCP. |
| `extensions/nan.ts` | Native NaN API-key login/environment fallback and seven documented chat models; no default changes or startup requests. |
| `extensions/subagents.ts` | Model profiles, bounded sync/background readers, child guards, collection and native usage. |
| `extensions/skill-registry.ts` | Bounded search/load, native snapshot refresh and atomic diagnostic publication; lazy/native exposure. |
| `extensions/status-ui.ts` | One owner for agents/tasks panels, unified questions and compact work-header/native-footer chrome. |
| `skills/` | 56 unique skills and their supporting resources, with short `jag-*` names. |
| `prompts/` | `/orchestraitor`, `/plan`, `/review`, and `/absorb`, with explicit arguments. |
| `scripts/install-pi.mjs` | Migration, native package registration, verification, and restoration. |

The harness preserves personal model, theme, editor, credentials, and MCP overrides. The separately installed pretty companion supplies its own prompt-editor and activity presentation; see the [pretty integration guide](pi-pretty.md). It provides bounded subagents through `subagent_run`. It does not implement independent verification, resumable SDD, dual review, TCR, or persistent Caveman. Its scope and personality instructions are behavioral rules; they are not a filesystem sandbox.

## NaN model provider

Reload Pi, run `/login nan`, and enter a key generated in NAN Cloud's API Keys settings into Pi's native secret prompt. Alternatively provide `NAN_API_KEY` before starting Pi. Select **NaN / GLM 5.3 Flash** through `/model` for coding; no default-provider change is required. Keys remain in Pi's private credential storage or process environment, never in this package. `glm5.3` requires premium membership; the model list is static and Pi's zero per-token cost display does not account for membership fees or quota. See [NaN setup, overrides, and limits](nan.md).

## Temporary side conversations

Use `/btw` or `/btw <question>` without continuing the main task. Closing cancels and discards the conversation. Submit `/bring latest|N+|N-M|all` **inside BTW** to explicitly copy a selection into the parent without triggering a turn. The panel uses the parent's current model and thinking level; it has no tools. See [BTW controls, isolation, and migration](btw.md).

## Optional work UI

Open `/orchestraitor:agents` or `/orchestraitor:tasks`; use `tasks expand|collapse` for detail and `/orchestraitor:ui hide|show` for passive chrome. The model-only task/question tools do not replace execution or permissions. Pi keeps its native editor/header/footer and counters.

See the [interactive UI guide](interactive-ui.md) for schemas, task replay versus recovery, native keybindings, synthetic/live checks and limitations. Exclude `extensions/status-ui.ts` through `pi config` to disable the work UI without disabling the launcher or BTW. For one invocation, `--exclude-tools orchestraitor_tasks,orchestraitor_ask` persistently excludes just the model tools; `hide` only changes presentation.

## MCP and memory

Context7 uses `https://mcp.context7.com/mcp`. Engram runs `engram mcp --tools=agent` with the session project's cwd. Both use `codemode` exposure. Pi owns connection errors and shutdown; the package never installs missing services.

An entry with the same server name in personal or project `mcp.json` overrides the complete default. Fields are not merged. For an explicit project identity, use trusted project configuration:

```json
{
  "mcpServers": {
    "engram": {
      "command": "engram",
      "args": ["mcp", "--tools=agent", "--project", "project-name"],
      "cwd": ".",
      "exposure": "codemode"
    }
  }
}
```

Do not set one fixed project globally across repositories. An inherited `ENGRAM_PROJECT` overrides cwd detection. Matching folder names alone do not ensure distinct memory identities.

Run `/mcp` inside the session to inspect extension registrations. `pi mcp list` does not load extensions. To persistently disable a server, provide its complete configuration with `enabled: false`, or exclude the package's MCP extension through `pi config` to disable both defaults.

Memory instructions restrict saves to useful, verified project decisions and exclude secrets, personal information, raw transcripts, and sensitive code. They do not implement automatic capture or a data filter. Engram inherits its environment; review autosync configuration before connecting your usual database. The package does not enable cloud sync.

## Try without registration

```bash
HARNESS="$PWD"
cd /path/to/project
pi --no-extensions -e builtin:mcp -e builtin:codemode -e "$HARNESS"
```

This changes only that invocation. Personal and project MCP settings still apply. Existing skill sources may collide until migrated. Engram may open its usual database; use the temporary integration test below for isolated memory checks.

## Development security

Use pnpm 12.9.1 with the committed lockfile. Pi 1.0.4 is a development dependency only; runtime peers remain host-provided and neither the host nor `node_modules` is packed. BTW's pinned `beautiful-mermaid@1.1.3` is a separate runtime dependency; local checkouts install it here, while Pi installs it for native Git/npm sources.

```bash
pnpm install --frozen-lockfile
```

| Policy | Effect |
| --- | --- |
| Frozen lockfile | CI cannot silently resolve new dependency versions. |
| `minimumReleaseAge: 1440` | Newly published versions must age for 24 hours; do not bypass the cooldown. |
| `autoInstallPeers: false` | Do not automatically install host-provided peers. |
| `blockExoticSubdeps: true` | Reject exotic transitive sources, such as Git or arbitrary URLs. |
| `strictDepBuilds: true` | A new dependency with an unreviewed lifecycle script stops installation. |
| Version-specific `allowBuilds: false` | Explicitly deny the reviewed genai 2.21.0, esbuild 0.28.2 and protobufjs 7.6.6 scripts. New versions require another review. |

All dependency build scripts remain denied. Published artifacts and the optional esbuild platform package work for the verified tests without postinstall. Install optional dependencies normally; do not omit them. This is not a sandbox, a malware scan, or a guarantee that locked code is safe. The policy applies to this development checkout, not to Pi's separately managed packages, Pretty, or your global Pi installation.

Do not run blanket `approve-builds`, add wildcard approvals, or regenerate the lockfile automatically to make CI pass. Inspect a changed script/version and rerun tests before any explicit approval. An intentional update uses `pnpm install` locally and reviews the lockfile diff; CI stays frozen. `pnpm audit` checks current registry advisories but cannot prove absence of unknown vulnerabilities.

## Verify

The [efficiency guide](performance.md) documents compact model-facing task/child handoffs, projection reuse and the offline benchmark. Run `pnpm run bench --samples 7 --output /tmp/pi-benchmark.json` from a checkout; it makes no model/MCP requests. Observed character reductions are distinct from measured provider-token savings.

```bash
pnpm test
pnpm pack --dry-run --ignore-scripts
# Optional external checks; not automatic CI gates:
pnpm run test:mcp
pnpm run test:pretty
pnpm run test:personality
```

- `pnpm test` checks native tool regressions, prompt and personality injection, packaged skill loading and resources, migration and recovery, and native installation in temporary configuration. It uses local synthetic providers for native UI/child integration, not live models or MCP services. Visible TUI acceptance remains a separate gate.
- `test:pretty` exercises the actual installed companion on the native Pi SDK and CLI in temporary profiles, including both load orders, reload, preserved tool selection, a custom shell/prefix, read and find/grep, plus bash conflict blocking/recovery. It requires the pinned companion or `PI_PRETTY_PACKAGE_DIR` and makes no model/MCP requests; terminal screenshots are a separate check.
- `test:mcp` calls Context7 and Engram through native `codemode`, with synthetic memories and a temporary database. It checks project separation and avoids personal memories.
- `test:personality` makes bounded calls to the configured Pi model in isolated sessions. It writes synthetic transcripts for manual scoring; it uses the configured account and consumes model quota.
- Packing includes extensions, instructions, skills, scripts, docs, and licenses. Tests, `.ai` reports, personal settings, credentials, and memory databases are excluded.

Tests prefer the canonical Pi development host installed by pnpm and propagate its SDK root to installer subprocesses. `pnpm test` also puts the local CLI on PATH. Private dependency fixtures resolve through the host's module tree rather than assuming nested `node_modules`. Set `PI_TEST_PACKAGE_DIR` to explicitly test another installed host root; without a local host, tests fall back to Pi on PATH. Packing integration covers both pnpm and npm for compatibility. The installer inventory adapter and some integration checks depend on host internals and need revalidation after a Pi upgrade. The adapter checks that its required host hooks exist before migration. Peers use `*` because Pi supplies them; the original baseline used Pi 1.0.0 and current deterministic checks run on Pi 1.0.4, with the codemode fixture updated to supply the host's prompt-guidelines callback. Historical live UI evidence retains its recorded host version. Revalidate on upgrades. The UI guide documents native dynamic-selection versus persistent-exclusion behavior on reload. The established test convention is `node:test` with `node:assert`.

See [verification evidence](verification.md) and [attribution](../THIRD_PARTY_NOTICES.md).

## Subagents and verification

Use `/models-profiles` to configure named profiles per role and scope. Use `subagent_run` for up to two pending readers or one exclusive synchronous implementer, and `subagent_collect` to retrieve background results. Each task gets a fresh process/session; the parent runs commands and checks the result. See [subagent input, isolation and lifecycle](subagents.md) for file restrictions, model selection, cancellation, output fields and pending real-model checks.

Normal tools use one unboxed line. `codemode` shows nested-call counts and the currently running tool, and `subagent_run` shows task counts, roles and completion counts. Script source, nested-call arguments and successful output stay hidden until Pi's configurable `app.tools.expand` action (`Ctrl+O` by default) expands the tool. Expansion restores codemode's native code/result view and the complete subagent response.

Errors remain visible: the header plus up to three visual rows, including caught nested-call failures and failed, timed-out or cancelled children. Codemode shows the start of the error cause; other tools show the error tail. Normal rows have no filled background; error rows keep the error background. Presentation does not truncate or change model-facing results. Codemode is decorated through Pi's public factory only when its native tool is present, preserves inactive/disabled selection, and leaves foreign tools with a different parameter schema unchanged. Restart Pi or run `/reload` after changing the package.

Reviews identify repository/base/scope and content fingerprints, including relevant new files, and recheck them before the verdict. Findings distinguish observed/inferred evidence and introduced/aggravated/pre-existing/unknown origin. Behavior changes use observed failing and passing checks where appropriate; the final diff alone does not prove RED/GREEN execution.
