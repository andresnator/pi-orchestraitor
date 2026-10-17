import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { realpath, rm } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { BatchController } from "../extensions/subagent/controller.mjs";
import test from "node:test";
import { createPackageUISession, createUISession, createWorkspace, fakeUIContext, loadExtensions, loadUiModule, packageRoot } from "./helpers/ui-harness.mjs";

test("shouldClearOnlyOwnedChromeWhenDisposedRepeatedly", async (t) => {
	// Given
	const { createUIOwner, WORK_STATUS_KEY } = await loadUiModule(t, "extensions/status-ui.ts");
	const { ctx, widgets, statuses } = fakeUIContext();
	const owner = createUIOwner();
	owner.activate(ctx);
	owner.setStatus("Running");
	assert.ok(statuses.has(WORK_STATUS_KEY));
	// When
	owner.dispose();
	owner.dispose();
	// Then
	assert.deepEqual({ widgets: [...widgets], statuses: [...statuses] },
		{ widgets: [["foreign-widget", ["Foreign widget"]]], statuses: [["foreign-status", "Foreign status"]] });
});

for (const mode of ["rpc", "json", "print"]) {
	test(`shouldAvoidVisualComponentsWhenModeIs${mode}`, async (t) => {
		// Given
		const { createUIOwner } = await loadUiModule(t, "extensions/status-ui.ts");
		const { ctx, calls } = fakeUIContext(mode);
		const owner = createUIOwner();
		owner.activate(ctx);
		// When
		owner.setStatus("Running");
		const result = await owner.modal("panel", () => ({render: () => [], invalidate() {}}));
		owner.dispose();
		// Then
		assert.deepEqual({ result, calls }, { result: { status: "unavailable" }, calls: [] });
	});
}

test("shouldProtectQuestionAndReplaceOnlyPanelsWhenModalIsOwned", async (t) => {
	// Given
	const { createUIOwner } = await loadUiModule(t, "extensions/status-ui.ts");
	const { ctx, dialogs } = fakeUIContext();
	const owner = createUIOwner();
	owner.activate(ctx);
	let disposed = 0;
	const factory = () => ({ render: () => [], invalidate() {}, dispose() { disposed++; } });
	const first = owner.modal("panel", factory);
	// When
	const second = owner.modal("panel", factory);
	const replaced = await first;
	const question = owner.modal("question", factory);
	const replacedAgain = await second;
	const busy = await owner.modal("panel", factory);
	owner.dispose();
	// Then
	assert.deepEqual({ replaced, replacedAgain, busy, cancelled: await question, disposed, count: dialogs.length },
		{ replaced: { status: "cancelled" }, replacedAgain: { status: "cancelled" }, busy: { status: "busy" },
			cancelled: { status: "cancelled" }, disposed: 3, count: 3 });
});

test("shouldCloseModalWhenSignalAbortsOrSessionGenerationChanges", async (t) => {
	// Given
	const { createUIOwner } = await loadUiModule(t, "extensions/status-ui.ts");
	const { ctx } = fakeUIContext();
	const owner = createUIOwner();
	owner.activate(ctx);
	const controller = new AbortController();
	const factory = () => ({ render: () => [], invalidate() {} });
	const pending = owner.modal("panel", factory, controller.signal);
	// When
	controller.abort();
	const aborted = await pending;
	const oldGeneration = owner.generation;
	const next = owner.modal("panel", factory);
	owner.activate(ctx);
	const cancelled = await next;
	const alreadyAborted = await owner.modal("panel", factory, controller.signal);
	// Then
	assert.deepEqual({ aborted, cancelled, alreadyAborted, changed: owner.generation > oldGeneration },
		{ aborted: { status: "cancelled" }, cancelled: { status: "cancelled" }, alreadyAborted: { status: "cancelled" }, changed: true });
});

test("shouldRegisterOneLifecycleOwnerWithoutStartupChromeWhenExtensionLoads", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const loaded = await loadExtensions([join(packageRoot, "extensions/status-ui.ts")], cwd);
	assert.deepEqual(loaded.errors, []);
	const extension = loaded.extensions[0];
	const { ctx, calls } = fakeUIContext();
	// When
	for (const handler of extension.handlers.get("session_start")) await handler({ type: "session_start" }, ctx);
	for (const handler of extension.handlers.get("session_shutdown")) await handler({ type: "session_shutdown" }, ctx);
	// Then
	assert.deepEqual({ tools: [...extension.tools.keys()], shortcuts: [...extension.shortcuts.keys()],
		flags: [...extension.flags.keys()], commands: [...extension.commands.keys()], calls },
		{ tools: ["orchestraitor_ask"], shortcuts: [], flags: [], commands: ["orchestraitor:ui", "orchestraitor:agents"], calls: [] });
});

