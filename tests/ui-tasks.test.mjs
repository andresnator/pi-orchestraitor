import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
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
	const tool = createTaskTool(() => 0);
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
	assert.deepEqual(JSON.parse(result.content[0].text), { operation: "update", revision: 2, bindingCurrent: true, projectIdentity: cwd,
		tasks: [{ ...pending("t0"), status: "done", evidence: "Synthetic check passed" }] });
	assert.deepEqual(JSON.parse(listed.content[0].text).state, replayTasks(ctx.sessionManager.getBranch()));
	assert.equal(result.details.state.tasks.length, 20);
	assert.ok(result.content[0].text.length < listed.content[0].text.length * 0.4);
	assert.deepEqual(wire, [{ type: "function_call_output", call_id: "update", output: result.content[0].text }]);
});

test("shouldReturnAffectedAddsReplacementAndClearWithReusableRevisions", async (t) => {
	// Given
	const { createTaskTool } = await taskModule(t);
	const cwd = await createWorkspace(t);
	const ctx = { cwd, sessionManager: pi.SessionManager.inMemory(cwd) };
	const tool = createTaskTool(() => 0);
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
	const tool = createTaskTool(() => 1);
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

test("shouldVerifyPlanHashAndRejectDriftBeforeMutationWhenTasksAreBound", async (t) => {
	// Given
	const { createTaskTool, checkTaskBinding } = await taskModule(t);
	const cwd = await realpath(await createWorkspace(t));
	await mkdir(join(cwd, ".git"));
	await writeFile(join(cwd, "plan.md"), "original plan");
	const binding = { project: cwd, path: "plan.md", sha256: createHash("sha256").update("original plan").digest("hex"), groups: ["group-1"] };
	const manager = pi.SessionManager.inMemory(cwd);
	const ctx = { cwd, sessionManager: manager };
	const tool = createTaskTool(() => 0);
	const result = await tool.execute("bind", { operation: "replace", expectedRevision: 0, binding, tasks: [{ ...pending(), group: "group-1" }] }, undefined, undefined, ctx);
	manager.appendMessage({ role: "toolResult", toolName: tool.name, toolCallId: "bind", isError: false, timestamp: Date.now(), ...result });
	// When
	await writeFile(join(cwd, "plan.md"), "changed plan");
	const readback = await tool.execute("list", { operation: "list" }, undefined, undefined, ctx);
	// Then
	assert.equal(readback.details.bindingCurrent, false);
	assert.equal(await checkTaskBinding(binding, cwd), false);
	await assert.rejects(tool.execute("update", { operation: "update", expectedRevision: 1, id: "g1", changes: { status: "in_progress" } }, undefined, undefined, ctx), /plan.*hash|binding/i);
	await assert.rejects(tool.execute("escape", { operation: "replace", expectedRevision: 1, binding: { ...binding, path: "../plan.md" }, tasks: [{ ...pending(), group: "group-1" }] }, undefined, undefined, ctx), /path|binding/i);
});

test("shouldAbortOrRejectChangedSessionWithoutCommittingWhenPlanVerificationIsPending", async (t) => {
	// Given
	const { createTaskTool } = await taskModule(t);
	const cwd = await createWorkspace(t);
	const ctx = { cwd, sessionManager: pi.SessionManager.inMemory(cwd) };
	let generation = 0;
	const tool = createTaskTool(() => generation);
	const signal = new AbortController();
	signal.abort();
	// When / Then
	await assert.rejects(tool.execute("abort", { operation: "add", expectedRevision: 0, tasks: [pending()] }, signal.signal, undefined, ctx), /cancelled/i);
	const waiting = tool.execute("changed", { operation: "add", expectedRevision: 0, tasks: [pending()] }, undefined, undefined, ctx);
	generation++;
	await assert.rejects(waiting, /session changed/i);
	assert.deepEqual(ctx.sessionManager.getBranch(), []);
});

test("shouldBoundCollapsedAndExpandedHeaderWhenTerminalIsNarrowOrShort", async (t) => {
	// Given
	const { taskHeader } = await taskModule(t);
	const state = { version: 1, revision: 1, tasks: Array.from({ length: 10 }, (_, index) => ({ ...pending(String(index)), title: "Unicode 你好 é \x1b]52;c;secret\x07" })) };
	// When
	const rows = [1, 20, 40, 80, 120].flatMap((width) => [false, true].map((expanded) => ({ width, expanded, lines: taskHeader(state, expanded, width, 24, plainTheme, true) })));
	// Then
	assert.ok(rows.every(({ width, expanded, lines }) => lines.length <= (expanded ? 5 : 1) && lines.every((line) => tui.visibleWidth(line) <= width && !line.includes("\x1b]52"))));
	assert.equal(taskHeader(state, true, 80, 10, plainTheme, false).length, 1);
	assert.deepEqual(taskHeader({ version: 1, revision: 0, tasks: [] }, true, 80, 24, plainTheme, true), []);
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
				assert.deepEqual(renderHeader(ui), hidden || i === 2 ? [] : [`Tasks · ${i}/1 done`]);
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
			assert.deepEqual(renderHeader(ui), ["Tasks · 0/1 done"]);
			const { replayTasks } = await taskModule(t);
			assert.deepEqual(replayTasks(ui.session.sessionManager.getBranch()).tasks.map(({ id }) => id), ["g1"]);
			assert.deepEqual(ui.errors, []);
		} finally { release.resolve(); await running; }
	});
}

