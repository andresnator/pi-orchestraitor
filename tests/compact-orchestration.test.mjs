import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { stripVTControlCharacters as stripAnsi } from "node:util";
import { createWorkspace, hostRoot, importHost, isolatedAgentDir, packageRoot, pi } from "./helpers/pi-host.mjs";

const { theme } = await importHost("dist/modes/interactive/theme/theme.js");
const { visibleWidth } = await importHost("node_modules/@earendil-works/pi-tui/dist/index.js");
pi.initTheme("dark", false);

async function fixture(t, selection = ["read", "codemode"], factory = pi.createCodemodeExtension()) {
	const cwd = await createWorkspace(t);
	const settingsManager = pi.SettingsManager.inMemory({ codemode: { mode: "only", inlineBudget: 0 } });
	const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir: isolatedAgentDir, settingsManager,
		noExtensions: true, additionalExtensionPaths: [join(packageRoot, "extensions/compact-tools.ts"), join(packageRoot, "extensions/status-ui.ts")],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		extensionFactories: factory ? [factory] : [],
	});
	await resourceLoader.reload();
	const { session } = await pi.createAgentSession({ cwd, agentDir: isolatedAgentDir, settingsManager, resourceLoader,
		sessionManager: pi.SessionManager.inMemory(cwd), tools: selection });
	t.after(async () => { await session.extensionRunner.emit({ type: "session_shutdown" }); session.dispose(); });
	const errors = [];
	await session.bindExtensions({ onError: (error) => errors.push(error) });
	assert.deepEqual(errors, []);
	return { cwd, session, resourceLoader };
}

function componentFor(session, name, args, id = "compact-live") {
	const definition = session.getToolDefinition(name);
	assert.equal(definition.renderShell, "self", `${name} must use the compact renderer actually selected by Pi`);
	return new pi.ToolExecutionComponent(name, id, args, { showImages: false }, definition, { requestRender() {} }, session.cwd);
}

