import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { realpath, rm } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { BatchController } from "../extensions/subagent/controller.mjs";
import test from "node:test";
import { createUISession, createWorkspace, fakeUIContext, loadExtensions, loadUiModule, packageRoot } from "./helpers/ui-harness.mjs";
import { loadPackage, startSession } from "./helpers/pi-host.mjs";

async function workbenchHarness(t, { mode = "tui", flag, herdr = true, tty = true, rejectSource = false, native = false } = {}) {
	const { default: register } = await loadUiModule(t, "extensions/status-ui.ts");
	const handlers = new Map(), commands = new Map(), flags = new Map(), calls = [], updates = [];
	const { ctx, calls: uiCalls } = fakeUIContext(mode);
	ctx.cwd = await createWorkspace(t);
	const fake = { on(name, handler) { const items = handlers.get(name) ?? []; items.push(handler); handlers.set(name, items); },
		registerTool() {}, registerCommand(name, command) { commands.set(name, command); },
		registerFlag(name, options) { flags.set(name, options); }, getFlag(name) { return flag ?? flags.get(name)?.default; } };
	let beforePublish, factories = 0, session;
	const workbench = {
		isHerdrTerminal: () => herdr && tty,
		async resolveSource(sourceCtx) { calls.push("resolve"); if (rejectSource) throw new Error("unavailable"); return { session: sourceCtx.sessionManager.getSessionId() }; },
		createPublisher(options) { beforePublish = options.beforePublish; calls.push("create"); let enabled = false; let identity;
			return { get enabled() { return enabled; }, get identity() { return identity; }, async start(source) { calls.push("start"); enabled = true; identity = source; },
				update(value) { updates.push(structuredClone(value)); return true; }, async flush() {}, async stop() { calls.push("stop"); enabled = false; } };
		},
	};
	if (native) {
		const resources = await loadPackage(ctx.cwd, { settings: { packages: [] }, extensionFactories: [(pi) => {
			factories++; register({ ...pi, getFlag: name => flag ?? pi.getFlag(name) }, workbench);
		}] });
		({ session } = await startSession(t, ctx.cwd, resources));
		await session.bindExtensions({ uiContext: ctx.ui, mode });
	} else register(fake, workbench);
	const emit = async (name, event = {}) => {
		if (session) return session.extensionRunner.emit({ type: name, ...event });
		for (const handler of handlers.get(name) ?? []) await handler({ type: name, ...event }, ctx);
	};
	if (!native) t.after(() => emit("session_shutdown"));
	return { get ctx() { return session?.extensionRunner.createContext() ?? ctx; }, calls, updates, uiCalls, emit,
		command: args => session ? session.extensionRunner.getCommand("orchestraitor:workbench").handler(args, session.extensionRunner.createCommandContext()) : commands.get("orchestraitor:workbench")?.handler(args, ctx),
		commands, flags, session, get factories() { return factories; }, heartbeat() { beforePublish?.(); } };
}

test("shouldEnableWorkbenchByDefaultWhenPiStartsInAnEligibleHerdrTerminal", async (t) => {
	// Given
	const harness = await workbenchHarness(t);
	// When
	await harness.emit("session_start");
	// Then
	assert.equal(harness.flags.get("orchestraitor-workbench").default, true);
	assert.deepEqual({ calls: harness.calls, updates: harness.updates.length, uiCalls: harness.uiCalls },
		{ calls: ["resolve", "create", "start"], updates: 1, uiCalls: [] });
});

for (const [condition, options] of [["OutsideHerdr", { herdr: false }], ["NotAnInteractiveTerminal", { tty: false }]]) {
	test(`shouldKeepDefaultWorkbenchInertWhen${condition}`, async (t) => {
		// Given
		const harness = await workbenchHarness(t, options);
		// When
		await harness.emit("session_start");
		// Then
		assert.deepEqual({ calls: harness.calls, updates: harness.updates, uiCalls: harness.uiCalls },
			{ calls: [], updates: [], uiCalls: [] });
	});
}

