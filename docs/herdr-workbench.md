# Keep Pi authoritative; inspect work in a separate Herdr pane

The optional workbench shows **Overview, Tasks, Agents and Usage** beside its originating Pi session. Publishing starts by default in interactive Pi terminals inside Herdr; it does not open a companion automatically. The workbench cannot run agents, change tasks, accept work or answer questions. Questions remain styled native cards inside Pi. Personal plugin registration and shortcut setup remain manual.

## Quick path — user-directed setup

Requirements: Node compatible with this package (`>=22.19.0`), Pi with the public TUI/SDK APIs used by **1.0.2**, and local macOS Herdr **0.9.3**. The plugin currently declares macOS only; Linux, Windows and remote sessions are not accepted platforms. Node, `pi` and `herdr` must be reachable in the plugin PATH. Missing dependencies are reported, never installed automatically.

1. Load the package normally; retain `extensions/status-ui.ts`.
2. Start interactive Pi **inside Herdr**. Publishing starts automatically; verify it with:
   ```text
   /orchestraitor:workbench status
   ```
   No `enable` command is normally needed. Use `/orchestraitor:workbench enable` to re-enable a deliberately disabled publisher. RPC, JSON, print, non-interactive terminals and terminals outside Herdr do not publish. The existing `--orchestraitor-workbench` flag defaults to true; SDK callers can explicitly set its value to false.
3. Choose the actual installed package directory and link its plugin yourself:
   ```bash
   WORKBENCH="/absolute/path/to/pi-orchestraitor/herdr/workbench"
   herdr plugin link "$WORKBENCH"
   herdr plugin list
   ```
   Linking registers the plugin in your chosen Herdr profile; it is not part of package installation. The manifest has no download, build or automatic-open hooks.
4. If desired, add this binding to your chosen Herdr configuration yourself:
   ```toml
   [[keys.command]]
   key = "cmd+e"
   type = "plugin_action"
   command = "pi.orchestraitor.toggle"
   ```
   Follow your installed Herdr reload procedure. Preserve existing bindings, including Command-R for reviewr. This is **Command-E**, not Control-E and not a Pi global shortcut.
5. From the enabled Pi pane, press Command-E. It opens/focuses the associated companion; press it again from Pi or the companion to close only that view and return to the valid origin. Pi's editor and execution are not controlled by the plugin.

### Explicit-caller fallback

Herdr's `plugin action invoke` CLI resolves UI focus rather than reliably identifying the shell caller. This implementation rejects its ambiguous CLI invocation context. In an ordinary shell in the exact originating Herdr terminal, use the argv-based fallback:

```bash
node "$WORKBENCH/actions.mjs" open --caller "$HERDR_PANE_ID"
node "$WORKBENCH/actions.mjs" toggle --caller "$HERDR_PANE_ID"
node "$WORKBENCH/actions.mjs" close --caller "$HERDR_PANE_ID"
```

The caller must match inherited Herdr IDs, the exact source process and current owned-pair focus. Never copy another terminal's ID or run this from an unrelated focused pane. A CLI invocation is not evidence that your terminal forwards Command-E.

## Navigation and layout

| Key | Local effect |
| --- | --- |
| `1`–`4` | Overview / Tasks / Agents / Usage |
| Arrows | List focus or detail scrolling |
| Enter | Detail or completed-group expansion; never task acceptance |
| Tab | Show the list or the selected item's detail; arrows follow the visible focus |
| PageUp / PageDown | Scroll |
| Escape | Back from detail/help |
| `?` / `q` | Help / close this companion |

Selection follows stable IDs; updates preserve deliberate scrolling. Completed tasks are collapsed in groups. Titles, status, group, evidence/reason and plan-binding warnings remain available in detail. Multiline native notes use visible `↵`/`⇥` markers; original receipts are unchanged. Agents show observations, requested versus confirmed effective models, phases, diagnostics and exit confirmation—not inferred task linkage or parent acceptance.

Right splits preserve at least **80 chat columns and 48 companion columns**; otherwise down splits preserve **12 chat rows and 10 companion rows**. Geometry checks include a conservative chrome allowance. A debounced resize can replace only a verified owned right companion below its source, preserving bounded local navigation state and foreign geometry. It does not automatically move back right; reopening reevaluates placement. Too-small or changed/ambiguous layouts fail safely rather than resetting the workspace or covering Pi's editor.

