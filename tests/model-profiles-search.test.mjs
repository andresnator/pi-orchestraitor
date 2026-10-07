import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createPackageUISession, importHost, loadUiModule, plainTheme, tui } from "./helpers/ui-harness.mjs";
import { isolatedAgentDir } from "./helpers/pi-host.mjs";
import { paths, snapshot } from "../extensions/models/store.mjs";

const { KeybindingsManager } = await importHost("dist/core/keybindings.js");
const keys = new KeybindingsManager();
const enter = "\r", down = "\x1b[B", up = "\x1b[A", backspace = "\x7f", escape = "\x1b";
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

test("every models-profiles selection uses searchable terminal menus without model calls", async t => {
	const { session, errors } = await createPackageUISession(t, "tui");
	const command = session.extensionRunner.getCommand("models-profiles");
	const ctx = session.extensionRunner.createCommandContext();
	const choices = [
		["pers", "personal"], ["cre", "Create profile"], ["expl", "explore"], ["mod", "model"], ["DeepSeek V4 Flash", "nan/deepseek-v4-flash"],
		["expl", "explore"], ["reas", "reasoning"], ["off", "off"], ["rev", "review"], ["mode", "mode"], ["backg", "background"], ["save apply", "Save and apply"],
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
				const [query, expected] = choices.shift() ?? assert.fail("Unexpected menu");
				component.focused = true;
				component.render(80);
				component.handleInput(query);
				component.handleInput(enter);
				assert.equal(finished, true, query);
				assert.equal(outcome, expected, query);
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
	assert.deepEqual((await snapshot(files.personal)).data.assignments, { explore: { model: "nan/deepseek-v4-flash", reasoning: "off" }, review: { mode: "background" } });
	assert.deepEqual((await snapshot(files.profiles)).data.profiles.map(profile => profile.name), ["Search Demo", "Second profile"]);
	assert.equal(session.sessionManager.getEntries().filter(entry => entry.type === "message").length, 0);
	// The searched value, not its filtered position or display name, is persisted.
	assert.match(await readFile(files.profiles, "utf8"), /nan\/deepseek-v4-flash/);
});

test("RPC profile selection retains native dialogs instead of requesting terminal components", async t => {
	const { selectProfileOption } = await loadUiModule(t, "extensions/models/selector.ts");
	const calls = [];
	const ctx = { mode: "rpc", ui: { async select(title, options) { calls.push([title, options]); return options[1]; }, custom() { assert.fail("RPC has no custom terminal UI"); } } };
	assert.equal(await selectProfileOption(ctx, "Scope", ["personal", "project"]), "project");
	assert.deepEqual(calls, [["Scope", ["personal", "project"]]]);
});
