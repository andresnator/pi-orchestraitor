import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { createWorkspace, hostRoot, isolatedAgentDir, packageRoot, pi } from "../helpers/pi-host.mjs";

const PRETTY_NAME = "@heyhuynhgiabuu/pi-pretty";
const prettyRoot = process.env.PI_PRETTY_PACKAGE_DIR ?? join(homedir(), ".pi", "agent", "npm", "node_modules", PRETTY_NAME);
const manifest = JSON.parse(await readFile(join(prettyRoot, "package.json"), "utf8").catch(() => {
	throw new Error("Install pi-pretty with install:pi, or set PI_PRETTY_PACKAGE_DIR to its installed package directory.");
}));
assert.equal(manifest.name, PRETTY_NAME);
assert.equal(manifest.version, "0.6.30");
const prettyExtension = join(prettyRoot, "src/index.ts");
const compactExtension = join(packageRoot, "extensions/compact-tools.ts");
assert.equal(process.env.PI_PRETTY_ISOLATED_HOME, "1", "Run through npm run test:pretty to isolate upstream HOME-based storage");
await writeFile(join(process.env.PRETTY_CONFIG_DIR, "pi-pretty.json"), JSON.stringify({ theme: "github-dark", disableTools: ["bash"] }));

for (const order of ["pretty-first", "harness-first"]) {
	for (const selection of [["read", "bash", "edit", "write"], ["read"], []]) {
		test(`shouldUseHarnessShellAndKeepActualPrettyAcrossReloadWhenOrderIs${order}AndSelectionHas${selection.length}Tools`, { timeout: 20000 }, async (t) => {
			// Given
			const cwd = await createWorkspace(t), file = join(cwd, "marker.ts");
			await writeFile(file, "export const marker = 73;\n");
			const paths = order === "pretty-first" ? [prettyExtension, compactExtension] : [compactExtension, prettyExtension];
			const shellPath = join(cwd, "custom-shell");
			await writeFile(shellPath, '#!/bin/sh\nexport PRETTY_TEST_SHELL=custom\nexec /bin/bash "$@"\n', { mode: 0o755 });
			const settingsManager = pi.SettingsManager.inMemory({ shellPath, shellCommandPrefix: "export PRETTY_TEST_PREFIX=applied" });
			const loader = new pi.DefaultResourceLoader({ cwd, agentDir: isolatedAgentDir, settingsManager,
				noExtensions: true, additionalExtensionPaths: paths, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true });
			await loader.reload();
			assert.deepEqual(loader.getExtensions().errors, []);
			const { session } = await pi.createAgentSession({ cwd, agentDir: isolatedAgentDir, settingsManager, resourceLoader: loader,
				sessionManager: pi.SessionManager.inMemory(cwd), tools: selection });
			const errors = [];
			try {
				// When
				await session.bindExtensions({ mode: "print", onError: error => errors.push(error) });
				for (let pass = 0; pass < 2; pass++) {
					if (pass) await session.reload();
					// Then
					assert.deepEqual(session.getActiveToolNames(), selection);
					const ctx = session.extensionRunner.createContext();
					for (const [name, args, native] of [["read", { path: file }, pi.createReadToolDefinition(cwd)],
						["bash", { command: 'printf "pretty-marker:%s:%s" "$PRETTY_TEST_PREFIX" "$PRETTY_TEST_SHELL"' },
							pi.createBashToolDefinition(cwd, { shellPath, commandPrefix: "export PRETTY_TEST_PREFIX=applied" })]]) {
						const registered = name === "read" && !selection.includes(name)
							? loader.getExtensions().extensions.find(({ path }) => path === prettyExtension).tools.get(name)
							: session.extensionRunner.getAllRegisteredTools().find(({ definition }) => definition.name === name);
						const tool = session.getToolDefinition(name) ?? registered.definition;
						assert.equal(registered.sourceInfo.path, name === "read" ? prettyExtension : compactExtension);
						assert.equal(Boolean(session.getToolDefinition(name)), selection.includes(name));
						const actual = await tool.execute(`pretty-${name}-${pass}`, args, undefined, undefined, ctx);
						const expected = await native.execute("native", args, undefined, undefined, ctx);
						assert.deepEqual(actual.content, expected.content);
						if (name === "read") {
							assert.equal(actual.details._type, "readFile");
							assert.ok(actual.details.__prettyElapsedMs >= 0);
						} else {
							assert.match(actual.content[0].text, /pretty-marker:applied:custom/);
							assert.equal(actual.details?.__prettyElapsedMs, undefined);
							assert.equal(tool.renderShell, "self");
						}
						pi.initTheme("dark", false);
						const component = new pi.ToolExecutionComponent(name, `render-${name}`, args, { showImages: false }, tool, { requestRender() {} }, cwd);
						component.markExecutionStarted(); component.updateResult(actual, false); component.setExpanded(true);
						assert.match(component.render(100).map(stripVTControlCharacters).join("\n"), /marker/);
					}
					assert.equal(session.extensionRunner.getAllRegisteredTools().find(({ definition }) => definition.name === "edit").sourceInfo.path, compactExtension);
					for (const [name, args] of [["find", { pattern: "*.ts", path: cwd }], ["grep", { pattern: "marker", path: cwd, glob: "*.ts" }]]) {
						// Exercise upstream search without adding it to the persisted selection.
						const tool = session.extensionRunner.getAllRegisteredTools().find(({ definition }) => definition.name === name)?.definition;
						assert.ok(tool, `Pretty must register ${name}`);
						const result = await tool.execute(`search-${name}`, args, undefined, undefined, ctx);
						assert.match(result.content.filter(block => block.type === "text").map(block => block.text).join("\n"), /marker\.ts/);
					}
				}
				assert.deepEqual(errors, []);
			} finally { await session.extensionRunner.emit({ type: "session_shutdown" }); session.dispose(); }
		});
	}
}

