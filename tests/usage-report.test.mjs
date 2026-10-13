import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createWorkspace, importHost, packageRoot } from "./helpers/pi-host.mjs";

const { computeCacheWaste } = await importHost("dist/core/cache-stats.js");
const SCRIPT = join(packageRoot, "scripts/usage-report.mjs");
// Synthetic per-token prices: input $2/M, cache read $0.2/M, output $10/M.
const PRICE = { input: 2e-6, cacheRead: 2e-7, output: 1e-5 };
const round = value => Number(value.toFixed(9));

function usage(input, cacheRead = 0, output = 100) {
	const cost = { input: input * PRICE.input, output: output * PRICE.output, cacheRead: cacheRead * PRICE.cacheRead, cacheWrite: 0 };
	return { input, output, cacheRead, cacheWrite: 0, reasoning: 0, totalTokens: input + cacheRead + output,
		cost: { ...cost, total: cost.input + cost.output + cost.cacheRead } };
}
const text = value => [{ type: "text", text: value }];
const user = (value = "Next step") => ({ type: "message", message: { role: "user", content: text(value) } });
const system = () => ({ type: "message", message: { role: "system", content: "Host rules", sections: {}, toolsAdded: ["read"] } });
const call = (id, name, args) => ({ type: "toolCall", id, name, arguments: args });
const result = (toolCallId, toolName, value, fields = {}) =>
	({ type: "message", message: { role: "toolResult", toolCallId, toolName, content: text(value), isError: false, ...fields } });
const bash = (command, output, fields = {}) =>
	({ type: "message", message: { role: "bashExecution", command, output, exitCode: 0, cancelled: false, truncated: false, ...fields } });
function assistant(input, cacheRead, { model = "model-a", thinking = "medium", content = text("Done"), ...fields } = {}) {
	return { type: "message", message: { role: "assistant", content, api: "openai-responses", provider: "test", model,
		usage: usage(input, cacheRead), stopReason: "stop", durationMs: 1000, thinkingLevel: thinking, ...fields } };
}

/** Native v3 session log: each entry follows the previous one unless `parent` is given; message timestamps default to the entry clock. */
function session(header = {}) {
	const lines = [{ type: "session", version: 3, id: "s1", timestamp: "2026-10-05T10:00:00.000Z", cwd: "/work/app", ...header }];
	let clock = Date.parse(lines[0].timestamp), last = null;
	return {
		lines,
		add(entry, { parent = last, seconds = 1, time } = {}) {
			clock = time ? Date.parse(time) : clock + seconds * 1000;
			const line = { ...entry, id: `e${lines.length}`, parentId: parent, timestamp: new Date(clock).toISOString() };
			if (line.message) line.message = { timestamp: clock, ...line.message };
			lines.push(line);
			return (last = line.id);
		},
	};
}
const write = (path, log) => writeFile(path, log.lines.map(line => JSON.stringify(line)).join("\n") + "\n");
const run = args => execFileSync(process.execPath, [SCRIPT, ...args], { cwd: packageRoot, encoding: "utf8", stdio: "pipe" });
const report = (sessions, ...args) => JSON.parse(run(["--sessions", sessions, "--json", ...args]));
const counts = (records, ...fields) => Object.fromEntries(Object.entries(records).map(([key, record]) => [key, fields.map(field => record[field])]));

