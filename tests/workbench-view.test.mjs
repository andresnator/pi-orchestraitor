import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import test from "node:test";
import { importTui } from "../scripts/pi-host.mjs";
import { createWorkbenchApp } from "../herdr/workbench/app.mjs";
import { placement } from "../herdr/workbench/view.mjs";
import { PALETTES, selectPalette } from "../herdr/workbench/palette.mjs";
import { projectSessionUsage } from "../extensions/ui/workbench-usage.mjs";
import { validateWorkbenchSnapshot } from "../extensions/ui/workbench-contract.mjs";
import { importHost } from "./helpers/pi-host.mjs";
const ui = await importTui();
const { renderLayoutFrame } = await importHost("node_modules/@earendil-works/pi-tui/dist/layout.js");
function sample() {
	return { version: 1, publisher: { instance: "source", pid: process.pid, pane: "origin", workspace: "workspace", socket: "/socket", project: "/demo-project", session: "session", generation: 1, sequence: 1, publishedAt: Date.now() },
		tasks: { revision: 1, bindingCurrent: false, rows: [{ id: "a", title: "Long Unicode café 日本語 🧩 ".repeat(5), status: "blocked", reason: "Await explicit verification" }, { id: "b", title: "Completed task", status: "done", group: "Contract", evidence: "Verified marker" }] },
		agents: { live: [{ id: "r", label: "Read evidence", role: "review", phase: "running", requestedModel: "openai-codex/current" }], recent: [], launchBlocked: false, historyLimited: false, nestedHistoryUnavailable: false }, usage: projectSessionUsage([]) };
}

test("shouldFitAllApprovedTabsAcrossNarrowShortUnicodeAndPaletteMatrix", () => {
	// Given
	let checked = 0;
	// When
	for (const palette of Object.keys(PALETTES)) for (const width of [1, 20, 40, 48, 80, 120]) for (const height of [8, 13, 24, 40]) {
		const app = createWorkbenchApp(ui, { palette, colorMode: "truecolor", getRows: () => height });
		app.update({ status: "live", snapshot: sample() });
		for (const tab of ["1", "2", "3", "4"]) {
			app.handleInput(tab);
			const frame = app.renderDocument(width);
			// Then
			assert.ok(frame.every(line => ui.visibleWidth(line) <= width), `${palette}/${width}/${height}/${tab}`);
			if (width >= 48) assert.match(stripVTControlCharacters(frame.join("\n")), height < 10 ? /Too small/ : /ORCHESTRAITOR/);
			checked++;
		}
	}
	assert.equal(checked, 288);
});

test("shouldRetainApprovedPalettesGeometryAndCardTreatment", async () => {
	// Given
	const approved = await import("./fixtures/workbench-preview.mjs");
	const app = createWorkbenchApp(ui, { palette: "nord", colorMode: "truecolor" }); app.update({ status: "live", snapshot: sample() });
	// When / Then
	assert.deepEqual(PALETTES, approved.PALETTES);
	assert.deepEqual([[131, 24], [130, 25], [80, 25], [79, 25], [80, 24]].map(([width, height]) => placement(width, height)), ["right", "down", "down", "unavailable", "unavailable"]);
	assert.match(stripVTControlCharacters(app.renderDocument(80).join("\n")), /╭ CONTEXT/);
	assert.match(stripVTControlCharacters(app.renderDocument(80).join("\n")), /╭ RECORDED SESSION/);
});