test("shouldDiscardOlderBindingCheckAfterNewerRefreshClearsPersistedTasks", { timeout: 5000 }, async (t) => {
	const fs = await import("node:fs/promises"), { syncBuiltinESMExports } = await import("node:module");
	const entered = Promise.withResolvers(), release = Promise.withResolvers(), original = fs.default.readFile;
	let plan, block = false;
	const mock = t.mock.method(fs.default, "readFile", async (path, ...args) => {
		if (block && String(path) === plan) { entered.resolve(); await release.promise; }
		return original(path, ...args);
	});
	syncBuiltinESMExports();
	t.after(() => { release.resolve(); mock.mock.restore(); syncBuiltinESMExports(); });
	const ui = await createUISession(t), { session } = ui, runner = session.extensionRunner;
	const cwd = await realpath(session.sessionManager.getCwd());
	await mkdir(join(cwd, ".git"));
	plan = join(cwd, "plan.md");
	await writeFile(plan, "plan");
	const binding = { project: cwd, path: "plan.md", sha256: createHash("sha256").update("plan").digest("hex"), groups: ["group"] };
	const tool = runner.getAllRegisteredTools().find(({ definition }) => definition.name === "orchestraitor_tasks").definition;
	const result = await tool.execute("tasks", { operation: "add", expectedRevision: 0, binding, tasks: [{ ...pending(), group: "group" }] }, undefined, undefined, runner.createToolContext("tasks"));
	session.sessionManager.appendMessage({ ...receipt(result).message, timestamp: Date.now() });
	block = true;
	const oldRefresh = runner.emit({ type: "turn_end", toolResults: [] });
	await Promise.race([entered.promise, oldRefresh.then(() => { throw new Error("Binding check did not start"); })]);
	session.sessionManager.appendMessage({ ...receipt({ content: [], details: { version: 1, operation: "clear", state: { version: 1, revision: 2, tasks: [] } } }).message, timestamp: Date.now() });
	await runner.emit({ type: "turn_end", toolResults: [] });
	assert.deepEqual(renderHeader(ui), []);
	release.resolve(); await oldRefresh;
	assert.deepEqual(renderHeader(ui), []);
});

