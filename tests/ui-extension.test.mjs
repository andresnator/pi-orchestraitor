import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { BatchController } from "../extensions/subagent/controller.mjs";
import test from "node:test";
import { createUISession, createWorkspace, fakeUIContext, loadExtensions, loadUiModule, packageRoot } from "./helpers/ui-harness.mjs";

const header = ({ widgets, ctx }) => widgets.get("orchestraitor:work")?.({ terminal: { rows: 24 } }, ctx.ui.theme).render(100).join("\n") ?? "";

test("shouldReuseTaskProjectionWhenNativeHistoryIsUnchangedAcrossHooks", async (t) => {
	// Given
	const ui = await createUISession(t), { session } = ui;
	const manager = session.sessionManager, runner = session.extensionRunner;
	let branchReads = 0;
	const branch = manager.getBranch.bind(manager);
	manager.getBranch = () => { branchReads++; return branch(); };
	manager.getEntries = () => { assert.fail("Native UI must not scan all session entries"); };
	// When
	await runner.emit({ type: "tool_execution_start", toolName: "read" });
	await runner.emit({ type: "turn_end" });
	await runner.emit({ type: "agent_settled" });
	// Then
	assert.equal(branchReads, 0);
	manager.appendMessage({ role: "toolResult", toolName: "orchestraitor_tasks", toolCallId: "seed", content: [], isError: false, timestamp: 1,
		details: { version: 1, operation: "add", state: { version: 1, revision: 1, tasks: [{ id: "one", title: "Branch work", status: "pending" }] } } });
	await runner.emit({ type: "tool_execution_start", toolName: "read" });
	assert.equal(branchReads, 1);
	assert.match(header(ui), /0\/1 done/);
});

test("shouldRefreshBranchTasksWhenNavigationKeepsEntryCount", async (t) => {
	// Given
	const ui = await createUISession(t), { session, widgets } = ui;
	const manager = session.sessionManager, runner = session.extensionRunner;
	const root = manager.appendMessage({ role: "user", content: "root", timestamp: 0 });
	manager.appendMessage({ role: "toolResult", toolName: "orchestraitor_tasks", toolCallId: "seed", content: [], isError: false, timestamp: 1,
		details: { version: 1, operation: "add", state: { version: 1, revision: 1, tasks: [{ id: "one", title: "Branch work", status: "pending" }] } } });
	await runner.emit({ type: "turn_end" });
	assert.match(header(ui), /0\/1 done/);
	const count = manager.getEntryCount();
	manager.getEntries = () => { assert.fail("Native UI must not scan all session entries"); };
	// When
	manager.branch(root);
	await runner.emit({ type: "session_tree", oldLeafId: null, newLeafId: root });
	// Then
	assert.equal(manager.getEntryCount(), count);
	assert.equal(widgets.has("orchestraitor:work"), false);
});

test("shouldDetectExternalPlanDriftEvenWhenTaskProjectionIsCached", async (t) => {
	// Given
	const ui = await createUISession(t), { session } = ui;
	const cwd = await realpath(session.extensionRunner.createContext().cwd);
	await mkdir(join(cwd, ".git")); await writeFile(join(cwd, "plan.md"), "original");
	const binding = { project: cwd, path: "plan.md", sha256: createHash("sha256").update("original").digest("hex"), groups: ["g1"] };
	session.sessionManager.appendMessage({ role: "toolResult", toolName: "orchestraitor_tasks", toolCallId: "bound", content: [], isError: false, timestamp: 0,
		details: { version: 1, operation: "replace", state: { version: 1, revision: 1, binding, tasks: [{ id: "one", title: "Bound work", group: "g1", status: "pending" }] } } });
	await session.extensionRunner.emit({ type: "turn_end" });
	assert.doesNotMatch(header(ui), /plan binding stale/);
	session.sessionManager.getBranch = () => { assert.fail("Unchanged branch must not be reconstructed"); };
	// When
	await writeFile(join(cwd, "plan.md"), "external edit");
	await session.extensionRunner.emit({ type: "turn_end" });
	// Then
	assert.match(header(ui), /plan binding stale/);
});

test("shouldClearOnlyOwnedChromeWhenDisposedRepeatedly", async (t) => {
	// Given
	const { createUIOwner, WORK_WIDGET_KEY, WORK_STATUS_KEY } = await loadUiModule(t, "extensions/status-ui.ts");
	const { ctx, widgets, statuses } = fakeUIContext();
	const owner = createUIOwner();
	owner.activate(ctx);
	owner.setWidget(["Work"]);
	owner.setStatus("Running");
	assert.ok(widgets.has(WORK_WIDGET_KEY) && statuses.has(WORK_STATUS_KEY));
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
		owner.setWidget(["Work"]);
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
		{ tools: ["orchestraitor_tasks", "orchestraitor_ask"], shortcuts: [], flags: [], commands: ["orchestraitor:ui", "orchestraitor:tasks", "orchestraitor:agents"], calls: [] });
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
			{ errors: [], calls: [], active: ["read", "bash", "edit", "write", "orchestraitor_tasks", "orchestraitor_ask"], extensions: 1 });
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

