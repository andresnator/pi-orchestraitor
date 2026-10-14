import assert from "node:assert/strict";
import { realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { createUISession, createWorkspace, importHost, loadUiModule, pi, plainTheme, tui } from "./helpers/ui-harness.mjs";

const pending = (id = "g1") => ({ id, title: "Inspect marker", status: "pending" });
const receipt = (result, isError = false) => ({ type: "message", message: { role: "toolResult", toolName: "orchestraitor_tasks", toolCallId: "tasks", isError, ...result } });

async function taskModule(t) { return loadUiModule(t, "extensions/ui/tasks.ts"); }

test("shouldReturnOnlyAffectedTasksAndKeepFullReceiptsWhenUpdatingLargeBoards", async (t) => {
	// Given
	const { createTaskTool, replayTasks } = await taskModule(t);
	const cwd = await realpath(await createWorkspace(t));
	const ctx = { cwd, sessionManager: pi.SessionManager.inMemory(cwd) };
	const tool = createTaskTool();
	const seed = await tool.execute("seed", { operation: "replace", expectedRevision: 0,
		tasks: Array.from({ length: 20 }, (_, index) => pending(`t${index}`)) }, undefined, undefined, ctx);
	ctx.sessionManager.appendMessage({ role: "toolResult", toolName: tool.name, toolCallId: "seed", isError: false, timestamp: Date.now(), ...seed });
	// When
	const result = await tool.execute("update", { operation: "update", expectedRevision: 1, id: "t0",
		changes: { status: "done", evidence: "Synthetic check passed" } }, undefined, undefined, ctx);
	ctx.sessionManager.appendMessage({ role: "toolResult", toolName: tool.name, toolCallId: "update", isError: false, timestamp: Date.now(), ...result });
	const listed = await tool.execute("list", { operation: "list" }, undefined, undefined, ctx);
	const { convertResponsesMessages } = await importHost("node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js");
	const wire = convertResponsesMessages({ provider: "openai-codex", api: "openai-responses", id: "fixture", input: ["text"] },
		{ messages: [{ role: "toolResult", toolName: tool.name, toolCallId: "update", isError: false, timestamp: 0, ...result }] }, new Set(["openai-codex"]));
	// Then
	assert.deepEqual(JSON.parse(result.content[0].text), { operation: "update", revision: 2,
		tasks: [{ ...pending("t0"), status: "done", evidence: "Synthetic check passed" }] });
	assert.deepEqual(JSON.parse(listed.content[0].text), { state: replayTasks(ctx.sessionManager.getBranch()) });
	assert.equal(result.details.state.tasks.length, 20);
	assert.ok(result.content[0].text.length < listed.content[0].text.length * 0.4);
	assert.deepEqual(wire, [{ type: "function_call_output", call_id: "update", output: result.content[0].text }]);
});

test("shouldReturnAffectedAddsReplacementAndClearWithReusableRevisions", async (t) => {
	// Given
	const { createTaskTool } = await taskModule(t);
	const cwd = await createWorkspace(t);
	const ctx = { cwd, sessionManager: pi.SessionManager.inMemory(cwd) };
	const tool = createTaskTool();
	const responses = [];
	let revision = 0;
	// When
	for (const input of [{ operation: "add", tasks: [pending("one")] }, { operation: "add", tasks: [pending("two")] },
		{ operation: "replace", tasks: [pending("one"), pending("two")] }, { operation: "clear" }]) {
		const result = await tool.execute("mutation", { ...input, expectedRevision: revision }, undefined, undefined, ctx);
		const response = JSON.parse(result.content[0].text);
		revision = response.revision;
		responses.push({ operation: response.operation, revision, ids: response.tasks.map(task => task.id) });
		ctx.sessionManager.appendMessage({ role: "toolResult", toolName: tool.name, toolCallId: "mutation", isError: false, timestamp: revision, ...result });
	}
	// Then
	assert.deepEqual(responses, [{ operation: "add", revision: 1, ids: ["one"] }, { operation: "add", revision: 2, ids: ["two"] },
		{ operation: "replace", revision: 3, ids: ["one", "two"] }, { operation: "clear", revision: 4, ids: [] }]);
});

test("shouldRequireEvidenceAndReopeningReasonWhenTaskStatusChanges", async (t) => {
	// Given
	const { emptyTasks, applyTaskOperation } = await taskModule(t);
	const initial = applyTaskOperation(emptyTasks(), { operation: "replace", expectedRevision: 0, tasks: [pending()] });
	// When / Then
	assert.throws(() => applyTaskOperation(initial, { operation: "update", expectedRevision: 1, id: "g1", changes: { status: "done" } }), /evidence/i);
	const done = applyTaskOperation(initial, { operation: "update", expectedRevision: 1, id: "g1", changes: { status: "done", evidence: "node --test: passed" } });
	assert.throws(() => applyTaskOperation(done, { operation: "update", expectedRevision: 2, id: "g1", changes: { status: "pending" } }), /reason/i);
	const reopened = applyTaskOperation(done, { operation: "update", expectedRevision: 2, id: "g1", changes: { status: "blocked", reason: "New failing case" } });
	assert.deepEqual(reopened, { version: 1, revision: 3, tasks: [{ ...pending(), status: "blocked", evidence: "node --test: passed", reason: "New failing case" }] });
	assert.equal(initial.tasks[0].status, "pending");
});

for (const [operation, expected] of [
	[{ operation: "add", expectedRevision: 0, tasks: [pending(), pending()] }, /unique/i],
	[{ operation: "add", expectedRevision: 0, tasks: [{ ...pending(), title: "x".repeat(201) }] }, /title/i],
	[{ operation: "add", expectedRevision: 0, tasks: [{ ...pending(), status: "accepted" }] }, /status/i],
	[{ operation: "update", expectedRevision: 0, id: "missing", changes: { status: "done", evidence: "check" } }, /unknown/i],
	[{ operation: "clear", expectedRevision: 1 }, /revision/i],
	[{ operation: "clear" }, /revision/i],
	[{ operation: "add", expectedRevision: 0, tasks: Array.from({ length: 51 }, (_, index) => pending(String(index))) }, /50|limit/i],
]) {
	test(`shouldRejectInvalidMutationWithoutChangingStateWhenInputIs${JSON.stringify(operation)}`, async (t) => {
		// Given
		const { emptyTasks, applyTaskOperation } = await taskModule(t);
		const state = emptyTasks();
		// When / Then
		assert.throws(() => applyTaskOperation(state, operation), expected);
		assert.deepEqual(state, { version: 1, revision: 0, tasks: [] });
	});
}

test("shouldPreserveStableIdsOnReplacementAndClearExplicitlyWhenTasksExist", async (t) => {
	// Given
	const { emptyTasks, applyTaskOperation } = await taskModule(t);
	const state = applyTaskOperation(emptyTasks(), { operation: "add", expectedRevision: 0, tasks: [pending()] });
	// When / Then
	assert.throws(() => applyTaskOperation(state, { operation: "replace", expectedRevision: 1, tasks: [pending("new-id")] }), /preserve|stable/i);
	const cleared = applyTaskOperation(state, { operation: "clear", expectedRevision: 1 });
	assert.deepEqual(cleared, { version: 1, revision: 2, tasks: [] });
});

test("shouldReplayOnlySuccessfulVersionedActiveBranchReceiptsWhenHistoryContainsInvalidResults", async (t) => {
	// Given
	const { emptyTasks, applyTaskOperation, replayTasks } = await taskModule(t);
	const state = applyTaskOperation(emptyTasks(), { operation: "add", expectedRevision: 0, tasks: [pending()] });
	const valid = receipt({ details: { version: 1, operation: "add", state }, content: [] });
	const invalid = [receipt({ details: { version: 99, operation: "clear", state: { version: 1, revision: 2, tasks: [] } } }),
		receipt({ details: { version: 1, operation: "clear", state: { version: 1, revision: 2, tasks: [] } } }, true),
		receipt({ details: { version: 1, operation: "replace", state: { version: 1, revision: 2, tasks: [{ ...pending(), status: "done" }] } } })];
	// When
	const active = replayTasks([valid, ...invalid]);
	const empty = replayTasks([]);
	// Then
	assert.deepEqual({ active, empty }, { active: state, empty: emptyTasks() });
});

test("shouldNotPublishUnpersistedSnapshotsWhenToolExecutesDirectly", async (t) => {
	// Given
	const { createTaskTool, replayTasks } = await taskModule(t);
	const cwd = await createWorkspace(t);
	const manager = pi.SessionManager.inMemory(cwd);
	const ctx = { cwd, sessionManager: manager };
	const tool = createTaskTool();
	// When
	const result = await tool.execute("mutation", { operation: "add", expectedRevision: 0, tasks: [pending()] }, undefined, undefined, ctx);
	const beforeCommit = await tool.execute("list", { operation: "list" }, undefined, undefined, ctx);
	manager.appendMessage({ role: "toolResult", toolName: tool.name, toolCallId: "mutation", isError: false, timestamp: Date.now(), ...result });
	const afterCommit = await tool.execute("list", { operation: "list" }, undefined, undefined, ctx);
	// Then
	assert.deepEqual({ before: beforeCommit.details.state.revision, after: afterCommit.details.state.revision, replay: replayTasks(manager.getBranch()) },
		{ before: 0, after: 1, replay: result.details.state });
	assert.equal(tool.exposure, "model-only");
	assert.equal(tool.executionMode, "sequential");
});

test("shouldRejectWithoutCommittingWhenTaskUpdateIsAlreadyCancelled", async (t) => {
	// Given
	const { createTaskTool } = await taskModule(t);
	const cwd = await createWorkspace(t);
	const ctx = { cwd, sessionManager: pi.SessionManager.inMemory(cwd) };
	const tool = createTaskTool();
	const signal = new AbortController();
	signal.abort();
	// When / Then
	await assert.rejects(tool.execute("abort", { operation: "add", expectedRevision: 0, tasks: [pending()] }, signal.signal, undefined, ctx), /cancelled/i);
	assert.deepEqual(ctx.sessionManager.getBranch(), []);
});

test("shouldReplayOnlyAppendedReceiptsAndWholeBranchAfterLeafMovesWhenTaskToolRuns", async (t) => {
	// Given
	const { createTaskTool, replayTasks } = await taskModule(t);
	const cwd = await createWorkspace(t);
	const manager = pi.SessionManager.inMemory(cwd);
	const ctx = { cwd, sessionManager: manager };
	const tool = createTaskTool();
	const run = (id, params) => tool.execute(id, params, undefined, undefined, ctx);
	const commit = async (id, params) => { manager.appendMessage({ role: "toolResult", toolName: tool.name, toolCallId: id, isError: false, timestamp: Date.now(), ...await run(id, params) }); };
	await commit("seed", { operation: "add", expectedRevision: 0, tasks: [pending("one"), pending("two")] });
	const seeded = manager.getLeafId();
	let branchReads = 0;
	const branch = manager.getBranch.bind(manager);
	manager.getBranch = (...args) => { branchReads++; return branch(...args); };
	// When
	await commit("start", { operation: "update", expectedRevision: 1, id: "one", changes: { status: "in_progress" } });
	await run("appended", { operation: "list" });
	const appendedReads = branchReads;
	manager.branch(seeded);
	await commit("other", { operation: "update", expectedRevision: 1, id: "two", changes: { status: "in_progress" } });
	const listed = await run("switched", { operation: "list" });
	// Then
	assert.deepEqual({ appendedReads, switchedReads: branchReads }, { appendedReads: 0, switchedReads: 1 });
	assert.deepEqual(listed.details.state, replayTasks(branch()));
	assert.deepEqual(listed.details.state.tasks.map(({ status }) => status), ["pending", "in_progress"]);
});

test("shouldBoundCollapsedAndExpandedHeaderWhenTerminalIsNarrowOrShort", async (t) => {
	// Given
	const { taskHeader } = await loadUiModule(t, "extensions/ui/task-view.ts");
	const state = { version: 1, revision: 1, tasks: Array.from({ length: 10 }, (_, index) => ({ ...pending(String(index)), title: "Unicode 你好 é \x1b]52;c;secret\x07" })) };
	// When
	const rows = [1, 20, 40, 80, 120].flatMap((width) => [false, true].map((expanded) => ({ width, expanded, lines: taskHeader(state, expanded, width, 24, plainTheme) })));
	// Then
	assert.ok(rows.every(({ width, expanded, lines }) => lines.length <= (expanded ? 12 : 4) && lines.every((line) => tui.visibleWidth(line) <= width && !line.includes("\x1b]52"))));
	assert.equal(taskHeader(state, true, 80, 10, plainTheme).length, 1);
	assert.deepEqual(taskHeader({ version: 1, revision: 0, tasks: [] }, true, 80, 24, plainTheme), []);
});

const timed = (at, state) => ({ ...receipt({ details: { version: 1, operation: "replace", state }, content: [] }), timestamp: new Date(at).toISOString() });
const board = (revision, tasks) => ({ version: 1, revision, tasks });
const stages = [
	[{ id: "T1", title: "Fix config", status: "pending", group: "fix" }, { id: "T2", title: "Add regression", status: "pending", group: "fix" }, { id: "T3", title: "Update docs", status: "pending", group: "docs" }],
	[{ id: "T1", title: "Fix config", status: "in_progress", group: "fix" }, { id: "T2", title: "Add regression", status: "pending", group: "fix" }, { id: "T3", title: "Update docs", status: "pending", group: "docs" }],
	[{ id: "T1", title: "Fix config", status: "done", group: "fix", evidence: "pnpm test passed" }, { id: "T2", title: "Add regression", status: "blocked", group: "fix", reason: "Fixture HOME undecided" }, { id: "T3", title: "Update docs", status: "pending", group: "docs" }],
];
const activeBranch = stages.map((tasks, index) => timed(60_000 * index, board(index + 1, tasks)));

test("shouldDeriveTaskHistoryFromReceiptsWithoutChangingReplayedStateWhenActivityIsRequested", async (t) => {
	// Given
	const { replayTaskActivity, replayTasks } = await taskModule(t);
	// When
	const { state, activity } = replayTaskActivity([...activeBranch, receipt({ details: { version: 1, operation: "clear", state: board(9, []) } })]);
	// Then
	assert.deepEqual(state, replayTasks(activeBranch));
	assert.deepEqual(Object.fromEntries(activity), {
		T1: { since: 120_000, events: [{ revision: 1, at: 0, change: "added as pending" }, { revision: 2, at: 60_000, change: "pending → in progress" },
			{ revision: 3, at: 120_000, change: "in progress → done · evidence added" }] },
		T2: { since: 120_000, events: [{ revision: 1, at: 0, change: "added as pending" }, { revision: 3, at: 120_000, change: "pending → blocked · reason added" }] },
		T3: { since: 0, events: [{ revision: 1, at: 0, change: "added as pending" }] },
	});
});

test("shouldDropLegacyPlanBindingWhenReplayingEarlierReceipts", async (t) => {
	// Given
	const { replayTasks } = await taskModule(t);
	const binding = { project: "/fixture", path: "plan.md", sha256: "a".repeat(64), groups: ["fix", "docs"] };
	// When
	const state = replayTasks(stages.map((tasks, index) => timed(60_000 * index, { ...board(index + 1, tasks), binding })));
	// Then
	assert.deepEqual(state, board(3, stages[2]));
});

test("shouldRecordRemovedEvidenceWhenReplaceReopensTaskWithoutIt", async (t) => {
	// Given
	const { replayTaskActivity } = await taskModule(t);
	const reopened = stages[2].map((task) => task.id === "T1" ? { id: "T1", title: "Fix config", status: "in_progress", group: "fix", reason: "Regression found" } : task);
	// When
	const { activity } = replayTaskActivity([...activeBranch, timed(180_000, board(4, reopened))]);
	// Then
	assert.deepEqual(activity.get("T1").events.at(-1), { revision: 4, at: 180_000, change: "done → in progress · evidence removed · reason added" });
});

test("shouldShowFocusTimingGroupsAndNextTaskWhenRenderingCollapsedAndExpandedHeaders", async (t) => {
	// Given
	const { replayTaskActivity } = await taskModule(t);
	const { taskHeader } = await loadUiModule(t, "extensions/ui/task-view.ts");
	const { state, activity } = replayTaskActivity(activeBranch);
	const now = 120_000 + 95_000;
	// When
	const collapsed = taskHeader(state, false, 120, 40, plainTheme, activity, now);
	const expanded = taskHeader(state, true, 120, 40, plainTheme, activity, now);
	// Then
	assert.equal(collapsed.length, 3);
	assert.match(collapsed[0], /^Tasks \S+ 1\/3 done · ⊘ 1 blocked  ○ 1 pending +rev 3$/u);
	assert.match(collapsed[1], /^ ⊘ T2  Add regression  — Fixture HOME undecided +blocked · 1m35s$/u);
	assert.match(collapsed[2], /last ✓ T1 1m ago  ·  next ○ T3 Update docs +\/orchestraitor:tasks$/u);
	const expectedRows = [/^Tasks \S+ 1\/3 done · 33% · ⊘ 1 blocked  ○ 1 pending +rev 3$/u,
		/^fix ─+ 1\/2$/u, /^ ✓ T1  Fix config +done · 1m ago$/u, /^ {7}evidence  pnpm test passed$/u, /^ ⊘ T2  Add regression +blocked · 1m35s$/u,
		/^ {7}reason  {3}Fixture HOME undecided$/u, /^docs ─+ 0\/1$/u, /^ ○ T3  Update docs +pending$/u, /\/orchestraitor:tasks collapse/u];
	assert.equal(expanded.length, expectedRows.length);
	expectedRows.forEach((pattern, index) => assert.match(expanded[index], pattern));
	const longer = { ...state, tasks: [...state.tasks, { id: "T4", title: "Release notes", status: "pending", group: "docs" }] };
	assert.ok(taskHeader(longer, true, 120, 16, plainTheme, activity, now).every((line) => !/evidence|reason/u.test(line)), "Detail rows drop first on short budgets");
});

test("shouldMoveSelectionAndShowEvidenceReasonAndHistoryWhenPanelIsNavigated", async (t) => {
	// Given
	const { replayTaskActivity } = await taskModule(t);
	const { createTaskPanel } = await loadUiModule(t, "extensions/ui/task-view.ts");
	const { state, activity } = replayTaskActivity(activeBranch);
	const keys = { matches: (data, name) => data === name };
	let closed;
	const agents = [{ role: "implement", label: "Fix isolated config", phase: "running", effectiveModel: "fixture-model" }];
	const panel = createTaskPanel(() => ({ state, activity, agents }), { requestRender() {}, terminal: { rows: 40, columns: 120 } }, plainTheme, keys, (result) => { closed = result; });
	// When
	const blocked = panel.render(120).join("\n");
	panel.handleInput("tui.select.up");
	const done = panel.render(120).join("\n");
	const narrow = panel.render(60);
	panel.handleInput("tui.select.cancel");
	// Then
	assert.match(blocked, /▶⊘ T2 Add regression/u);
	assert.match(blocked, /reason\s*│?\s*\n?.*Fixture HOME undecided/u);
	assert.match(blocked, /agents  ▸ implement · running · fixture-model · Fix isolated config/u);
	assert.match(blocked, /— none yet · required to mark done/u);
	assert.match(done, /▶✓ T1 Fix config/u);
	assert.match(done, /pnpm test passed/u);
	assert.match(done, /parent-reported, not runtime certification/u);
	assert.match(done, /rev 3 .*in progress → done · evidence added/u);
	assert.ok(narrow.every((line) => tui.visibleWidth(line) <= 60));
	assert.ok(narrow.some((line) => /^▶✓ T1 Fix config/u.test(line)));
	assert.deepEqual(closed, { status: "closed" });
});

async function nativeTasks(t, calls, hooks = {}, options = {}) {
	const { createAssistantMessageEventStream } = await importHost("node_modules/@earendil-works/pi-ai/dist/index.js");
	const { session, resources, ...ui } = await createUISession(t, "tui", options);
	let requests = 0;
	session.modelRuntime.registerProvider("task-fixture", { api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "fixture",
		models: [{ id: "model", name: "Local tasks fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1024 }],
		streamSimple(model) {
			const stream = createAssistantMessageEventStream();
			const first = requests++ === 0;
			const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: first ? "toolUse" : "stop",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				content: first ? calls.map((arguments_, index) => arguments_.type === "toolCall" ? arguments_ : ({ type: "toolCall", name: "orchestraitor_tasks", id: `tasks-${index}`, arguments: arguments_ })) : [{ type: "text", text: "done" }] };
			stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message); return stream;
		},
	});
	await session.setModel((await session.modelRuntime.getAvailable()).find(({ provider }) => provider === "task-fixture"));
	const extension = resources.loader.getExtensions().extensions[0];
	for (const [event, handler] of Object.entries(hooks)) {
		const handlers = extension.handlers.get(event) ?? [];
		handlers.push(handler);
		extension.handlers.set(event, handlers);
	}
	return { session, resources, ...ui };
}

const askCall = (id) => ({ type: "toolCall", name: "orchestraitor_ask", id, arguments: { questions: [
	{ id: "q", prompt: "Wait for the fixture", selection: "single", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] },
] } });
const renderHeader = ({ widgets, ctx }) => widgets.get("orchestraitor:work")?.({ terminal: { rows: 24 } }, ctx.ui.theme).render(100) ?? [];