/** One branch with a cold start, a hit, one miss per cause, a compaction and a miss below Pi's noise floor. */
function linearSession() {
	const log = session();
	log.add(user());
	log.add(assistant(10_000, 0));
	log.add(user());
	log.add(assistant(2_000, 10_000));
	log.add(user());
	log.add(assistant(13_000, 0, { model: "model-b" }));
	log.add(user());
	log.add(assistant(14_000, 0, { model: "model-b", thinking: "high" }));
	log.add(system());
	log.add(assistant(15_000, 0, { model: "model-b", thinking: "high" }));
	log.add({ type: "context_edit", targetId: "e1", replacement: null });
	log.add(assistant(16_000, 0, { model: "model-b", thinking: "high" }));
	log.add(user(), { seconds: 360 });
	log.add(assistant(17_000, 0, { model: "model-b", thinking: "high" }));
	log.add(user());
	log.add(assistant(18_000, 0, { model: "model-b", thinking: "high" }));
	const kept = log.add(user());
	log.add({ type: "compaction", summary: "Summary", firstKeptEntryId: kept, tokensBefore: 18_000 });
	log.add(assistant(5_000, 0, { model: "model-b", thinking: "high" }));
	log.add(user());
	log.add(assistant(1_000, 5_000, { model: "model-b", thinking: "high" }));
	log.add(user());
	log.add(assistant(1_500, 5_000, { model: "model-b", thinking: "high" }));
	// Pi's cache warmer re-reads the prefix before it expires, so the next request after a long pause is not idle.
	log.add({ type: "usage", kind: "cache_warm", provider: "test", model: "model-b", usage: usage(0, 6_500, 1) }, { seconds: 270 });
	log.add(user(), { seconds: 90 });
	log.add(assistant(500, 6_500, { model: "model-b", thinking: "high" }));
	return log;
}

test("shouldAttributeEachCacheMissToTheChangeBeforeItWhenALinearSessionIsReplayed", async (t) => {
	// Given
	const dir = await createWorkspace(t);
	await write(join(dir, "linear.jsonl"), linearSession());
	// When
	const { cache } = report(dir);
	// Then
	assert.deepEqual({
		byCause: counts(cache.misses.byCause, "count", "missedTokens"),
		missedCost: round(cache.misses.missedCost),
		coldStarts: counts(cache.coldStarts, "count", "uncachedTokens"),
		transitions: counts(cache.transitions, "requests", "misses", "idleRequests", "idleMisses"),
	}, {
		byCause: { model: [1, 12_000], thinking: [1, 13_000], prompt: [1, 14_000], context_edit: [1, 15_000], idle: [1, 16_000], other: [1, 17_000] },
		missedCost: 0.1566,
		coldStarts: { start: [1, 10_000], compaction: [1, 5_000] },
		transitions: { none: [6, 2, 1, 1], model: [1, 1, 0, 0], thinking: [1, 1, 0, 0], prompt: [1, 1, 0, 0], context_edit: [1, 1, 0, 0] },
	});
});

test("shouldMatchPiCacheWasteWhenTheSessionHasOneBranch", async (t) => {
	// Given
	const dir = await createWorkspace(t);
	const log = linearSession();
	await write(join(dir, "linear.jsonl"), log);
	const models = { getModel: () => ({ cost: { cacheRead: 0.2 } }) };
	// When
	const { misses } = report(dir).cache;
	const native = computeCacheWaste(log.lines.slice(1), models);
	// Then
	assert.deepEqual({ count: misses.count, missedTokens: misses.missedTokens, missedCost: round(misses.missedCost) },
		{ count: native.missCount, missedTokens: native.missedTokens, missedCost: round(native.missedCost) });
});

test("shouldCompareWithThePreviousRequestOnTheSameBranchWhenTheSessionBranches", async (t) => {
	// Given
	const dir = await createWorkspace(t);
	const log = session();
	log.add(user());
	const first = log.add(assistant(20_000, 0));
	log.add(user());
	log.add(assistant(40_000, 20_000));
	// File order would compare the next request with the abandoned 60k-token branch.
	log.add(user(), { parent: first });
	log.add(assistant(2_000, 20_000));
	await write(join(dir, "branched.jsonl"), log);
	// When
	const { cache } = report(dir);
	// Then
	assert.deepEqual({ misses: cache.misses.count, transitions: counts(cache.transitions, "requests", "misses") },
		{ misses: 0, transitions: { none: [2, 0] } });
});

