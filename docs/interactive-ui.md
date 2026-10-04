# See delegated work, tasks and decisions without replacing Pi

The optional UI extension adds read-only agents/tasks panels, a compact task work header, one native-footer status and a unified question tool. Pi still owns the editor, application keybindings, model/context/usage display and execution. This is presentation and branch-local task replay, not another scheduler or durable SDD recovery.

## Quick path

1. Ask the coordinator to use tasks for substantial authorized work; small changes need no list.
2. Open `/orchestraitor:agents` or `/orchestraitor:tasks` for detail.
3. Use `/orchestraitor:tasks expand` or `collapse` to adjust the work header.
4. Use `/orchestraitor:ui hide` or `show` for passive chrome only. Questions and execution remain active.

Only native TUI mode creates components. In RPC, JSON and print, tasks still work and questions return `unavailable`; use ordinary textual clarification. These tools never enable disabled tools or grant security/destructive-action permissions.

## Ownership

| Responsibility | Owner |
| --- | --- |
| Child execution, cancellation, termination, safety lock and accounting | Existing `subagent_run` / `BatchController`; UI observes native progress only. |
| Harness widget/status keys and foreground modal | `extensions/status-ui.ts`; one owner, no foreign keys/factories replaced. |
| Agent observations and bounded branch outcomes | `extensions/ui/agents.ts`; active batch plus at most 20 recent outcomes. |
| Task authority | Validated successful native `orchestraitor_tasks` results on the active branch, replayed by `extensions/ui/tasks.ts`. |
| Requirements/preferences | One `orchestraitor_ask` schema and interaction in `extensions/ui/questions.ts`. |
| Safe terminal display | Shared `extensions/ui/display.ts`; original IDs and opaque values remain untouched. |

## Panels and compact chrome

The agents panel shows assignment order, IDs, roles, requested/effective model evidence, phases and bounded diagnostics. Starting/running/stopping are not failure or acceptance. Runtime completion is not parent acceptance; absent effective-model or nested historical evidence stays unavailable. Panels cannot launch, retry, grant, resume or cancel work.

Tasks start collapsed as one row. Expanded chrome uses at most five rows; short terminals temporarily collapse it. Empty lists contribute no task row. Full detail remains in the task panel. The footer contributes one status with this precedence: known launch block, awaiting input, active agents; idle contributes nothing. Native counters are not repeated.

Selection, scrolling, submission and cancellation use native configurable actions. Check `/hotkeys` and Pi's keybinding documentation rather than relying on a hardcoded shortcut. Read-only panels also close with Escape. The extension never replaces the main editor/header/footer, registers global shortcuts, or changes personal themes.

Before tree navigation, session switching or forking, the UI cancels its current interaction and invalidates pending work from that interaction generation. It retains the current context, task/agent projections and visibility/expansion preferences while navigation is pending. A veto or an aborted branch summary leaves the existing UI usable, including new panels and questions. Confirmed tree/session changes rebuild from the effective branch and restore the default visible, collapsed chrome. Shutdown and context replacement release the owned UI; late completion of an old interaction cannot close its replacement.

## Task contract

`orchestraitor_tasks` and `orchestraitor_ask` are direct model-only, sequential tools. Nested codemode/`executeTool` calls are rejected. The coordinator reads task revision before mutations:

```json
{"operation":"list"}
```

```json
{
  "operation":"replace",
  "expectedRevision":0,
  "tasks":[{"id":"inspect","title":"Inspect the requested boundary","status":"pending"}]
}
```

Operations are `replace`, `add`, `update`, `list`, `clear`. IDs remain stable on replacement; explicit clear discards the list. Statuses are `pending`, `in_progress`, `blocked`, `done`. Limits: 50 tasks, 80-character IDs, 200-character titles and 1,000-character evidence/reason notes. Marking done requires evidence in that update; reopening requires a reason. Child success never completes a task automatically.

Exact-plan work includes a binding with the canonical project identity returned by `list`, repository-relative `path`, original `sha256`, unique `groups` and each task's `group`. Binding verification is read-only and occurs outside rendering. Drift blocks mutations; reads/panels warn that the old projection is stale. The plan bytes and checkboxes are never changed by tasks.

Uncommitted, failed, invalid or cancelled candidate snapshots are not authority. Reload/tree/fork replay follows the active native branch; a fresh session starts empty. This does not validate cross-session execution resumption. UI unavailability does not block otherwise safe work.