for (const nextTool of ["orchestraitor_ask", "subagent_run"]) for (const hidden of [false, true]) {
	test(`shouldRefreshPersistedCreationUpdateAndClearWhile${nextTool}WaitsWithHidden${hidden}`, { timeout: 5000 }, async (t) => {
		const gates = Array.from({ length: 3 }, () => ({ entered: Promise.withResolvers(), release: Promise.withResolvers() }));
		let index = 0, turns = 0;
		const wait = async () => { const gate = gates[index++]; gate.entered.resolve(); await gate.release.promise; };
		const options = nextTool === "subagent_run" ? { extensionFactories: [(api) => api.registerTool({
			name: "subagent_run", label: "Controlled agent", description: "Local waiting fixture", executionMode: "sequential", parameters: { type: "object", properties: {} },
			async execute() { await wait(); return { content: [], details: { results: [] } }; },
		})] } : {};
		const operations = [
			{ operation: "add", expectedRevision: 0, tasks: [pending()] },
			{ operation: "update", expectedRevision: 1, id: "g1", changes: { status: "done", evidence: "Local evidence" } },
			{ operation: "clear", expectedRevision: 2 },
		];
		const calls = operations.flatMap((operation, i) => [operation, nextTool === "orchestraitor_ask" ? askCall(`wait-${i}`) : { type: "toolCall", name: nextTool, id: `wait-${i}`, arguments: {} }]);
		const ui = await nativeTasks(t, calls, { turn_end() { turns++; } }, options);
		const { session, ctx, errors } = ui, runner = session.extensionRunner;
		ctx.ui.custom = async () => { await wait(); return { status: "cancelled" }; };
		if (hidden) await runner.getCommand("orchestraitor:ui").handler("hide", runner.createCommandContext());
		const running = session.prompt("Use local progress fixtures.");
		try {
			for (let i = 0; i < gates.length; i++) {
				await Promise.race([gates[i].entered.promise, running.then(() => { throw new Error("Waiting tool did not start"); })]);
				assert.equal(turns, 0);
				if (hidden || i === 2) assert.deepEqual(renderHeader(ui), []);
				else assert.match(renderHeader(ui)[0], new RegExp(`^Tasks \\S+ ${i}/1 done`));
				gates[i].release.resolve();
			}
			await running;
			assert.deepEqual(errors, []);
		} finally { gates.forEach(({ release }) => release.resolve()); await running; }
	});
}

