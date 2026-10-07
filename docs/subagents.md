# Bounded subagents

`subagent_run` starts a fresh Node process and in-memory Pi session per task. It accepts one or two `explore`/`review` readers, or one exclusive `implement` writer. A parent has at most two pending readers across calls; an implementer is exclusive and synchronous. Small changes should remain direct. Plan work groups stay sequential and their original SHA-256 stays unchanged.

## Tool input

```json
{
  "tasks": [
    {
      "role": "review",
      "instruction": "Inspect src/parser.ts for malformed-input handling. Read only; do not change files. Return findings with paths and line ranges, inference labelled separately, blockers and unperformed checks.",
      "context": "Objective: determine whether empty input is rejected. Accessible evidence: src/parser.ts and tests/parser.test.ts in this workspace. Acceptance: cite the actual branch and any matching test, or report missing evidence. The parent runs tests and decides acceptance.",
      "skills": [],
      "model": "provider/model-id",
      "reasoning": "high"
    }
  ]
}
```

`model`, `reasoning`, `mode`, `context` and `skills` are optional. Per-field precedence is task → trusted project role/defaults → personal role/defaults → parent. Project assignments are neither read nor applied until Pi reports native project trust; personal assignments and explicit task choices remain available. Execution defaults to `sync`. Explicit unsupported efforts fail before launch; inherited effort follows Pi's capability clamping. `off` disables thinking; inheritance is a separate choice. Models must be available in the parent's registry and enabled scope. The parent streams through `modelRegistry.streamSimple`, including extension-only providers and runtime credentials. The child retains its own process and protected tools without loading personal credentials. There is no silent model fallback.

## Model profiles

Run `/models-profiles` in Pi, select personal/project scope (project scope requires native Pi project trust), and create or select a named profile. Every terminal selection menu supports typing to filter with Pi's native fuzzy matching: scope, profiles/actions, roles, fields, models, effort, and execution mode. Models are searchable by provider, ID, or display name. Use arrows to navigate, Enter to select, Backspace to edit the search, and Esc to go back. Searches reset when opening another menu. RPC retains native selection dialogs. Edit each role's model, supported effort (including `max` when provided by Pi), and execution mode. Readers may use `background`; implementation uses `sync`. Review the effective before/after values and choose **Save and apply**. **Save profile** stores changes without applying them. **Apply** applies the saved version. Rename, duplicate and delete are also available; deletion requires confirmation and preserves applied assignments. `●` marks the last applied profile, even when assignments are subsequently edited elsewhere.

**Effective assignments** shows values and their source. **Refresh catalog** asks Pi to refresh; provider installation/authentication remains in Pi. The panel uses no model requests. It requires an interactive UI (TUI or an RPC client implementing Pi UI requests); print mode can use configuration files directly.

Profiles live in `<Pi agent directory>/orchestraitor/profiles.json`. Applied personal assignments live in `orchestraitor/config.json` there; project assignments live in `.pi/orchestraitor.json`. Each config accepts an `assignments` object with `defaults`, `explore`, `review`, and `implement`, each containing optional `model`, `reasoning`, and `mode` fields. A null field inherits; applying a profile replaces the scope's complete assignments so old overrides do not leak. Other configuration fields are preserved. Writes use a cooperative lock, revision checks and same-directory atomic rename. Stale panels fail explicitly. A profile saved before an application failure remains saved, and the error distinguishes those outcomes. Changes affect newly prepared tasks only.

## Background readers

Set `mode: "background"` on explore/review tasks. `subagent_run` returns pending IDs immediately; mixed batches wait for synchronous tasks only. `subagent_collect` accepts `action: "status" | "collect" | "wait" | "cancel"` and optional `ids`. Collect returns finished results; wait waits then collects; cancel cancels then collects. Wait, collect and cancel require a direct model-issued tool call so their usage has a durable native accounting receipt; nested calls through `codemode` or `ctx.executeTool()` may query status only. Results include native usage only on their first collection. Completed but uncollected readers retain capacity. Collect all readers before launching implementation. The collect tool must be enabled to launch background work. Once the launch call returns, versioned session-level observations keep the agents UI current; mixed-batch outcomes are matched by task ID and only uncollected IDs remain live.