test("shouldRenderAllBoundedRowsAndLongDetailsWithoutDroppingUsageOverflow", () => {
	// Given
	const snapshot = sample();
	snapshot.tasks.rows = Array.from({ length: 50 }, (_, index) => ({ id: `t${index}`, title: "界".repeat(200), status: "blocked", reason: "界".repeat(1000), evidence: "界".repeat(1000) }));
	const agent = (_, index) => ({ id: `a${index}`, role: "review", label: "界".repeat(200), phase: "completed", terminated: true, diagnostic: "界".repeat(1000) });
	snapshot.agents.live = Array.from({ length: 2 }, agent); snapshot.agents.recent = Array.from({ length: 20 }, agent);
	snapshot.usage = projectSessionUsage(Array.from({ length: 150 }, (_, index) => ({ id: `u${index}`, type: "usage", provider: "openai-codex", model: `model-${index}`, usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10 } })));
	const app = createWorkbenchApp(ui, { palette: "mono" }); app.update({ status: "live", snapshot });
	// When / Then
	for (const tab of ["1", "2", "3", "4"]) {
		app.handleInput(tab);
		for (const width of [48, 80, 120]) assert.ok(app.renderDocument(width).every(row => ui.visibleWidth(row) <= width));
	}
	const usage = app.renderDocument(80).join("\n");
	assert.match(usage, /Other Codex models · 50/);
	assert.match(usage, /Native recorded total\s+1,500/);
	app.handleInput("2"); app.handleInput("\r");
	assert.ok(app.renderDocument(48).every(row => ui.visibleWidth(row) <= 48));
});

test("shouldPreserveSelectedTaskAndScrollWhenLiveDataChanges", () => {
	// Given
	const app = createWorkbenchApp(ui, { palette: "mono" });
	const snapshot = sample(); app.update({ status: "live", snapshot });
	app.handleInput("2"); app.handleInput("\r");
	const selected = app.state.selected[1];
	app.scroll.updateLayout(100, 10, () => {}); app.handleInput("\x1b[6~");
	const offset = app.scroll.scrollTop;
	// When
	snapshot.tasks.rows.unshift({ id: "new", title: "New urgent task", status: "blocked" }); snapshot.publisher.sequence++;
	app.update({ status: "live", snapshot });
	// Then
	assert.equal(app.state.selected[1], selected);
	assert.equal(app.state.detail, true);
	assert.equal(app.scroll.scrollTop, offset);
	assert.match(stripVTControlCharacters(app.renderDocument(80).join("\n")), /Await explicit verification/);
});

test("shouldSelectNearestRemainingRowWhenSelectedTaskDisappearsWithoutOpeningIt", () => {
	// Given
	const snapshot = sample(); snapshot.tasks.rows = ["one", "two", "three"].map(id => ({ id, title: id, status: "pending" }));
	const app = createWorkbenchApp(ui, { palette: "mono" }); app.update({ status: "live", snapshot }); app.handleInput("2"); app.handleInput("\x1b[B"); app.handleInput("\x1b[B");
	// When
	snapshot.tasks.rows.pop(); snapshot.publisher.sequence++; app.update({ status: "live", snapshot });
	// Then
	assert.deepEqual({ selected: app.state.selected[1], detail: app.state.detail }, { selected: "task:two", detail: false });
});

for (const tab of ["2", "3"]) test(`shouldNavigateTheVisibleListAfterTabLeavesDetailFocusInTab${tab}`, () => {
	// Given
	const snapshot = sample(); snapshot.tasks.bindingCurrent = true;
	snapshot.tasks.rows = ["Alpha", "Beta"].map(id => ({ id, title: `${id} task`, status: "pending", reason: `${id} evidence ` + "recorded detail ".repeat(50) }));
	snapshot.agents.live = ["Alpha", "Beta"].map(id => ({ id, label: `${id} agent`, role: "review", phase: "running", diagnostic: `${id} evidence ` + "recorded detail ".repeat(50) }));
	validateWorkbenchSnapshot(snapshot);
	const before = structuredClone(snapshot);
	const app = createWorkbenchApp(ui, { palette: "mono", getRows: () => 24 });
	app.update({ status: "live", snapshot }); app.handleInput(tab); app.handleInput("\r");
	const render = () => stripVTControlCharacters(renderLayoutFrame(app.root, 48, 24, () => {}).lines.join("\n"));
	assert.match(render(), /DETAILS/);
	const first = app.state.selected[Number(tab) - 1];
	app.handleInput("\x1b[B");
	assert.equal(app.state.selected[Number(tab) - 1], first);
	assert.ok(app.scroll.scrollTop > 0);
	// When: key transitions may arrive without an intervening render.
	app.handleInput("\t"); app.handleInput("\x1b[B");
	// Then
	assert.equal(app.state.focus, "list");
	const second = app.state.selected[Number(tab) - 1];
	assert.notEqual(second, first);
	assert.match(render(), tab === "2" ? /› · Beta task/ : /› ~ review · Beta agent/);
	assert.doesNotMatch(render(), /DETAILS/);
	app.handleInput("\t");
	assert.equal(app.state.focus, "detail");
	assert.match(render(), /Beta evidence/);
	app.handleInput("\x1b[B");
	assert.equal(app.state.selected[Number(tab) - 1], second);
	assert.ok(app.scroll.scrollTop > 0);
	app.handleInput("\t"); app.handleInput("\x1b[A");
	assert.equal(app.state.selected[Number(tab) - 1], first);
	assert.match(render(), tab === "2" ? /› · Alpha task/ : /› ~ review · Alpha agent/);
	app.handleInput("\r"); assert.match(render(), /Alpha evidence/);
	app.handleInput("\x1b");
	assert.deepEqual({ focus: app.state.focus, detail: app.state.detail }, { focus: "list", detail: false });
	assert.deepEqual(snapshot, before);
});