for (const rejection of ["blocked", "transformed"]) {
	test(`shouldKeepOnlyPersistedSuccessWhileQuestionWaitsAfterTaskIs${rejection}`, { timeout: 5000 }, async (t) => {
		const started = Promise.withResolvers(), release = Promise.withResolvers();
		const ui = await nativeTasks(t, [
			{ operation: "add", expectedRevision: 0, tasks: [pending()] },
			{ operation: "add", expectedRevision: 1, tasks: [pending("phantom")] }, askCall("wait"),
		], rejection === "blocked" ? {
			tool_call(event) { if (event.toolCallId === "tasks-1") return { block: true, reason: "Fixture rejection" }; },
		} : {
			tool_result(event) { if (event.toolCallId === "tasks-1") return { isError: true }; },
		});
		ui.ctx.ui.custom = async () => { started.resolve(); await release.promise; return { status: "cancelled" }; };
		const running = ui.session.prompt("Use local rejection fixture.");
		try {
			await Promise.race([started.promise, running.then(() => { throw new Error("Question did not open"); })]);
			assert.match(renderHeader(ui)[0], /^Tasks \S+ 0\/1 done/);
			const { replayTasks } = await taskModule(t);
			assert.deepEqual(replayTasks(ui.session.sessionManager.getBranch()).tasks.map(({ id }) => id), ["g1"]);
			assert.deepEqual(ui.errors, []);
		} finally { release.resolve(); await running; }
	});
}