Before normal settlement, Pi immediately issues one grouped continuation asking the parent to call `subagent_collect` with `action: "wait"` and verify results. The wait runs inside the cancellable tool execution, never inside the settlement boundary. Each task can trigger at most one automatic collection reminder, recorded in the session. If the parent still omits collection, the flow stops automatic continuation, displays the unresolved IDs and preserves their receipts for manual collection. Further user turns or reload do not grant another reminder to the same task. Final settlement cancels any still-running children, including when an abort arrives between the boundary and continuation. Cancellation/navigation/reload/shutdown stop children. Persisted custom receipts retain pending/result evidence for background readers; synchronous results use the native foreground receipt, including the outer receipt for nested launches; native tool-result receipts establish completed accounting. Result visibility follows the active branch, while accounting deduplication inspects all entries in the session tree, including abandoned branches. Navigating before a collection receipt cannot charge its usage again. After reload, results with no native accounting receipt anywhere in that tree remain collectable; interrupted jobs without a final receipt show pending consumption, not invented zero usage. Recovery never restarts children. The task board still requires parent verification.

Selected `skills` are native-authorized names, never paths from a generated registry. In lazy mode the shared resolver revalidates bodies/resources immediately before preparation; a rejection blocks launch without fallback to stale metadata. In native mode or without the resolver, the captured native catalog is used. Manual-only names are rejected for automatic delegation in either mode. Children receive only the selected bodies and directories, not the registry or parent catalog.

An implementer additionally needs `files`, a nonempty list of exact project-relative files. The child prompt includes that complete list and the instruction to edit only those paths. Assignments and returned write paths use `/`; native Windows separators are normalized before traversal, protected-path and allowlist checks. Globs, traversal and protected paths are rejected. The parent must have `read` enabled, and `edit` plus `write` for implementation. The launcher respects Pi's tool allowlists and does not activate disabled tools.

Each ordered receipt in `details.results` contains `id`, `role`, `cwd`, effective `model` and `reasoning`, `status`, `finalResponse`, `writes`, `diagnostic` and `terminated`. Before a successful startup, model/reasoning fields describe the requested selection, since effective values are not yet available. Writes distinguish attempted and completed file writes at the validated final path; attempts may have left partial content. Rejected destinations are not recorded as write attempts. This is an operation ledger, not an independent filesystem audit. No automatic rollback is performed.

## Observed progress (optional UI)

The launcher forwards optional bounded lifecycle observations through native `tool_execution_update` as `details.progress`, with version, session/generation/tool-call identity, ordered task IDs and requested/effective model evidence. The controller remains the only lifecycle authority; observers are immutable and exception-isolated. Preparation/starting/running/stopping are not premature failures or completed work.

The [interactive UI](interactive-ui.md) consumes these events for a read-only panel and one native-footer status. Nested calls use native identities; missing persisted nested history is marked unavailable after replay. Final `details.results`, native top-level usage and safety locks retain their contracts; model content uses the compact handoff below. Progress carries no top-level usage and never marks parent tasks done. Disable the UI entrypoint without changing this launcher.

## Usage accounting

Each result adds `usageComplete` and optional native Pi `usage`. The launcher sums finalized assistant responses across the whole child run, including tool-use turns, once per response. Streaming updates and repeated final events are not extra consumption. Optional `reasoning` and `cacheWrite1h` remain subset counters, not additions to `totalTokens`; reported costs are not repriced.

| Outcome | Accounting |
| --- | --- |
| Normal run with valid finalized usage and confirmed stdout drain | `usageComplete: true`; reported zero usage/cost remains valid. |
| Cancellation, timeout, failure, missing/invalid usage or ambiguous/incomplete transport | `usageComplete: false`; retain valid totals already observed and explain limitations in `diagnostic`. |
| No valid observed usage | Omit `usage`; never substitute a complete zero. |

The native tool result's top-level `usage` sums the ordered child results. Pi persists it and includes it once in footer and `/session` totals alongside parent usage. `details.results` retains child attribution; `details.usageComplete` requires all children to be complete. Model-facing content is a compact JSON array with `id`, `status`, `finalResponse`, `writes`, `diagnostic`, `terminated` and `usageComplete`. Final responses and safety evidence are preserved without truncation; model/reasoning/cwd and per-child accounting remain in full receipts. Expand the native tool view to inspect complete receipts. Do not add child detail totals again when reconciling native tool usage.

