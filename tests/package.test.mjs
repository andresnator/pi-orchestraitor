import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
	createWorkspace, importHost, isolatedAgentDir, loadPackage, mcpStatus,
	packageRoot, pi, startSession,
} from "./helpers/pi-host.mjs";

const { expandPromptTemplate } = await importHost("dist/core/prompt-templates.js");
const EXPECTED_PROMPTS = ["absorb", "orchestraitor", "plan", "review"];
const PROVENANCE = JSON.parse(await readFile(join(packageRoot, "docs/skills-provenance.json"), "utf8"));
const EXPECTED_FILES = [
	"LICENSE", "README.md", "THIRD_PARTY_NOTICES.md", "package.json",
	"extensions/compact-tools.ts", "extensions/instructions.ts", "extensions/mcp.ts", "extensions/nan.ts", "extensions/subagents.ts",
	...["index", "context", "conversation", "markdown", "popup", "transcript", "types"].map((name) => `extensions/btw/${name}.ts`),
	"extensions/skill-registry.ts", "extensions/skills/sources.mjs", "extensions/skills/registry.mjs", "extensions/skills/store.mjs", "extensions/skills/types.ts",
	"extensions/status-ui.ts", "extensions/ui/display.ts", "extensions/ui/agents.ts", "extensions/ui/tasks.ts", "extensions/ui/questions.ts",
	"extensions/models/store.mjs", "extensions/models/panel.mjs", "extensions/models/selector.ts", "extensions/subagent/bridge.mjs", "extensions/subagent/background.mjs",
	"extensions/subagent/child.mjs", "extensions/subagent/controller.mjs", "extensions/subagent/guard.mjs", "extensions/subagent/policy.mjs", "extensions/subagent/runtime.mjs",
	"instructions/core.md", "instructions/orchestraitor.md", "instructions/personality.md",
	"scripts/install-pi.mjs", "scripts/pi-host.mjs", "scripts/skill-migration.mjs", "scripts/check-personality.mjs", "scripts/bench.mjs",
	"scripts/skill-inventory.mjs", "scripts/package-registration.mjs", "scripts/pretty-config.mjs",
	"docs/btw.md", "docs/nan.md", "docs/usage.md", "docs/skills.md", "docs/skills-provenance.json", "docs/verification.md", "docs/subagents.md", "docs/interactive-ui.md", "docs/performance.md", "docs/pi-pretty.md",
	"docs/architecture/execution.md", "docs/architecture/flows.md", "docs/architecture/index.md",
	"licenses/Apache-2.0.txt", "licenses/MIT.txt", "licenses/mattpocock-MIT.txt", "licenses/humanlayer-MIT.txt",
	...PROVENANCE.skills.flatMap((skill) => skill.resources.map(({ path }) => `skills/${skill.name}/${path}`)),
	...EXPECTED_PROMPTS.map((name) => `prompts/${name}.md`),
].sort();

function disabledMcp() {
	return pi.createMcpExtension({
		loadConfig: () => ({ errors: [], servers: [
			{ name: "context7", config: { url: "https://example.invalid", enabled: false }, source: "fixture" },
			{ name: "engram", config: { command: "engram", enabled: false }, source: "fixture" },
		] }),
		createTransport: () => { throw new Error("No connection allowed in package tests"); },
	});
}

test("shouldDiscoverAndExpandAllPromptsWhenLoadedFromAnotherWorkspace", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const { loader } = await loadPackage(cwd);
	// When
	const { prompts, diagnostics } = loader.getPrompts();
	const expansions = prompts.map((prompt) => ({
		name: prompt.name,
		withArgs: expandPromptTemplate(`/${prompt.name} "src/path with spaces.ts" target`, prompts),
		withoutArgs: expandPromptTemplate(`/${prompt.name}`, prompts),
	}));
	// Then
	assert.deepEqual({ names: prompts.map(({ name }) => name).sort(), diagnostics, errors: loader.getExtensions().errors },
		{ names: EXPECTED_PROMPTS, diagnostics: [], errors: [] });
	for (const expansion of expansions) {
		assert.match(expansion.withArgs, /src\/path with spaces\.ts target/);
		assert.doesNotMatch(expansion.withArgs, /\$ARGUMENTS/);
		assert.doesNotMatch(expansion.withoutArgs, /\$ARGUMENTS/);
	}
});