test("shouldSelectPrettyAndHarnessOwnersWhenActualPackagesStartInNativeCli", { timeout: 20000 }, async (t) => {
	// Given
	const cwd = await createWorkspace(t), agentDir = join(cwd, "agent");
	await mkdir(agentDir);
	await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [
		{ source: packageRoot, extensions: ["!extensions/mcp.ts"], skills: [], prompts: [] }, prettyRoot,
	], extensions: ["-builtin:mcp", "-builtin:llama.cpp"], defaultProjectTrust: "always" }));
	const probe = join(cwd, "probe.ts");
	await writeFile(probe, `export default function(pi) { pi.registerCommand("pretty-probe", {description:"Offline ownership probe",handler() {
pi.sendMessage({customType:"pretty-probe",content:"Startup receipt",display:false,details:{tools:pi.getAllTools().map(({name,sourceInfo})=>({name,sourceInfo})),active:pi.getActiveTools()}});
}}); }`);
	// When: owned RPC process and command only; no provider is prompted.
	const output = execFileSync(process.execPath, [join(hostRoot, "dist/cli.js"), "--mode", "rpc", "--no-session", "--no-skills",
		"--no-prompt-templates", "--no-themes", "--no-context-files", "--tools", "read,bash,codemode,subagent_run", "-e", probe], {
		cwd, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, encoding: "utf8", timeout: 15000,
		input: '{"id":"probe","type":"prompt","message":"/pretty-probe"}\n{"id":"messages","type":"get_messages"}\n',
	});
	// Then
	const responses = output.trim().split("\n").map(line => JSON.parse(line));
	assert.equal(responses.find(item => item.id === "probe").data.disposition, "handled");
	const receipt = responses.find(item => item.id === "messages").data.messages.find(message => message.customType === "pretty-probe");
	assert.deepEqual(receipt.details.active, ["read", "bash", "codemode", "subagent_run"]);
	assert.equal(receipt.details.tools.find(tool => tool.name === "read").sourceInfo.path, prettyExtension);
	assert.equal(receipt.details.tools.find(tool => tool.name === "bash").sourceInfo.path, compactExtension);
	assert.equal(receipt.details.tools.find(tool => tool.name === "codemode").sourceInfo.path, compactExtension);
});

