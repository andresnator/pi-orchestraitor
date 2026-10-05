import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
await writeFile(join(process.env.PRETTY_CONFIG_DIR, "pi-pretty.json"), JSON.stringify({ theme: "github-dark" }));

for (const order of ["pretty-first", "harness-first"]) {
	test(`shouldKeepActualPrettyRenderersAndSelectionAcrossReloadWhenOrderIs${order}`, { timeout: 20000 }, async (t) => {
		// Given
		const cwd = await createWorkspace(t), file = join(cwd, "marker.ts");
		await writeFile(file, "export const marker = 73;\n");
		const paths = order === "pretty-first" ? [prettyExtension, compactExtension] : [compactExtension, prettyExtension];
		const settingsManager = pi.SettingsManager.inMemory();
		const loader = new pi.DefaultResourceLoader({ cwd, agentDir: isolatedAgentDir, settingsManager,
			noExtensions: true, additionalExtensionPaths: paths, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const selection = ["read", "bash", "edit", "write"];
		const { session } = await pi.createAgentSession({ cwd, agentDir: isolatedAgentDir, settingsManager, resourceLoader: loader,
			sessionManager: pi.SessionManager.inMemory(cwd), tools: selection });
		const errors = [];
		try {
			// When
			await session.bindExtensions({ mode: "print", onError: error => errors.push(error) });
			await session.extensionRunner.emit({ type: "session_start", reason: "startup" });
			for (let pass = 0; pass < 2; pass++) {
				if (pass) await session.reload();
				// Then
				assert.deepEqual(session.getActiveToolNames(), selection);
				const ctx = session.extensionRunner.createContext();
				for (const [name, args, native] of [["read", { path: file }, pi.createReadToolDefinition(cwd)],
					["bash", { command: "printf pretty-marker" }, pi.createBashToolDefinition(cwd)]]) {
					const tool = session.getToolDefinition(name);
					assert.equal(session.getAllTools().find(tool => tool.name === name).sourceInfo.path, prettyExtension);
					const actual = await tool.execute(`pretty-${name}-${pass}`, args, undefined, undefined, ctx);
					const expected = await native.execute("native", args, undefined, undefined, ctx);
					assert.deepEqual(actual.content, expected.content);
					if (name === "read") assert.equal(actual.details._type, "readFile");
					assert.ok(actual.details.__prettyElapsedMs >= 0);
					pi.initTheme("dark", false);
					const component = new pi.ToolExecutionComponent(name, `render-${name}`, args, { showImages: false }, tool, { requestRender() {} }, cwd);
					component.markExecutionStarted(); component.updateResult(actual, false); component.setExpanded(true);
					assert.match(component.render(100).map(stripVTControlCharacters).join("\n"), /marker/);
				}
				assert.equal(session.getAllTools().find(tool => tool.name === "edit").sourceInfo.path, compactExtension);
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
	for (const name of ["read", "bash"]) assert.equal(receipt.details.tools.find(tool => tool.name === name).sourceInfo.path, prettyExtension);
	assert.equal(receipt.details.tools.find(tool => tool.name === "codemode").sourceInfo.path, compactExtension);
});
