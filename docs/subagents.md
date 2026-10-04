# Bounded subagents

`subagent_run` starts a fresh Node process and in-memory Pi session per task. It accepts one or two `explore`/`review` readers, or one exclusive `implement` writer. A parent has one active batch. Small changes should remain direct. Plan work groups stay sequential and their original SHA-256 stays unchanged.

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

`model`, `reasoning`, `context` and `skills` are optional. Model and reasoning default to the parent. Models must be available in the parent's registry and enabled scope, and independently available to the child through the existing credential/model storage. Models supplied only by parent extensions or ephemeral credentials may therefore fail explicitly. There is no silent model fallback. Pi may clamp reasoning to model capabilities; results report the effective level confirmed at startup.

An implementer additionally needs `files`, a nonempty list of exact project-relative files. The child prompt includes that complete list and the instruction to edit only those paths. Assignments and returned write paths use `/`; native Windows separators are normalized before traversal, protected-path and allowlist checks. Globs, traversal and protected paths are rejected. The parent must have `read` enabled, and `edit` plus `write` for implementation. The launcher respects Pi's tool allowlists and does not activate disabled tools.

Each ordered result contains `id`, `role`, `cwd`, effective `model` and `reasoning`, `status`, `finalResponse`, `writes`, `diagnostic` and `terminated`. Before a successful startup, model/reasoning fields describe the requested selection, since effective values are not yet available. Writes distinguish attempted and completed file writes at the validated final path; attempts may have left partial content. Rejected destinations are not recorded as write attempts. This is an operation ledger, not an independent filesystem audit. No automatic rollback is performed.

## Observed progress (optional UI)

The launcher forwards optional bounded lifecycle observations through native `tool_execution_update` as `details.progress`, with version, session/generation/tool-call identity, ordered task IDs and requested/effective model evidence. The controller remains the only lifecycle authority; observers are immutable and exception-isolated. Preparation/starting/running/stopping are not premature failures or completed work.

The [interactive UI](interactive-ui.md) consumes these events for a read-only panel and one native-footer status. Nested calls use native identities; missing persisted nested history is marked unavailable after replay. Final `details.results`, JSON-array model content, native top-level usage and safety locks are unchanged. Progress carries no top-level usage and never marks parent tasks done. Disable the UI entrypoint without changing this launcher.

## Usage accounting

Each result adds `usageComplete` and optional native Pi `usage`. The launcher sums finalized assistant responses across the whole child run, including tool-use turns, once per response. Streaming updates and repeated final events are not extra consumption. Optional `reasoning` and `cacheWrite1h` remain subset counters, not additions to `totalTokens`; reported costs are not repriced.

| Outcome | Accounting |
| --- | --- |
| Normal run with valid finalized usage and confirmed stdout drain | `usageComplete: true`; reported zero usage/cost remains valid. |
| Cancellation, timeout, failure, missing/invalid usage or ambiguous/incomplete transport | `usageComplete: false`; retain valid totals already observed and explain limitations in `diagnostic`. |
| No valid observed usage | Omit `usage`; never substitute a complete zero. |

The native tool result's top-level `usage` sums the ordered child results. Pi persists it and includes it once in footer and `/session` totals alongside parent usage. `details.results` retains child attribution; `details.usageComplete` requires all children to be complete. The model-facing content remains a JSON array. Do not add child detail totals again when reconciling native tool usage.

Accounting completeness is not task acceptance or invoice accuracy. Interrupted responses can consume provider quota without reporting final usage; zero catalog prices do not establish free billing. Accounting is in-memory for this run only, with no historical ledger or estimate of missing consumption.

## Assignment and handoff

Use `instruction` and `context` for one objective, accessible evidence, scope/authority and acceptance criteria, as in the example above. The shared child prompt requests a concise outcome with inspected/changed paths and relevant ranges, observations versus inference, blockers, remaining work and unperformed checks. Do not require a second lifecycle schema or a long ceremonial report.

`status: completed` means the run finished normally, **not that the task was accepted**. A blocked reader may finish successfully while reporting unavailable evidence. The parent verifies claims and actual changes before accepting work.