Accounting completeness is not task acceptance or invoice accuracy. Interrupted responses can consume provider quota without reporting final usage; zero catalog prices do not establish free billing. Accounting is in-memory for this run only, with no historical ledger or estimate of missing consumption.

## Assignment and handoff

Keep small changes direct. Delegate independent objectives with relevant context and accessible evidence only when parent-plus-child work can justify fresh-session startup and review costs. Parallel work alone does not establish token savings. Use `instruction` and `context` for one objective, scope/authority and acceptance criteria, as in the example above; model and reasoning changes remain explicit. The shared child prompt requests a concise outcome with inspected/changed paths and relevant ranges, observations versus inference, blockers, remaining work and unperformed checks. Do not require a second lifecycle schema or a long ceremonial report.

`status: completed` means the run finished normally, **not that the task was accepted**. A blocked reader may finish successfully while reporting unavailable evidence. The parent verifies claims and actual changes before accepting work.

External checkouts may be outside the child's readable roots. Inspect them directly in the parent or supply bounded excerpts in `context`, labelled with their source path and ranges. Excerpts are evidence, not authority; supplied paths do not grant access. `files` remains an exact write allowlist, never an attachment mechanism.

## Isolation and lifecycle

The child uses public Pi SDK service/session APIs and the native RPC server. A temporary configuration, in-memory session and explicit resource overrides disable automatic extensions, skills, prompts, themes, context files, `SYSTEM.md` and `APPEND_SYSTEM.md`. Only the guard, explicitly selected effective skills and captured instructions whose paths are within the project directory are supplied. Global and ancestor instruction files are excluded. Credentials are resolved by the parent registry and never serialized into task manifests or sent through the provider bridge. Bridged children receive only a minimal environment. Provider context is limited to 8 MiB; decoded events and wire records to 1 MiB each, with a 32 MiB wire budget per stream and explicit failure on overflow. Consecutive cumulative event snapshots are delta-encoded, so repeated partial text is not counted repeatedly against the stream budget. The bridge permits one unconsumed nonterminal snapshot at a time, with credit returned when its stream iterator advances. Temporary task data is removed after confirmed exit.

The guard exposes `read`, literal-text `search` and `list`; implementers additionally get guarded native `edit` and `write`. Searches skip binary and large files and bound traversal/output. Optional `mode: "files"` emits each matching path once; `limit` (1–2000) bounds matches. The default remains line-based content search. Limits and skipped oversized files report truncation. These tools validate paths on every execution. Native file tools also validate the final path in their filesystem operation callbacks, after Unicode-space normalization and read filename fallbacks. Image detection and parent-directory creation use the same guard. Reads are confined to the canonical project and selected skill directories. Symlinks are rejected, including internal aliases; hard-linked files cannot be written. Git metadata, `.pi`, `.codex`, `.agents` and `node_modules` are inaccessible, except explicit read-only selected skill subdirectories under `.pi/skills`, `.agents/skills` or `.codex/skills`. Enclosing metadata roots, other skills and protected entries inside a selected directory remain inaccessible. A standalone selected skill directly in a protected metadata root cannot be delegated; use a skill subdirectory or keep that work in the parent. Writes additionally protect instruction files, package configuration and top-level `extensions`, `instructions`, `skills` and `prompts` directories. Select different task boundaries when those harness resources need changing; the parent edits them directly.

Children receive no Bash, Git, MCP, codemode or delegation tools. These are tool controls, **not an OS sandbox**. A same-user external process can race filesystem validation or change files concurrently. Do not treat this as protection against hostile local processes or hostile SDK/provider code.

Before a prompt is sent, the parent requires a guard confirmation tied to task ID, manifest digest, cwd, active tools, model and effective reasoning, then checks native RPC state. Startup has a 30-second deadline; each task has a ten-minute deadline. Completion requires `agent_settled`, a nonempty final assistant response without a provider/abort error, and a clean, confirmed process exit. `agent_end` or exit zero alone cannot establish success.