test("shouldKeepListFocusWhenDetailNavigationReachesACompletedGroup", () => {
	// Given
	const snapshot = sample();
	const app = createWorkbenchApp(ui, { palette: "mono" });
	app.update({ status: "live", snapshot }); app.handleInput("2"); app.handleInput("\r");
	// When
	app.handleInput("\t"); app.handleInput("\x1b[B"); app.handleInput("\t");
	// Then: a group header has no detail card, so Tab must keep list navigation.
	assert.deepEqual({ focus: app.state.focus, detail: app.state.detail, selected: app.state.selected[1] }, { focus: "list", detail: false, selected: "group:Contract" });
	assert.match(app.renderDocument(80).join("\n"), /› ▸ Completed/);
	app.handleInput("\r"); app.handleInput("\x1b[B"); app.handleInput("\r");
	assert.match(app.renderDocument(80).join("\n"), /Verified marker/);
});

for (const tab of ["2", "3"]) test(`shouldKeepSelectedRowVisibleWithWrappedTitlesWarningsAndGroupsInTab${tab}`, () => {
	// Given
	let height = 24, width = 48;
	const snapshot = sample();
	snapshot.tasks.rows = Array.from({ length: 8 }, (_, index) => ({ id: `t${index}`, title: `Task ${index} ` + "long task title ".repeat(12), status: index >= 6 ? "done" : "pending", ...(index >= 6 ? { group: "Verification", evidence: "Verified fixture" } : {}) }));
	snapshot.agents.launchBlocked = true; snapshot.agents.historyLimited = true;
	snapshot.agents.live = [];
	snapshot.agents.recent = Array.from({ length: 8 }, (_, index) => ({ id: `a${index}`, label: `Agent ${index} ` + "long agent label ".repeat(11), role: "review", phase: "completed", terminated: true }));
	validateWorkbenchSnapshot(snapshot);
	const app = createWorkbenchApp(ui, { palette: "mono", getRows: () => height });
	app.update({ status: "stale", snapshot }); app.handleInput(tab);
	const render = () => stripVTControlCharacters(renderLayoutFrame(app.root, width, height, () => {}).lines.join("\n"));
	const assertSelectedVisible = () => {
		const frame = render();
		assert.match(frame, /›/);
		const selected = app.state.selected[Number(tab) - 1];
		if (selected.startsWith("task:")) assert.match(frame, new RegExp(`› [·✓] Task ${selected.slice(-1)}`));
		else if (selected.startsWith("agent:")) assert.match(frame, new RegExp(`› ✓ review · Agent ${selected.split(":")[2].slice(-1)}`));
		else assert.match(frame, /› [▸▾] Completed/);
	};
	render();
	// When / Then: navigate below the viewport and back through rows of different heights.
	for (let index = 0; index < 6; index++) { app.handleInput("\x1b[B"); assertSelectedVisible(); }
	if (tab === "2") {
		app.handleInput("\r"); render();
		for (let index = 0; index < 2; index++) { app.handleInput("\x1b[B"); assertSelectedVisible(); }
	}
	for (let index = 0; index < 8; index++) { app.handleInput("\x1b[A"); assertSelectedVisible(); }
	// Several keys can arrive before another render, which also changes the wrapping width.
	for (let index = 0; index < 4; index++) app.handleInput("\x1b[B");
	width = 80; height = 13; assertSelectedVisible();
});