test("shouldCommitEachSnapshotBeforeNextSequentialCallWhenNativeModelIssuesTasks", async (t) => {
	// Given
	const { replayTasks } = await taskModule(t);
	const beforeCommit = [];
	const { session, widgets, errors } = await nativeTasks(t, [
		{ operation: "replace", expectedRevision: 0, tasks: [pending()] },
		{ operation: "update", expectedRevision: 1, id: "g1", changes: { status: "done", evidence: "Native receipt inspected" } },
	], { message_end(event, ctx) {
		if (event.message.role === "toolResult" && event.message.toolName === "orchestraitor_tasks") beforeCommit.push(replayTasks(ctx.sessionManager.getBranch()).revision);
	} });
	// When
	await session.prompt("Use local task fixture.");
	const state = replayTasks(session.sessionManager.getBranch());
	// Then
	assert.deepEqual({ beforeCommit, revision: state.revision, status: state.tasks[0]?.status, errors },
		{ beforeCommit: [0, 1], revision: 2, status: "done", errors: [] });
	assert.ok(widgets.has("orchestraitor:work"));
	assert.equal(session.sessionManager.getBranch().filter(({ type }) => type === "custom").length, 0);
});

test("shouldChainRevisionsWhenTaskUpdatesShareAMessageWithWorkCalls", async (t) => {
	// Given
	const { replayTasks } = await taskModule(t);
	const work = (id) => ({ type: "toolCall", name: "read", id, arguments: { path: "notes.txt" } });
	const { session, errors } = await nativeTasks(t, [
		{ operation: "replace", expectedRevision: 0, tasks: [{ ...pending("a"), status: "in_progress" }, pending("b")] },
		work("read-a"),
		{ operation: "update", expectedRevision: 1, id: "a", changes: { status: "done", evidence: "Earlier result inspected" } },
		{ operation: "update", expectedRevision: 2, id: "b", changes: { status: "in_progress" } },
		work("read-b"),
	]);
	await writeFile(join(session.sessionManager.getCwd(), "notes.txt"), "synthetic notes");
	// When
	await session.prompt("Use local batched task fixture.");
	// Then
	const receipts = session.messages.filter(({ role }) => role === "toolResult")
		.map(({ toolName, isError, details }) => ({ toolName, isError, revision: details?.state?.revision }));
	assert.deepEqual({ receipts, errors }, { receipts: [
		{ toolName: "orchestraitor_tasks", isError: false, revision: 1 }, { toolName: "read", isError: false, revision: undefined },
		{ toolName: "orchestraitor_tasks", isError: false, revision: 2 }, { toolName: "orchestraitor_tasks", isError: false, revision: 3 },
		{ toolName: "read", isError: false, revision: undefined },
	], errors: [] });
	assert.deepEqual(replayTasks(session.sessionManager.getBranch()).tasks.map(({ id, status }) => ({ id, status })),
		[{ id: "a", status: "done" }, { id: "b", status: "in_progress" }]);
});

