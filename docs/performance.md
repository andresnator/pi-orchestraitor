# Harness efficiency

The package keeps native tools, all 56 native skills (54 automatically selectable and two explicit-only), personality, bounded children and optional UI. Efficiency changes reduce repeated model context and projection work without introducing an agent pool, a model-based skill selector, a second accounting database or custom compaction.

The ten-lens consolidation reduces standalone catalog entries, not necessarily provider tokens. The historical 61-skill measurements below and the earlier 51-skill consolidation baseline retain their original counts; neither measures the current 56-skill package or establishes provider savings from the new workflows.

## Local benchmark

Run from a Git checkout:

```bash
pnpm run bench --samples 7 --output /tmp/pi-before.json
# Apply a change, then run the same fixtures and host.
pnpm run bench --samples 7 --compare /tmp/pi-before.json --output /tmp/pi-after.json
```

`pnpm run` measures the locked Pi host in `node_modules`; `node scripts/bench.mjs` measures the `pi` on PATH, and `PI_TEST_PACKAGE_DIR` selects another installed host. Prompt preparation calls Pi 1.2.0's `emitBeforeAgentStart(request, options)` form; earlier hosts take a different signature and are not measured correctly. Output files must be new paths; existing reports are never overwritten. Without `--output`, the command prints JSON. Reports include Node/Pi versions, platform, Git revision, a SHA-256 over tracked/unignored file names and contents (including dirty changes), raw samples, medians and p95 values. Rounds run each configuration in a separate process, sequentially, without concurrent tests. Do not compare different hosts as evidence of a code improvement.

- **Native / package / package-native:** isolated SDK resource/session startup, prepared prompt and model-visible tool declaration sizes, RSS/heap and CPU over a 100 ms idle interval. Package defaults to lazy skills; package-native loads the same 56-skill catalog (54 automatic and two explicit-only) after the public native-mode command. Startup includes host import/resources/mode setup, not first prompt preparation or time to first model token; preparation is reported separately. These samples use print mode.
- **Skills:** actual bounded search/load plus native read of jag-code; one warmup and five refresh/search/load timings per package sample. Initial and one-selected-skill character totals include schema and lookup/call overhead. The full diagnostic file is measured separately, never added to model context. This single deterministic English query does not evaluate selector quality.
- **Tasks:** real task-tool execution on a synthetic 20-task board, preserving full receipts; update latency and model-facing response size.
- **Subagents:** actual launcher response shaping with a synthetic controller receipt. No process or model is started; sizes do not measure child startup or real delegation savings.
- **Hooks:** simulated native Pi UI without terminal I/O, 10,000 native entries, five warmups and 30 unchanged-history starts. This measures task projection overhead.

These benchmark modes load the harness alone, excluding the separately installed pi-pretty companion and its FFF index/highlighter. They do not measure the complete pretty-enabled profile. `test:pretty` checks that integration separately.

Benchmarks use temporary agent state, disabled MCP transports and no provider calls. `characters` and UTF-8 `bytes` are measured. `estimatedTokens` is explicitly the characters/4 heuristic, not tokenizer output, observed provider usage or billing. Idle CPU and RSS are noisy process snapshots; these short offline samples do not establish interactive idle cost or a memory leak.

## Recorded session usage

`pnpm run usage` summarizes Pi session logs, `~/.pi/agent/sessions` by default. It reads names, sizes, counts, timestamps and provider-reported usage, never message, tool or file content; a label that is not a plain identifier is reported as `(other)`. It makes no model or MCP requests.

```bash
pnpm run usage --since 2026-10-03 --until 2026-10-13 --output /tmp/usage-before.json
# After the change has handled comparable work:
pnpm run usage --since 2026-10-20 --compare /tmp/usage-before.json
```

`--sessions DIR|FILE` selects other logs, `--cwd PATH` keeps sessions started in that project or below it, and `--json` prints the report. The report records only that `--cwd` applied, never the path. `--output` accepts only new paths, as for the benchmark.

- **Accounting.** Each session is replayed along its `parentId` tree, oldest session first. A fork copies its parent's entries with their ids and timestamps; a copy counts only when no older selected session holds it, so a fork read without its parent still counts its history once. Usage is the sum of assistant messages, `usage` entries, compaction and branch-summary usage, and top-level tool-result usage. Child `details.results[].usage` attributes that sum and is never added again. Invalid or incomplete usage marks the total as a lower bound, never as zero. A background child left pending in one selected session counts as collected when another session, such as a fork, collects it.
- **Cache misses.** Pi's `/session` rule decides each miss: the previous request on the same branch, a 1,024-token floor, a reset after compaction or branch summary, and cache warming counted as a request. Each miss is attributed to the change before it: model, thinking level, system prompt, context edit, more than five idle minutes, or other.
- **Residency.** Each request's paid prompt cost (uncached input, cache reads and writes) is spread over its projected context (latest compaction, kept entries, latest context edits) by estimated tokens. System prompt, tool declarations and estimate error remain unattributed.
- **Codemode and ceremony.** Codemode output is grouped by the sources a script references, with `@options` use, truncation and rereads of the spilled output. Ceremony-only turns are assistant turns whose only calls update tasks or memory.
- **Time.** Model time is Pi's `durationMs` or, in logs written before Pi 1.2.0 recorded it, the entry time minus the request start. On 844 turns that had both, the two differed by at most 4 ms at p99. Tool time exists only where Pi recorded it.