test("shouldPreserveDisableUntilExplicitReenableWhenDefaultPublisherIsReconstructed", async (t) => {
	// Given
	const harness = await workbenchHarness(t);
	await harness.emit("session_start");
	// When
	await harness.command("disable");
	await harness.emit("session_start", { reason: "reload" });
	await harness.emit("session_tree");
	await harness.emit("turn_end");
	const disabledCalls = [...harness.calls];
	await harness.command("enable");
	await harness.command("enable");
	// Then
	assert.deepEqual({ disabledCalls, calls: harness.calls },
		{ disabledCalls: ["resolve", "create", "start", "stop"], calls: ["resolve", "create", "start", "stop", "resolve", "create", "start"] });
});

for (const flag of [true, false]) test(`shouldPreserveExplicitPublisherOverridesAcrossNativeReloadWithFlag${flag}`, async (t) => {
	// Given
	const harness = await workbenchHarness(t, { native: true, flag });
	await harness.emit("session_start");
	const firstRunner = harness.session.extensionRunner;
	// When
	await harness.command("disable");
	const starts = harness.calls.filter(call => call === "start").length;
	await harness.session.reload();
	// Then
	assert.notEqual(harness.session.extensionRunner, firstRunner);
	assert.equal(harness.factories, 2);
	assert.equal(harness.calls.filter(call => call === "start").length, starts);
	await harness.command("enable");
	await harness.session.reload();
	assert.equal(harness.factories, 3);
	assert.equal(harness.calls.filter(call => call === "start").length, starts + 2);
});

test("shouldKeepWorkbenchInertWhenExplicitlyDisabledAndStopAfterManualEnable", async (t) => {
	// Given
	const harness = await workbenchHarness(t, { flag: false });
	await harness.emit("session_start");
	assert.deepEqual(harness.calls, []);
	// When
	assert.ok(harness.commands.has("orchestraitor:workbench"));
	await harness.command("enable");
	await harness.command("disable");
	await harness.emit("tool_execution_update", { toolName: "read" });
	// Then
	assert.deepEqual(harness.calls, ["resolve", "create", "start", "stop"]);
	assert.equal(harness.updates.length, 1);
});

for (const mode of ["rpc", "json", "print"]) test(`shouldNotStartOptedInWorkbenchIn${mode}`, async (t) => {
	// Given / When
	const harness = await workbenchHarness(t, { mode, flag: true });
	await harness.emit("session_start"); await harness.command("enable");
	// Then
	assert.deepEqual(harness.calls, []);
});

test("shouldPublishCommittedTasksButNeverQuestionsOrTranscriptContent", async (t) => {
	// Given
	const harness = await workbenchHarness(t, { flag: true });
	await harness.emit("session_start");
	harness.ctx.sessionManager.appendMessage({ role: "user", content: "PRIVATE PROMPT AND DRAFT", timestamp: Date.now() });
	harness.ctx.sessionManager.appendMessage({ role: "toolResult", toolName: "orchestraitor_ask", content: [{ type: "text", text: "PRIVATE ANSWER" }], toolCallId: "q", timestamp: Date.now(), isError: false });
	harness.ctx.sessionManager.appendMessage({ role: "toolResult", toolName: "orchestraitor_tasks", toolCallId: "t", content: [], timestamp: Date.now(), isError: false,
		details: { version: 1, operation: "replace", state: { version: 1, revision: 1, tasks: [{ id: "one", title: "Committed work", status: "pending" }] } } });
	// When
	await harness.emit("tool_execution_start", { toolName: "orchestraitor_ask", toolCallId: "waiting" });
	const before = harness.calls.length;
	await harness.emit("session_before_tree"); // Simulate a veto: no committed session_tree follows.
	// Then
	assert.equal(harness.updates.at(-1)?.tasks.rows[0]?.title, "Committed work");
	assert.doesNotMatch(JSON.stringify(harness.updates), /PRIVATE|waiting/);
	assert.equal(harness.calls.length, before);
});

