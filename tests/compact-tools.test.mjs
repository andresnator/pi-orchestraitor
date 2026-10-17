import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { stripVTControlCharacters as stripAnsi } from "node:util";

import { importHost, loadExtensions, pi, renderersFor } from "./helpers/pi-host.mjs";

const { theme } = await importHost("dist/modes/interactive/theme/theme.js");
const { visibleWidth } = await importHost("node_modules/@earendil-works/pi-tui/dist/index.js");
const { withBuiltInRenderers } = await importHost("dist/core/tools/renderers/index.js");
pi.initTheme("dark", false);
const extensionPath = fileURLToPath(new URL("../extensions/compact-tools.ts", import.meta.url));
const cwd = await mkdtemp(join(tmpdir(), "pi-compact-tools-test-"));
const settings = { shellCommandPrefix: "export COMPACT_TEST=kept", images: { autoResize: false } };
const loaded = await loadExtensions([extensionPath], cwd);
assert.deepEqual(loaded.errors, []);
loaded.runtime.getSettings = () => settings;
loaded.runtime.getAllTools = () => [];
const extension = loaded.extensions[0];
// Resolve as interactive mode does when no extension owns the tool.
const resolveRenderers = (name) => (extension.toolRenderers ?? []).reduceRight((next, resolver) => () => resolver(name, next),
	() => withBuiltInRenderers(name, undefined))();
const tools = new Map(["read", "bash", "edit", "write"].map((name) => [name, { name, ...resolveRenderers(name) }]));
const fakeTheme = {
	fg: (_token, text) => text,
	bold: (text) => text,
	bg: (token, text) => `${token}:${text}`,
};
const outputMarker = "unique-output-marker";
const toolContext = (args, overrides = {}) => ({
	args, toolCallId: "test-call", state: {}, cwd, invalidate() {},
	lastComponent: undefined, executionStarted: true, argsComplete: true,
	isPartial: false, expanded: false, showImages: false, isError: false,
	...overrides,
});
const render = (tool, args, result, overrides = {}, width = 80) => {
	const context = toolContext(args, overrides);
	return [
		...tool.renderCall(args, fakeTheme, context).render(width),
		...tool.renderResult(result, context, fakeTheme, context).render(width),
	];
};
const result = { content: [{ type: "text", text: outputMarker }], details: undefined };
after(() => rm(cwd, { recursive: true, force: true }));

for (const name of ["read", "bash", "edit", "write"]) {
	test(`shouldRenderOneUnboxedLineWhen${name}IsCollapsed`, () => {
		// Given
		const tool = tools.get(name);
		const args = name === "bash" ? { command: "echo hello\n echo goodbye" } : { path: "example.txt" };
		// When
		const lines = render(tool, args, result);
		// Then
		assert.deepEqual({
			lineCount: lines.length,
			hasBackground: lines[0].startsWith("toolSuccessBg:"),
			hasStatus: lines[0].includes(`${name} · completed`),
			hasOutput: lines[0].includes(outputMarker),
		}, { lineCount: 1, hasBackground: false, hasStatus: true, hasOutput: false });
	});
}

for (const [overrides, expectedBackground, expectedStatus] of [
	[{ isPartial: true }, false, "running…"],
	[{ isPartial: true, executionStarted: false }, false, "preparing…"],
	[{ isError: true }, true, "error"],
]) {
	test(`shouldShow${expectedStatus}WhenExecutionStateChanges`, () => {
		// Given
		const tool = tools.get("bash");
		// When
		const lines = render(tool, { command: "npm test" }, result, overrides);
		// Then
		assert.deepEqual({ count: lines.length, background: lines[0].startsWith("toolErrorBg:"),
			status: lines[0].includes(expectedStatus) },
		{ count: overrides.isError ? 2 : 1, background: expectedBackground, status: true });
	});
}

