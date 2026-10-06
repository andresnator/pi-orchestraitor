import assert from "node:assert/strict";
import { mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createWorkspace, importHost, isolatedAgentDir, packageRoot, pi, startSession } from "./helpers/pi-host.mjs";

const { buildSystemPrompt } = await importHost("dist/core/system-prompt.js");
const NAME = "java-fixture";
const MANUAL = "manual-fixture";
const BODY = "Selected fixture instructions, never included in the initial catalog.";
async function writeSkill(root, name, manual = false) {
	const directory = join(root, name);
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: Java fixture testing.\ndisable-model-invocation: ${manual}\n---\n${BODY}\n`);
}
async function fixture(t, skillsOverride, source = ".config/opencode/skills") {
	const cwd = await createWorkspace(t);
	const root = join(cwd, source);
	await writeSkill(root, NAME);
	await writeSkill(root, MANUAL, true);
	const settingsManager = pi.SettingsManager.inMemory({ packages: [{ source: packageRoot, extensions: ["!extensions/mcp.ts"], skills: [], prompts: [] }] }, { projectTrusted: true });
	const loader = new pi.DefaultResourceLoader({
		cwd, agentDir: isolatedAgentDir, settingsManager, noSkills: true,
		additionalSkillPaths: [root], noContextFiles: true, noThemes: true, skillsOverride,
	});
	await loader.reload();
	const { session, errors } = await startSession(t, cwd, { loader, settingsManager });
	assert.deepEqual([...loader.getExtensions().errors, ...errors], []);
	const prepare = () => session.extensionRunner.emitBeforeAgentStart("Work on the fixture", undefined,
		session.extensionRunner.createCommandContext().getSystemPromptOptions());
	const ctx = () => session.extensionRunner.createContext();
	const execute = (params) => session.getToolDefinition("skill_registry").execute("registry-fixture", params, undefined, undefined, ctx());
	return { cwd, root, session, loader, prepare, execute };
}

test("shouldHonorTheNativeToolSignalWhenASkillLookupIsCancelled", async (t) => {
	// Given
	const { session, prepare } = await fixture(t);
	await prepare();
	const controller = new AbortController();
	controller.abort();
	const ctx = session.extensionRunner.createToolContext("cancelled", controller.signal);
	// When / Then
	await assert.rejects(session.getToolDefinition("skill_registry").execute("cancelled", { operation: "search", query: "java" }, controller.signal, undefined, ctx), /abort/i);
});

test("shouldDelegateRefreshedProjectSkillBodiesWhenTheRealRegistryResolvesNames", async (t) => {
	// Given
	const key = Symbol.for("pi-orchestraitor.subagent-controller");
	const previous = globalThis[key];
	const batches = [];
	globalThis[key] = { async cancel() {}, async run(manifests, promptFor) { batches.push({ manifests, prompts: manifests.map(promptFor) }); return []; } };
	const { root, session, prepare } = await fixture(t, undefined, ".agents/skills");
	t.after(() => { globalThis[key] = previous; });
	await prepare();
	await writeFile(join(root, NAME, "SKILL.md"), `---\nname: ${NAME}\ndescription: Java fixture testing.\n---\nFresh project body after native registration.\n`);
	const model = { provider: "fixture", id: "registry" };
	const ctx = { ...session.extensionRunner.createContext(), model, modelRegistry: { getAvailable: () => [model] } };
	// When
	await session.getToolDefinition("subagent_run").execute("registry-project", { tasks: [{ role: "review", instruction: "inspect", skills: [NAME] }] }, undefined, undefined, ctx);
	// Then
	assert.match(batches[0].prompts[0], /Fresh project body after native registration/);
	assert.doesNotMatch(batches[0].prompts[0], new RegExp(BODY));
});

test("shouldSearchLoadAndDelegateAnUnnamedNativeAliasAcrossReloads", async (t) => {
	const key = Symbol.for("pi-orchestraitor.subagent-controller"), previous = globalThis[key], batches = [];
	globalThis[key] = { async cancel() {}, async run(manifests, promptFor) { batches.push({ manifests, prompts: manifests.map(promptFor) }); return []; } };
	t.after(() => { globalThis[key] = previous; });
	const { cwd, root, session, loader, prepare, execute } = await fixture(t, undefined, ".agents/skills");
	const target = join(cwd, "vendor", "original"), alias = join(root, "chosen");
	await mkdir(target, { recursive: true });
	await writeFile(join(target, "SKILL.md"), "---\ndescription: Aliased native fixture.\n---\nSELECTED_ALIAS_BODY\n");
	await symlink(target, alias);
	const canonicalFile = await realpath(join(target, "SKILL.md"));
	const model = { provider: "fixture", id: "registry" };
	for (let reload = 0; reload < 2; reload++) {
		await session.reload();
		assert.ok(loader.getSkills().skills.some(({ name, filePath }) => name === "chosen" && filePath === join(alias, "SKILL.md")));
		await prepare();
		const search = await execute({ operation: "search", query: "chosen" });
		assert.deepEqual(JSON.parse(search.content[0].text).matches.map(({ name }) => name), ["chosen"]);
		const loaded = await execute({ operation: "load", name: "chosen" });
		assert.match(loaded.content[0].text, /SELECTED_ALIAS_BODY/);
		const ctx = { ...session.extensionRunner.createContext(), model, modelRegistry: { getAvailable: () => [model] } };
		await session.getToolDefinition("subagent_run").execute("alias", { tasks: [{ role: "review", instruction: "inspect", skills: ["chosen"] }] }, undefined, undefined, ctx);
		assert.equal(batches.at(-1).manifests[0].skills[0].filePath, canonicalFile);
		assert.equal(batches.at(-1).manifests[0].skills[0].name, "chosen");
		assert.match(batches.at(-1).prompts[0], /SELECTED_ALIAS_BODY/);
	}
});

test("shouldRefreshResourcesAndRemovalsWithoutRewritingAnUnchangedRegistryWhenRequestsStart", async (t) => {
	// Given
	const { cwd, root, prepare, execute } = await fixture(t);
	const registryPath = join(cwd, ".ai", "skills", "registry.md");
	await prepare();
	const original = await readFile(registryPath, "utf8");
	const originalTime = (await stat(registryPath)).mtimeMs;
	// When
	await prepare();
	const unchangedTime = (await stat(registryPath)).mtimeMs;
	const references = join(root, NAME, "references");
	await mkdir(references);
	await writeFile(join(references, "guide.md"), "A newly added supporting resource.");
	await prepare();
	const changed = await readFile(registryPath, "utf8");
	await rm(join(root, NAME, "SKILL.md"));
	await prepare();
	const search = await execute({ operation: "search", query: "java testing" });
	// Then
	assert.equal(unchangedTime, originalTime);
	assert.notEqual(changed, original);
	assert.deepEqual(JSON.parse(search.content[0].text).matches, []);
	assert.match(await readFile(registryPath, "utf8"), /unavailable/);
	await assert.rejects(execute({ operation: "load", name: NAME }), /unavailable/i);
});

test("shouldReplaceHeadersWithLazyDiscoveryWhenTheFirstPromptIsPrepared", async (t) => {
	// Given
	const { cwd, session, loader, prepare } = await fixture(t);
	// When
	const prepared = await prepare();
	const prompt = buildSystemPrompt(prepared.systemPromptOptions);
	// Then
	assert.doesNotMatch(prompt, /<available_skills>/);
	assert.match(prompt, /skill_registry/);
	assert.doesNotMatch(prompt, new RegExp(BODY));
	assert.ok(session.getToolDefinition("skill_registry"));
	assert.deepEqual(loader.getSkills().skills.map(({ name, disableModelInvocation }) => ({ name, disableModelInvocation })).sort((a, b) => a.name.localeCompare(b.name)), [
		{ name: NAME, disableModelInvocation: false }, { name: MANUAL, disableModelInvocation: true },
	]);
	assert.match(await readFile(join(cwd, ".ai", "skills", "registry.md"), "utf8"), /opencode/);
});

test("shouldBoundSearchAndPreserveManualCommandsWhenSkillsAreLoadedOnDemand", async (t) => {
	// Given
	const { session, prepare, execute } = await fixture(t);
	await prepare();
	// When
	const search = await execute({ operation: "search", query: "java testing", limit: 1 });
	const loaded = await execute({ operation: "load", name: NAME });
	// Then
	assert.deepEqual(JSON.parse(search.content[0].text).matches.map(({ name }) => name), [NAME]);
	assert.match(loaded.content[0].text, new RegExp(BODY));
	await assert.rejects(execute({ operation: "load", name: MANUAL }), /manual-only|explicit/i);
	assert.ok(session.extensionRunner.createCommandContext().getSystemPromptOptions().skills.some(({ name, disableModelInvocation }) => name === MANUAL && disableModelInvocation));
});

test("shouldRequireNativeReloadWhenANewNameAppearsInAConfiguredSource", async (t) => {
	// Given
	const { root, session, prepare, execute } = await fixture(t);
	await prepare();
	await writeSkill(root, "new-fixture");
	// When / Then
	await assert.rejects(execute({ operation: "load", name: "new-fixture" }), /unavailable|reload/i);
	await session.reload();
	await prepare();
	const loaded = await execute({ operation: "load", name: "new-fixture" });
	assert.match(loaded.content[0].text, new RegExp(BODY));
});

test("shouldKeepHostExcludedSkillsUnavailableWhenNativeReloadReappliesPolicy", async (t) => {
	// Given
	const { root, session, prepare, execute } = await fixture(t, (result) => ({ ...result, skills: result.skills.filter(({ name }) => name !== "denied-fixture") }));
	await prepare();
	await writeSkill(root, "denied-fixture");
	// When
	await session.reload();
	await prepare();
	// Then
	await assert.rejects(execute({ operation: "load", name: "denied-fixture" }), /unavailable/i);
});

test("shouldRestoreNativeHeadersWhenTheUserSelectsNativeMode", async (t) => {
	// Given
	const { session, prepare } = await fixture(t);
	await prepare();
	const command = session.extensionRunner.getCommand("orchestraitor:skills");
	const ctx = session.extensionRunner.createCommandContext();
	// When
	await command.handler("native", ctx);
	const native = await prepare();
	await command.handler("lazy", ctx);
	const lazy = await prepare();
	// Then
	assert.match(buildSystemPrompt(native.systemPromptOptions), /<available_skills>/);
	assert.doesNotMatch(buildSystemPrompt(lazy.systemPromptOptions), /<available_skills>/);
});
