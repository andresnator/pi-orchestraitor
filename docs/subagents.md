# Bounded subagents

`subagent_run` starts a fresh Node process and in-memory Pi session per task. It accepts one or two `explore`/`review` readers, or one exclusive `implement` writer. A parent has one active batch. Small changes should remain direct. Plan work groups stay sequential and their original SHA-256 stays unchanged.

## Tool input

```json
{
  "tasks": [
    {
      "role": "review",
      "instruction": "Inspect src/parser.ts for malformed-input handling. Return evidence with line numbers.",
      "context": "The parent will run tests and inspect your findings.",
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

## Isolation and lifecycle

The child uses public Pi SDK service/session APIs and the native RPC server. A temporary configuration, in-memory session and explicit resource overrides disable automatic extensions, skills, prompts, themes, context files, `SYSTEM.md` and `APPEND_SYSTEM.md`. Only the guard, explicitly selected effective skills and captured instructions whose paths are within the project directory are supplied. Global and ancestor instruction files are excluded. Credentials are resolved through existing host paths and never serialized into task manifests. Temporary task data is removed after confirmed exit.

The guard exposes `read`, literal-text `search` and `list`; implementers additionally get guarded native `edit` and `write`. Searches skip binary and large files and bound traversal/output. These tools validate paths on every execution. Native file tools also validate the final path in their filesystem operation callbacks, after Unicode-space normalization and read filename fallbacks. Image detection and parent-directory creation use the same guard. Reads are confined to the canonical project and selected skill directories. Symlinks are rejected, including internal aliases; hard-linked files cannot be written. Git metadata, `.pi`, `.codex`, `.agents` and `node_modules` are inaccessible. Writes additionally protect instruction files, package configuration and top-level `extensions`, `instructions`, `skills` and `prompts` directories. Select different task boundaries when those harness resources need changing; the parent edits them directly.

Children receive no Bash, Git, MCP, codemode or delegation tools. These are tool controls, **not an OS sandbox**. A same-user external process can race filesystem validation or change files concurrently. Do not treat this as protection against hostile local processes or hostile SDK/provider code.

Before a prompt is sent, the parent requires a guard confirmation tied to task ID, manifest digest, cwd, active tools, model and effective reasoning, then checks native RPC state. Startup has a 30-second deadline; each task has a ten-minute deadline. Completion requires `agent_settled`, a nonempty final assistant response without a provider/abort error, and a clean, confirmed process exit. `agent_end` or exit zero alone cannot establish success.

Cancellation, session switch/fork/tree navigation, reload and shutdown abort the active batch. Shutdown first requests RPC abort, then closes stdin, then escalates to TERM/KILL with bounded waits. Writer exclusivity is retained until exit is observed. If exit cannot be confirmed, launches remain blocked in that host process, including after extension reload. Preparation failures before process creation, and failures after confirmed exit, release the batch so a later launch can retry. Late control events are discarded. Validated write notifications remain accepted during teardown, including after `exit`, until IPC disconnect or process close is observed. Duplicate phases cannot change a completed write back to attempted. The drain has a bounded wait; an unconfirmed drain is reported in diagnostics. RPC records, returned text and diagnostics are bounded, with truncation reported. There is no durable recovery between parent sessions.

The parent must inspect results and writes and run all commands, tests and builds. Delegation is not independent verification or blind dual review. SDD, TCR and automatic Git delivery remain unsupported.

## Manual checks with a real model — not run automatically

These checks incur provider usage and are **pending**, not covered by deterministic fixtures:

1. Run two readers with the inherited model; inspect their evidence and ordered results.
2. Request an explicitly available alternate model and reasoning; check effective values. Request an unavailable model and confirm a clear failure before prompting.
3. Assign a writer one disposable file. Ask it to read outside the project, write another file and execute Bash; confirm rejection and inspect the actual file and operation ledger.
4. Cancel during startup and during generation/tool execution. Confirm process exit and preservation of partial writes; then run another batch.
5. Reload or change the parent session during a batch and confirm teardown. Inspect provider-specific errors and length-limited responses.
6. Run from an extracted package with selected external skills and OAuth credentials; confirm only intended context and skill resources are visible.
7. On a native Windows host, run read/edit/write/list/search with root-level and nested assignments and both separators. Inspect the `/`-normalized write ledger and confirm traversal and symlink rejection. Deterministic `path.win32` tests use simulated filesystem metadata and do not establish native Windows execution.

Protocol reference: [Pi CLI integration](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli-integration.md). Deterministic tests use installed Pi 1.0.0 APIs and fixtures without model calls.