Task replay is awaited at the start of each tool, so persisted creation, updates and clearing are visible while the next question or agent tool is still waiting. `turn_end` refreshes the final tool result. On Pi 1.0.2, `message_end` and `tool_execution_end` precede persistence, so their candidate results are not used to update the task widget. Async plan-binding checks apply only to the current context, interaction generation and latest refresh request. Hidden chrome stays hidden through these refreshes.

## Question contract

Example model input:

```json
{
  "questions":[{
    "id":"approach",
    "prompt":"Which harmless example should the guide use?",
    "selection":"single",
    "options":[{"label":"Parser","value":"opaque/parser"},{"label":"Formatter","value":"opaque/formatter"}]
  }]
}
```

Use one to six unique IDs, `single` or `multiple`, two to eight distinct values per choice. Questions default to required; `required:false` permits skipping. Free text needs explicit `allowText:true`. Prompts/values/answers are bounded to 1,000 characters and labels to 200. IDs/option values are returned exactly, separately from sanitized labels.

Single choice uses native dialogs and an explicit review step. Rich forms compose native selection, text input and scrolling, with correction before final submission. No option is approved just because it is highlighted. Results have version 1 and `answered` plus answers, or `cancelled`, `unavailable`, `busy` without submitted answers. Abort/session change discards drafts. An active question is not displaced by another panel/question. Questions collect requirements, not native trust or operation permissions.

Form transitions synchronize controls and text focus immediately, including when multiple keystrokes arrive before the next render. Enter after the last text answer opens review; another Enter acts on the newly focused review row, without implicit submission. Submission, cancellation and disposal end input handling, and the result callback runs at most once.

## Disable safely and account for host limitations

For one invocation, retain the rest of the package but prevent model calls to both UI tools:

```bash
pi --exclude-tools orchestraitor_tasks,orchestraitor_ask
```

To disable the whole UI extension, use `pi config` resource filtering or this package selection in your chosen settings scope:

```json
{"packages":[{"source":"/absolute/path/to/pi-orchestraitor","extensions":["!extensions/status-ui.ts"]}]}
```

This leaves the launcher, instructions, compact tools and MCP registration intact. `hide` is not extension disabling and does not hide a foreground question.

Pi 1.0.2 distinguishes persistent SDK `tools`/`excludeTools` (CLI `--tools`/`--exclude-tools`) from dynamic active-set changes. Persistent filters survive reload. The host may reactivate default-active extension tools after dynamic deactivation on reload; this also occurs with the pre-existing launcher. Use persistent filters for exclusions that must survive reload. The harness does not patch that host behavior or reset tool selection to enable UI.

## Reproduce visible checks in an isolated terminal

Automated component rendering and JSON/RPC events are not visible-TUI evidence. Use a newly created Herdr pane, capture the actual viewport as text **and ANSI**, and distinguish the local synthetic provider from the separate real-model run. Never automate an unexpected trust/security approval.

From this checkout, create a fresh run (never reuse personal settings/credentials):

```bash
HARNESS="$PWD"
RUN="$(mktemp -d)"
RUN="$(cd "$RUN" && pwd -P)"
mkdir "$RUN/profile" "$RUN/workspace" "$RUN/sessions"
cd "$RUN/workspace"
UI_SMOKE_ENABLED=1 UI_SMOKE_ROOT="$RUN" PI_CODING_AGENT_DIR="$RUN/profile" \
PI_OFFLINE=1 PI_TELEMETRY=0 pi \
  --offline --no-approve --no-extensions --no-skills --no-prompt-templates \
  --no-themes --no-context-files --tui-mode fullscreen --use-theme dark \
  -e "$HARNESS/extensions/instructions.ts" \
  -e "$HARNESS/extensions/compact-tools.ts" \
  -e "$HARNESS/extensions/subagents.ts" \
  -e "$HARNESS/extensions/status-ui.ts" \
  -e "$HARNESS/tests/fixtures/ui-smoke.ts" \
  --model ui-smoke/model --thinking off --session-dir "$RUN/sessions"
```

Repeat in a fresh run with `--tui-mode regular`. This synthetic launch deliberately omits MCP; separate complete-package integration/service checks cover the fifth entrypoint and real services. The test-only fixture supplies a local parent provider and loopback SSE provider for actual production guarded child sessions. It creates only owned scratch files/configuration and a foreign keyed widget/status for coexistence. It refuses unrelated `models.json` overwrites. It does not copy the production UI or directly execute its model-only tools. No fixture code ships in the package.

