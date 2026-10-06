# Harness efficiency

The package keeps native tools, all 56 native skills (54 automatically selectable and two explicit-only), personality, bounded children and optional UI. Efficiency changes reduce repeated model context and projection work without introducing an agent pool, a model-based skill selector, a second accounting database or custom compaction.

The ten-lens consolidation reduces standalone catalog entries, not necessarily provider tokens. The historical 61-skill measurements below and the earlier 51-skill consolidation baseline retain their original counts; neither measures the current 56-skill package or establishes provider savings from the new workflows.

## Local benchmark

Run from a Git checkout with a compatible Pi host on PATH:

```bash
npm run bench -- --samples 7 --output /tmp/pi-before.json
# Apply a change, then run the same fixtures and host.
npm run bench -- --samples 7 --compare /tmp/pi-before.json --output /tmp/pi-after.json
```

Output files must be new paths; existing reports are never overwritten. Without `--output`, the command prints JSON. Reports include Node/Pi versions, platform, Git revision, a SHA-256 over tracked/unignored file names and contents (including dirty changes), raw samples, medians and p95 values. Rounds run each configuration in a separate process, sequentially, without concurrent tests. Do not compare different hosts as evidence of a code improvement.

- **Native / package / package-native:** isolated SDK resource/session startup, prepared prompt and model-visible tool declaration sizes, RSS/heap and CPU over a 100 ms idle interval. Package defaults to lazy skills; package-native loads the same 56-skill catalog (54 automatic and two explicit-only) after the public native-mode command. Startup includes host import/resources/mode setup, not first prompt preparation or time to first model token; preparation is reported separately. These samples use print mode.
- **Skills:** actual bounded search/load plus native read of jag-code; one warmup and five refresh/search/load timings per package sample. Initial and one-selected-skill character totals include schema and lookup/call overhead. The full diagnostic file is measured separately, never added to model context. This single deterministic English query does not evaluate selector quality.
- **Tasks:** real task-tool execution on a synthetic 20-task board, preserving full receipts; update latency and model-facing response size.
- **Subagents:** actual launcher response shaping with a synthetic controller receipt. No process or model is started; sizes do not measure child startup or real delegation savings.
- **Hooks:** simulated native Pi UI without terminal I/O, 10,000 native entries, five warmups and 30 unchanged-history starts. This measures task projection overhead.

These benchmark modes load the harness alone, excluding the separately installed pi-pretty companion and its FFF index/highlighter. They do not measure the complete pretty-enabled profile. `test:pretty` checks that integration separately.

Benchmarks use temporary agent state, disabled MCP transports and no provider calls. `characters` and UTF-8 `bytes` are measured. `estimatedTokens` is explicitly the characters/4 heuristic, not tokenizer output, observed provider usage or billing. Idle CPU and RSS are noisy process snapshots; these short offline samples do not establish interactive idle cost or a memory leak.

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

No provider benchmark has been run. Character savings omit provider-specific protocol wrappers and tokenization; cache behavior, repeated/missed searches, task quality and extra turns can change the result. Filesystem refresh adds work before requests and lookups rather than introducing an idle watcher. Native mode remains available.

## Prepared model A/B protocol

This protocol is ready for a separately authorized run. No live model work is part of `bench` or `npm test`.

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