test("shouldRejectStaleSiblingWriteWhenNativeCallsShareExpectedRevision", async (t) => {
	// Given
	const { replayTasks } = await taskModule(t);
	const { session } = await nativeTasks(t, [
		{ operation: "add", expectedRevision: 0, tasks: [pending()] },
		{ operation: "clear", expectedRevision: 0 },
	]);
	// When
	await session.prompt("Use local stale-write fixture.");
	const receipts = session.messages.filter(({ role }) => role === "toolResult");
	// Then
	assert.deepEqual({ errors: receipts.map(({ isError }) => isError), revision: replayTasks(session.sessionManager.getBranch()).revision },
		{ errors: [false, true], revision: 1 });
});

test("shouldRejectTransformedOrAbortedResultWithoutPhantomTasksWhenNativePipelineDoesNotCommitSuccess", async (t) => {
	// Given
	const { replayTasks } = await taskModule(t);
	const { session } = await nativeTasks(t, [{ operation: "add", expectedRevision: 0, tasks: [pending()] }], {
		tool_result(event) { if (event.toolName === "orchestraitor_tasks") return { isError: true, content: [{ type: "text", text: "Rejected by fixture" }] }; },
	});
	// When
	await session.prompt("Use local rejected-result fixture.");
	// Then
	assert.deepEqual(replayTasks(session.sessionManager.getBranch()), { version: 1, revision: 0, tasks: [] });
	const result = session.messages.find(message => message.role === "toolResult" && message.toolName === "orchestraitor_tasks");
	assert.equal(result.details.state.tasks.length, 1, "The hook retains candidate details");
	const definition = session.getToolDefinition("orchestraitor_tasks");
	pi.initTheme("dark", false);
	const component = new pi.ToolExecutionComponent(definition.name, result.toolCallId, {}, { showImages: false }, definition, { requestRender() {} }, session.cwd);
	component.markExecutionStarted();
	component.updateResult(result, false);
	for (const expanded of [false, true, false]) {
		component.setExpanded(expanded);
		const display = component.render(120).map(stripVTControlCharacters).join("\n");
		assert.match(display, /Rejected by fixture/);
		assert.doesNotMatch(display, /Inspect marker|"revision": 1|"state"/);
	}
});