test("shouldRevealAllAvailableOutputAndArgumentsWhenExpanded", () => {
	// Given
	const output = Array.from({ length: 120 }, (_, index) => `output-${index}`).join("\n");
	const fullResult = { content: [{ type: "text", text: output }], details: undefined };
	const args = { command: "printf 'hello\\nworld'", timeout: 10 };
	// When
	const lines = render(tools.get("bash"), args, fullResult, { expanded: true }, 100);
	// Then
	assert.deepEqual({ hasLastLine: lines.some((line) => line.includes("output-119")),
		hasArguments: lines.some((line) => line.includes('"timeout": 10')),
		unboxed: lines.every((line) => !line.startsWith("toolSuccessBg:")) },
	{ hasLastLine: true, hasArguments: true, unboxed: true });
});

test("shouldRevealDiffWhenEditIsExpanded", () => {
	// Given
	const editResult = { ...result, details: { diff: "-old\n+new", firstChangedLine: 1 } };
	// When
	const lines = render(tools.get("edit"), { path: "example.txt" }, editResult, { expanded: true });
	// Then
	assert.deepEqual({ removed: lines.some((line) => line.includes("-old")),
		added: lines.some((line) => line.includes("+new")) }, { removed: true, added: true });
});

test("shouldFitTerminalWidthWhenCommandsContainWideCharacters", () => {
	// Given
	const tool = tools.get("bash");
	const args = { command: "echo '你好 🧪' ".repeat(50) };
	// When
	const outcomes = [1, 2, 10, 40, 120].map((width) => {
		const context = toolContext(args);
		const lines = tool.renderCall(args, theme, context).render(width);
		return { width, lineCount: lines.length, fits: lines.every((line) => visibleWidth(line) <= width) };
	});
	// Then
	assert.deepEqual(outcomes, [1, 2, 10, 40, 120].map((width) => ({ width, lineCount: 1, fits: true })));
});

test("shouldExpandAndCollapseWhenNativeToolComponentIsToggled", () => {
	// Given
	pi.initTheme("dark", false);
	const tool = tools.get("bash");
	const component = new pi.ToolExecutionComponent("bash", "native-test", { command: "printf hello" },
		{ showImages: false }, tool, { requestRender() {} }, cwd);
	component.markExecutionStarted();
	component.updateResult(result, false);
	// When
	const collapsed = component.render(80).map(stripAnsi);
	component.setExpanded(true);
	const expanded = component.render(80).map(stripAnsi);
	component.setExpanded(false);
	const collapsedAgain = component.render(80).map(stripAnsi);
	// Then
	assert.deepEqual({ collapsedLines: collapsed.filter((line) => line.trim()).length,
		outputVisible: expanded.some((line) => line.includes(outputMarker)),
		restored: JSON.stringify(collapsed) === JSON.stringify(collapsedAgain) },
	{ collapsedLines: 1, outputVisible: true, restored: true });
});

for (const selection of [[], ["read"], ["read", "bash", "edit", "write"]]) {
	test(`shouldPreserveSelectionWhenPiBindsExtensionWith${selection.length}Tools`, async () => {
		// Given
		const settingsManager = pi.SettingsManager.inMemory(settings);
		const resourceLoader = new pi.DefaultResourceLoader({
			cwd, agentDir: join(cwd, "agent"), settingsManager,
			noExtensions: true, additionalExtensionPaths: [extensionPath],
			noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		});
		await resourceLoader.reload();
		const { session, extensionsResult } = await pi.createAgentSession({
			cwd, agentDir: join(cwd, "agent"), settingsManager, resourceLoader,
			sessionManager: pi.SessionManager.inMemory(cwd), tools: selection,
		});
		const errors = [];
		try {
			// When
			await session.bindExtensions({ onError: (error) => errors.push(error) });
			const registered = [...extensionsResult.extensions[0].tools.values()];
			const names = ["read", "bash", "edit", "write"];
			// Then: Pi keeps the tools; the harness only selects their renderers.
			assert.deepEqual({ active: session.getActiveToolNames(), errors, registeredCount: registered.length,
				replaced: session.getAllTools().filter(({ name, sourceInfo }) => names.includes(name) && sourceInfo.source !== "builtin").map(({ name }) => name),
				compact: names.map((name) => renderersFor(session, name)?.renderShell) },
			{ active: selection, errors: [], registeredCount: 0, replaced: [], compact: names.map(() => "self") });
		} finally {
			session.dispose();
		}
	});
}