Commands in that isolated run:

- Agents: `/ui-smoke two`, `writer`, `failure`, `cancel`, `retry`; open `/orchestraitor:agents`. Cancellation writes a synthetic partial file before waiting; close the panel and use native parent interruption, then verify actual bytes, write ledger, confirmed exit and retry.
- Tasks: `/ui-smoke tasks-create`, `tasks-start`, `tasks-block`, `tasks-done`, `tasks-reopen`; inspect, collapse/expand, hide/show. These are explicit synthetic parent decisions, not automatic child acceptance.
- Questions: `/ui-smoke single` and `/ui-smoke form`; choose predefined harmless markers, edit synthetic Unicode text, correct, submit or cancel. Inspect exact native results.

### Acceptance matrix

| ID | Exercise | Required evidence |
| --- | --- | --- |
| V1 | Two readers, one writer, failure, cancellation, retry | Starting/running/final frames, order, diagnostics, no acceptance label; separate actual termination/bytes checks. |
| V2 | Task create/update/block/done/reopen/collapse/expand | Before/after header and full-panel frames, stable IDs, evidence/reason and unchanged supplied plan hash. |
| V3 | Single choice, multi-select, free text, correction, cancel | Option/form frames, exact native values, no partial answer on cancel, restored editor text/focus. |
| V4 | Chrome/coexistence/hide/show | Native editor/footer/context/usage, compact tools and foreign widget/status remain; state/execution unchanged. |
| V5 | Layout, focus and lifecycle | Actual narrow/wide and short terminal sizes, dark/light/system theme checks, both native modes, scrolling, Unicode, reload/new/tree without stale UI. |
| V6 | Bounded real model, no fixture | Two tasks, two readers on synthetic marker data, parent-inspected citations, one harmless question, agents/tasks panels; usage reconciled and an actual cancellation/retry if not already exercised. |

V1–V4 must run in both regular and fullscreen with the fixture; V5 covers real transitions. V6 uses the configured available model and existing credentials without copying/printing them, full production package and fresh synthetic workspace/session receipts; no substitute model or fixture. It consumes quota. Separate service tests isolate synthetic Engram data. Never present mocks as model acceptance or claim native Windows verification without running there.

Pi 1.0.2 fresh CLI startup can persist `lastChangelogVersion` in its settings, even offline with telemetry disabled. A normal profile launch is not guaranteed read-only. When personal-setting writes are forbidden, use a native SDK `InteractiveMode` over `AgentSessionRuntime`, with services supplied a `SettingsManager.inMemory` snapshot and existing auth/model-file references. Keep the model catalog cache and session receipts in the scratch run. The installed public SDK examples for settings, session runtime and codemode/MCP define the required APIs; do not patch host internals or copy credentials. Verify the personal settings SHA-256 before startup and after shutdown. This route passed the recorded Pi 1.0.2 V6 run; revalidate against a changed host.

### Capture and retain evidence

1. Require `HERDR_ENV=1`; inspect `herdr --help`, `herdr pane`, and the caller layout.
2. Create a sibling pane with the appropriate split direction and `--no-focus`; use its returned ID, not the caller's pane.
3. Launch the verified command there. Use bounded waits and logical input keys.
4. After each state, capture `herdr pane read <id> --source visible --format text` and `--format ansi`; retain dimensions, mode, theme, timestamp, pane/session ID and scenario ID. Scrollback is supplementary, not proof of vanished frames.
5. Verify native receipts, actual files and child termination separately. Reconcile parent assistant usage plus native tool-result usage once; do not add child detail usage again. Inspect `/session` without adding a statistics feature.
6. Record source HEAD, hashes of changed/new files, exact launches, Pi/Node/model identities, command exits, expected/observed results and retained record hashes locally under `.ai/verification/interactive-harness-ui/`: `evidence.json`, `checks.txt`, `screens.jsonl`, `consistency.md`. Append a public summary to [verification](verification.md), not raw transcripts or credentials.
7. Close only owned processes/panes after capture; confirm no child remains. Missing service/model/terminal or matrix evidence means partial delivery, not completion.

## Next step

See [bounded subagents](subagents.md) for guards, cancellation and usage completeness, [architecture](architecture/index.md) for responsibility boundaries, and [verification](verification.md) for observed results and limitations. This guide specifies a procedure; it does not predeclare its outcome.
