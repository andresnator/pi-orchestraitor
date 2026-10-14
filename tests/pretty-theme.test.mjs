import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { applyPrettyTheme } from "../extensions/pretty/theme.mjs";
import { createWorkspace } from "./helpers/pi-host.mjs";

async function agentDir(t) {
	const home = await createWorkspace(t), directory = join(home, ".pi", "agent");
	await mkdir(directory, { recursive: true });
	const write = (name, text) => writeFile(join(directory, name), text);
	return { home, directory, settings: (text) => write("settings.json", text), pretty: (text) => write("pi-pretty.json", text) };
}

test("shouldFollowPiBuiltInThemeOnEachStartWithoutWritingFiles", async (t) => {
	const { home, directory, settings } = await agentDir(t);
	for (const [theme, shiki] of [["light", "github-light"], ["dark", "github-dark"]]) {
		await settings(JSON.stringify({ theme }));
		const env = { HOME: home };
		assert.equal(applyPrettyTheme(env), shiki);
		assert.deepEqual(env, { HOME: home, PRETTY_THEME: shiki });
	}
	assert.deepEqual(await readdir(directory), ["settings.json"]);
});

test("shouldReplaceOnlyItsOwnThemeWhenPiReloads", async (t) => {
	const { home, settings, pretty } = await agentDir(t);
	const env = { HOME: home };
	await settings('{"theme":"light"}');
	assert.equal(applyPrettyTheme(env), "github-light");
	await settings('{"theme":"dark"}');
	assert.equal(applyPrettyTheme(env), "github-dark");
	await settings('{"theme":"dracula"}');
	assert.equal(applyPrettyTheme(env), undefined);
	assert.equal(Object.hasOwn(env, "PRETTY_THEME"), false, "custom theme goes back to Pretty");
	await settings('{"theme":"dark"}');
	assert.equal(applyPrettyTheme(env), "github-dark");
	await pretty('{"theme":"vesper"}');
	assert.equal(applyPrettyTheme(env), undefined);
	assert.equal(Object.hasOwn(env, "PRETTY_THEME"), false, "Pretty's file takes over");
	env.PRETTY_THEME = "nord";
	await pretty("{}");
	assert.equal(applyPrettyTheme(env), undefined);
	assert.equal(env.PRETTY_THEME, "nord", "a value set elsewhere is never replaced");
});

test("shouldLeaveExplicitPrettyThemesAlone", async (t) => {
	const { home, settings, pretty } = await agentDir(t);
	await settings('{"theme":"dark"}');
	const preset = { HOME: home, PRETTY_THEME: "nord" };
	assert.equal(applyPrettyTheme(preset), undefined);
	assert.equal(preset.PRETTY_THEME, "nord");
	await pretty('{"theme":"dracula"}');
	const env = { HOME: home };
	assert.equal(applyPrettyTheme(env), undefined);
	assert.equal(Object.hasOwn(env, "PRETTY_THEME"), false);
	// PRETTY_CONFIG_DIR moves Pretty's file away from HOME, as in Pretty.
	const custom = join(home, "custom");
	await mkdir(custom);
	await writeFile(join(custom, "pi-pretty.json"), '{"theme":"vesper"}');
	assert.equal(applyPrettyTheme({ HOME: home, PRETTY_CONFIG_DIR: custom }), undefined);
	assert.equal(applyPrettyTheme({ HOME: home, PRETTY_CONFIG_DIR: join(home, "missing") }), "github-dark", "HOME's pi-pretty.json is not consulted");
});

test("shouldIgnorePrettyThemesThatPrettyItselfIgnores", async (t) => {
	const { home, settings, pretty } = await agentDir(t);
	await settings('{"theme":"dark"}');
	for (const text of ['{"theme":"  "}', '{"theme":7}', '{"theme":null}', "null", "{bad-json", '{"disableTools":["bash"]}']) {
		await pretty(text);
		assert.equal(applyPrettyTheme({ HOME: home }), "github-dark", text);
	}
});

test("shouldLeaveCustomOrUnreadablePiThemesToPretty", async (t) => {
	const { home, settings } = await agentDir(t);
	assert.equal(applyPrettyTheme({ HOME: home }), undefined, "missing settings");
	for (const text of ['{"theme":"dracula"}', '{"theme":"constructor"}', "{}", "null", "{bad-json"]) {
		await settings(text);
		const env = { HOME: home };
		assert.equal(applyPrettyTheme(env), undefined, text);
		assert.equal(Object.hasOwn(env, "PRETTY_THEME"), false);
	}
	await settings('{"theme":"dark"}');
	// Like Pretty, Pi's settings are read only through HOME.
	assert.equal(applyPrettyTheme({ PRETTY_CONFIG_DIR: join(home, ".pi", "agent") }), undefined);
});