test("shouldAwaitBindingRefreshBeforeOpeningNextNativeQuestion", { timeout: 5000 }, async (t) => {
	const fs = await import("node:fs/promises"), { syncBuiltinESMExports } = await import("node:module");
	const checking = Promise.withResolvers(), releaseCheck = Promise.withResolvers(), question = Promise.withResolvers(), releaseQuestion = Promise.withResolvers();
	let plan, persistedCandidate = false, opened = false;
	const original = fs.default.readFile;
	const mock = t.mock.method(fs.default, "readFile", async (path, ...args) => {
		if (persistedCandidate && String(path) === plan) { checking.resolve(); await releaseCheck.promise; }
		return original(path, ...args);
	});
	syncBuiltinESMExports();
	t.after(() => { releaseCheck.resolve(); releaseQuestion.resolve(); mock.mock.restore(); syncBuiltinESMExports(); });
	const operation = { operation: "add", expectedRevision: 0, tasks: [{ ...pending(), group: "group" }] };
	const ui = await nativeTasks(t, [operation, askCall("wait")], {
		message_end(event) { if (event.message.role === "toolResult" && event.message.toolName === "orchestraitor_tasks") persistedCandidate = true; },
	});
	const cwd = await realpath(ui.session.sessionManager.getCwd());
	await mkdir(join(cwd, ".git"));
	plan = join(cwd, "plan.md"); await writeFile(plan, "plan");
	operation.binding = { project: cwd, path: "plan.md", sha256: createHash("sha256").update("plan").digest("hex"), groups: ["group"] };
	ui.ctx.ui.custom = async () => { opened = true; question.resolve(); await releaseQuestion.promise; return { status: "cancelled" }; };
	const running = ui.session.prompt("Use the local binding refresh fixture.");
	try {
		await Promise.race([checking.promise, running.then(() => { throw new Error("Refresh did not check binding"); })]);
		assert.equal(opened, false);
		releaseCheck.resolve();
		await Promise.race([question.promise, running.then(() => { throw new Error("Question did not open"); })]);
		assert.deepEqual(renderHeader(ui), ["Tasks · 0/1 done"]);
		assert.deepEqual(ui.errors, []);
	} finally { releaseCheck.resolve(); releaseQuestion.resolve(); await running; }
});

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

test("shouldAbortDuringNativeHashCheckWithoutPublishingTasksWhenParentCancels", { timeout: 5000 }, async (t) => {
	// Given
	const { replayTasks } = await taskModule(t);
	const fs = await import("node:fs/promises");
	const { syncBuiltinESMExports } = await import("node:module");
	const calls = [{ operation: "replace", expectedRevision: 0, tasks: [{ ...pending(), group: "group-1" }] }];
	const { session, widgets } = await nativeTasks(t, calls);
	const cwd = await realpath(session.sessionManager.getCwd());
	await mkdir(join(cwd, ".git"));
	const plan = join(cwd, "plan.md");
	await writeFile(plan, "original");
	calls[0].binding = { project: cwd, path: "plan.md", sha256: createHash("sha256").update("original").digest("hex"), groups: ["group-1"] };
	let enter, release;
	const entered = new Promise((resolve) => { enter = resolve; });
	const gate = new Promise((resolve) => { release = resolve; });
	t.after(() => release());
	const original = fs.default.readFile;
	const mock = t.mock.method(fs.default, "readFile", async (path, ...args) => {
		if (String(path) === plan) { enter(); await gate; }
		return original(path, ...args);
	});
	syncBuiltinESMExports();
	t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
	const running = session.prompt("Use local bound-task fixture.");
	await Promise.race([entered, running.then(() => { throw new Error("Fixture never entered hash verification"); })]);
	// When
	const aborted = session.abort();
	release();
	await Promise.all([running, aborted]);
	// Then
	assert.deepEqual(replayTasks(session.sessionManager.getBranch()), { version: 1, revision: 0, tasks: [] });
	assert.ok(!widgets.has("orchestraitor:work"));
	assert.ok(session.messages.some((message) => message.role === "toolResult" && message.isError));
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