`--since` and `--until` filter entries by their own timestamps, so background child usage collected after `--until` belongs to the later window. Compare by model and per turn: a different model or task mix changes totals without any harness change.

### First recorded baseline

The maintainer's sessions from 2026-10-03 to 2026-10-13 are summarized privately in `.ai/verification/performance/usage-baseline.json`, next to `bench-before.json`. Personal spend and volume are not published. The report found:

- Requests without a preceding change missed the cache 2.2% of the time. After a model change, 10 of 10 missed; after a thinking change, 17 of 25.
- Codemode results carried an estimated half of the paid prompt cost. Scripts referencing Pi documentation, Pi `dist` files and Context7 each produced a quarter to a third of codemode output; one script can reference several.
- About 15% of assistant turns only updated tasks or memory, and none combined those updates with other calls. The main Codex models almost never sent more than one tool call per message, although Pi allows parallel calls, so asking for batched calls may not remove those turns; fewer, grouped updates can.
- One child receipt reported incomplete usage, so the totals are a lower bound.

On Node 24.20.0 / Pi 1.2.0 / macOS, seven benchmark rounds recorded package startup at 328.9 ms (native 250.5 ms). Prompt plus tool declarations measured 20,008 characters with lazy skills versus 36,365 with native headers.

## Codemode output budget

Codemode output carried the largest share of the baseline's paid prompt cost, so the package lowers its default cap and asks for narrower reads:

- `extensions/context-budget.ts` adds `// @options: {"max_output_tokens": 8000}` to top-level codemode scripts the model issues without options. Pi's own default is 10,000 estimated tokens (characters/4). Above the cap, Pi keeps the start and end of the output, saves all of it to a temporary file and names that file in the result. `--orchestraitor-codemode-max-output N` sets another cap, and `0` keeps Pi's default. An invalid value is reported at session start and also keeps Pi's default.
- The transcript keeps the script as the model wrote it; only the executed copy changes. Scripts with an options line, misplaced options (which Pi rejects), nested calls and other tools are left unchanged, and an unexpected input leaves the call as it is.
- A blank or comment first line is replaced, so line numbers do not move. Otherwise the options line is added, and the frames in Pi's final `Script error:` block are moved back one line. The saved full output and stack traces that a script prints itself keep the shifted numbers, and first-line columns can differ from an unmodified run.
- `extensions/instructions.ts` changes Pi's rule to read pi `.md` files completely into: list the headings first, then read the relevant sections completely. The rest of Pi's docs section, its paths and its position stay unchanged; if Pi rewords that rule, the section is left as Pi renders it. `instructions/core.md` prefers installed docs, types and source for installed packages, Pi included, and keeps Context7 for libraries that are not installed.

These are hypotheses until measured. After a week of comparable work, run `pnpm run usage --since <merge date> --compare <baseline>` and compare per model and per turn: codemode output per turn should fall without more turns per task or repeated scripts. A lower cap, such as 6,000, cut more output when truncation was simulated over recorded results, but that simulation assumes the model behaves the same. Evaluate it as a separate, explicitly chosen cohort.

## Task and memory turns

About 15% of the baseline's assistant turns only updated tasks or memory. The package makes those updates smaller and asks for them to travel with work:

- `orchestraitor_tasks` mutations return the operation, the new revision and only the affected tasks, plus `bindingCurrent` when a plan is bound. `list` still returns the complete board with `bindingCurrent` and the project identity, and every receipt keeps the full versioned state in `details`. On the benchmark's one-task update on a 20-task board, the model-facing response fell from 261 to 146 characters.
- The task tool runs sequentially, so several updates in one assistant message, alongside work calls, take consecutive revisions. `instructions/orchestraitor.md` asks for updates with the next work calls and for done evidence that has already returned.
- `extensions/mcp.ts` registers Engram when the session starts, unless another package, such as gentle-engram, already provides `mem_search`; both routes would expose the same memory twice. An `engram` entry in `mcp.json` still adds this package's route.
- This guidance and the codemode rules add 439 characters to the owned instructions and 40 to the tool declarations. Prompt plus tool declarations grew by 528 characters, about 130 estimated tokens per request, in a prefix that stays stable and is mostly read from cache. Package startup stayed within 1% of the baseline.