test("shouldCountUsageOnceWhenChildDetailsRepeatTheToolResultUsage", async (t) => {
	// Given
	const dir = await createWorkspace(t);
	const log = session();
	log.add(user());
	log.add(assistant(1_000, 0, { content: [call("c1", "subagent_run", { tasks: [] })] }));
	log.add(result("c1", "subagent_run", "{}", { usage: usage(3_000, 1_000),
		details: { results: [{ id: "child-1", role: "explore", usage: usage(3_000, 1_000), usageComplete: true }], pending: [], usageComplete: true } }));
	log.add({ type: "compaction", summary: "Summary", firstKeptEntryId: "e1", tokensBefore: 5_000, usage: usage(4_000) });
	log.add({ type: "branch_summary", fromId: "e2", summary: "Branch", usage: usage(500) });
	log.add({ type: "usage", kind: "cache_warm", provider: "test", model: "model-a", usage: usage(0, 6_000, 1) });
	await write(join(dir, "usage.jsonl"), log);
	// When
	const { usage: totals, subagents } = report(dir);
	// Then
	assert.deepEqual({
		total: [totals.total.input, totals.total.cacheRead, totals.total.output, round(totals.total.cost.total)], complete: totals.complete,
		parts: [totals.assistant.input, totals.toolResults.subagent_run.input, totals.summaries.compaction.input, totals.summaries.branch_summary.input, totals.usageEntries.cache_warm.cacheRead],
		explore: [subagents.receipts, subagents.children, subagents.byRole.explore.usage.input],
	}, { total: [8_500, 7_000, 401, 0.02241], complete: true, parts: [1_000, 3_000, 4_000, 500, 6_000], explore: [1, 1, 3_000] });
});

test("shouldReportALowerBoundWhenChildOrMessageUsageIsIncomplete", async (t) => {
	// Given
	const dir = await createWorkspace(t);
	const log = session();
	log.add(user());
	log.add(assistant(1_000, 0, { content: [call("c1", "subagent_run", {}), call("c2", "subagent_run", {})] }));
	log.add(result("c1", "subagent_run", "{}", { usage: usage(2_000),
		details: { results: [{ id: "child-1", role: "implement", usageComplete: false }], pending: [], usageComplete: false } }));
	log.add(result("c2", "subagent_run", "{}", { details: { results: [], pending: ["child-2"], usageComplete: false } }));
	log.add(assistant(0, 0, { usage: undefined }));
	await write(join(dir, "incomplete.jsonl"), log);
	// When
	const json = report(dir);
	const human = run(["--sessions", dir]);
	// Then
	assert.deepEqual({ complete: json.usage.complete, incomplete: json.usage.incomplete, input: json.usage.total.input },
		{ complete: false, incomplete: { invalidUsage: 1, receipts: 0, children: 1, uncollected: 1 }, input: 3_000 });
	assert.match(human, /lower bound: incomplete accounting/);
});

test("shouldCountOnlyEntriesInsideTheWindowWhenSinceAndUntilAreGiven", async (t) => {
	// Given
	const dir = await createWorkspace(t);
	const log = session({ timestamp: "2026-10-01T09:00:00.000Z" });
	log.add(user(), { time: "2026-10-01T10:00:00.000Z" });
	log.add(assistant(10_000, 0));
	log.add(user(), { time: "2026-10-05T10:00:00.000Z" });
	log.add(assistant(1_000, 10_000, { content: [call("c1", "subagent_run", {})] }));
	log.add(result("c1", "subagent_run", "{}", { details: { results: [], pending: ["child-1"], usageComplete: false } }));
	// The child's usage arrives with a collect after the window, so it belongs to the later window.
	log.add(user(), { time: "2026-10-08T10:00:00.000Z" });
	log.add(assistant(1_000, 11_000, { content: [call("c2", "subagent_collect", {})] }));
	log.add(result("c2", "subagent_collect", "{}", { usage: usage(2_000),
		details: { results: [{ id: "child-1", role: "explore", usage: usage(2_000), usageComplete: true }], pending: [], usageComplete: true } }));
	await write(join(dir, "window.jsonl"), log);
	// When
	const json = report(dir, "--since", "2026-10-03", "--until", "2026-10-07");
	// Then
	assert.deepEqual({ window: json.window, turns: [json.turns.assistant, json.turns.user], input: json.usage.total.input, complete: json.usage.complete,
		coldStarts: json.cache.coldStarts, transitions: counts(json.cache.transitions, "requests", "misses", "idleRequests") }, {
		window: { since: "2026-10-03T00:00:00.000Z", until: "2026-10-07T00:00:00.000Z" }, turns: [1, 1], input: 1_000, complete: true,
		coldStarts: {}, transitions: { none: [1, 0, 1] },
	});
});