The default palette is an explicit **Nord-compatible preset**, not inherited Herdr theme state. Choose a preset for an explicit open with `PI_WORKBENCH_PALETTE=light node "$WORKBENCH/actions.mjs" open --caller "$HERDR_PANE_ID"` (or `mono`/`nord`). Close the old companion first; existing instances retain their selected preset. Reduced-color rendering is provided by the standalone renderer; `NO_COLOR`/a dumb terminal select monochrome. Nord attribution and its MIT notice are retained in `herdr/workbench/palette.mjs`. State meaning also uses labels, symbols and focus markers, not color alone. Pi question cards use Pi's current theme and native configurable keys, independently of the companion palette.

## Read usage without inventing quota

| Reading | Scope and limits |
| --- | --- |
| Estimated context | Latest Pi-reported occupied tokens, capacity and percentage for the active Codex model; unknown is not zero. |
| Recorded session total | Native **all-entry** input + output + cache-read + cache-write, including compaction, summaries and other branches. |
| Codex rows | Recorded `openai-codex` models, not the current selected model guessed retrospectively. At most 100 rows; additional models retain a labeled count and aggregate. |
| Unattributed / unsupported | Retain amounts without adequate model evidence and separately label other providers. |
| Parent / delegated attribution | Attribution of already counted native amounts; child detail is never added again. |
| Incomplete | Missing, failed or cancelled accounting may understate consumption even when valid observed numbers reconcile. |

Tasks follow the **active branch**; recorded usage follows the **whole native session**. Streaming chunks do not create finalized consumption. Reported zero remains valid; missing usage is visibly incomplete. Reasoning and cache-write-1h are subsets, not extra totals. There are no prices, subscription limits, reset times, provider-account requests or credential reads in the companion.

## Privacy, ownership and failure

Snapshots are disposable display data, not a command channel or durable ledger. A user-owned `0700` temporary namespace, derived from canonical socket and exact origin, contains bounded atomic `0600` files. The wire format carries random instance identity, PID, native session, generation, sequence and time; readers reject unsafe permissions, symlinks, oversized or malformed data. Native prompts, chat, question drafts, raw child answers and credentials are not published.

Updates coalesce to five writes per second. While a write is pending, only the latest update is retained; the next write waits at least 200 milliseconds after completion. A two-second heartbeat checks native entry changes, refreshes recorded usage when needed, and otherwise reuses cached projections. A companion reads at most four times per second. Data is stale after six seconds. Disable, shutdown, missing socket, failed writes or changed publisher instance produce stale/disconnected/error states; the companion never silently attaches to another session. Reload requires a deliberate close/reopen of the old companion. Hiding Pi's passive chrome does not disable publishing or execution.

Lifecycle actions require the open receipt plus exact pane/terminal, source and live process argv/PID/token evidence. Titles and cwd alone prove nothing. Repeated actions serialize; an uncertain open retains its lease and blocks duplicate retries. Same-user cooperative locks and permissions are **not an OS sandbox**. Abandoned locks are not automatically broken.

If an action fails, inspect the installed `herdr plugin log` help and the explicit owned pane's `pane process-info`/layout. Do not close a guessed pane, remove an uncertain lease blindly, stop the personal server or resize reviewr. Native Pi execution and task receipts remain usable; use its existing panels while resolving host identity.

## Disable safely

1. Close the owned companion with Command-E or local `q` while the pair is still valid.
2. Run `/orchestraitor:workbench disable` in Pi. Explicit enable/disable choices survive session navigation and native `/reload` in the current Pi process. Starting a fresh Pi process uses the default or its SDK flag override. Repeated shutdown is safe and removes only matching source artifacts.
3. If you want to remove personal registration, inspect `herdr plugin unlink --help` and unlink `pi.orchestraitor` yourself. Remove only the optional Command-E binding you added.

Excluding `extensions/status-ui.ts` disables the publisher and question/task UI without disabling the launcher. It does not authorize closing another application's panes or deleting its state.

## Verify before calling it accepted

`npm test` covers contract/accounting, transport, native component layout, lifecycle seams and extracted-package inventory. Fixtures under `tests/fixtures/workbench-*` are **unshipped and explicitly synthetic**. The public-SDK launcher uses in-memory settings, owned scratch resources and existing credential references only after explicit live-usage authorization; ordinary personal-profile CLI startup can write settings and is not a read-only substitute.

Real Command-E delivery, actual two-pane focus/draft preservation, visible native questions, live configured Codex accounting and final user approval remain separate acceptance gates. See [verification](verification.md) for observed evidence and limitations, [native Pi UI](interactive-ui.md) for answer contracts, and [subagents](subagents.md) for execution/accounting authority.