The main Codex models rarely sent several calls per message, so fewer turns depend on the model following this guidance. Compare ceremony-only turns per model with `pnpm run usage --compare`.

## Model and thinking switches

The first request after a model or thinking switch usually misses the prompt cache and pays for the whole context again. In the baseline, every request sent right after a model switch missed the cache, as did about two thirds of those after a thinking switch, against about 2% of the others. Pi's optional `showCacheMissNotices` setting reports a miss after it happens. `extensions/ui/cache-notice.ts` warns before the request, while the switch can still be undone:

- It waits until switching has settled for 1 second, then compares the selection with the latest request's. Switching back is silent, and so are selections Pi restores.
- It warns only when the context holds at least 20k tokens, the floor of Pi's own notice, and stays silent while the size is unknown, such as right after compaction.
- The estimated cost is the context tokens times the new model's input price, or its cache-write price when higher, minus its cache-read price. It is shown from $0.01.
- The warning goes through `ctx.ui.notify`. It never reaches the transcript or the model and adds nothing to the prompt.

Switch at session start or right after compaction, when the context is not cached anyway.

## Subagent requests

Children were under 3% of the baseline's cost, so these changes stay narrow:

- Child requests carried no provider session. Each child now has its own, derived in the parent from the parent's session and the task id. Providers that support sessions key prompt caching or request affinity on it. On Codex it also keys the cached websocket, which the parent closes when the child finishes instead of leaving it open for five idle minutes. The parent's own session is never reused, because that would put the child under the parent's cache key and Codex connection. In the baseline, explore and review children read about 62% and 74% of their prompt tokens from cache; compare `subagents.byRole` with `pnpm run usage --compare`.
- A child's system prompt no longer lists the selected skills or tells the child to read their files, because the task prompt already carries each body. Each body now names the directory its relative references resolve against.
- Guarded `search` shows at most 500 characters of each matching line, like Pi's `grep`, so one minified line no longer fills the 32 KiB output.

## Historical efficiency comparison

Before removal of the optional workbench on 2026-10-05, Node 24.20.0 and Pi 1.0.2 on macOS, seven fresh-process rounds per configuration produced:

| Metric | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| Owned instructions + native skill catalog | 32,170 chars | 24,526 chars | 23.8% smaller; names, bodies and resources retained. |
| Complete package prompt | 35,126 chars | 27,482 chars | 21.8% smaller in the isolated fixture, excluding separate tool schemas. |
| One-task mutation on 20-task board | 1,574 chars | 261 chars | 83.4% smaller; full board remains in native receipts and explicit list. |
| Unchanged hook branch/usage reads, historical publisher enabled | 35 / 35 | 0 / 0 | Deterministic operation count, including five warmups. |
| Package session startup median | 329.2 ms | 332.9 ms | Approximately +1.1%; no startup speedup claimed. |
| Native session startup median | 288.5 ms | 291.5 ms | Approximately +1.1% background variation between runs. |

One synthetic child handoff used 224 characters versus 706 for the original full pretty-printed receipt. The final response, writes, diagnostics, termination and accounting-completeness evidence remain intact; the full metadata is visible on expansion. This example is not a measured real-child token saving.

Raw reports are retained privately under `.ai/verification/performance/`; that directory and reports are excluded from Git and the npm package. Ratios are fixture-specific. Shorter prompts and stable prefixes can help context efficiency, but real savings depend on provider tokenization, cache behavior, extra turns and success rate. The compact native renderer alone does not save model tokens.

## Native UI after integration removal

The optional workbench, publisher, private snapshot transport and duplicate usage projection are removed. Native Pi owns session accounting; child attribution remains in full native receipts. Task projection caching still avoids branch reads when the manager/leaf are unchanged, and bound plans are still checked for external drift.

Historical benchmark report version 2 measured only native and package configurations. It removes duplicate package startup samples and the removed usage projection fixture. Comparisons record `sameMethodology`; prompt/task size and print-mode startup fields are unchanged, but the hook fixture now measures native UI alone. Do not compare hook timings across report versions as the same operation. Removal reduces code and background work; it does not itself prove provider-token savings.

Seven fresh-process rounds on the same Node/Pi host recorded package startup at 332.3 ms median versus 332.9 ms before removal (about -0.2%, within normal variation). The prompt remains 27,482 characters and a one-task mutation remains 261 characters. All 35 unchanged-history hook invocations made zero branch or all-entry reads. The private version-2 report is `.ai/verification/performance/without-herdr.json`; no additional token saving or material startup speedup is claimed.

## Lazy skill registry comparison

Report version 3 compares lazy exposure with native headers in the **same package and authorized catalog**, not with an empty native profile. It adds first prompt preparation and selected-skill lookup/read overhead; version-2 startup/setup and schema selection are not identical. Cross-report comparisons mark methodology/environment compatibility and missing configurations instead of assuming equivalence.

