# Local CLI and Artifact Assembly

## Preflight and authorization

Inspect locally installed `whisper --help` and package metadata for version-specific flags; check `ffmpeg` and available model weights. The inspected upstream CLI (20250625) defaults to `turbo`; it may download missing weights and can catch per-file exceptions without returning a failing exit code. Do not assume that presence on PATH proves inference works. Do not upgrade or install dependencies automatically. Offer platform-appropriate instructions only after identifying missing prerequisites.

Use absolute input/output/helper paths and argument arrays where possible. If a shell is required, safely quote every path/argument rather than interpolating raw user text. A model name and language must be supported CLI values, not arbitrary shell fragments. A filename beginning with a dash is safe as an absolute path.

## One isolated run

After authorization to process the recording, create a unique private directory using the platform's temporary-directory facility (for example `mktemp -d` on supported POSIX hosts). Record that directory; do not reuse or clear a predictable global path. Ensure it is private to the current user. Run the following shape as one command, replacing placeholders with validated arguments:

```text
whisper "/absolute/input.wav" --model turbo --task transcribe --language es --verbose False --output_format json --output_dir "/private/unique/run"
```

For auto-detection **omit** `--language es`; never pass `auto`. Add `--word_timestamps True` only when word timing is requested and supported; JSON alone does not enable it. Whisper's plain transcription does not identify speakers. Do not invent speaker turns.

In transcript-only mode, keep stdout/stderr in private run logs instead of returning their contents through a model tool result: errors or unexpected CLI versions could print sensitive content even with verbose disabled. Report exit status and file metadata, not log bodies. Duration and model choice affect resource use; do not promise completion times. Cancellation must not trigger automatic deletion of user files.

Expected output uses the input basename with only its final extension replaced by `.json`. The new private directory prevents stale results and collisions between equal basenames. Check the expected output belongs to this run; the assembler validates content but cannot prove freshness on its own.

## Deterministic assembly

Node >=22.19 is sufficient; no additional Node packages are needed. The output parent directory must already exist. These are argument shapes; do not send transcript text as a command argument.

```text
node "/skill/scripts/assemble.mjs" "/private/run/input.json" "/approved/new-transcript.md"
node "/skill/scripts/assemble.mjs" "/private/run/input.json" "/approved/new-transcript.md" --summary "/private/run/summary.md" --coverage complete
```

Use `--coverage partial` when any recognized text was omitted from summarization. Do not claim complete coverage merely because the helper accepted the flag; keep segment/character coverage evidence. Without a summary, coverage is `none`. The helper does not run Whisper, download weights, summarize, or delete anything.

Inputs are bounded to 64 MiB per JSON/summary file. Missing, malformed, empty or oversized inputs stop before writing; use an explicitly designed chunking path rather than truncate the artifact. Output uses exclusive creation and mode 0600 on POSIX; an existing file or symlink is refused. On platforms with different permission models, verify equivalent access controls. Failure returns exit 1; success prints only path/count/coverage metadata. Keep raw JSON as the authoritative record of what the recognizer returned, not proof of what was actually said.

## Authorized summary processing

Whisper JSON can be one enormous line. Do not use a truncated tool response as the full transcript. Extract bounded segment/text slices locally, number them and track which ranges the model received; summarize all ranges or report partial coverage. Preserve raw JSON/text regardless of summarization. Format an optional summary with topics, decisions, actions and short supported quotes; omit sections not supported by the recording.

Distinguish recognition errors from interpretation uncertainty. If the recording is silent, decoding fails or resources are insufficient, report the observed failure and propose a supported smaller model/conversion only with authorization. No cloud API fallback. Confirm retention of private raw JSON/logs; clean up only specifically owned artifacts when the user authorizes it.