/** A two-turn parent and a fork of it that adds one turn; Pi forks copy every entry with its original id and timestamp under a newer header. */
function forked(parentPath, header = {}) {
	const parent = session();
	parent.add(user());
	parent.add(assistant(10_000, 0));
	parent.add(user());
	const leaf = parent.add(assistant(1_000, 10_000));
	const fork = session({ id: "s2", timestamp: "2026-10-05T11:00:00.000Z", parentSession: parentPath, ...header });
	fork.lines.push(...parent.lines.slice(1));
	fork.add(user(), { parent: leaf });
	fork.add(assistant(1_000, 11_000));
	return { parent, fork };
}

test("shouldCountCopiedHistoryOnceWhenAForkRepeatsItsParentEntries", async (t) => {
	// Given
	const dir = await createWorkspace(t);
	const parentPath = join(dir, "parent.jsonl");
	const { parent, fork } = forked(parentPath);
	await write(parentPath, parent);
	// The fork's name sorts first; sessions are read oldest first.
	await write(join(dir, "fork.jsonl"), fork);
	// When
	const json = report(dir);
	// Then
	assert.deepEqual({ sources: json.sources, turns: json.turns.assistant, input: json.usage.total.input,
		coldStarts: counts(json.cache.coldStarts, "count"), transitions: counts(json.cache.transitions, "requests", "misses") }, {
		sources: { files: 2, sessions: 2, forks: 1, entries: 6, inheritedEntries: 4, invalidLines: 0 }, turns: 3, input: 12_000,
		coldStarts: { start: [1] }, transitions: { none: [2, 0] },
	});
});

test("shouldCountForkHistoryOnceWhenItsParentIsNotSelected", async (t) => {
	// Given
	const dir = await createWorkspace(t);
	// The parent lives in another project's directory, or was deleted.
	const parentPath = join(dir, "other-project", "parent.jsonl");
	const first = join(dir, "first.jsonl");
	await write(first, forked(parentPath).fork);
	await write(join(dir, "second.jsonl"), forked(parentPath, { id: "s3", timestamp: "2026-10-05T12:00:00.000Z" }).fork);
	// When
	const alone = report(first);
	const siblings = report(dir);
	// Then
	const totals = json => ({ sources: json.sources, turns: json.turns.assistant, input: json.usage.total.input });
	assert.deepEqual([totals(alone), totals(siblings)], [
		{ sources: { files: 1, sessions: 1, forks: 1, entries: 6, inheritedEntries: 0, invalidLines: 0 }, turns: 3, input: 12_000 },
		{ sources: { files: 2, sessions: 2, forks: 2, entries: 8, inheritedEntries: 4, invalidLines: 0 }, turns: 4, input: 13_000 },
	]);
});