test("shouldRejectNativeNestedExecutionWithoutMutatingTasksWhenToolIsModelOnly", async (t) => {
	// Given
	const { replayTasks } = await taskModule(t);
	const { session } = await createUISession(t, "print");
	const ctx = session.extensionRunner.createToolContext("nested-probe", undefined);
	// When
	const result = await ctx.executeTool("orchestraitor_tasks", { operation: "add", expectedRevision: 0, tasks: [pending()] });
	// Then
	assert.equal(result.isError, true);
	assert.ok(!ctx.tools.some(({ name }) => name === "orchestraitor_tasks"));
	assert.deepEqual(replayTasks(session.sessionManager.getBranch()), { version: 1, revision: 0, tasks: [] });
});

test("shouldReplayForkedNativeReceiptsAndIsolateFreshSessionsWhenHistoryIsCopied", async (t) => {
	// Given
	const { replayTasks } = await taskModule(t);
	const { session } = await nativeTasks(t, [{ operation: "add", expectedRevision: 0, tasks: [pending()] }]);
	await session.prompt("Create the local fork fixture.");
	const cwd = session.sessionManager.getCwd();
	const store = pi.SessionManager.create(cwd, join(cwd, "session-fixtures"));
	for (const message of session.messages) store.appendMessage(message);
	// When
	const fork = pi.SessionManager.forkFrom(store.getSessionFile(), cwd, join(cwd, "fork-fixtures"));
	const fresh = pi.SessionManager.inMemory(cwd);
	// Then
	assert.notEqual(fork.getSessionId(), store.getSessionId());
	assert.deepEqual({ forkIds: replayTasks(fork.getBranch()).tasks.map(({ id }) => id), fresh: replayTasks(fresh.getBranch()) },
		{ forkIds: ["g1"], fresh: { version: 1, revision: 0, tasks: [] } });
});

test("shouldFollowNativeBranchAndReloadWithoutResumingWorkWhenTreeChanges", async (t) => {
	// Given
	const { replayTasks } = await taskModule(t);
	const { session } = await nativeTasks(t, [{ operation: "add", expectedRevision: 0, tasks: [pending()] }]);
	await session.prompt("Create a branch task.");
	const leaf = session.sessionManager.getLeafId();
	// When
	session.sessionManager.resetLeaf();
	await session.extensionRunner.emit({ type: "session_tree", oldLeafId: leaf, newLeafId: null });
	const empty = replayTasks(session.sessionManager.getBranch());
	session.sessionManager.branch(leaf);
	await session.extensionRunner.emit({ type: "session_start", reason: "reload" });
	const restored = replayTasks(session.sessionManager.getBranch());
	// Then
	assert.deepEqual({ empty, restoredIds: restored.tasks.map(({ id }) => id), restoredRevision: restored.revision },
		{ empty: { version: 1, revision: 0, tasks: [] }, restoredIds: ["g1"], restoredRevision: 1 });
});
