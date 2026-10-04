import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { loadUiModule, plainTheme, tui } from "./helpers/ui-harness.mjs";

const progress = (sequence, tasks, generation = 7, toolCallId = "call/1") =>
	({ version: 1, generation, toolCallId, sequence, tasks });
const observed = (id, phase = "running") =>
	({ id, role: "explore", label: "inspect " + id, requestedModel: "fixture/requested", phase });

test("shouldKeepInputOrderAndRejectStaleOrForeignUpdatesWhenBatchIsLive", async (t) => {
	// Given
	const { createAgentsProjection } = await loadUiModule(t, "extensions/ui/agents.ts");
	const view = createAgentsProjection();
	view.start("call/1", [{ role: "explore", instruction: "one" }, { role: "review", instruction: "two" }], "call");
	// When
	const accepted = view.update("call/1", progress(1, [observed("one", "starting"), { ...observed("two", "preparing"), role: "review" }]));
	const later = view.update("call/1", progress(2, [observed("one"), { ...observed("two"), role: "review", effectiveModel: "fixture/confirmed" }]));
	const validRows = [observed("one"), { ...observed("two"), role: "review" }];
	const rejected = [
		view.update("call/1", progress(1, validRows)),
		view.update("call/1", progress(3, validRows, 8)),
		view.update("unknown", progress(4, validRows, 7, "unknown")),
		view.update("call/1", progress(4, validRows, 7, "other")),
	];
	// Then
	assert.deepEqual({ accepted, later, rejected, rows: view.snapshot().live.map(({ id, phase, effectiveModel }) => ({ id, phase, effectiveModel })) },
		{ accepted: true, later: true, rejected: [false, false, false, false],
			rows: [{ id: "one", phase: "running", effectiveModel: undefined }, { id: "two", phase: "running", effectiveModel: "fixture/confirmed" }] });
	view.finish("call/1", { details: { results: [{ id: "one", role: "explore", status: "completed", terminated: true }] } });
	assert.equal(view.update("call/1", progress(5, [observed("late")])), false);
});

test("shouldReplayOnlyBranchOutcomesAndLimitHistoryWhenSessionChanges", async (t) => {
	// Given
	const { createAgentsProjection } = await loadUiModule(t, "extensions/ui/agents.ts");
	const view = createAgentsProjection();
	const entry = (id, status = "completed") => ({ type: "message", message: {
		role: "toolResult", toolName: "subagent_run", toolCallId: id,
		details: { results: [{ id, role: "explore", model: "fixture/model", status, terminated: status !== "termination_failed" }] },
	} });
	// When
	view.replay(Array.from({ length: 25 }, (_, index) => entry(String(index))));
	const previous = view.snapshot();
	view.start("nested/1", [{ role: "explore", instruction: "nested" }], "nested");
	view.finish("nested/1", { details: { results: [{ id: "nested", role: "explore", status: "completed", terminated: true }] } });
	view.replay([entry("branch", "failed")]);
	const branch = view.snapshot();
	// Then
	assert.deepEqual({ previousCount: previous.recent.length, limited: previous.historyLimited,
		branchIds: branch.recent.map(({ id }) => id), live: branch.live, nestedUnavailable: branch.nestedHistoryUnavailable },
		{ previousCount: 20, limited: true, branchIds: ["branch"], live: [], nestedUnavailable: true });
});

test("shouldClassifyStoppingAsLiveAndUnconfirmedExitAsFailureWhenProjecting", async (t) => {
	// Given
	const { classifyAgent } = await loadUiModule(t, "extensions/ui/agents.ts");
	// When
	const states = [
		{ phase: "preparing" }, { phase: "starting" }, { phase: "running" }, { phase: "stopping" },
		{ status: "completed", terminated: true }, { status: "completed", terminated: false },
		{ status: "timed_out", terminated: true }, { status: "failed" },
	].map(classifyAgent);
	// Then
	assert.deepEqual(states.map(({ phase, active, failed }) => ({ phase, active, failed })), [
		...["preparing", "starting", "running", "stopping"].map((phase) => ({ phase, active: true, failed: false })),
		{ phase: "completed", active: false, failed: false }, { phase: "termination_failed", active: false, failed: true },
		{ phase: "timed_out", active: false, failed: true }, { phase: "failed", active: false, failed: true },
	]);
});

test("shouldFollowAcceptedControllerBatchWhenPreparationOrderReverses", async (t) => {
	// Given
	const { createAgentsProjection } = await loadUiModule(t, "extensions/ui/agents.ts");
	const view = createAgentsProjection();
	view.start("slow", [{ role: "explore", instruction: "slow preparation" }]);
	view.start("accepted", [{ role: "explore", instruction: "first to acquire controller" }]);
	// When
	view.update("accepted", { ...progress(1, [observed("accepted-child")], 7, "accepted"), batchStarted: true });
	view.finish("slow", { content: [{ type: "text", text: "A subagent batch is already active" }] }, true);
	// Then
	assert.deepEqual({ live: view.snapshot().live.map(({ id }) => id),
		recent: view.snapshot().recent.map(({ phase, diagnostic }) => ({ phase, diagnostic })) },
		{ live: ["accepted-child"], recent: [{ phase: "failed", diagnostic: "A subagent batch is already active" }] });
});