test("shouldCountAChildAsCollectedWhenAForkCollectsWhatItsParentLeftPending", async (t) => {
	// Given
	const dir = await createWorkspace(t);
	const parentPath = join(dir, "parent.jsonl");
	const parent = session();
	parent.add(user());
	parent.add(assistant(1_000, 0, { content: [call("c1", "subagent_run", {})] }));
	const leaf = parent.add(result("c1", "subagent_run", "{}", { details: { results: [], pending: ["child-1"], usageComplete: false } }));
	const fork = session({ id: "s2", timestamp: "2026-10-05T11:00:00.000Z", parentSession: parentPath });
	fork.lines.push(...parent.lines.slice(1));
	fork.add(assistant(1_000, 1_000, { content: [call("c2", "subagent_collect", {})] }), { parent: leaf });
	fork.add(result("c2", "subagent_collect", "{}", { usage: usage(2_000),
		details: { results: [{ id: "child-1", role: "explore", usage: usage(2_000), usageComplete: true }], pending: [], usageComplete: true } }));
	await write(parentPath, parent);
	await write(join(dir, "fork.jsonl"), fork);
	// When
	const alone = report(parentPath);
	const both = report(dir);
	// Then
	const accounting = json => ({ complete: json.usage.complete, uncollected: json.usage.incomplete.uncollected, input: json.usage.total.input });
	assert.deepEqual([accounting(alone), accounting(both)],
		[{ complete: false, uncollected: 1, input: 1_000 }, { complete: true, uncollected: 0, input: 4_000 }]);
});

test("shouldMeasureCodemodeSourcesOptionsAndSpillsWhenScriptsReturnOutput", async (t) => {
	// Given
	const dir = await createWorkspace(t);
	const spill = "/tmp/pi-codemode/output-1.txt";
	const log = session();
	log.add(user());
	log.add(assistant(1_000, 0, { content: [call("c1", "codemode", { code: [
		'// @options: {"max_output_tokens": 4000}',
		'const page = await read("node_modules/@earendil-works/pi-coding-agent/docs/extensions.md");',
		"return context7.query_docs(page);",
	].join("\n") })] }));
	log.add(result("c1", "codemode", "x".repeat(400), { details: { calls: [{ id: "n1", name: "read", status: "ok", durationMs: 1, args: {} }] } }));
	log.add(assistant(1_000, 1_000, { content: [call("c2", "codemode", { code: "return listFiles();" })] }));
	log.add(result("c2", "codemode", `Warning: truncated output (original token count: 12000)\n${"y".repeat(100)}\n[Full output: ${spill} (read with offset/limit)]`,
		{ details: { calls: [], fullOutputPath: spill } }));
	log.add(assistant(1_000, 2_000, { content: [call("c3", "read", { path: spill, offset: 1, limit: 50 })] }));
	await write(join(dir, "codemode.jsonl"), log);
	// When
	const { codemode } = report(dir);
	// Then
	assert.deepEqual({ results: codemode.results, sources: counts(codemode.bySource, "results"), multiSource: codemode.multiSource,
		context7AboutPi: codemode.context7AboutPi, options: codemode.options, truncated: codemode.truncated }, {
		results: 2, sources: { "pi-docs": [1], context7: [1], other: [1] }, multiSource: { results: 1, characters: 400 },
		context7AboutPi: 1, options: { scripts: 1, maxOutputTokens: { 4000: 1 } }, truncated: { results: 1, originalEstimatedTokens: 12_000, spillRereads: 1 },
	});
});

test("shouldSeparateCeremonyOnlyTurnsFromBatchedWorkWhenTasksAndMemoryAreCalled", async (t) => {
	// Given
	const dir = await createWorkspace(t);
	const log = session();
	log.add(user());
	for (const names of [["orchestraitor_tasks"], ["mem_save"], ["orchestraitor_tasks", "mem_save"], ["read", "orchestraitor_tasks"], []]) {
		log.add(assistant(1_000, 0, { content: names.length ? names.map((name, index) => call(`c${log.lines.length}-${index}`, name, {})) : text("Done") }));
	}
	await write(join(dir, "ceremony.jsonl"), log);
	// When
	const { ceremony } = report(dir);
	// Then
	assert.deepEqual({ only: counts(ceremony.only, "turns"), batched: ceremony.batchedTurns, calls: ceremony.calls },
		{ only: { tasks: [1], memory: [1], mixed: [1] }, batched: 1, calls: { orchestraitor_tasks: 3, mem_save: 2 } });
});