test("shouldLoadPromptsAndExtensionsWhenExplicitPackageBypassesDiscovery", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const loader = new pi.DefaultResourceLoader({
		cwd, agentDir: isolatedAgentDir, settingsManager: pi.SettingsManager.inMemory(),
		noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true,
		additionalExtensionPaths: [packageRoot],
	});
	// When
	await loader.reload();
	// Then
	assert.deepEqual({
		extensions: loader.getExtensions().extensions.map(({ path }) => basename(path)).sort(),
		errors: loader.getExtensions().errors,
		prompts: loader.getPrompts().prompts.map(({ name }) => name).sort(),
		skills: loader.getSkills().skills.length,
	}, {
		extensions: ["compact-tools.ts", "index.ts", "instructions.ts", "mcp.ts", "nan.ts", "skill-registry.ts", "status-ui.ts", "subagents.ts"],
		errors: [], prompts: EXPECTED_PROMPTS, skills: 56,
	});
});

for (const manager of ["pnpm", "npm"]) test(`shouldLoadOnlyPackagedResourcesWhen${manager}TarballIsExtractedElsewhere`, async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const packing = JSON.parse(execFileSync(manager, ["pack", "--ignore-scripts", "--json", "--pack-destination", cwd], {
		cwd: packageRoot, encoding: "utf8", env: { ...process.env, npm_config_cache: join(cwd, "npm-cache") },
	}));
	const packed = Array.isArray(packing) ? packing[0] : packing;
	execFileSync("tar", ["-xzf", resolve(cwd, packed.filename), "-C", cwd]);
	const modules = join(cwd, "node_modules"); await mkdir(modules);
	const extracted = join(modules, "harness package with spaces");
	await rename(join(cwd, "package"), extracted);
	// Provision only locked runtime dependencies, offline and without installing host peers.
	for (const file of ["pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
		await copyFile(join(packageRoot, file), join(extracted, file));
	}
	execFileSync("pnpm", ["install", "--prod", "--offline", "--frozen-lockfile", "--ignore-scripts"], {
		cwd: extracted, encoding: "utf8", timeout: 30000,
	});
	const workspace = join(cwd, "consumer");
	await mkdir(workspace);
	// When
	const resources = await loadPackage(workspace, {
		packagePath: extracted, loadSkills: true, settings: { theme: "system" }, extensionFactories: [disabledMcp()],
	});
	const { session, errors } = await startSession(t, workspace, resources);
	await mcpStatus(session);
	const result = await session.extensionRunner.emitBeforeAgentStart("Make a scoped change", undefined, {
		cwd: workspace, customPrompt: "Host instructions", selectedTools: ["read", "bash", "edit", "write"],
		sections: { existing: "Project-specific instructions" },
	});
	const manifest = JSON.parse(await readFile(join(extracted, "package.json"), "utf8"));
	// Then
	assert.deepEqual({
		files: packed.files.map(({ path }) => path).sort(),
		errors: [...resources.loader.getExtensions().errors, ...errors],
		prompts: resources.loader.getPrompts().prompts.map(({ name }) => name).sort(),
		skills: resources.loader.getSkills().skills.map(({ name }) => name).sort(),
		skillDiagnostics: resources.loader.getSkills().diagnostics,
		active: session.getActiveToolNames(),
		prefix: result.systemPromptOptions.customPrompt,
		preservedSection: result.systemPromptOptions.sections.existing,
		theme: resources.settingsManager.getTheme(),
		dependencies: manifest.dependencies,
		peers: manifest.peerDependencies,
		nanProvider: session.modelRuntime.getProvider("nan")?.name,
		nanModels: session.modelRuntime.getModels("nan").map(({ id }) => id),
	}, {
		files: EXPECTED_FILES, errors: [], prompts: EXPECTED_PROMPTS,
		skills: PROVENANCE.skills.map(({ name }) => name).sort(), skillDiagnostics: [],
		active: ["read", "bash", "edit", "write", "subagent_collect", "subagent_run", "orchestraitor_tasks", "orchestraitor_ask", "skill_registry"], prefix: "Host instructions",
		preservedSection: "Project-specific instructions", theme: "system", dependencies: { "beautiful-mermaid": "1.1.3" },
		peers: { "@earendil-works/pi-ai": "*", "@earendil-works/pi-coding-agent": "*", "@earendil-works/pi-tui": "*", typebox: "*" },
		nanProvider: "NaN", nanModels: ["deepseek-v4-flash", "glm5.3-flash", "qwen3.8-flash", "mimo-v2.6-flash", "gemma4", "qwen3.6", "glm5.3"],
	});
	// Native extensions must work under node_modules, including spaces.
	assert.ok(packed.files.every(({ path }) => !path.startsWith("herdr/") && !path.includes("workbench")));
	// The extracted bootstrap must resolve its sibling guard/runtime files without repo imports.
	const { BatchController } = await import(pathToFileURL(join(extracted, "extensions/subagent/controller.mjs")).href);
	const { hostRoot } = await import("./helpers/pi-host.mjs");
	const [childResult] = await new BatchController({ sdkRoot: hostRoot, credentialDir: isolatedAgentDir,
		childPath: join(extracted, "extensions/subagent/child.mjs") }).run([{
		id: "extracted", role: "explore", instruction: "inspect", cwd: workspace,
		model: "unavailable/model", reasoning: "high", skills: [], files: [], contextFiles: [], tools: ["read", "search", "list"],
	}], () => "No model call is allowed");
	assert.deepEqual({ status: childResult.status, terminated: childResult.terminated }, { status: "failed", terminated: true });
	assert.match(childResult.diagnostic, /Model unavailable/);
	assert.match(result.systemPromptOptions.sections.pi_orchestraitor_execution, /Orchestraitor/);
	assert.match(result.systemPromptOptions.sections.pi_orchestraitor_personality, /Colombian software architect/);
	assert.equal(PROVENANCE.skills.length, 56);
	for (const skill of PROVENANCE.skills) {
		for (const resource of skill.resources) {
			const bytes = await readFile(join(extracted, "skills", skill.name, resource.path));
			assert.equal(createHash("sha256").update(bytes).digest("hex"), resource.sha256);
		}
	}
	for (const file of EXPECTED_FILES) {
		assert.doesNotMatch(await readFile(join(extracted, file), "utf8"), /\/Users\/sopra\/|\/opt\/homebrew\//);
	}
});

test("shouldRegisterBtwOnceWhenStandaloneCopyIsExcluded", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const original = join(isolatedAgentDir, "extensions/btw");
	await mkdir(original, { recursive: true });
	await writeFile(join(original, "index.ts"), `export default function(pi) {
		pi.registerCommand("btw", { description: "Standalone fixture", handler: async () => {} });
	}`);
	t.after(() => rm(original, { recursive: true, force: true }));
	// When
	const resources = await loadPackage(cwd, { settings: { extensions: [`-${join(original, "index.ts")}`] } });
	const loaded = resources.loader.getExtensions();
	const owners = loaded.extensions.filter((extension) => extension.commands.has("btw"));
	// Then
	assert.deepEqual({ paths: owners.map(({ path }) => path), errors: loaded.errors },
		{ paths: [join(packageRoot, "extensions/btw/index.ts")], errors: [] });
});

test("shouldAvoidDoubleRegistrationWhenOriginalGlobalExtensionIsExcluded", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const extensionsDir = join(isolatedAgentDir, "extensions");
	await mkdir(extensionsDir, { recursive: true });
	const original = join(extensionsDir, "compact-tools.ts");
	await copyFile(join(packageRoot, "extensions/compact-tools.ts"), original);
	t.after(() => rm(original, { force: true }));
	// When
	const resources = await loadPackage(cwd, {
		settings: { extensions: [`-${original}`] },
		extensionFactories: [disabledMcp()],
	});
	const { session, errors } = await startSession(t, cwd, resources);
	await mcpStatus(session);
	const extensions = resources.loader.getExtensions().extensions;
	// Then
	assert.deepEqual({
		compactPaths: extensions.filter(({ path }) => basename(path) === "compact-tools.ts").map(({ path }) => path),
		tools: session.extensionRunner.getAllRegisteredTools().map(({ definition }) => definition.name).sort(),
		errors,
	}, {
		compactPaths: [join(packageRoot, "extensions/compact-tools.ts")],
		tools: ["bash", "edit", "orchestraitor_ask", "orchestraitor_tasks", "read", "skill_registry", "subagent_collect", "subagent_run", "write"], errors: [],
	});
});