async function executeScript(session, code, component, id = "compact-live") {
	// Issue a deterministic tool call through Pi's bound executor and real sandbox.
	// No provider or model is involved; nested tool hooks and store entries stay native.
	session.agent.state.messages.push({ role: "assistant", content: [{ type: "toolCall", id, name: "codemode", arguments: { code } }],
		api: "openai-responses", provider: "fixture", model: "fixture", stopReason: "toolUse", timestamp: Date.now(),
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
	component.markExecutionStarted();
	const updates = [];
	const outcome = await session.agent.state.tools.find(({ name }) => name === "codemode").execute(id, { code }, undefined, (result) => {
		component.updateResult(result, true);
		updates.push(component.render(120).map(stripAnsi));
	});
	component.updateResult(outcome, false);
	return { outcome, updates };
}

test("shouldCompactRealCodemodeProgressAndRestoreNativeDetailsAndStoreOnExpansion", async (t) => {
	const { cwd, session } = await fixture(t);
	const path = join(cwd, "source.txt");
	await writeFile(path, Array.from({ length: 80 }, (_, i) => `source-line-${i}`).join("\n"));
	const code = `const source = await tools.read({path: ${JSON.stringify(path)}}); store("compact-store", 73); text(source);`;
	const component = componentFor(session, "codemode", { code });
	const { outcome, updates } = await executeScript(session, code, component);
	assert.notEqual(outcome.isError, true);
	assert.match(outcome.content.map((block) => block.text).join("\n"), /source-line-79/);
	assert.ok(updates.some((lines) => lines.some((line) => /1 running \(read\)/.test(line))));
	assert.ok(updates.every((lines) => lines.filter((line) => line.trim()).length === 1));
	const collapsed = component.render(120).map(stripAnsi);
	assert.equal(collapsed.filter((line) => line.trim()).length, 1);
	assert.match(collapsed.join("\n"), /codemode · completed · 1 call · 1 completed/);
	assert.doesNotMatch(collapsed.join("\n"), /source-line-|const source|source\.txt/);
	component.setExpanded(true);
	const expanded = component.render(120).map(stripAnsi).join("\n");
	assert.match(expanded, /const source/);
	assert.match(expanded, /source\.txt/);
	assert.match(expanded, /source-line-79/);
	component.setExpanded(false);
	assert.deepEqual(component.render(120).map(stripAnsi), collapsed);
	const nextCode = 'text(load("compact-store"));';
	const next = await executeScript(session, nextCode, componentFor(session, "codemode", { code: nextCode }, "compact-store-read"), "compact-store-read");
	assert.match(next.outcome.content.map((block) => block.text).join("\n"), /\b73\b/);
	// The factory's dynamic loadout must still honor the user's `only` mode.
	const definition = session.getToolDefinition("codemode");
	assert.equal(definition.exposure, "model-only");
	assert.ok(definition.constrainedSampling);
	assert.equal(definition.defaultActive, false);
	const loadout = definition.prepareLoadout({ declared: session.agent.state.tools, callable: [session.getToolDefinition("read")],
		registered: session.getAllTools(), getNamespace: () => undefined,
		getPromptGuidelines: (name) => session.getToolDefinition(name).promptGuidelines ?? [],
		getExposure: (name) => session.getToolDefinition(name).exposure ?? "direct" });
	assert.ok(loadout.hiddenDeclarations.includes("read"));
});

test("shouldShowCaughtNestedFailuresAndScriptFailuresWithoutDumpingSuccessfulOutput", async (t) => {
	const { cwd, session } = await fixture(t);
	const code = `await Promise.allSettled([tools.read({path:${JSON.stringify(join(cwd, "missing.txt"))}})]); text("successful-output-must-stay-hidden");`;
	const component = componentFor(session, "codemode", { code });
	const { outcome } = await executeScript(session, code, component);
	assert.notEqual(outcome.isError, true, "The script catches the native nested failure");
	const collapsed = component.render(80).map(stripAnsi);
	assert.match(collapsed.join("\n"), /completed with errors/);
	assert.match(collapsed.join("\n"), /read:.*ENOENT/);
	assert.doesNotMatch(collapsed.join("\n"), /successful-output-must-stay-hidden/);
	assert.ok(collapsed.filter((line) => line.trim()).length <= 4);
	component.setExpanded(true);
	assert.match(component.render(120).map(stripAnsi).join("\n"), /successful-output-must-stay-hidden/);
	const failCode = 'text("partial-output\\nScript error: decoy-output"); throw new Error("visible-script-cause");';
	const failure = componentFor(session, "codemode", { code: failCode }, "script-failure");
	const failed = await executeScript(session, failCode, failure, "script-failure");
	assert.equal(failed.outcome.isError, true);
	assert.match(failure.render(80).map(stripAnsi).join("\n"), /visible-script-cause/);
});

for (const name of ["codemode"]) {
	test(`shouldDisplayTransformedErrorWithoutConfirmingCandidateMetadataWhen${name}IsExpanded`, async (t) => {
		const { session } = await fixture(t);
		const args = name === "codemode" ? { code: 'text("candidate")' } : { tasks: [{ role: "review", instruction: "inspect" }] };
		const details = name === "codemode" ? { calls: [{ name: "read", status: "ok", result: "candidate output" }] }
			: { results: [{ role: "review", status: "completed", finalResponse: "candidate output" }] };
		const result = { content: [{ type: "text", text: "Rejected by result hook: explanation retained" }], details, isError: true };
		const before = structuredClone(result);
		const component = componentFor(session, name, args);
		component.markExecutionStarted();
		component.updateResult(result, false);
		for (const expanded of [false, true, false]) {
			component.setExpanded(expanded);
			const output = component.render(120).map(stripAnsi).join("\n");
			assert.match(output, /Rejected by result hook: explanation retained/);
			assert.doesNotMatch(output, /candidate output|1\/1 completed|1 call · 1 completed/);
		}
		assert.deepEqual(result, before);
	});
}

test("shouldKeepCodemodeInactiveOrAbsentAndLeaveForeignCodemodeToolsAlone", async (t) => {
	for (const selection of [[], ["read"], ["read", "codemode"]]) {
		const { session } = await fixture(t, selection);
		assert.deepEqual(session.getActiveToolNames(), selection);
		if (selection.includes("codemode")) assert.equal(session.getToolDefinition("codemode").renderShell, "self");
	}
	// Passing null explicitly disables the fixture's native extension factory.
	const disabled = await fixture(t, ["read"], null);
	assert.equal(disabled.session.getToolDefinition("codemode"), undefined);
	const foreign = await fixture(t, ["codemode"], (api) => api.registerTool({ name: "codemode", label: "Foreign", description: "Foreign",
		parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
		async execute() { return { content: [{ type: "text", text: "foreign" }] }; } }));
	assert.equal(foreign.session.getToolDefinition("codemode").label, "Foreign");
	assert.equal(foreign.session.getToolDefinition("codemode").renderShell, undefined);
});

test("shouldKeepCompactNativeToolsAndUserSelectionAfterReload", async (t) => {
	const { session } = await fixture(t);
	await session.reload();
	assert.deepEqual(session.getActiveToolNames(), ["read", "codemode"]);
	for (const name of ["read", "codemode"]) assert.equal(session.getToolDefinition(name).renderShell, "self");
	const code = 'text("after-reload-marker");';
	const component = componentFor(session, "codemode", { code }, "reload-call");
	const { outcome } = await executeScript(session, code, component, "reload-call");
	assert.match(outcome.content.map((block) => block.text).join("\n"), /after-reload-marker/);
	assert.equal(component.render(80).map(stripAnsi).filter((line) => line.trim()).length, 1);
	component.setExpanded(true);
	assert.match(component.render(80).map(stripAnsi).join("\n"), /after-reload-marker/);
});

test("shouldSelectTheCompactCodemodeRendererWhenInstalledPackageStartsInRealPiCli", async (t) => {
	const cwd = await createWorkspace(t);
	const agentDir = join(cwd, "agent");
	await mkdir(agentDir);
	await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [packageRoot],
		extensions: ["-builtin:mcp", "-builtin:llama.cpp"], defaultProjectTrust: "always" }));
	const probe = join(cwd, "probe.ts");
	await writeFile(probe, `export default function (pi) {
		pi.registerCommand("compact-cli-probe", { description: "Inspect effective tool sources without a model", handler() {
			pi.sendMessage({ customType: "compact-cli-probe", content: "Startup receipt", display: false,
				details: { tools: pi.getAllTools().map(({ name, sourceInfo }) => ({ name, sourceInfo })), active: pi.getActiveTools() } });
		} });
	}`);
	// The real CLI reads only temporary configuration, never prompts a model,
	// and exposes the startup receipt through the native session message command.
	const output = execFileSync(process.execPath, [join(hostRoot, "dist/cli.js"), "--mode", "rpc", "--no-session", "--no-skills",
		"--no-prompt-templates", "--no-themes", "--no-context-files", "--tools", "read,codemode", "-e", probe], {
		cwd, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, encoding: "utf8", timeout: 15_000,
		input: '{"id":"probe","type":"prompt","message":"/compact-cli-probe"}\n{"id":"messages","type":"get_messages"}\n',
	});
	const responses = output.trim().split("\n").map((line) => JSON.parse(line));
	assert.equal(responses.find((item) => item.id === "probe").data.disposition, "handled");
	const response = responses.find((item) => item.id === "messages");
	assert.equal(response.success, true);
	const receipt = response.data.messages.find((message) => message.customType === "compact-cli-probe");
	assert.ok(receipt, "CLI startup must bind the installed package before the probe");
	assert.deepEqual(receipt.details.active, ["read", "codemode"]);
	assert.match(JSON.stringify(receipt.details.tools.find((tool) => tool.name === "codemode").sourceInfo), /compact-tools\.ts/);
});