test("shouldTimeTurnsFromTheirTimestampsWhenOlderLogsLackDurationMs", async (t) => {
	// Given
	const dir = await createWorkspace(t);
	const log = session();
	log.add(user());
	// Pi stamps the message when the request starts and appends its entry when the request completes.
	log.add(assistant(1_000, 0, { durationMs: undefined, timestamp: Date.parse("2026-10-05T10:00:03.000Z"),
		content: [call("c1", "orchestraitor_tasks", {})] }), { time: "2026-10-05T10:00:21.000Z" });
	log.add(result("c1", "orchestraitor_tasks", "{}"));
	// A request that starts after its own entry reflects a clock error, not a duration.
	log.add(assistant(1_000, 1_000, { durationMs: undefined, timestamp: Date.parse("2026-10-05T10:00:40.000Z"),
		content: [call("c2", "read", {})] }), { time: "2026-10-05T10:00:30.000Z" });
	log.add(result("c2", "read", "text", { durationMs: 250 }));
	log.add(assistant(1_000, 1_000, { durationMs: 4_000 }));
	await write(join(dir, "timing.jsonl"), log);
	// When
	const { models, ceremony, tools } = report(dir);
	// Then
	assert.deepEqual({ model: [models["test/model-a"].timedTurns, models["test/model-a"].perTurn.durationMs], tasks: ceremony.only.tasks.durationMs,
		tools: counts(tools, "timedResults", "durationMs") },
		{ model: [2, 11_000], tasks: 18_000, tools: { orchestraitor_tasks: [0, 0], read: [1, 250] } });
});

test("shouldAttributeResidencyToTheProjectedContextWhenEditsAndCompactionApply", async (t) => {
	// Given
	const dir = await createWorkspace(t);
	const log = session();
	log.add(user("u".repeat(400)));
	log.add(bash("ls", "b".repeat(38)));
	// Pi keeps `!!` command output out of the model context.
	log.add(bash("ls", "x".repeat(400), { excludeFromContext: true }));
	log.add(assistant(10_000, 0, { content: [call("r1", "read", { path: "a" })] }));
	const removed = log.add(result("r1", "read", "r".repeat(800)));
	log.add({ type: "context_edit", targetId: removed, replacement: null });
	const kept = log.add(assistant(1_000, 10_000, { content: text("ok") }));
	log.add({ type: "compaction", summary: "s".repeat(40), firstKeptEntryId: kept, tokensBefore: 11_000 });
	log.add(user("v".repeat(80)));
	log.add(assistant(500, 0));
	await write(join(dir, "residency.jsonl"), log);
	// When
	const { residency } = report(dir);
	// Then
	assert.deepEqual(counts(residency.byItem, "estimatedTokenRequests"),
		{ user: [220], bash_execution: [20], "call:read": [4], "summary:compaction": [10], "assistant:text": [0.5] });
});