Seven sequential fresh-process rounds on Node 24.20.0 / Pi 1.0.3 / macOS, with 61 bundled skills, recorded:

| Character metric | Native headers | Lazy | Reduction |
| --- | ---: | ---: | ---: |
| Prepared prompt | 27,723 | 10,826 | 60.9% |
| Prompt + model-visible tool declarations | 34,849 | 18,493 | 46.9% |
| Above + one selected skill workflow | 38,670 | 23,799 | 38.5% |

The lazy workflow includes a five-result search and load, versus a native read; its additional lookup/call overhead is 1,485 characters. Micro-sample median-of-medians was approximately 35 ms for refresh, 33 ms for search and 33 ms for load. First prompt preparation medians were 40.8 ms lazy versus 0.35 ms native; startup was 335.9 versus 335.6 ms, not a speedup. Timings are local, noisy and scale with resource count.

No controlled provider A/B has been run. `pnpm run usage` measures recorded sessions, whose tasks differ, so it shows where tokens go rather than proving that a change saved them. Character savings omit provider-specific protocol wrappers and tokenization; cache behavior, repeated/missed searches, task quality and extra turns can change the result. Filesystem refresh adds work before requests and lookups rather than introducing an idle watcher. Native mode remains available.

## Prepared model A/B protocol

This protocol is ready for a separately authorized run. No live model work is part of `bench`, `usage` or `pnpm test`.

Use the pre-change revision `058e89d` and the optimized tree recorded by the benchmark. Capture exact source identities before running. Use the same explicitly chosen provider/model and reasoning level, isolated workspaces/settings, fixed instructions, disabled unused services and no automatic model fallback. Preserve raw native receipts and test results locally. Model and maximum consumption budget must be set before launch.

| Scenario | Fixed input and required result |
| --- | --- |
| Consultation | A two-file synthetic repository: identify the exported API and cite its definition/caller. No writes; both citations must be correct. |
| Small change | A synthetic function with a wrong empty-input result and one deterministic failing test: make the minimal fix and observe failure/pass. Exact changed-file scope and final test result must match. |
| Task execution | A synthetic three-group plan: inspect, fix the same function, verify. Preserve plan hash, record stable tasks and parent evidence, satisfy the same tests. |
| Delegated exploration | Two independent read-only questions on the same synthetic repository: maximum two readers, correct citations, unchanged files and confirmed exits. Parent verifies both answers. |

Run three repetitions per scenario per version: 24 sessions total. Pair versions within each repetition, alternating baseline-first/optimized-first. Use fresh sessions for this cold-run comparison; record actual cache-read/write amounts because fresh sessions do not guarantee an empty provider cache. Evaluate continued-session reuse in a separate explicitly budgeted cohort, never pool it with cold runs.

For each pair record completion, observed acceptance, turns/corrections, elapsed time, input/output/cache-read/cache-write, and reported cost when available. Sum parent native responses and top-level child tool usage once, including failed attempts and verification. Child details attribute that aggregate and must not be added again. Treat incomplete usage as incomplete, never zero or an accepted savings result. Do not derive a monetary saving from a cache percentage or use a single weighted token count across different providers.

Report paired differences and all failures. Keep the change only if acceptance is preserved and measured task consumption improves without a material time regression. Three repetitions provide an initial acceptance signal, not statistical proof; publish uncertainty instead of promising a fixed saving.

## Profiles and bounded background work — 2026-10-07

The skill inspector now uses four workers while preserving catalog order and every validation/read. `jag-refactor` loads its technique index only when needed: the entrypoint decreased from 13,371 to 7,901 UTF-8 bytes (41%); the moved catalog remains available as a reference. Child search adds optional files-only output and a match limit, with truncation indicated.

Three offline samples per mode, run sequentially without tests, compared base `3fa03fe` in an isolated worktree with the implementation on Node 24.20.0 / Pi 1.0.4 / macOS. Raw reports: `/tmp/pi-profiles-base-clean.json` and `/tmp/pi-profiles-final-clean.json` (local, not distributed).

| Package metric | Base | Implementation |
|---|---:|---:|
| Median startup | 298.0 ms | 313.8 ms |
| Median prompt preparation | 25.84 ms | 22.62 ms |
| Active tool declaration characters | 7,667 | 8,333 |

Profiles and collection add tool instructions/context. These samples do not establish a general speed or memory improvement: native startup also varied (230.1 → 239.6 ms), native RSS varied substantially, paths differ between worktrees, and the sample count is small. The inspector's preparation time decreased in this run while startup increased. No model requests were made. Background execution overlaps independent work but does not guarantee token savings; real usage and quality require the separately budgeted A/B described above.