test("shouldReplayNativeLaunchFailureWithoutInventingChildEvidenceWhenReceiptIsAnError", async (t) => {
	// Given
	const { createAgentsProjection } = await loadUiModule(t, "extensions/ui/agents.ts");
	const view = createAgentsProjection();
	const branch = [
		{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "rejected", name: "subagent_run",
			arguments: { tasks: [{ role: "explore", instruction: "inspect marker" }] } }] } },
		{ type: "message", message: { role: "toolResult", toolName: "subagent_run", toolCallId: "rejected", isError: true,
			content: [{ type: "text", text: "Model unavailable: fixture/missing" }] } },
	];
	// When
	view.replay(branch, "session", false);
	// Then
	const row = view.snapshot().recent[0];
	assert.deepEqual(row && { phase: row.phase, label: row.label, id: row.id, effective: row.effectiveModel, diagnostic: row.diagnostic },
		{ phase: "failed", label: "inspect marker", id: undefined, effective: undefined, diagnostic: "Model unavailable: fixture/missing" });
});

test("shouldDistinguishHistoricalUnconfirmedExitFromCurrentLockWhenReplaying", async (t) => {
	// Given
	const { createAgentsProjection } = await loadUiModule(t, "extensions/ui/agents.ts");
	const view = createAgentsProjection();
	const branch = [{ type: "message", message: { role: "toolResult", toolName: "subagent_run", toolCallId: "historical",
		details: { results: [{ id: "old", role: "explore", status: "termination_failed", terminated: false }] } } }];
	// When
	view.replay(branch, "fresh-host", false);
	const historical = view.snapshot();
	view.replay(branch, "same-poisoned-host", true);
	// Then
	assert.deepEqual({ historicalBlocked: historical.launchBlocked, historicalPhase: historical.recent[0].phase,
		actualBlocked: view.snapshot().launchBlocked }, { historicalBlocked: false, historicalPhase: "termination_failed", actualBlocked: true });
});

test("shouldRejectValidStaleSessionPacketsWhenBranchIsReplayed", async (t) => {
	// Given
	const { createAgentsProjection } = await loadUiModule(t, "extensions/ui/agents.ts");
	const view = createAgentsProjection();
	view.replay([], "new-session");
	view.start("call/1", [{ role: "explore", instruction: "inspect" }]);
	// When
	const old = view.update("call/1", { ...progress(1, [observed("one")]), sessionId: "old-session" });
	const current = view.update("call/1", { ...progress(1, [observed("one")]), sessionId: "new-session" });
	view.replay([], "new-session");
	const late = view.update("call/1", { ...progress(2, [observed("one")]), sessionId: "new-session" });
	// Then
	assert.deepEqual({ old, current, late, live: view.snapshot().live }, { old: false, current: true, late: false, live: [] });
});

test("shouldBoundConfirmedModelFallbackWhenNativeReceiptIsReplayed", async (t) => {
	// Given
	const { createAgentsProjection } = await loadUiModule(t, "extensions/ui/agents.ts");
	const view = createAgentsProjection();
	const model = "m".repeat(10000);
	// When
	view.replay([{ type: "message", message: { role: "toolResult", toolName: "subagent_run", toolCallId: "call",
		details: { results: [{ id: "one", role: "explore", status: "completed", terminated: true, model }] } } }]);
	// Then
	assert.deepEqual({ requested: view.snapshot().recent[0].requestedModel.length,
		confirmed: view.snapshot().recent[0].effectiveModel.length }, { requested: 200, confirmed: 200 });
});

test("shouldBoundReadOnlyPanelAndSanitizeOnlyDisplayWhenLabelsAreUntrusted", async (t) => {
	// Given
	const { createAgentsPanel } = await loadUiModule(t, "extensions/ui/agents.ts");
	const label = "Unicode 你好 é \x1b]52;c;secret\x07".repeat(30);
	const snapshot = { live: [observed("one", "stopping")], recent: [{ ...observed("two", "failed"), label, diagnostic: label }], historyLimited: true, nestedHistoryUnavailable: true };
	const terminal = { rows: 16 };
	let closed;
	const keys = { matches: (data, action) => data === action };
	const panel = createAgentsPanel(() => snapshot, { terminal, requestRender() {} }, plainTheme, keys, (value) => { closed = value; });
	// When
	const rendered = [1, 20, 40, 80, 120].map((width) => panel.render(width));
	panel.handleInput("tui.select.pageDown");
	panel.handleInput("\x1b");
	// Then
	assert.ok(rendered.every((lines, i) => lines.length <= 9 && lines.every((line) => tui.visibleWidth(line) <= [1, 20, 40, 80, 120][i])));
	assert.ok(rendered.every((lines) => lines.every((line) => !/[\x00-\x1f\x7f-\x9f]/u.test(stripVTControlCharacters(line)) && !line.includes("\x1b]52"))));
	assert.deepEqual(closed, { status: "closed" });
	assert.equal(snapshot.recent[0].label, label);
});