test("shouldShowOnlyThreeVisualTailRowsWhenCollapsedToolFails", () => {
	// Given
	const failure = { content: [{ type: "text", text: "earlier\n" + "failure 你好 🧪 ".repeat(12) + "\nlast cause\n\n" }] };
	// When
	const lines = render(tools.get("bash"), { command: "fail" }, failure, { isError: true }, 28);
	// Then
	assert.equal(lines.length, 4);
	assert.ok(lines.at(-1).includes("last cause"));
	assert.ok(!lines.some((line) => line.includes("earlier")));
});

test("shouldStripTerminalControlsOnlyFromPresentationWhenDisplayingFailure", () => {
	// Given
	const text = "\x1b]52;c;secret\x07\x1b[31mUnicode 你好 🧪\x1b[0m\nlast\x00\x08\r cause";
	const failure = { content: [{ type: "text", text }] };
	// When
	const lines = render(tools.get("bash"), { command: "fail\x1b[2J" }, failure, { isError: true, expanded: true });
	// Then
	assert.ok(lines.some((line) => line.includes("Unicode 你好 🧪")));
	assert.ok(lines.every((line) => !/[\x00-\x08\x0b-\x1f\x7f-\x9f]/u.test(line)));
	assert.equal(failure.content[0].text, text);
});

test("shouldBoundVisualErrorRowsAndPreserveExpansionWhenTerminalIsNarrow", () => {
	// Given
	const failure = { content: [{ type: "text", text: "first\n" + "Unicode 你好 🧪 é ".repeat(8) + "\nlast cause\n" }], isError: true };
	// When
	for (const width of [1, 2, 3, 8, 20, 80]) {
		const context = toolContext({ command: "fail" }, { isError: true });
		const lines = tools.get("bash").renderResult(failure, context, theme, context).render(width);
		// Then
		assert.ok(lines.length <= 3);
		assert.ok(lines.every((line) => visibleWidth(line) <= width));
	}
	const expanded = render(tools.get("bash"), { command: "fail" }, failure, { isError: true, expanded: true }, 80);
	assert.ok(expanded.some((line) => line.includes("first")));
	assert.ok(expanded.some((line) => line.includes("last cause")));
});

const runTool = async (session, name, args, id) => {
	session.agent.state.messages.push({ role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }],
		api: "openai-responses", provider: "fixture", model: "fixture", stopReason: "toolUse", timestamp: Date.now(),
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
	return session.extensionRunner.createToolContext(id, undefined).executeTool(name, args);
};
const renderedCall = (renderers, args) => renderers.renderCall(args, fakeTheme, toolContext(args)).render(80).join("\n").trim();

