import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createWorkspace, loadExtensions, packageRoot } from "./helpers/pi-host.mjs";

const controllerKey = Symbol.for("pi-orchestraitor.subagent-controller");
async function fixture(t) {
	const cwd = await realpath(await createWorkspace(t));
	const batches = [];
	const previous = globalThis[controllerKey];
	globalThis[controllerKey] = { cancelCount: 0, async cancel() { this.cancelCount++; }, async run(manifests, promptFor) {
		batches.push({ manifests, prompts: manifests.map(promptFor) }); return [];
	} };
	t.after(() => { globalThis[controllerKey] = previous; });
	const loaded = await loadExtensions([join(packageRoot, "extensions/subagents.ts")], cwd);
	assert.deepEqual(loaded.errors, []);
	loaded.runtime.getThinkingLevel = () => "high";
	loaded.runtime.getActiveTools = () => ["read", "edit", "write", "subagent_run"];
	const extension = loaded.extensions[0];
	const models = [{ provider: "fixture", id: "first" }, { provider: "fixture", id: "second" }];
	const ctx = { cwd, model: models[0], modelRegistry: { getAvailable: () => models }, scopedModels: [] };
	const capture = (skills = []) => extension.handlers.get("before_agent_start")[0]({ systemPromptOptions: {
		cwd, skills, contextFiles: [{ path: "AGENTS.md", content: "captured instructions" }],
	} });
	capture();
	return { cwd, batches, loaded, extension, ctx, capture, tool: extension.tools.get("subagent_run").definition };
}

test("shouldInheritAndOverrideModelAndReasoningWhenPreparingChildTasks", async (t) => {
	// Given
	const { tool, ctx, batches } = await fixture(t);
	// When
	await tool.execute("batch", { tasks: [{ role: "explore", instruction: "first" }, { role: "review", instruction: "second", model: "fixture/second", reasoning: "low" }] }, undefined, undefined, ctx);
	// Then
	assert.deepEqual(batches[0].manifests.map(({ model, reasoning, tools, contextFiles }) => ({ model, reasoning, tools, contextFiles })),
		["first", "second"].map((id, index) => ({ model: `fixture/${id}`, reasoning: index ? "low" : "high", tools: ["read", "search", "list"], contextFiles: [{ path: "AGENTS.md", content: "captured instructions" }] })));
});

test("shouldRejectUnavailableModelsAndDisabledParentToolsBeforeLaunch", async (t) => {
	// Given
	const { tool, ctx, batches, loaded } = await fixture(t);
	// When / Then
	await assert.rejects(tool.execute("bad", { tasks: [{ role: "review", instruction: "inspect", model: "fixture/missing" }] }, undefined, undefined, ctx), /unavailable/);
	await assert.rejects(tool.execute("bad", { tasks: [{ role: "review", instruction: "inspect", model: "fixture/second" }] }, undefined, undefined, { ...ctx, scopedModels: [{ model: ctx.model }] }), /scope/);
	loaded.runtime.getActiveTools = () => ["read", "subagent_run"];
	await assert.rejects(tool.execute("bad", { tasks: [{ role: "implement", instruction: "fix", files: ["target"] }] }, undefined, undefined, ctx), /edit and write/);
	loaded.runtime.getActiveTools = () => ["subagent_run"];
	await assert.rejects(tool.execute("bad", { tasks: [{ role: "explore", instruction: "inspect" }] }, undefined, undefined, ctx), /read tool/);
	assert.deepEqual(batches, []);
});

test("shouldPassOnlySelectedSkillBodiesWhenCapturingEffectiveCatalog", async (t) => {
	// Given
	const { cwd, tool, ctx, batches, capture } = await fixture(t);
	await mkdir(join(cwd, "selected"));
	const skill = { name: "chosen", description: "selected skill", filePath: join(cwd, "selected/SKILL.md"), baseDir: join(cwd, "selected") };
	await writeFile(skill.filePath, "SELECTED_CONTENT");
	capture([skill, { name: "other", filePath: "/unavailable/other/SKILL.md" }]);
	// When
	await tool.execute("batch", { tasks: [{ role: "explore", instruction: "inspect", skills: ["chosen"] }] }, undefined, undefined, ctx);
	// Then
	assert.deepEqual(batches[0].manifests[0].skills, [skill]);
	assert.match(batches[0].prompts[0], /SELECTED_CONTENT/);
	assert.doesNotMatch(batches[0].prompts[0], /unavailable/);
	await assert.rejects(tool.execute("bad", { tasks: [{ role: "explore", instruction: "inspect", skills: ["missing"] }] }, undefined, undefined, ctx), /missing/);
});

for (const event of ["session_before_switch", "session_before_fork", "session_before_tree", "session_shutdown", "session_start"]) {
	test(`shouldCancelAndInvalidateCapturedContextWhen${event}Occurs`, async (t) => {
		// Given
		const { tool, ctx, extension } = await fixture(t);
		// When
		await extension.handlers.get(event)[0]({ type: event }, ctx);
		// Then
		assert.equal(globalThis[controllerKey].cancelCount, 1);
		await assert.rejects(tool.execute("stale", { tasks: [{ role: "explore", instruction: "inspect" }] }, undefined, undefined, ctx), /not been captured/);
	});
}

test("shouldExcludeGlobalInstructionsWhenCapturingProjectContext", async (t) => {
	// Given
	const { cwd, tool, ctx, batches, extension } = await fixture(t);
	extension.handlers.get("before_agent_start")[0]({ systemPromptOptions: { cwd, skills: [], contextFiles: [
		{ path: join(cwd, "AGENTS.md"), content: "PROJECT" },
		{ path: "/outside/AGENTS.md", content: "GLOBAL_LEAK" },
	] } });
	// When
	await tool.execute("batch", { tasks: [{ role: "explore", instruction: "inspect" }] }, undefined, undefined, ctx);
	// Then
	assert.deepEqual(batches[0].manifests[0].contextFiles, [{ path: join(cwd, "AGENTS.md"), content: "PROJECT" }]);
});


test("shouldIncludeExactEditablePathsWhenImplementerReceivesItsAssignment", async (t) => {
	// Given
	const { tool, ctx, batches } = await fixture(t);
	const files = ["src/selected-target.txt", "src/other target.txt"];
	// When
	await tool.execute("batch", { tasks: [{ role: "implement", instruction: "Correct the typo in the assigned file", files }] }, undefined, undefined, ctx);
	// Then
	assert.ok(batches[0].prompts[0].includes(`Editable files (exact project-relative paths):\n${JSON.stringify(files, null, 2)}`));
});