test("shouldColorBlockedStateSymbolWithoutColoringBodyTextRed", (t) => {
	// Given
	const original = Object.fromEntries(["NO_COLOR", "TERM", "COLORTERM"].map(name => [name, process.env[name]]));
	t.after(() => {
		for (const [name, value] of Object.entries(original)) {
			if (value === undefined) delete process.env[name]; else process.env[name] = value;
		}
	});
	delete process.env.NO_COLOR;
	process.env.TERM = "xterm-256color"; process.env.COLORTERM = "truecolor";
	const app = createWorkbenchApp(ui, { palette: "nord", colorMode: "truecolor" }); app.update({ status: "live", snapshot: sample() }); app.handleInput("2");
	// When
	const frame = app.renderDocument(80).join("\n");
	// Then
	assert.match(frame, /\x1b\[38;2;191;97;106m[\s\S]{0,50}!/);
	assert.match(frame, /Long Unicode/);
});

test("shouldExpandCompletedGroupsWithoutMutatingNativeTasksOrClaimingAcceptance", () => {
	// Given
	const snapshot = sample(); const before = structuredClone(snapshot);
	const app = createWorkbenchApp(ui, { palette: "mono" }); app.update({ status: "live", snapshot }); app.handleInput("2");
	// When
	app.handleInput("\x1b[B"); app.handleInput("\r"); app.handleInput("\x1b[B"); app.handleInput("\r");
	// Then
	assert.match(app.renderDocument(80).join("\n"), /Verified marker/);
	assert.deepEqual(snapshot, before);
	app.handleInput("3"); app.handleInput("\r");
	assert.match(app.renderDocument(80).join("\n"), /not.*acceptance|NOT.*acceptance/);
});

test("shouldDistinguishUnknownZeroUnsupportedStaleAndDisconnectedReadings", () => {
	// Given
	const app = createWorkbenchApp(ui, { palette: "mono" }); const snapshot = sample();
	app.update({ status: "live", snapshot });
	// When / Then
	assert.match(app.renderDocument(80).join("\n"), /Awaiting context reading/);
	assert.match(app.renderDocument(80).join("\n"), /0 tokens/);
	snapshot.usage.context = { status: "estimated", tokens: 0, capacity: 100, percent: 0 };
	app.update({ status: "live", snapshot });
	assert.match(app.renderDocument(80).join("\n"), /0 \/ 100.*0%/);
	snapshot.usage.context = { status: "unsupported" }; app.update({ status: "stale", snapshot });
	assert.match(app.renderDocument(80).join("\n"), /STALE/);
	assert.match(app.renderDocument(80).join("\n"), /outside Codex scope/);
	app.update({ status: "live", snapshot: { ...snapshot, publisher: { ...snapshot.publisher, instance: "replacement" } } });
	assert.match(app.renderDocument(80).join("\n"), /DISCONNECTED/);
});

test("shouldOfferOnlyLocalNavigationAndRestoreBoundedViewState", () => {
	// Given
	const app = createWorkbenchApp(ui, { palette: "mono" }); app.update({ status: "live", snapshot: sample() }); app.handleInput("2"); app.handleInput("\r");
	// When
	const local = app.exportState(); const restored = createWorkbenchApp(ui, { palette: "mono", initialState: local }); restored.update({ status: "live", snapshot: sample() });
	// Then
	assert.equal(restored.state.tab, 1); assert.equal(restored.state.detail, true);
	assert.equal(restored.handleInput("q"), "quit");
	assert.ok(JSON.stringify(local).length < 16384);
	assert.doesNotMatch(JSON.stringify(local), /Await explicit|model|prompt|command/);
	assert.equal(selectPalette("nord", { NO_COLOR: "" }).name, "mono");
	assert.throws(() => selectPalette("unknown", {}), /palette/i);
});
