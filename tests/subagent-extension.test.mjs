import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createWorkspace, loadExtensions, packageRoot, pi } from "./helpers/pi-host.mjs";
import { REGISTRY_RESOLVE_EVENT } from "../extensions/skills/registry.mjs";

const controllerKey = Symbol.for("pi-orchestraitor.subagent-controller");

test("shouldPreserveHandoffAndSafetyEvidenceWithoutRepeatedMetadataWhenChildrenFinish", async (t) => {
	// Given
	const child = { id: "child", role: "review", cwd: "/project", model: "fixture/first", reasoning: "high", status: "cancelled",
		finalResponse: "Observed src/a.ts:12; remaining check unavailable", writes: [{ path: "src/a.ts", status: "completed" }],
		diagnostic: "Cancelled after a completed write", terminated: true, usageComplete: false,
		usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
	const { tool, ctx } = await fixture(t, [child]);
	// When
	const result = await tool.execute("run", { tasks: [{ role: "review", instruction: "Inspect one file" }] }, undefined, undefined, ctx);
	// Then
	assert.deepEqual(JSON.parse(result.content[0].text), [{ id: "child", status: "cancelled", finalResponse: child.finalResponse,
		writes: child.writes, diagnostic: child.diagnostic, terminated: true, usageComplete: false }]);
	assert.deepEqual(result.details.results, [child]);
	assert.deepEqual(result.usage, child.usage);
});
async function fixture(t, results = []) {
	const cwd = await realpath(await createWorkspace(t));
	const batches = [];
	const previous = globalThis[controllerKey];
	globalThis[controllerKey] = { cancelCount: 0, async cancel() { this.cancelCount++; }, async run(manifests, promptFor) {
		batches.push({ manifests, prompts: manifests.map(promptFor) }); return results;
	} };
	t.after(() => { globalThis[controllerKey] = previous; });
	const eventBus = pi.createEventBus();
	const loaded = await loadExtensions([join(packageRoot, "extensions/subagents.ts")], cwd, eventBus);
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
	return { cwd, batches, loaded, extension, ctx, capture, eventBus, tool: extension.tools.get("subagent_run").definition };
}

for (const scenario of ["writer", "readers", "partial", "unknown"]) {
	test(`shouldExposeNativeBatchUsageWhenResultsAre${scenario}`, async (t) => {
		// Given
		const usage = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10, reasoning: 1, cacheWrite1h: 2,
			cost: { input: 0.125, output: 0.25, cacheRead: 0, cacheWrite: 0, total: 0.375 } };
		const results = scenario === "writer" ? [{ id: "one", role: "implement", status: "completed", usage, usageComplete: true }]
			: [{ id: "one", role: "explore", status: "completed", ...(scenario !== "unknown" ? { usage } : {}), usageComplete: scenario !== "unknown" },
				{ id: "two", role: "review", status: scenario === "partial" ? "cancelled" : "completed", ...(scenario !== "unknown" ? { usage } : {}), usageComplete: scenario === "readers" }];
		const { tool, ctx } = await fixture(t, results);
		const tasks = results.map(({ role }) => ({ role, instruction: "inspect", ...(role === "implement" ? { files: ["target"] } : {}) }));
		// When
		const result = await tool.execute("usage", { tasks }, undefined, undefined, ctx);
		// Then
		const expected = scenario === "unknown" ? undefined : scenario === "writer" ? usage
			: { input: 2, output: 4, cacheRead: 6, cacheWrite: 8, totalTokens: 20, reasoning: 2, cacheWrite1h: 4,
				cost: { input: 0.25, output: 0.5, cacheRead: 0, cacheWrite: 0, total: 0.75 } };
		const handoffs = scenario === "writer" ? [{ id: "one", status: "completed", usageComplete: true }]
			: [{ id: "one", status: "completed", usageComplete: scenario !== "unknown" },
				{ id: "two", status: scenario === "partial" ? "cancelled" : "completed", usageComplete: scenario === "readers" }];
		assert.deepEqual(result, { content: [{ type: "text", text: JSON.stringify(handoffs) }],
			details: { results, usageComplete: ["writer", "readers"].includes(scenario) }, ...(expected ? { usage: expected } : {}) });
	});
}