for (const mode of ["tui", "rpc", "json", "print"]) {
	test(`shouldLoadAndDisposeNativeSessionWithoutVisualChangesWhenModeIs${mode}`, async (t) => {
		// Given
		const { session, errors, close, calls, resources } = await createUISession(t, mode);
		// When
		await session.extensionRunner.emit({ type: "session_start", reason: "reload" });
		await session.extensionRunner.emit({ type: "session_tree", oldLeafId: null, newLeafId: null });
		await close();
		// Then
		assert.deepEqual({ errors, calls, active: session.getActiveToolNames(),
			extensions: resources.loader.getExtensions().extensions.length },
			{ errors: [], calls: [], active: ["read", "bash", "edit", "write", "orchestraitor_ask"], extensions: 1 });
	});
}

test("shouldKeepObservedPoisonedControllerLockWhenNativeUiReloads", async (t) => {
	// Given
	const cwd = await realpath(await createWorkspace(t));
	const child = new EventEmitter();
	Object.assign(child, { pid: 123, stdin: new PassThrough(), stdout: new PassThrough(),
		stderr: new PassThrough(), kill() {} });
	const controller = new BatchController({ startTimeout: 10, taskTimeout: 50, stopGrace: 1,
		spawnProcess(_command, args) {
			t.after(() => rm(dirname(args[1]), { recursive: true, force: true }));
			return child;
		},
	});
	const manifest = { cwd, id: "unconfirmed", role: "explore", instruction: "inspect", model: "fixture/model",
		reasoning: "high", files: [], skills: [], tools: ["read", "search", "list"] };
	const results = await controller.run([manifest], () => "work");
	const key = Symbol.for("pi-orchestraitor.subagent-controller");
	const previous = globalThis[key];
	globalThis[key] = controller;
	t.after(() => { globalThis[key] = previous; });
	const { session, dialogs, errors } = await createUISession(t, "tui");
	session.sessionManager.appendMessage({ role: "toolResult", toolName: "subagent_run", toolCallId: "old-batch",
		content: [], details: { results }, isError: false, timestamp: Date.now() });
	// When
	await session.extensionRunner.emit({ type: "session_shutdown", reason: "reload" });
	await session.extensionRunner.emit({ type: "session_start", reason: "reload" });
	const panel = session.extensionRunner.getCommand("orchestraitor:agents").handler("", session.extensionRunner.createCommandContext());
	const visible = dialogs.at(-1).component.render(120).map(stripVTControlCharacters).join("\n");
	dialogs.at(-1).done({ status: "closed" });
	await panel;
	// Then
	assert.match(visible, /Launches blocked: child exit was not confirmed/);
	assert.deepEqual({ blocked: controller.blocked, retained: controller.orphans.has(child), errors },
		{ blocked: true, retained: true, errors: [] });
	await assert.rejects(controller.run([manifest], () => "work"), /launches blocked/i);
});

test("shouldShowLaunchBlockFromControllerStateNotErrorTextWhenRunFails", async (t) => {
	// Given
	const key = Symbol.for("pi-orchestraitor.subagent-controller");
	const previous = globalThis[key];
	t.after(() => { globalThis[key] = previous; });
	const fail = async (blocked, text) => {
		const { session, statuses, dialogs } = await createUISession(t, "tui");
		const runner = session.extensionRunner;
		globalThis[key] = { blocked };
		await runner.emit({ type: "tool_execution_start", toolName: "subagent_run", toolCallId: "run", args: { tasks: [{ role: "explore", instruction: "inspect" }] } });
		await runner.emit({ type: "tool_execution_end", toolName: "subagent_run", toolCallId: "run", isError: true, result: { content: [{ type: "text", text }] } });
		const shown = runner.getCommand("orchestraitor:agents").handler("", runner.createCommandContext());
		const visible = dialogs.at(-1).component.render(120).map(stripVTControlCharacters).join("\n");
		dialogs.at(-1).done({ status: "closed" });
		await shown;
		return { panel: /Launches blocked/.test(visible), status: statuses.get("orchestraitor:status") === "Agents blocked" };
	};
	// When
	const quoted = await fail(false, "Validation failed: instruction \"explain why launches blocked after termination\" is too long");
	const locked = await fail(true, "Subagent launches blocked");
	// Then
	assert.deepEqual({ quoted, locked }, { quoted: { panel: false, status: false }, locked: { panel: true, status: true } });
});