test("shouldBlockConflictingActualPrettyBashAndRecoverOnReloadAfterEnvironmentOverrideIsCorrected", { timeout: 20000 }, async (t) => {
	const previous = process.env.PRETTY_DISABLE_TOOLS;
	process.env.PRETTY_DISABLE_TOOLS = "read"; // Overrides the file's bash exclusion.
	const cwd = await createWorkspace(t), marker = join(cwd, "must-not-execute");
	const settingsManager = pi.SettingsManager.inMemory({ shellCommandPrefix: "export PREFIX=required" });
	const loader = new pi.DefaultResourceLoader({ cwd, agentDir: isolatedAgentDir, settingsManager,
		noExtensions: true, additionalExtensionPaths: [prettyExtension, compactExtension],
		noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
		extensionFactories: [pi.createCodemodeExtension()] });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await pi.createAgentSession({ cwd, agentDir: isolatedAgentDir, settingsManager, resourceLoader: loader,
		sessionManager: pi.SessionManager.inMemory(cwd), tools: ["bash", "codemode"] });
	try {
		const errors = [], notifications = [];
		await session.bindExtensions({ onError: error => errors.push(error), mode: "print",
			uiContext: { ...session.extensionRunner.getUIContext(), notify: message => notifications.push(message) } });
		for (let pass = 0; pass < 2; pass++) {
			if (pass) await session.reload();
			assert.equal(session.getAllTools().find(tool => tool.name === "bash").sourceInfo.path, prettyExtension);
			session.agent.state.messages.push({ role: "assistant", content: [{ type: "toolCall", id: `blocked-${pass}`, name: "bash", arguments: { command: "blocked" } }],
				api: "openai-responses", provider: "fixture", model: "fixture", stopReason: "toolUse", timestamp: Date.now(),
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
			const ctx = session.extensionRunner.createToolContext(`blocked-${pass}`, undefined);
			const blocked = await ctx.executeTool("bash", { command: `touch ${JSON.stringify(marker)}` });
			assert.equal(blocked.isError, true);
			assert.match(blocked.result.content[0].text, /Bash ownership conflict.*PRETTY_DISABLE_TOOLS/);
			const code = `text(await tools.bash({command:${JSON.stringify(`touch ${JSON.stringify(marker)}`)}}));`;
			session.agent.state.messages.push({ role: "assistant", content: [{ type: "toolCall", id: `nested-${pass}`, name: "codemode", arguments: { code } }],
				api: "openai-responses", provider: "fixture", model: "fixture", stopReason: "toolUse", timestamp: Date.now(),
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
			const nested = await session.agent.state.tools.find(tool => tool.name === "codemode").execute(`nested-${pass}`, { code });
			assert.match(nested.content.filter(block => block.type === "text").map(block => block.text).join("\n"), /Bash ownership conflict/);
			await assert.rejects(access(marker), { code: "ENOENT" });
		}
		assert.equal(notifications.length, 2);
		process.env.PRETTY_DISABLE_TOOLS = "read,bash";
		await session.reload();
		assert.equal(session.getAllTools().find(tool => tool.name === "bash").sourceInfo.path, compactExtension);
		assert.deepEqual(session.getActiveToolNames(), ["bash", "codemode"]);
		const ctx = session.extensionRunner.createToolContext("recovered", undefined);
		const result = await ctx.executeTool("bash", { command: 'printf "%s" "$PREFIX"' });
		assert.notEqual(result.isError, true);
		assert.match(result.result.content[0].text, /required/);
		assert.deepEqual(errors, []);
	} finally {
		if (previous === undefined) delete process.env.PRETTY_DISABLE_TOOLS;
		else process.env.PRETTY_DISABLE_TOOLS = previous;
		await session.extensionRunner.emit({ type: "session_shutdown" }); session.dispose();
	}
});