Cancellation, session switch/fork/tree navigation, reload and shutdown abort the active batch. Shutdown first requests RPC abort, then closes stdin, then escalates to TERM/KILL with bounded waits. Writer exclusivity is retained until exit is observed. If exit cannot be confirmed, launches remain blocked in that host process, including after extension reload. Preparation failures before process creation, and failures after confirmed exit, release the batch so a later launch can retry. Late control events are discarded. The provider bridge remains active through bounded teardown and allows up to one second for an aborted provider response with finalized usage before synthesizing an incomplete cancellation response. Finalized usage remains observable through bounded stdout teardown; IPC disconnect alone does not establish stdout completion. Returned results stop accepting observations before return. Validated write notifications remain accepted during teardown, including after `exit`, until IPC disconnect or process close is observed. Duplicate phases cannot change a completed write back to attempted. The drain has a bounded wait; an unconfirmed drain is reported in diagnostics. RPC records, returned text and diagnostics are bounded, with truncation reported. Background accounting receipts survive reload; child execution itself is never resumed.

The parent must inspect results and writes and run all commands, tests and builds. Delegation is not independent verification or blind dual review. SDD, TCR and automatic Git delivery remain unsupported.

## Verify handoffs and accounting in a new pane

Use a disposable canonical workspace with a three-line marker/unknown-value file, a typo file and a separate outside-workspace file. Open a new terminal pane; keep native session receipts outside the workspace. With `HARNESS` pointing to this checkout, `MODEL` to an available provider/model and `RECEIPTS` to a fresh directory, launch from that workspace:

```bash
pi --no-extensions --no-skills --no-prompt-templates --no-themes \
  --no-context-files --no-approve --offline \
  -e "$HARNESS/extensions/instructions.ts" \
  -e "$HARNESS/extensions/subagents.ts" \
  --tools read,edit,write,subagent_run,subagent_collect --model "$MODEL" --session-dir "$RECEIPTS"
```

`--offline` disables discovery/network refresh, not requested model inference. Existing credentials must be available to the parent. This exercise consumes provider quota.

1. Delegate two readers with evidence-bearing assignments. Check their citations against the original file, ordered results, no writes and complete usage.
2. Delegate the outside-workspace read without passing its contents or broadening roots. Expect a blocked handoff, not invented evidence or task acceptance merely because the run completed.
3. Delegate only the typo replacement to one writer with its exact file allowlist. Inspect actual bytes, unchanged files and the write ledger.
4. Start a bounded multi-read task, observe an active child and press Escape. Check cancellation, retained observed usage, incomplete accounting, confirmed exit and a successful subsequent reader.

Expand results with Ctrl+O and inspect `/session`. Reconcile each native tool-result `usage` against its children and the whole session against parent assistant plus native tool usage exactly once. Preserve local receipts, source hashes, pane identity and command exits; missing evidence blocks acceptance. The coordinator runs `npm test` and checks actual files—child claims are not verification.

The [2026-10-04 evidence](verification.md#subagent-handoffs-and-usage--2026-10-04) records this bounded run and its limits.

## Manual checks with a real model — not run automatically

This broader release checklist incurs provider usage. Only the subsets recorded above have current live evidence; unrecorded scenarios remain **pending** and cannot be inferred from deterministic fixtures:

1. Run two readers with the inherited model; inspect their evidence and ordered results.
2. Request an explicitly available alternate model and reasoning; check effective values. Request an unavailable model and confirm a clear failure before prompting.
3. Assign a writer one disposable file. Ask it to read outside the project, write another file and execute Bash; confirm rejection and inspect the actual file and operation ledger.
4. Cancel during startup and during generation/tool execution. Confirm process exit and preservation of partial writes; then run another batch.
5. Reload or change the parent session during a batch and confirm teardown. Inspect provider-specific errors and length-limited responses.
6. Run from an extracted package with selected external skills and OAuth credentials; confirm only intended context and skill resources are visible.
7. On a native Windows host, run read/edit/write/list/search with root-level and nested assignments and both separators. Inspect the `/`-normalized write ledger and confirm traversal and symlink rejection. Deterministic `path.win32` tests use simulated filesystem metadata and do not establish native Windows execution.

Protocol reference: [Pi CLI integration](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli-integration.md). The original deterministic baseline used Pi 1.0.0; current checks use Pi 1.0.4, including local synthetic provider/guarded-child UI integration. This is not live-model or visible-terminal acceptance.