test("shouldReportAgentReplayFailureWithoutLeavingQuestionsUnownedOnSessionStart", async (t) => {
	// Given
	const { session, errors, dialogs } = await createUISession(t, "tui");
	const manager = session.sessionManager, runner = session.extensionRunner;
	const branch = manager.getBranch.bind(manager);
	await runner.emit({ type: "session_shutdown", reason: "reload" });
	manager.getBranch = () => { manager.getBranch = branch; throw new Error("Agent history unreadable"); };
	// When
	await runner.emit({ type: "session_start", reason: "reload" });
	const ask = runner.getAllRegisteredTools().find(({ definition }) => definition.name === "orchestraitor_ask").definition;
	const pending = ask.execute("ask", { questions: [{ id: "q", prompt: "Choose", selection: "single", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] }] }, undefined, undefined, runner.createToolContext("ask", undefined));
	await Promise.resolve();
	dialogs.at(-1)?.done({ status: "cancelled" });
	// Then
	const reported = errors.filter(({ event }) => event === "session_start").map(({ error }) => error).join("\n");
	assert.deepEqual({ agents: /Agent history unreadable/.test(reported), question: (await pending).details.status }, { agents: true, question: "cancelled" }, reported);
});

test("shouldUpdateOneNativeFooterEntryDuringAgentsAndQuestionsWhenChromeIsVisible", async (t) => {
	// Given
	const { session, ctx, statuses, dialogs } = await createUISession(t);
	const runner = session.extensionRunner;
	// When
	await runner.emit({ type: "tool_execution_start", toolName: "subagent_run", toolCallId: "agents", args: { tasks: [{ role: "explore", instruction: "inspect" }] } });
	const active = statuses.get("orchestraitor:status");
	let opened;
	const started = new Promise((resolve) => { opened = resolve; });
	const originalCustom = ctx.ui.custom;
	ctx.ui.custom = (factory, options) => { const pending = originalCustom(factory, options); opened(); return pending; };
	const question = runner.getAllRegisteredTools().find(({ definition }) => definition.name === "orchestraitor_ask").definition;
	const pending = question.execute("ask", { questions: [{ id: "q", prompt: "Choose", selection: "single", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] }] }, undefined, undefined, runner.createToolContext("ask", undefined));
	await started;
	const awaiting = statuses.get("orchestraitor:status");
	dialogs.at(-1).done({ status: "cancelled" }); await pending;
	const returned = statuses.get("orchestraitor:status");
	await runner.emit({ type: "tool_execution_end", toolName: "subagent_run", toolCallId: "agents", isError: false, result: { details: { results: [{ id: "agent", role: "explore", status: "completed", terminated: true }] } } });
	// Then
	assert.deepEqual({ active, awaiting, returned, statuses: [...statuses] }, { active: "Agents · 1 active", awaiting: "Awaiting input", returned: "Agents · 1 active", statuses: [["foreign-status", "Foreign status"]] });
});

test("shouldHideAndRestoreOnlyPassiveChromeWithoutChangingBranchOrNativeFactoriesWhenUserTogglesUi", async (t) => {
	// Given
	const { session, ctx, widgets, statuses } = await createUISession(t);
	const runner = session.extensionRunner;
	for (const method of ["setHeader", "setFooter", "setEditorComponent", "setEditorText", "setWorkingIndicator"]) ctx.ui[method] = () => { throw new Error(`Foreign ${method} must not be replaced`); };
	await runner.emit({ type: "tool_execution_start", toolName: "subagent_run", toolCallId: "agents", args: { tasks: [{ role: "review", instruction: "review" }] } });
	const initialBranch = JSON.stringify(session.sessionManager.getBranch());
	const command = runner.getCommand("orchestraitor:ui");
	// When
	await command.handler("hide", runner.createCommandContext());
	const hidden = { widgets: [...widgets], statuses: [...statuses] };
	await command.handler("show", runner.createCommandContext());
	// Then
	assert.deepEqual(hidden, { widgets: [["foreign-widget", ["Foreign widget"]]], statuses: [["foreign-status", "Foreign status"]] });
	assert.equal(statuses.get("orchestraitor:status"), "Agents · 1 active");
	assert.equal(JSON.stringify(session.sessionManager.getBranch()), initialBranch);
});