test("shouldForwardNativeProgressWithoutResultsOrUsageWhenObserverReportsPhases", async (t) => {
	// Given
	const results = [{ id: "runtime", role: "explore", model: "fixture/first", status: "completed", terminated: true }];
	const { tool, ctx, extension } = await fixture(t, results);
	let observer, observedManifest;
	globalThis[controllerKey].run = async (manifests, _prompt, _signal, report) => {
		observer = report;
		observedManifest = manifests[0];
		for (const phase of ["starting", "running", "stopping", "completed"]) {
			report({ id: manifests[0].id, role: manifests[0].role, label: "inspect", requestedModel: manifests[0].model,
				...(phase !== "starting" ? { effectiveModel: manifests[0].model } : {}), phase });
		}
		return results;
	};
	const updates = [];
	// When
	const result = await tool.execute("native/1", { tasks: [{ role: "explore", instruction: "inspect" }] },
		undefined, (value) => updates.push(value), ctx);
	const before = updates.length;
	await extension.handlers.get("session_shutdown")[0]({ type: "session_shutdown" }, ctx);
	observer({ id: observedManifest.id, role: observedManifest.role, label: "inspect",
		requestedModel: observedManifest.model, phase: "failed" });
	// Then
	assert.deepEqual(result, { content: [{ type: "text", text: '[{"id":"runtime","status":"completed","terminated":true}]' }],
		details: { results, usageComplete: false } });
	assert.equal(updates.length, before);
	assert.ok(updates.every((value) => value.content.length === 0 && !value.usage && !value.details.results));
	assert.deepEqual(updates.map(({ details }) => details.progress.sequence), [1, 2, 3, 4, 5, 6]);
	assert.ok(updates.every(({ details }) => details.progress.toolCallId === "native/1" &&
		Object.isFrozen(details.progress) && Object.isFrozen(details.progress.tasks) &&
		details.progress.tasks.every(Object.isFrozen)));
});

test("shouldIgnoreBrokenProgressCallbackWhenNativeResultIsReturned", async (t) => {
	// Given
	const { tool, ctx } = await fixture(t, [{ id: "one", role: "explore", status: "completed", usageComplete: false }]);
	// When
	const result = await tool.execute("native", { tasks: [{ role: "explore", instruction: "inspect" }] },
		undefined, () => { throw new Error("UI failed"); }, ctx);
	// Then
	assert.equal(result.details.results[0].status, "completed");
	assert.equal(result.usage, undefined);
});

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
	await tool.execute("batch", { tasks: [{ role: "implement", instruction: "Correct the typo in the assigned file", context: "Acceptance: only the typo changes; parent verifies the diff.", files }] }, undefined, undefined, ctx);
	// Then
	const prompt = batches[0].prompts[0];
	assert.ok(prompt.includes(`Editable files (exact project-relative paths):\n${JSON.stringify(files, null, 2)}`));
	assert.match(prompt, /Correct the typo in the assigned file/);
	assert.match(prompt, /Acceptance: only the typo changes; parent verifies the diff\./);
	assert.equal(prompt.match(/Handoff:/g)?.length, 1);
	assert.match(prompt, /inspected\/changed paths and relevant line ranges/);
	assert.match(prompt, /observed findings from inference/);
	assert.match(prompt, /blockers, remaining work and unperformed checks/);
	assert.match(prompt, /Do not run commands, delegate, or claim checks you did not perform/);
});

test("shouldUseTheRefreshedRegistryBodyWhenTheNativeNameIsDelegated", async (t) => {
	// Given
	const { cwd, tool, ctx, batches, capture, eventBus } = await fixture(t);
	const directory = join(cwd, "chosen");
	await mkdir(directory);
	const filePath = join(directory, "SKILL.md");
	await writeFile(filePath, "Do not reread a stale body after resolution.");
	const skill = { name: "chosen", filePath, baseDir: directory };
	capture([skill]);
	eventBus.on(REGISTRY_RESOLVE_EVENT, (request) => { request.result = Promise.resolve([{ skill, body: "Fresh authoritative selected body" }]); });
	// When
	await tool.execute("registry", { tasks: [{ role: "explore", instruction: "inspect", skills: ["chosen"] }] }, undefined, undefined, ctx);
	// Then
	assert.match(batches[0].prompts[0], /Fresh authoritative selected body/);
	assert.doesNotMatch(batches[0].prompts[0], /Do not reread a stale body/);
});

test("shouldNotFallBackToACapturedSkillWhenTheRegistryRejectsDelegation", async (t) => {
	// Given
	const { cwd, tool, ctx, batches, capture, eventBus } = await fixture(t);
	capture([{ name: "chosen", filePath: join(cwd, "SKILL.md"), baseDir: cwd }]);
	eventBus.on(REGISTRY_RESOLVE_EVENT, (request) => { request.result = Promise.reject(new Error("Native skill is no longer available")); });
	// When / Then
	await assert.rejects(tool.execute("registry", { tasks: [{ role: "explore", instruction: "inspect", skills: ["chosen"] }] }, undefined, undefined, ctx), /no longer available/);
	assert.deepEqual(batches, []);
});

test("shouldRejectManualOnlySkillsWhenNoRegistryResolverHandlesDelegation", async (t) => {
	// Given
	const { cwd, tool, ctx, batches, capture } = await fixture(t);
	const filePath = join(cwd, "SKILL.md");
	await writeFile(filePath, "Manual instructions must not reach a model automatically.");
	capture([{ name: "manual", filePath, baseDir: cwd, disableModelInvocation: true }]);
	// When / Then
	await assert.rejects(tool.execute("manual", { tasks: [{ role: "explore", instruction: "inspect", skills: ["manual"] }] }, undefined, undefined, ctx), /manual-only|explicit/i);
	assert.deepEqual(batches, []);
});