test("shouldHideAndRestoreOnlyPassiveChromeWithoutChangingTasksOrNativeFactoriesWhenUserTogglesUi", async (t) => {
	// Given
	const { session, ctx, widgets, statuses } = await createUISession(t);
	const runner = session.extensionRunner;
	for (const method of ["setHeader", "setFooter", "setEditorComponent", "setEditorText", "setWorkingIndicator"]) ctx.ui[method] = () => { throw new Error(`Foreign ${method} must not be replaced`); };
	const tool = runner.getAllRegisteredTools().find(({ definition }) => definition.name === "orchestraitor_tasks").definition;
	const result = await tool.execute("tasks", { operation: "replace", expectedRevision: 0, tasks: [{ id: "one", title: "Inspect", status: "pending" }] }, undefined, undefined, runner.createToolContext("tasks", undefined));
	session.sessionManager.appendMessage({ role: "toolResult", toolCallId: "tasks", toolName: tool.name, timestamp: Date.now(), isError: false, ...result });
	await runner.emit({ type: "turn_end", toolResults: [] });
	await runner.emit({ type: "tool_execution_start", toolName: "subagent_run", toolCallId: "agents", args: { tasks: [{ role: "review", instruction: "review" }] } });
	const initialBranch = JSON.stringify(session.sessionManager.getBranch());
	const command = runner.getCommand("orchestraitor:ui");
	// When
	await command.handler("hide", runner.createCommandContext());
	const hidden = { widgets: [...widgets], statuses: [...statuses] };
	await command.handler("show", runner.createCommandContext());
	// Then
	assert.deepEqual(hidden, { widgets: [["foreign-widget", ["Foreign widget"]]], statuses: [["foreign-status", "Foreign status"]] });
	assert.ok(widgets.has("orchestraitor:work"));
	assert.equal(statuses.get("orchestraitor:status"), "Agents · 1 active");
	assert.equal(JSON.stringify(session.sessionManager.getBranch()), initialBranch);
});

test("shouldRenderCurrentThemeAndBoundRowsAtAllWidthsWithoutCachingForeignColorsWhenWorkHeaderResizes", async (t) => {
	// Given
	const { session, ctx, widgets } = await createUISession(t);
	const runner = session.extensionRunner;
	const tool = runner.getAllRegisteredTools().find(({ definition }) => definition.name === "orchestraitor_tasks").definition;
	const result = await tool.execute("tasks", { operation: "replace", expectedRevision: 0, tasks: Array.from({ length: 6 }, (_, i) => ({ id: String(i), title: "原é\x1b]52;c;secret\x07", status: "pending" })) }, undefined, undefined, runner.createToolContext("tasks", undefined));
	session.sessionManager.appendMessage({ role: "toolResult", toolCallId: "tasks", toolName: tool.name, timestamp: Date.now(), isError: false, ...result });
	await runner.emit({ type: "turn_end", toolResults: [] });
	await runner.getCommand("orchestraitor:tasks").handler("expand", runner.createCommandContext());
	const terminal = { rows: 24, columns: 80 };
	const component = widgets.get("orchestraitor:work")({ terminal }, ctx.ui.theme);
	const { visibleWidth } = (await import("./helpers/ui-harness.mjs")).tui;
	// When / Then
	for (const color of [31, 32, 39]) {
		ctx.ui.theme = { fg: (_token, text) => `\x1b[${color}m${text}\x1b[0m` };
		component.invalidate();
		for (const width of [1, 20, 40, 80, 120]) {
			const lines = component.render(width);
			assert.equal(lines.length, 5);
			assert.ok(lines.every((line) => visibleWidth(line) <= width && !line.includes("\x1b]52")));
		}
	}
	terminal.rows = 10;
	assert.equal(component.render(80).length, 1);
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

test("shouldIgnoreTaskRefreshFromReplacedContextAndAfterShutdown", async (t) => {
	const cwd = await createWorkspace(t);
	const loaded = await loadExtensions([join(packageRoot, "extensions/status-ui.ts")], cwd);
	assert.deepEqual(loaded.errors, []);
	const extension = loaded.extensions[0];
	const old = fakeUIContext(), current = fakeUIContext();
	old.ctx.sessionManager.appendMessage({ role: "toolResult", toolName: "orchestraitor_tasks", toolCallId: "old", isError: false, content: [], timestamp: Date.now(),
		details: { version: 1, operation: "add", state: { version: 1, revision: 1, tasks: [{ id: "old", title: "Old context task", status: "pending" }] } } });
	const emit = async (type, ctx) => { for (const handler of extension.handlers.get(type)) await handler({ type }, ctx); };
	await emit("session_start", old.ctx);
	assert.ok(old.widgets.has("orchestraitor:work"));
	await emit("session_start", current.ctx);
	await emit("turn_end", old.ctx);
	assert.equal(current.widgets.has("orchestraitor:work"), false);
	await emit("session_shutdown", current.ctx);
	await emit("turn_end", old.ctx);
	assert.equal(current.widgets.has("orchestraitor:work"), false);
});
