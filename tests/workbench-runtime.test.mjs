import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { importTui } from "../scripts/pi-host.mjs";
import { startWorkbench } from "../herdr/workbench/main.mjs";
const ui = await importTui();
function terminalFixture() {
	const events = [], writes = [];
	return { events, writes, columns: 80, rows: 24, kittyProtocolActive: false,
		start(input, resize) { this.input = input; this.resize = resize; events.push("start"); }, stop() { events.push("stop"); }, drainInput: async () => {},
		write(value) { writes.push(value); }, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {} };
}

test("shouldRunNativeStandaloneRendererAndRestoreTerminalWhenQuitIsLocal", async (t) => {
	// Given
	const terminal = terminalFixture(); let reads = 0, quit = 0;
	const runtime = await startWorkbench({ ui, terminal, palette: "mono", read: async () => { reads++; return { status: "disconnected" }; }, onQuit: () => { quit++; } });
	t.after(() => runtime.stop());
	// When
	await sleep(30); terminal.input("4"); await sleep(30); terminal.input("q");
	await sleep(10); runtime.stop();
	// Then
	assert.ok(reads >= 1);
	assert.deepEqual(terminal.events, ["start", "stop"]);
	assert.equal(quit, 1);
	assert.match(terminal.writes.join(""), /ORCHESTRAITOR/);
	assert.match(terminal.writes.join(""), /DISCONNECTED/);
});

test("shouldBoundPollConcurrencyAndDiscardLateReadsAfterStop", async (t) => {
	// Given
	const terminal = terminalFixture(); let resolveRead, reads = 0;
	const runtime = await startWorkbench({ ui, terminal, palette: "mono", read: () => { reads++; return new Promise(resolve => { resolveRead = resolve; }); } });
	t.after(() => runtime.stop());
	// When
	await sleep(280); runtime.stop(); resolveRead({ status: "error" }); await sleep(10);
	// Then
	assert.equal(reads, 1);
	assert.deepEqual(terminal.events, ["start", "stop"]);
});

test("shouldRestoreTerminalWhenNativeStartFails", async () => {
	// Given
	const terminal = terminalFixture(); terminal.start = () => { terminal.events.push("start"); throw new Error("synthetic terminal failure"); };
	// When / Then
	await assert.rejects(startWorkbench({ ui, terminal, palette: "mono", read: async () => ({ status: "disconnected" }) }), /synthetic/);
	assert.ok(terminal.events.includes("stop"));
});
