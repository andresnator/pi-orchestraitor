import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createPackageUISession, importHost, loadUiModule, plainTheme, tui } from "./helpers/ui-harness.mjs";
import { isolatedAgentDir } from "./helpers/pi-host.mjs";
import { paths, snapshot } from "../extensions/models/store.mjs";

const { KeybindingsManager } = await importHost("dist/core/keybindings.js");
const keys = new KeybindingsManager();
const enter = "\r", down = "\x1b[B", up = "\x1b[A", right = "\x1b[C", backspace = "\x7f", escape = "\x1b";
const terminal = () => ({ terminal: { rows: 24, columns: 80 }, requestRender() {} });
const model = { provider: "nan", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", api: "openai-completions", reasoning: true };

test("profile selector uses native fuzzy matching for model names, IDs, providers and tokens", async t => {
	const { createSearchableSelector } = await loadUiModule(t, "extensions/models/selector.ts");
	const options = ["inherit", "openai-codex/gpt-6.1-sol", "nan/deepseek-v4-flash", "nan/other"];
	for (const query of ["DeepSeek V4 Flash", "deep flash", "nan/deepseek", "NAN DEEP", "dsv4fl"]) {
		const outcomes = [];
		const component = createSearchableSelector("Models", options, terminal(), plainTheme, keys, value => outcomes.push(value), {
			"nan/deepseek-v4-flash": "nan nan/deepseek-v4-flash nan deepseek-v4-flash DeepSeek V4 Flash",
		});
		component.handleInput(query);
		const frame = component.render(80).join("\n");
		assert.match(frame, /nan\/deepseek-v4-flash/);
		assert.doesNotMatch(frame, /gpt-6\.1-sol/);
		component.handleInput(enter);
		assert.deepEqual(outcomes, ["nan/deepseek-v4-flash"]);
	}
});

test("empty searches cannot select and editing, arrows and cancellation remain native", async t => {
	const { createSearchableSelector } = await loadUiModule(t, "extensions/models/selector.ts");
	const outcomes = [];
	const component = createSearchableSelector("Scope", ["personal", "project"], terminal(), plainTheme, keys, value => outcomes.push(value));
	component.focused = true;
	component.handleInput("zzz");
	assert.match(component.render(80).join("\n"), /No matches/);
	component.handleInput(enter); component.handleInput(down); component.handleInput(up);
	assert.deepEqual(outcomes, []);
	for (let i = 0; i < 3; i++) component.handleInput(backspace);
	component.handleInput("proj"); // j is search text, just as in Pi's /model selector.
	component.handleInput(enter);
	assert.deepEqual(outcomes, ["project"]);
	component.handleInput(escape); component.dispose(); component.handleInput(enter);
	assert.deepEqual(outcomes, ["project"]);
	const cancel = createSearchableSelector("Actions", ["Rename", "Duplicate"], terminal(), plainTheme, keys, value => outcomes.push(value));
	cancel.handleInput("ren"); cancel.handleInput(escape);
	assert.deepEqual(outcomes, ["project", undefined]);
	const wrapping = createSearchableSelector("Modes", ["inherit", "sync", "background"], terminal(), plainTheme, keys, value => outcomes.push(value));
	wrapping.handleInput(up); wrapping.handleInput(enter);
	assert.equal(outcomes.at(-1), "background");
});

test("search focus, selection and details survive narrow terminal resizing", async t => {
	const { createSearchableSelector } = await loadUiModule(t, "extensions/models/selector.ts");
	const screen = terminal(), outcomes = [];
	const component = createSearchableSelector("Effective assignments\n" + "日本語 café 🧩 ".repeat(30),
		Array.from({ length: 30 }, (_, i) => `profile-${i}`), screen, plainTheme, keys, value => outcomes.push(value));
	component.focused = true;
	component.handleInput(down); component.handleInput(down);
	for (const rows of [12, 24]) for (const width of [1, 20, 52, 120]) {
		screen.terminal.rows = rows;
		component.invalidate();
		const frame = component.render(width);
		assert.ok(frame.length <= rows - 6, `height ${frame.length} at ${width}x${rows}`);
		assert.ok(frame.every(line => tui.visibleWidth(line) <= width), `width ${width}`);
		if (width > 1) assert.match(frame.join("\n"), new RegExp(tui.CURSOR_MARKER));
	}
	component.handleInput("\x1b[6~"); // Scroll wrapped details while retaining the chosen row.
	component.handleInput(enter);
	assert.deepEqual(outcomes, ["profile-2"]);
});

test("every models-profiles screen uses searchable terminal components without model calls", async t => {
	const { session, errors } = await createPackageUISession(t, "tui");
	const command = session.extensionRunner.getCommand("models-profiles");
	const ctx = session.extensionRunner.createCommandContext();
	// A pair searches a menu; an object drives the combined model, effort, mode, time limit and parallelism picker.
	const choices = [
		["cre", "Create profile"], ["expl", /^ {2}explore /],
		{ keys: ["DeepSeek V4 Flash", right, down], expected: { model: "nan/deepseek-v4-flash", reasoning: "off", mode: null, timeout: null, parallel: null } },
		["review", /^ {2}review .* · ↳ 10m · ↳ max 5$/], { keys: [right, right, down, down, right, down, right, down, down], expected: { model: null, reasoning: null, mode: "background", timeout: "off", parallel: 2 } },
		["save apply", "Save and apply"],
		["demo", "1. ● Search Demo"], ["ren", "Rename"], ["dup", "Duplicate"], ["save profile", "Save profile"],
		["eff", "Effective assignments"], ["bac", "Back"], ["ref", "Refresh catalog"], ["close", "Close"],
	];
	const names = ["Search Demo", "Renamed draft", "Second profile"];
	const notifications = [], confirmations = [];
	let refreshes = 0;
	await command.handler("", { ...ctx, model, isProjectTrusted: () => true,
		modelRegistry: { getAvailable: () => [model], async refresh() { refreshes++; } },
		ui: { ...ctx.ui,
			select() { assert.fail("Terminal profile menus must use the searchable component"); },
			async custom(factory) {
				let outcome, finished = false;
				const component = factory(terminal(), plainTheme, keys, value => { outcome = value; finished = true; });
				const next = choices.shift() ?? assert.fail("Unexpected menu");
				component.focused = true;
				component.render(80);
				for (const key of Array.isArray(next) ? [next[0]] : next.keys) component.handleInput(key);
				component.handleInput(enter);
				assert.equal(finished, true, JSON.stringify(next));
				if (Array.isArray(next)) next[1] instanceof RegExp ? assert.match(outcome, next[1]) : assert.equal(outcome, next[1], next[0]);
				else assert.deepEqual(outcome, next.expected);
				component.dispose();
				return outcome;
			},
			async input() { return names.shift(); },
			async confirm(title, message) { confirmations.push([title, message]); return true; },
			notify(message, level) { notifications.push([message, level]); },
		},
	});
	assert.deepEqual(errors, []);
	assert.equal(choices.length, 0); assert.equal(names.length, 0); assert.equal(refreshes, 1);
	assert.equal(confirmations.length, 2);
	assert.ok(notifications.every(([, level]) => level === "info"), JSON.stringify(notifications));
	const files = paths(isolatedAgentDir, ctx.cwd);
	assert.deepEqual((await snapshot(files.personal)).data.assignments, { explore: { model: "nan/deepseek-v4-flash", reasoning: "off" }, review: { mode: "background", timeout: "off", parallel: 2 } });
	assert.deepEqual((await snapshot(files.profiles)).data.profiles.map(profile => profile.name), ["Search Demo", "Second profile"]);
	assert.equal(session.sessionManager.getEntries().filter(entry => entry.type === "message").length, 0);
	// The searched value, not its filtered position or display name, is persisted.
	assert.match(await readFile(files.profiles, "utf8"), /nan\/deepseek-v4-flash/);
});

const catalog = [model, { provider: "nan", id: "plain", name: "Plain", reasoning: false }, { provider: "openai-codex", id: "gpt-6.1-sol", name: "Sol", reasoning: true }];
const supported = item => item.reasoning ? ["off", "low", "medium", "high"] : ["off"];
function picker(createAssignmentPicker, request, screen = terminal()) {
	const outcomes = [];
	const component = createAssignmentPicker({ role: "explore", current: { model: null, reasoning: null, mode: null }, inherited: { model: "nan/deepseek-v4-flash", reasoning: "high", mode: "sync" },
		catalog, supported, modes: ["sync", "background"], ...request }, screen, plainTheme, keys, value => outcomes.push(value));
	component.focused = true;
	return { component, outcomes, frame: (width = 80) => component.render(width).join("\n") };
}

test("the combined picker chooses model, effort and mode in one step", async t => {
	const { createAssignmentPicker } = await loadUiModule(t, "extensions/models/selector.ts");
	const { component, outcomes, frame } = picker(createAssignmentPicker);
	assert.match(frame(), /1 MODEL/); assert.match(frame(), /2 EFFORT/); assert.match(frame(), /3 MODE/);
	assert.match(frame(), /inherit \(nan\/deepseek-v4-flash\)/);
	component.handleInput("sol");
	assert.doesNotMatch(frame(), /nan\/plain/);
	component.handleInput(right); component.handleInput(down); component.handleInput(down);
	component.handleInput(right); component.handleInput(down); component.handleInput(down);
	assert.match(frame(), /result openai-codex\/gpt-6\.1-sol · low · background/);
	component.handleInput(enter);
	assert.deepEqual(outcomes, [{ model: "openai-codex/gpt-6.1-sol", reasoning: "low", mode: "background" }]);
});

test("effort follows the chosen model and the session has no mode column", async t => {
	const { createAssignmentPicker } = await loadUiModule(t, "extensions/models/selector.ts");
	const { component, outcomes, frame } = picker(createAssignmentPicker, { role: "session", modes: [], current: { model: "nan/deepseek-v4-flash", reasoning: "medium" }, inherited: { model: "nan/deepseek-v4-flash", reasoning: "high" } });
	assert.doesNotMatch(frame(), /3 MODE/); assert.match(frame(), /★ session/); assert.match(frame(), /keep current/);
	component.handleInput(down); // nan/plain supports only off, so medium cannot survive.
	assert.match(frame(), /result nan\/plain · off/);
	component.handleInput(right); component.handleInput(up);
	assert.match(frame(), /result nan\/plain · keep current \(high\)/);
	component.handleInput(enter);
	assert.deepEqual(outcomes, [{ model: "nan/plain", reasoning: null }]);
	const cancel = picker(createAssignmentPicker);
	cancel.component.handleInput("\t"); // Provider filter cycles to nan only.
	assert.doesNotMatch(cancel.frame(), /gpt-6\.1-sol/);
	cancel.component.handleInput(escape);
	assert.deepEqual(cancel.outcomes, [undefined]);
});

test("typing in any picker column always searches models", async t => {
	const { createAssignmentPicker } = await loadUiModule(t, "extensions/models/selector.ts");
	for (const moves of [[], [right], [right, right]]) {
		const { component, outcomes, frame } = picker(createAssignmentPicker);
		for (const key of moves) component.handleInput(key);
		component.handleInput("s"); // The first keystroke already filters, from any column.
		assert.match(frame(), /› openai-codex\/gpt-6\.1-sol/, `after ${moves.length} column moves`);
		assert.doesNotMatch(frame(), /nan\/plain/);
		component.handleInput("ol");
		assert.match(frame(), /> sol/);
		component.handleInput(backspace); component.handleInput(backspace); component.handleInput(backspace);
		assert.match(frame(), /nan\/plain/, "clearing the search restores every model");
		component.handleInput("sol"); component.handleInput(enter);
		assert.equal(outcomes[0].model, "openai-codex/gpt-6.1-sol");
	}
});

test("a search without matches keeps the chosen model and cannot confirm", async t => {
	const { createAssignmentPicker } = await loadUiModule(t, "extensions/models/selector.ts");
	const { component, outcomes, frame } = picker(createAssignmentPicker, { current: { model: "openai-codex/gpt-6.1-sol", reasoning: "low", mode: null } });
	component.handleInput("zzz");
	assert.match(frame(), /No matches/);
	component.handleInput(enter);
	assert.deepEqual(outcomes, [], "nothing visible to confirm");
	for (let i = 0; i < 3; i++) component.handleInput(backspace);
	assert.match(frame(), /result openai-codex\/gpt-6\.1-sol · low/);
	component.handleInput(enter);
	assert.deepEqual(outcomes, [{ model: "openai-codex/gpt-6.1-sol", reasoning: "low", mode: null }]);
});

test("roles choose a time limit, including no limit, and how many subagents run at once", async t => {
	const { createAssignmentPicker } = await loadUiModule(t, "extensions/models/selector.ts");
	const { component, outcomes, frame } = picker(createAssignmentPicker, { timeouts: ["off", 5, 10], limits: [1, 2, 3], inherited: { model: "nan/deepseek-v4-flash", reasoning: "high", mode: "sync", timeout: 10, parallel: 5 } });
	assert.match(frame(120), /4 TIMEOUT .*5 MAX/);
	assert.match(frame(120), /result inherit \(nan\/deepseek-v4-flash\) · inherit \(high\) · inherit \(sync\) · inherit \(10m\) · inherit \(5\)/);
	// Narrow terminals show one column at a time and wrap the result instead of cutting it.
	assert.match(frame(80), /result inherit \(nan\/deepseek-v4-flash\) · inherit \(high\) · inherit \(sync\)\n {7}inherit \(10m\) · inherit \(5\)/);
	for (const key of [right, right, right, down]) component.handleInput(key);
	assert.match(frame(), /› no limit/);
	component.handleInput(right); component.handleInput(up);
	assert.match(frame(120), /· no limit · max 3$/m);
	component.handleInput(enter);
	assert.deepEqual(outcomes, [{ model: null, reasoning: null, mode: null, timeout: "off", parallel: 3 }]);
	const implement = picker(createAssignmentPicker, { role: "implement", modes: ["sync"], timeouts: ["off", 5], limits: [1, 2] });
	assert.doesNotMatch(implement.frame(120), /\d MODE\b/); assert.match(implement.frame(120), /3 TIMEOUT .*4 MAX/);
	implement.component.handleInput(enter);
	assert.deepEqual(implement.outcomes, [{ model: null, reasoning: null, timeout: null, parallel: null }]);
});

test("the combined picker fits narrow and short terminals", async t => {
	const { createAssignmentPicker } = await loadUiModule(t, "extensions/models/selector.ts");
	const screen = terminal();
	const { frame } = picker(createAssignmentPicker, { catalog: Array.from({ length: 40 }, (_, i) => ({ provider: "nan", id: `model-${i}`, reasoning: true })), timeouts: ["off", 5, 10, 60], limits: [1, 2, 10] }, screen);
	for (const rows of [12, 24, 40]) for (const width of [20, 52, 72, 120]) {
		screen.terminal.rows = rows;
		const lines = frame(width).split("\n");
		assert.ok(lines.length <= Math.max(8, rows - 6), `height ${lines.length} at ${width}x${rows}`);
		assert.match(lines.join("\n"), /› /, `selection visible at ${width}x${rows}`);
		assert.ok(lines.every(line => tui.visibleWidth(line) <= width), `width ${width}`);
	}
});

test("RPC profile selection retains native dialogs instead of requesting terminal components", async t => {
	const { selectProfileOption } = await loadUiModule(t, "extensions/models/selector.ts");
	const calls = [];
	const ctx = { mode: "rpc", ui: { async select(title, options) { calls.push([title, options]); return options[1]; }, custom() { assert.fail("RPC has no custom terminal UI"); } } };
	assert.equal(await selectProfileOption(ctx, "Scope", ["personal", "project"]), "project");
	assert.deepEqual(calls, [["Scope", ["personal", "project"]]]);
});
