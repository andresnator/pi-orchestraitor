import assert from "node:assert/strict";
import test from "node:test";
import { createHerdrClient, invocationContext } from "../herdr/workbench/herdr-client.mjs";
import { createWorkbenchActions } from "../herdr/workbench/actions.mjs";

function harness() {
	const source = { instance: "instance", pid: 11, pane: "origin", workspace: "workspace", socket: "/socket", project: "/same-project", session: "session", generation: 1, sequence: 1, publishedAt: Date.now() };
	const context = { socket: source.socket, pane: source.pane, workspace: source.workspace, tab: "tab" };
	const state = { owner: undefined, pending: false, focused: "origin", companion: undefined, width: 180, height: 40, direction: "right", ratio: 0.5, calls: [], source, next: 0, mismatch: false, moved: false, failOpen: false };
	let queue = Promise.resolve();
	const store = { readSnapshot: async () => ({ status: "live", snapshot: { publisher: source } }), readOwnership: async () => state.owner,
		writeOwnership: async owner => { state.owner = structuredClone(owner); }, clearOwnership: async () => { state.owner = undefined; },
		claim: async () => { if (state.pending) throw new Error("uncertain open"); state.pending = true; }, clearClaim: async () => { state.pending = false; },
		lock: operation => { const pending = queue.then(operation); queue = pending.catch(() => {}); return pending; } };
	const pane = id => ({ pane_id: id, workspace_id: "workspace", tab_id: state.moved && id !== "origin" ? "moved" : "tab", terminal_id: `terminal-${id}`, focused: state.focused === id });
	const layout = () => {
		const area = { x: 0, y: 0, width: state.width, height: state.height };
		const root = { ...area }, child = { ...area };
		if (state.companion) {
			if (state.direction === "right") { root.width = Math.floor(area.width * state.ratio); child.x = root.width; child.width = area.width - root.width; }
			else { root.height = Math.floor(area.height * state.ratio); child.y = root.height; child.height = area.height - root.height; }
		}
		return { workspace_id: "workspace", tab_id: "tab", zoomed: false, focused_pane_id: state.focused, area: { ...area, height: area.height + 10 },
			panes: [{ pane_id: "origin", rect: root }, ...(state.companion ? [{ pane_id: state.companion, rect: child }] : []), { pane_id: "reviewr", rect: { x: 0, y: state.height, width: state.width, height: 10 } }],
			splits: [...(state.companion ? [{ id: "owned", direction: state.direction, ratio: state.ratio, rect: area }] : []), { id: "foreign", direction: "down", ratio: 0.8, rect: { ...area, height: area.height + 10 } }] };
	};
	const client = { mainPath: "/plugin/main.mjs", pane: async id => id === "origin" || id === state.companion ? pane(id) : undefined, layout: async () => layout(),
		processes: async id => ({ pane_id: id, foreground_processes: id === "origin" ? [{ pid: 11, argv: ["node", "pi"] }] : [{ pid: state.mismatch ? 99 : 22, argv: ["node", "/plugin/main.mjs", "--socket", source.socket, "--origin", "origin", "--source", source.instance, "--token", state.token] }] }),
		open: async (_source, direction, token, localState) => { state.calls.push(["open", direction, localState]); if (state.failOpen) throw new Error("uncertain response"); state.companion = `owned-${++state.next}`; state.token = token; state.direction = direction; state.ratio = 0.5; return { plugin_id: "pi.orchestraitor", entrypoint: "workbench", pane: pane(state.companion) }; },
		focus: async id => { state.calls.push(["focus", id]); state.focused = id; return { plugin_id: "pi.orchestraitor", entrypoint: "workbench", pane: pane(id) }; },
		focusOrigin: async (_pane, _direction, origin) => { state.calls.push(["return", origin]); state.focused = origin; },
		close: async id => { assert.equal(id, state.companion); state.calls.push(["close", id]); state.companion = undefined; if (state.focused === id) state.focused = "origin"; return id; },
		resize: async (_id, _direction, amount) => { state.calls.push(["resize", amount]); state.ratio += amount; return layout(); } };
	const storage = async (_socket, origin) => origin === "origin" ? store : { readSnapshot: async () => ({ status: "disconnected" }), readOwnership: async () => undefined };
	return { state, context, client, actions: createWorkbenchActions({ client, storage }), layout };
}

test("shouldUseOnlyTargetPaneForNativeSplitOpenWithoutConflictingWorkspace", async () => {
	// Given
	let observed;
	const client = await createHerdrClient({ env: { HERDR_SOCKET_PATH: process.cwd(), PI_WORKBENCH_PALETTE: "light" }, run: async (_file, args, options) => {
		observed = { args, options }; assert.equal(args.includes("--workspace"), false);
		return { stdout: JSON.stringify({ result: { type: "plugin_pane_opened", plugin_pane: { pane: { pane_id: "owned" } } } }) };
	} });
	// When
	await client.open({ socket: "/socket", pane: "origin", workspace: "workspace", project: "/project with spaces", instance: "source" }, "right", "token");
	// Then
	assert.ok(observed.args.includes("--target-pane"));
	assert.ok(observed.args.includes("/project with spaces"));
	assert.ok(observed.args.includes("PI_WORKBENCH_PALETTE=light"));
	assert.deepEqual({ timeout: observed.options.timeout, maxBuffer: observed.options.maxBuffer, shell: observed.options.shell }, { timeout: 2500, maxBuffer: 262144, shell: undefined });
});

