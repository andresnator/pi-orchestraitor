# See delegated work and decisions without replacing Pi

The optional UI extension adds a read-only agents panel, one native-footer status, a unified question tool and a warning before a model or thinking switch re-bills cached context. Pi still owns the editor, application keybindings, native model/context/usage display and execution. This is presentation, not another scheduler or durable SDD recovery. A separate [footer extension](#footer) restyles Pi's footer.

The installer also registers the separate [pi-pretty companion](pi-pretty.md). It owns read/bash presentation and its prompt-editor/activity customization; this UI extension still owns only the harness status and foreground interactions.

## Quick path

1. Open `/orchestraitor:agents` for detail.
2. Use `/orchestraitor:ui hide` or `show` for passive chrome only. Questions and execution remain active.

Only native TUI mode creates components. In RPC, JSON and print, questions return `unavailable`; use ordinary textual clarification. Questions never enable disabled tools or grant security/destructive-action permissions.

## Ownership

| Responsibility | Owner |
| --- | --- |
| Child execution, cancellation, termination, safety lock and accounting | Existing `subagent_run` / `BatchController`; UI observes native progress only. |
| Harness status key and foreground modal | `extensions/status-ui.ts`; one owner, no foreign keys/factories replaced. |
| Agent observations and bounded branch outcomes | `extensions/ui/agents.ts`; active batch plus at most 20 recent outcomes. |
| Requirements/preferences | One `orchestraitor_ask` schema and interaction in `extensions/ui/questions.ts`. |
| Safe terminal display | Native `extensions/ui/display.ts`; original IDs and opaque values remain untouched. |
| Cache warning before a switch | `extensions/ui/cache-notice.ts`; native notification only, never transcript or model context. |

## Panel and compact chrome

The agents panel shows assignment order, IDs, roles, requested/effective model evidence, phases and bounded diagnostics. Starting/running/stopping are not failure or acceptance. Runtime completion is not parent acceptance; absent effective-model or nested historical evidence stays unavailable. Panels cannot launch, retry, grant, resume or cancel work.

The footer contributes one status with this precedence: known launch block, awaiting input, active agents; idle contributes nothing. Native counters are not repeated.

Switching model or thinking level with at least 20k context tokens shows one warning once switching has settled for 1 second: the next request will likely re-bill that context, with the cost estimated from the new model's prices. Returning to the selection of the current branch's latest request, also after `/tree` moves to another branch or a session resumes, restored selections, unknown context size after compaction and modes without UI stay silent. `hide` does not suppress it; disabling the extension does. See [performance](performance.md#model-and-thinking-switches) for the rule.

Selection, scrolling, submission and cancellation use native configurable actions. Check `/hotkeys` and Pi's keybinding documentation rather than relying on a hardcoded shortcut. The read-only panel also closes with Escape. The extension never replaces the main editor/header/footer, registers global shortcuts, or changes personal themes.

Before tree navigation, session switching or forking, the UI cancels its current interaction and invalidates pending work from that interaction generation. It retains the current context, agent projection and visibility preference while navigation is pending. A veto or an aborted branch summary leaves the existing UI usable, including new panels and questions. Confirmed tree/session changes rebuild from the effective branch and restore the default visible chrome. Shutdown and context replacement release the owned UI; late completion of an old interaction cannot close its replacement.

## Footer

`extensions/footer.ts` replaces Pi's terminal footer; other modes keep Pi's. It shows the same data in two lines plus Pi's extension-status line:

```text
~/Projects/pi-orchestraitor (develop) • session name
━─────── ctx 16.4%/1.0M (auto)  ↑2 ↓81 CH0%          claude-bridge · Claude Opus 5.5  effort:xhigh
```

The bar shows context usage and turns warning above 70% and error above 90%. Token totals keep input, output, the latest cache hit rate and the cost when it is above zero. The model shows its provider ID and display name; effort uses the color Pi gives the editor border at that thinking level. Narrow terminals drop token totals, the provider, the bar and then effort before truncating.

Disable only the footer to restore Pi's:

```json
{"packages":[{"source":"/absolute/path/to/pi-orchestraitor","extensions":["!extensions/footer.ts"]}]}
```

## Plan usage

`/quota` lists the plan windows each provider reported with its latest response in this Pi process, with their reset time and the age of the report. The active provider appears even before it reports any. Providers cannot be queried on demand: usage arrives only with `after_provider_response` headers, and Pi sends no model with that event, so the active provider owns them.

`pi-claude-bridge` reports Claude's `anthropic-ratelimit-unified-5h`/`7d` utilization and reset when Claude Code includes them. The `x-codex-primary`/`secondary` used-percent, window and reset headers are read on a best-effort basis: they were not observed in a live response. `extensions/quota.ts` owns the command; excluding it leaves the footer unchanged.

## Question contract

`orchestraitor_ask` is a direct model-only, sequential tool. Nested codemode/`executeTool` calls are rejected. Example model input:

```json
{
  "questions":[{
    "id":"approach",
    "prompt":"Which harmless example should the guide use?",
    "selection":"single",
    "options":[{"label":"Parser","value":"opaque/parser","recommended":true},{"label":"Formatter","value":"opaque/formatter"}]
  }]
}
```

Use one to six unique IDs, `single` or `multiple`, two to eight distinct values per choice. Questions default to required; `required:false` permits skipping. Free text needs explicit `allowText:true`. Mark the options you suggest with `recommended:true`, at most one for single choice. Prompts/values/answers are bounded to 1,000 characters and labels to 200. IDs/option values are returned exactly, separately from sanitized labels.

Simple and rich questions use the same rounded card in Pi's current theme. The top border names the question (`Question 2 of 3`, `Review`) and what it accepts (`pick one`, `pick any or type`); the bottom border lists the native key hints that fit, dropping the least important first. With several questions, a strip shows answered (`✓`), pending (`○`) and current questions plus review. The whole prompt is shown and wrapped; when the terminal is too short, it scrolls with page up/down and a `↓ N more lines` indicator. Option labels wrap to two lines, and recommended options end with a muted `(recommended)`, which preselects nothing. Radio marks (`○ ●`) represent single choice and squares (`□ ■`) multiple choice. Highlighting an option never approves it. Results have version 1 and `answered` plus answers, or `cancelled`, `unavailable`, `busy` without submitted answers. Abort/session change discards drafts. An active question is not displaced by another panel/question. Questions collect requirements, not native trust or operation permissions.

| Key | Question | Review |
|---|---|---|
| ↑ ↓ | Move the highlight | Move between answers and Submit |
| Enter | Single choice: choose and continue. Multiple choice: continue. Text row: start typing | Change the highlighted answer, or submit |
| Space | Multiple choice: toggle the option. Text row: start typing | — |
| 1–9 | Highlight that row without choosing it | — |
| ← → | Previous / next question (→ on the last one opens review) | ← returns to the last question |
| Backspace | Clear this question's answer | — |
| Esc | Cancel the whole questionnaire; while typing, return to the options | Cancel |

With `allowText:true`, a `Type your own answer…` row edits inline: Enter saves the text and continues; Esc returns to the options without saving the draft. Typed text replaces any chosen option. Enter on a required multiple choice asks for at least one toggle first, and review keeps `Submit` disabled while a required question is unanswered, naming the missing IDs. Reopening an answer from review returns there after the change.

Form transitions synchronize the highlight and text focus immediately, including when several keystrokes arrive before the next render. Choosing, saving text and opening review never submit; only Enter on the focused `Submit` row does. Submission, cancellation and disposal end input handling, and the result callback runs at most once.

## Disable safely and account for host limitations

For one invocation, retain the rest of the package but prevent model calls to the question tool:

```bash
pi --exclude-tools orchestraitor_ask
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
- Questions: `/ui-smoke single` and `/ui-smoke form`; choose predefined harmless markers, edit synthetic Unicode text, correct, submit or cancel. Inspect exact native results.

### Acceptance matrix

| ID | Exercise | Required evidence |
| --- | --- | --- |
| V1 | Two readers, one writer, failure, cancellation, retry | Starting/running/final frames, order, diagnostics, no acceptance label; separate actual termination/bytes checks. |
| V3 | Single choice, multi-select, free text, correction, cancel | Option/form frames, exact native values, no partial answer on cancel, restored editor text/focus. |
| V4 | Chrome/coexistence/hide/show | Native editor/footer/context/usage, compact tools and foreign widget/status remain; state/execution unchanged. |
| V5 | Layout, focus and lifecycle | Actual narrow/wide and short terminal sizes, dark/light/system theme checks, both native modes, scrolling, Unicode, reload/new/tree without stale UI. |
| V6 | Bounded real model, no fixture | Two readers on synthetic marker data, parent-inspected citations, one harmless question, agents panel; usage reconciled and an actual cancellation/retry if not already exercised. |

V1, V3 and V4 must run in both regular and fullscreen with the fixture; V5 covers real transitions. V6 uses the configured available model and existing credentials without copying/printing them, full production package and fresh synthetic workspace/session receipts; no substitute model or fixture. It consumes quota. Separate service tests isolate synthetic Engram data. Never present mocks as model acceptance or claim native Windows verification without running there.

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