test("shouldReleaseOwnershipWhenCustomFactoryFails", async (t) => {
	// Given
	const { createUIOwner } = await loadUiModule(t, "extensions/status-ui.ts");
	const { ctx } = fakeUIContext();
	const owner = createUIOwner();
	owner.activate(ctx);
	// When / Then
	await assert.rejects(owner.modal("panel", () => { throw new Error("factory failed"); }), /factory failed/);
	const next = owner.modal("panel", (_tui, _theme, _kb, done) => {
		done({ status: "closed" });
		return { render: () => [], invalidate() {} };
	});
	assert.deepEqual(await next, { status: "closed" });
});

test("shouldIgnoreAgentEventsFromReplacedContextAndAfterShutdown", async (t) => {
	const cwd = await createWorkspace(t);
	const loaded = await loadExtensions([join(packageRoot, "extensions/status-ui.ts")], cwd);
	assert.deepEqual(loaded.errors, []);
	const extension = loaded.extensions[0];
	const old = fakeUIContext(), current = fakeUIContext();
	const emit = async (type, ctx, event = {}) => { for (const handler of extension.handlers.get(type) ?? []) await handler({ type, ...event }, ctx); };
	const start = { toolName: "subagent_run", toolCallId: "agents", args: { tasks: [{ role: "explore", instruction: "inspect" }] } };
	await emit("session_start", old.ctx);
	await emit("session_start", current.ctx);
	await emit("tool_execution_start", old.ctx, start);
	assert.equal(current.statuses.has("orchestraitor:status"), false);
	await emit("session_shutdown", current.ctx);
	await emit("tool_execution_start", current.ctx, start);
	assert.equal(current.statuses.has("orchestraitor:status"), false);
	await emit("session_start", current.ctx);
	await emit("tool_execution_start", current.ctx, start);
	assert.equal(current.statuses.get("orchestraitor:status"), "Agents · 1 active");
});

// Pi persists rejected tool arguments verbatim, and any tool result can carry arbitrary details.
for (const [scenario, tasks, results] of [["String", "[{\"role\":\"explore\"}]"], ["Object", { role: "explore", instruction: "inspect" }], ["NullEntry", [null]],
	["NonArrayResults", [{ role: "explore", instruction: "inspect" }], { id: "not-a-list" }]]) {
	test(`shouldActivateUiAndAskAfterReloadWhenPersistedSubagentDataIs${scenario}`, async (t) => {
		// Given
		const { session, dialogs, errors } = await createPackageUISession(t, "tui");
		const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
		session.sessionManager.appendMessage({ role: "assistant", api: "openai-completions", provider: "fixture", model: "model", usage, stopReason: "toolUse",
			content: [{ type: "toolCall", id: "malformed", name: "subagent_run", arguments: { tasks } }], timestamp: Date.now() });
		session.sessionManager.appendMessage(results ? { role: "toolResult", toolName: "subagent_collect", toolCallId: "malformed", content: [], details: { results }, isError: false, timestamp: Date.now() }
			: { role: "toolResult", toolName: "subagent_run", toolCallId: "malformed", content: [{ type: "text", text: "Validation failed for tool \"subagent_run\"" }], isError: true, timestamp: Date.now() });
		// When
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "reload" });
		await session.extensionRunner.emit({ type: "session_start", reason: "reload" });
		const question = { id: "after-reload", prompt: "Pick a marker", selection: "single", options: [{ label: "Alpha", value: "alpha" }, { label: "Beta", value: "beta" }] };
		const asked = session.getToolDefinition("orchestraitor_ask").execute("ask", { questions: [question] }, undefined, undefined, session.extensionRunner.createContext());
		await Promise.resolve();
		for (const key of ["\r", "\r"]) dialogs.at(-1)?.component.handleInput(key); // Choose Alpha, then submit from review.
		const answer = await asked;
		// Then
		assert.deepEqual({ errors: errors.map(({ event, error }) => `${event}: ${error}`), answer: answer.details },
			{ errors: [], answer: { version: 1, status: "answered", answers: [{ id: "after-reload", values: ["alpha"] }] } });
	});
}