for (const order of ["before", "after"]) {
	test(`shouldLeaveForeignReadAndBashToTheirOwnerWhenTheirExtensionLoads${order === "before" ? "Before" : "After"}CompactTools`, async () => {
		// Given
		const foreignPath = join(cwd, `foreign-${order}.ts`);
		await writeFile(foreignPath, `import { createReadToolDefinition, createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
export default function(pi) {
	for (const original of [createReadToolDefinition(${JSON.stringify(cwd)}), createBashToolDefinition(${JSON.stringify(cwd)})]) {
		pi.registerTool({...original, defaultActive:false, renderCall:() => new Text("Foreign " + original.name,0,0),
			...(original.name === "bash" ? { execute: async (_id, args) => ({ content: [{ type: "text", text: "foreign:" + args.command }], details: undefined }) } : {})});
	}
}`);
		const paths = order === "before" ? [foreignPath, extensionPath] : [extensionPath, foreignPath];
		const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"),
			settingsManager: pi.SettingsManager.inMemory(), noExtensions: true, additionalExtensionPaths: paths,
			noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		await resourceLoader.reload();
		const { session } = await pi.createAgentSession({ cwd, agentDir: join(cwd, "agent"),
			settingsManager: resourceLoader.settingsManager, resourceLoader,
			sessionManager: pi.SessionManager.inMemory(cwd), tools: ["read", "bash", "edit", "write"] });
		const errors = [];
		try {
			// When
			const notifications = [];
			await session.bindExtensions({ onError: error => errors.push(error), mode: "print",
				uiContext: { ...session.extensionRunner.getUIContext(), notify: message => notifications.push(message) } });
			for (let pass = 0; pass < 2; pass++) {
				if (pass) await session.reload();
				const result = await runTool(session, "bash", { command: "printf ownership-marker" }, `bash-${pass}`);
				// Then
				assert.deepEqual(session.getActiveToolNames(), ["read", "bash", "edit", "write"]);
				assert.deepEqual({ isError: Boolean(result.isError), text: result.result.content.map(block => block.text).join("\n"),
					owners: Object.fromEntries(session.getAllTools().filter(({ name }) => ["read", "bash", "edit", "write"].includes(name))
						.map(({ name, sourceInfo }) => [name, sourceInfo.source === "builtin" ? "builtin" : sourceInfo.path])) },
				{ isError: false, text: "foreign:printf ownership-marker",
					owners: { read: foreignPath, bash: foreignPath, edit: "builtin", write: "builtin" } });
				for (const name of ["read", "bash"]) {
					assert.equal(renderedCall(renderersFor(session, name), { path: "x", command: "x" }), `Foreign ${name}`);
				}
				for (const name of ["edit", "write"]) assert.equal(renderersFor(session, name).renderShell, "self");
			}
			assert.deepEqual(notifications, []);
			assert.deepEqual(errors, []);
		} finally { await session.extensionRunner.emit({ type: "session_shutdown" }); session.dispose(); }
	});
}

test("shouldRunPiBashWithHomeRelativeShellPathAndPrefixWhenCompactToolsIsLoaded", async (t) => {
	// Given: Pi expands "~" in shellPath; the harness must not pass the raw setting to its own bash.
	const home = await mkdtemp(join(tmpdir(), "pi-compact-home-")), previousHome = process.env.HOME;
	t.after(() => rm(home, { recursive: true, force: true }));
	await mkdir(join(home, "bin"));
	await writeFile(join(home, "bin", "compact-shell"), '#!/bin/sh\nexport COMPACT_SHELL=home\nexec /bin/bash "$@"\n', { mode: 0o755 });
	process.env.HOME = home;
	const settingsManager = pi.SettingsManager.inMemory({ shellPath: "~/bin/compact-shell", shellCommandPrefix: settings.shellCommandPrefix });
	const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), settingsManager,
		noExtensions: true, additionalExtensionPaths: [extensionPath],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await resourceLoader.reload();
	const { session } = await pi.createAgentSession({ cwd, agentDir: join(cwd, "agent"), settingsManager, resourceLoader,
		sessionManager: pi.SessionManager.inMemory(cwd), tools: ["bash"] });
	const errors = [];
	try {
		await session.bindExtensions({ onError: error => errors.push(error), mode: "print" });
		// When
		const result = await runTool(session, "bash", { command: 'printf "%s:%s" "$COMPACT_SHELL" "$COMPACT_TEST"' }, "home-shell");
		// Then
		assert.deepEqual({ isError: Boolean(result.isError), text: result.result.content.map(block => block.text).join("\n").trim(), errors },
			{ isError: false, text: "home:kept", errors: [] });
	} finally {
		process.env.HOME = previousHome;
		await session.extensionRunner.emit({ type: "session_shutdown" }); session.dispose();
	}
});