test("shouldRecreateOptedInPublisherOnReloadButKeepItThroughCommittedTreeAndVeto", async (t) => {
	// Given
	const harness = await workbenchHarness(t, { flag: true });
	await harness.emit("session_start");
	// When
	await harness.emit("session_before_tree");
	await harness.emit("session_tree");
	assert.equal(harness.calls.filter(call => call === "create").length, 1);
	await harness.emit("session_start", { reason: "reload" });
	await harness.emit("session_shutdown");
	const count = harness.updates.length;
	await harness.emit("tool_execution_update", { toolName: "subagent_run", toolCallId: "late" });
	await harness.emit("turn_end");
	// Then
	assert.equal(harness.calls.filter(call => call === "create").length, 2);
	assert.equal(harness.calls.filter(call => call === "stop").length, 2);
	assert.equal(harness.updates.length, count);
});

test("shouldReuseUsageProjectionDuringChildProgressInsteadOfRescanningHistory", async (t) => {
	// Given
	const harness = await workbenchHarness(t, { flag: true });
	await harness.emit("session_start");
	const original = harness.ctx.sessionManager.getEntries;
	harness.ctx.sessionManager.getEntries = () => { assert.fail("Progress must not re-read history"); };
	// When
	await harness.emit("tool_execution_update", { toolName: "subagent_run", toolCallId: "unknown" });
	// Then
	assert.equal(harness.updates.length, 2);
	harness.ctx.sessionManager.getEntries = original;
});

for (const boundary of ["heartbeat", "model_select"]) test(`shouldRefreshIdleNativeUsageReceiptsAt${boundary}`, async (t) => {
	// Given
	const harness = await workbenchHarness(t, { native: true });
	await harness.emit("session_start");
	const manager = harness.session.sessionManager;
	const getEntries = manager.getEntries.bind(manager);
	let scans = 0;
	manager.getEntries = () => { scans++; return getEntries(); };
	// When: append the same native receipt used by CacheWarmer.onWarmed while idle.
	assert.equal(harness.ctx.isIdle(), true);
	manager.appendUsage("cache_warm", "openai-codex", "idle-model", { input: 100, output: 0, cacheRead: 0, cacheWrite: 4, totalTokens: 104 });
	if (boundary === "heartbeat") harness.heartbeat(); else await harness.emit("model_select");
	// Then
	assert.deepEqual(harness.updates.at(-1).usage.total, { input: 100, output: 0, cacheRead: 0, cacheWrite: 4, total: 104 });
	assert.equal(harness.updates.at(-1).usage.complete, true);
	assert.equal(scans, 1);
	harness.heartbeat();
	await harness.emit("tool_execution_update", { toolName: "subagent_run", toolCallId: "unknown" });
	assert.equal(scans, 1);
});

test("shouldContainSourceFailureWithoutAffectingNativeUiWhenDefaultPublishingStarts", async (t) => {
	// Given
	const harness = await workbenchHarness(t, { rejectSource: true });
	// When
	await harness.emit("session_start");
	await harness.emit("turn_end");
	// Then
	assert.deepEqual({ calls: harness.calls, updates: harness.updates }, { calls: ["resolve"], updates: [] });
	assert.equal(harness.uiCalls.filter(row => row[0] === "notify" && /Workbench/.test(row[1])).length, 1);
});

test("shouldContainWorkbenchSourceFailureWithoutChangingNativeUiOrTools", async (t) => {
	// Given
	const harness = await workbenchHarness(t, { flag: false, rejectSource: true });
	await harness.emit("session_start");
	// When
	await harness.command("enable");
	await harness.emit("turn_end");
	// Then
	assert.deepEqual(harness.calls, ["resolve"]);
	assert.deepEqual(harness.updates, []);
	assert.ok(harness.uiCalls.some(row => row[0] === "notify" && /Workbench/.test(row[1])));
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
		publisherDefault: extension.flags.get("orchestraitor-workbench")?.default, calls },
		{ tools: ["orchestraitor_tasks", "orchestraitor_ask"], shortcuts: [], publisherDefault: true, calls: [] });
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