test("shouldNeverEmitContentWhenLogsContainSecrets", async (t) => {
	// Given
	const dir = await createWorkspace(t);
	const secret = "CANARY-7f3a91";
	const log = session({ cwd: `/work/${secret}` });
	log.add({ type: "session_info", name: secret });
	log.add(user(secret));
	log.add(assistant(10_000, 0, { errorMessage: secret, content: [{ type: "thinking", thinking: secret }, ...text(secret),
		call("c1", "codemode", { code: `return "${secret}";` }), call("c2", "read", { path: `/${secret}` }), call("c3", `${secret} tool`, {})] }));
	log.add(result("c1", "codemode", `Warning: truncated output (original token count: 99)\n${secret}\n[Full output: /tmp/${secret} (read with offset/limit)]`,
		{ details: { calls: [{ id: "n1", name: "read", status: "ok", durationMs: 1, args: { path: secret } }], fullOutputPath: `/tmp/${secret}` } }));
	log.add(result("c2", "read", secret, { details: { path: secret } }));
	log.add(bash(secret, secret));
	log.add({ type: "custom_message", customType: "note", content: secret, display: false });
	log.add({ type: "custom", customType: "state", data: { value: secret } });
	log.add({ type: "context_edit", targetId: "e4", replacement: text(secret) });
	log.add({ type: "label", targetId: "e2", label: secret });
	log.add({ type: "compaction", summary: secret, firstKeptEntryId: "e2", tokensBefore: 10_000, details: { readFiles: [secret] } });
	log.add({ type: "branch_summary", fromId: "e2", summary: secret });
	log.add(assistant(1_000, 0, { model: `${secret} model`, content: [call("c4", "subagent_run", { tasks: [{ prompt: secret }] })] }));
	log.add(result("c4", "subagent_run", secret, { usage: usage(1_000),
		details: { results: [{ id: "child-1", role: "review", final: secret, usage: usage(1_000), usageComplete: true }], pending: [], usageComplete: true } }));
	await write(join(dir, `${secret}.jsonl`), log);
	// When
	const outputs = [run(["--sessions", dir]), run(["--sessions", dir, "--json"]), run(["--sessions", dir, "--json", "--cwd", `/work/${secret}`])];
	// Then
	assert.deepEqual(outputs.map(output => output.includes(secret)), [false, false, false]);
	const [json, filtered] = outputs.slice(1).map(output => JSON.parse(output));
	assert.deepEqual({ turns: json.turns.assistant, models: Object.keys(json.models).sort(), sanitizedTool: json.tools["(other)"].calls, truncated: json.codemode.truncated.results,
		filtered: [filtered.filters, filtered.turns.assistant] },
		{ turns: 2, models: ["test/(other)", "test/model-a"], sanitizedTool: 1, truncated: 1, filtered: [{ cwd: true }, 2] });
});

test("shouldRefuseOverwritesAndCompareWithTheBaselineWhenOutputAndCompareAreGiven", async (t) => {
	// Given
	const dir = await createWorkspace(t);
	const before = join(dir, "before"), after = join(dir, "after"), baseline = join(dir, "baseline.json");
	for (const [path, input] of [[before, 10_000], [after, 20_500]]) {
		const log = session();
		log.add(user());
		log.add(assistant(input, 0));
		await mkdir(path);
		await write(join(path, "session.jsonl"), log);
	}
	run(["--sessions", before, "--output", baseline]);
	const saved = await readFile(baseline, "utf8");
	// When
	const overwrite = () => run(["--sessions", after, "--output", baseline]);
	const { comparison } = report(after, "--compare", baseline);
	// Then
	assert.throws(overwrite, /Refusing to overwrite existing report/);
	assert.equal(await readFile(baseline, "utf8"), saved);
	assert.deepEqual({ sameMethodology: comparison.sameMethodology, costPerTurn: round(comparison.metrics.costPerTurn.changePercent) },
		{ sameMethodology: true, costPerTurn: 100 });
});

test("shouldSelectSessionsInsideTheProjectWhenCwdIsGiven", async (t) => {
	// Given
	const dir = await createWorkspace(t);
	for (const [name, cwd] of [["app", "/work/app"], ["nested", "/work/app/sub"], ["sibling", "/work/apple"], ["other", "/work/other"]]) {
		const log = session({ cwd });
		log.add(user());
		log.add(assistant(1_000, 0));
		await write(join(dir, `${name}.jsonl`), log);
	}
	// When
	// pnpm forwards a literal "--" before script arguments.
	const json = JSON.parse(run(["--", "--sessions", dir, "--cwd", "/work/app", "--json"]));
	// Then
	assert.deepEqual({ filters: json.filters, files: json.sources.files, turns: json.turns.assistant },
		{ filters: { cwd: true }, files: 2, turns: 2 });
});

test("shouldRejectInvalidArgumentsBeforeReadingSessionsWhenArgumentsAreInvalid", () => {
	// Given
	const cases = [
		[["--bogus", "value"], /Usage: pnpm run usage/],
		[["--output"], /Usage: pnpm run usage/],
		[["--since", "never"], /Invalid --since date: never/],
		[["--since", "2026-10-07", "--until", "2026-10-03"], /--since must be earlier than --until/],
	];
	// When / Then
	for (const [args, message] of cases) assert.throws(() => run(args), message);
});