test("shouldRejectAmbiguousNativeCliContextAndMismatchedExplicitCaller", async () => {
	// Given
	const env = { HERDR_ENV: "1", HERDR_SOCKET_PATH: process.cwd(), HERDR_PANE_ID: "origin", HERDR_WORKSPACE_ID: "workspace", HERDR_TAB_ID: "tab", HERDR_PLUGIN_ID: "pi.orchestraitor",
		HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ invocation_source: "cli", focused_pane_id: "origin", workspace_id: "workspace", tab_id: "tab" }) };
	// When / Then
	await assert.rejects(invocationContext(env), /Ambiguous/);
	await assert.rejects(invocationContext(env, "foreign"), /caller/);
	assert.equal((await invocationContext(env, "origin")).pane, "origin");
});

test("shouldOpenOnlyOwnedPairAndReturnFocusWhenToggledFromCompanion", async () => {
	// Given
	const { state, context, actions, layout } = harness(); const foreign = layout().panes.at(-1);
	// When
	await actions.run("toggle", context);
	assert.equal(state.owner.companion.pane, state.companion);
	assert.deepEqual(layout().panes.at(-1), foreign);
	await actions.run("toggle", { ...context, pane: state.companion });
	// Then
	assert.equal(state.companion, undefined);
	assert.equal(state.owner, undefined);
	assert.equal(state.focused, "origin");
	assert.equal(state.calls.filter(call => call[0] === "open").length, 1);
});

test("shouldSerializeRapidActionsWithoutOpeningDuplicatePanes", async () => {
	// Given
	const { state, context, actions } = harness();
	// When
	await Promise.all([actions.run("toggle", context), actions.run("toggle", context)]);
	// Then
	assert.equal(state.calls.filter(call => call[0] === "open").length, 1);
	assert.equal(state.calls.filter(call => call[0] === "close").length, 1);
});

for (const change of ["mismatch", "moved"]) test(`shouldRefuseToCloseWhenOwnershipIs${change}`, async () => {
	// Given
	const { state, context, actions } = harness(); await actions.run("open", context); state[change] = true;
	// When / Then
	await assert.rejects(actions.run("close", context));
	assert.equal(state.calls.filter(call => call[0] === "close").length, 0);
});

test("shouldNeverGuessAnotherOriginFromSharedProjectOrForeignCaller", async () => {
	// Given
	const { state, context, actions } = harness(); await actions.run("open", context);
	// When / Then
	await assert.rejects(actions.run("toggle", { ...context, pane: "reviewr" }));
	assert.equal(state.calls.filter(call => call[0] === "close").length, 0);
});

test("shouldRetainUncertainOpenLeaseRatherThanRetryCreatingAnotherPane", async () => {
	// Given
	const { state, context, actions } = harness(); state.failOpen = true;
	// When / Then
	await assert.rejects(actions.run("open", context));
	await assert.rejects(actions.run("open", context));
	assert.equal(state.calls.filter(call => call[0] === "open").length, 1);
	assert.equal(state.pending, true);
});

test("shouldRelocateOnlyOwnedPairDownWithLocalStateAndPreservedForeignGeometry", async () => {
	// Given
	const { state, context, actions, layout } = harness(); await actions.run("open", context);
	state.width = 100; const foreign = layout().panes.at(-1); const old = state.companion;
	const localState = { tab: 2, selected: [], offsets: [] };
	// When
	await actions.run("relocate", { ...context, pane: old }, { localState });
	// Then
	assert.notEqual(state.companion, old);
	assert.equal(state.direction, "down");
	assert.deepEqual(layout().panes.at(-1), foreign);
	assert.deepEqual(state.calls.filter(call => call[0] === "open").at(-1), ["open", "down", localState]);
	assert.equal(state.focused, state.companion);
});

test("shouldNotStealForeignFocusToOpenAnExplicitCallerCompanion", async () => {
	// Given
	const { state, context, actions } = harness(); state.focused = "reviewr";
	// When / Then
	await assert.rejects(actions.run("open", context), /focus/i);
	assert.deepEqual(state.calls, []);
});

test("shouldCloseExactCompanionLocallyWhenSourceProcessHasExitedWithoutFocusingReplacement", async () => {
	// Given
	const { state, context, client, actions } = harness(); await actions.run("open", context);
	const processes = client.processes;
	client.processes = id => id === "origin" ? { pane_id: id, foreground_processes: [{ pid: 999, argv: ["shell"] }] } : processes(id);
	// When
	const result = await actions.run("close", { ...context, pane: state.companion });
	// Then
	assert.deepEqual(result, { status: "closed" });
	assert.equal(state.calls.filter(call => call[0] === "return").length, 0);
	assert.equal(state.companion, undefined);
});

test("shouldRemoveOnlyNewOwnedPaneWhenItsResizeFails", async () => {
	// Given
	const { state, context, client, actions, layout } = harness(); state.width = 140;
	const before = layout().panes.at(-1);
	client.resize = async () => { throw new Error("synthetic resize failure"); };
	// When / Then
	await assert.rejects(actions.run("open", context), /resize/);
	assert.equal(state.companion, undefined);
	assert.equal(state.owner, undefined);
	assert.deepEqual(layout().panes.at(-1), before);
});

test("shouldClearManualClosureWithoutClosingAReplacementOrForeignPane", async () => {
	// Given
	const { state, context, actions } = harness(); await actions.run("open", context);
	state.companion = undefined; state.focused = "origin";
	// When
	const result = await actions.run("close", context);
	// Then
	assert.deepEqual(result, { status: "already-closed" });
	assert.equal(state.owner, undefined);
	assert.equal(state.calls.filter(call => call[0] === "close").length, 0);
});

test("shouldRefuseTooSmallOriginBeforeChangingAnyPane", async () => {
	// Given
	const { state, context, actions } = harness(); state.width = 60; state.height = 15;
	// When / Then
	await assert.rejects(actions.run("open", context), /small/i);
	assert.deepEqual(state.calls, []);
});