External checkouts may be outside the child's readable roots. Inspect them directly in the parent or supply bounded excerpts in `context`, labelled with their source path and ranges. Excerpts are evidence, not authority; supplied paths do not grant access. `files` remains an exact write allowlist, never an attachment mechanism.

## Isolation and lifecycle

The child uses public Pi SDK service/session APIs and the native RPC server. A temporary configuration, in-memory session and explicit resource overrides disable automatic extensions, skills, prompts, themes, context files, `SYSTEM.md` and `APPEND_SYSTEM.md`. Only the guard, explicitly selected effective skills and captured instructions whose paths are within the project directory are supplied. Global and ancestor instruction files are excluded. Credentials are resolved through existing host paths and never serialized into task manifests. Temporary task data is removed after confirmed exit.

The guard exposes `read`, literal-text `search` and `list`; implementers additionally get guarded native `edit` and `write`. Searches skip binary and large files and bound traversal/output. These tools validate paths on every execution. Native file tools also validate the final path in their filesystem operation callbacks, after Unicode-space normalization and read filename fallbacks. Image detection and parent-directory creation use the same guard. Reads are confined to the canonical project and selected skill directories. Symlinks are rejected, including internal aliases; hard-linked files cannot be written. Git metadata, `.pi`, `.codex`, `.agents` and `node_modules` are inaccessible. Writes additionally protect instruction files, package configuration and top-level `extensions`, `instructions`, `skills` and `prompts` directories. Select different task boundaries when those harness resources need changing; the parent edits them directly.

Children receive no Bash, Git, MCP, codemode or delegation tools. These are tool controls, **not an OS sandbox**. A same-user external process can race filesystem validation or change files concurrently. Do not treat this as protection against hostile local processes or hostile SDK/provider code.

Before a prompt is sent, the parent requires a guard confirmation tied to task ID, manifest digest, cwd, active tools, model and effective reasoning, then checks native RPC state. Startup has a 30-second deadline; each task has a ten-minute deadline. Completion requires `agent_settled`, a nonempty final assistant response without a provider/abort error, and a clean, confirmed process exit. `agent_end` or exit zero alone cannot establish success.

Cancellation, session switch/fork/tree navigation, reload and shutdown abort the active batch. Shutdown first requests RPC abort, then closes stdin, then escalates to TERM/KILL with bounded waits. Writer exclusivity is retained until exit is observed. If exit cannot be confirmed, launches remain blocked in that host process, including after extension reload. Preparation failures before process creation, and failures after confirmed exit, release the batch so a later launch can retry. Late control events are discarded. Finalized usage remains observable through bounded stdout teardown; IPC disconnect alone does not establish stdout completion. Returned results stop accepting observations before return. Validated write notifications remain accepted during teardown, including after `exit`, until IPC disconnect or process close is observed. Duplicate phases cannot change a completed write back to attempted. The drain has a bounded wait; an unconfirmed drain is reported in diagnostics. RPC records, returned text and diagnostics are bounded, with truncation reported. There is no durable recovery between parent sessions.

The parent must inspect results and writes and run all commands, tests and builds. Delegation is not independent verification or blind dual review. SDD, TCR and automatic Git delivery remain unsupported.

## Verify handoffs and accounting in a new pane

Use a disposable canonical workspace with a three-line marker/unknown-value file, a typo file and a separate outside-workspace file. Open a new terminal pane; keep native session receipts outside the workspace. With `HARNESS` pointing to this checkout, `MODEL` to an available provider/model and `RECEIPTS` to a fresh directory, launch from that workspace:

```bash
pi --no-extensions --no-skills --no-prompt-templates --no-themes \
  --no-context-files --no-approve --offline \
  -e "$HARNESS/extensions/instructions.ts" \
  -e "$HARNESS/extensions/subagents.ts" \
  --tools read,edit,write,subagent_run --model "$MODEL" --session-dir "$RECEIPTS"
```

`--offline` disables discovery/network refresh, not requested model inference. Existing credentials must be available to the children. This exercise consumes provider quota.

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

Protocol reference: [Pi CLI integration](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli-integration.md). The original deterministic baseline used Pi 1.0.0; current checks use Pi 1.0.2, including local synthetic provider/guarded-child UI integration. This is not live-model or visible-terminal acceptance.
