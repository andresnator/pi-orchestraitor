import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createWorkspace, importHost, loadExtensions, packageRoot } from "./helpers/pi-host.mjs";

const { normalizeBuildSystemPromptOptions, buildSystemPrompt, buildSystemPromptSections } = await importHost("dist/core/system-prompt.js");
// Pi starts runs from a submitted prompt or from an idle custom message with triggerTurn.
const TRIGGERS = {
	UserPrompt: { messageType: "user", prompt: "Review only" },
	CustomMessage: { messageType: "custom", message: { role: "custom", customType: "fixture", content: "Continue", display: false, timestamp: 0 } },
};

for (const mode of ["tui", "print", "json", "rpc"]) for (const [trigger, fields] of Object.entries(TRIGGERS)) {
	test(`shouldPreservePromptAndToolsWhen${trigger}StartsARunIn${mode}`, async (t) => {
		// Given
		const cwd = await createWorkspace(t);
		const loaded = await loadExtensions([join(packageRoot, "extensions/instructions.ts")], cwd);
		assert.deepEqual(loaded.errors, []);
		const options = normalizeBuildSystemPromptOptions({
			cwd,
			customPrompt: "Original system prefix",
			selectedTools: ["read"],
			promptGuidelines: ["Existing rule"],
			sections: { other_extension: "Keep this" },
			contextFiles: [{ path: "AGENTS.md", content: "Repository rule" }],
		});
		const original = structuredClone(options);
		const event = { type: "before_agent_start", ...fields, systemPromptOptions: options };
		const handlers = loaded.extensions[0].handlers.get("before_agent_start");
		// When
		const results = [];
		for (let turn = 0; turn < 2; turn++) {
			for (const handler of handlers) results.push(await handler(event, { cwd, mode }));
		}
		// Then
		assert.deepEqual({ options, results }, {
			options: {
				...original,
				sections: {
					...original.sections,
					pi_orchestraitor_core: await readFile(join(packageRoot, "instructions/core.md"), "utf8"),
					pi_orchestraitor_execution: await readFile(join(packageRoot, "instructions/orchestraitor.md"), "utf8"),
					pi_orchestraitor_personality: await readFile(join(packageRoot, "instructions/personality.md"), "utf8"),
				},
			},
			results: [undefined, undefined],
		});
		assert.match(buildSystemPrompt(options), /<pi_orchestraitor_execution>[\s\S]*Orchestraitor/);
		assert.equal(buildSystemPrompt(options).split("<pi_orchestraitor_personality>").length, 2);
	});
}

test("shouldKeepTasksAsEvidenceProjectionWhenExecutionGuidanceIsLoaded", async () => {
	// Given
	const path = join(packageRoot, "instructions/orchestraitor.md");
	// When
	const instructions = await readFile(path, "utf8");
	// Then
	assert.match(instructions, /direct model-only `orchestraitor_tasks`/);
	assert.match(instructions, /Child completion never marks tasks done/);
	assert.match(instructions, /not execution authority or durable SDD recovery/);
	assert.match(instructions, /set each task's group to its plan group/);
});

test("shouldKeepQuestionsAsClarificationWithoutGrantingPermissionsWhenGuidanceIsLoaded", async () => {
	// Given
	const path = join(packageRoot, "instructions/orchestraitor.md");
	// When
	const instructions = await readFile(path, "utf8");
	// Then
	assert.match(instructions, /direct model-only `orchestraitor_ask`/);
	assert.match(instructions, /cancelled, busy or unavailable results are not approval/);
	assert.match(instructions, /never replace native trust\/security dialogs/);
});

test("shouldKeepOnePersonalitySectionWhenTheInstructionsExtensionIsReloaded", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const path = join(packageRoot, "extensions/instructions.ts");
	const options = normalizeBuildSystemPromptOptions({ cwd, customPrompt: "Host rules", sections: { project: "Project rules" } });
	// When
	for (let reload = 0; reload < 2; reload++) {
		const loaded = await loadExtensions([path], cwd);
		assert.deepEqual(loaded.errors, []);
		for (const handler of loaded.extensions[0].handlers.get("before_agent_start")) {
			await handler({ type: "before_agent_start", messageType: "user", prompt: "Hello", systemPromptOptions: options }, { cwd, mode: "print" });
		}
	}
	// Then
	const prompt = buildSystemPrompt(options);
	assert.deepEqual({ personalitySections: prompt.split("<pi_orchestraitor_personality>").length - 1, host: options.customPrompt, project: options.sections.project },
		{ personalitySections: 1, host: "Host rules", project: "Project rules" });
});

const READ_WHOLE_DOCS = "- Always read pi .md files completely and follow links to related docs";

/** Mirror Pi's runner: every read renders the options as earlier handlers left them. */
function startEvent(options) {
	return { type: "before_agent_start", messageType: "user", prompt: "Explain pi extensions", systemPromptOptions: options,
		get systemPrompt() { return buildSystemPrompt(options); } };
}

async function ownedSections() {
	return {
		pi_orchestraitor_core: await readFile(join(packageRoot, "instructions/core.md"), "utf8"),
		pi_orchestraitor_execution: await readFile(join(packageRoot, "instructions/orchestraitor.md"), "utf8"),
		pi_orchestraitor_personality: await readFile(join(packageRoot, "instructions/personality.md"), "utf8"),
	};
}

test("shouldKeepNativeDocsOutOfCustomSectionsWhenAddingOwnedInstructions", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const loaded = await loadExtensions([join(packageRoot, "extensions/instructions.ts")], cwd);
	assert.deepEqual(loaded.errors, []);
	const options = normalizeBuildSystemPromptOptions({ cwd, selectedTools: ["read"], sections: { other_extension: "Keep this" } });
	const original = structuredClone(options);
	const nativeDocs = buildSystemPromptSections(options).docs;
	const event = startEvent(options);
	// When
	const results = [];
	for (let turn = 0; turn < 2; turn++) {
		for (const handler of loaded.extensions[0].handlers.get("before_agent_start")) results.push(await handler(event, { cwd, mode: "tui" }));
	}
	// Then
	assert.deepEqual({ options, results, docs: buildSystemPromptSections(options).docs,
		docsSections: buildSystemPrompt(options).split("<docs>").length - 1 }, {
		options: { ...original, sections: { ...original.sections, ...await ownedSections() } },
		results: [undefined, undefined], docs: nativeDocs, docsSections: 1,
	});
});

test("shouldPreserveCustomDocsWhenAnotherExtensionProvidesThem", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const loaded = await loadExtensions([join(packageRoot, "extensions/instructions.ts")], cwd);
	assert.deepEqual(loaded.errors, []);
	const options = normalizeBuildSystemPromptOptions({ cwd, selectedTools: ["read"],
		sections: { docs: `External documentation guidance\n${READ_WHOLE_DOCS}` } });
	const original = structuredClone(options);
	const event = startEvent(options);
	// When
	for (const handler of loaded.extensions[0].handlers.get("before_agent_start")) await handler(event, { cwd, mode: "print" });
	// Then
	assert.deepEqual(options, { ...original, sections: { ...original.sections, ...await ownedSections() } });
});

test("shouldPreferRelevantSectionsOverWholeFilesWhenCoreGuidanceIsLoaded", async () => {
	// Given
	const path = join(packageRoot, "instructions/core.md");
	// When
	const instructions = await readFile(path, "utf8");
	// Then
	assert.match(instructions, /For Pi Markdown documentation, this overrides whole-file reading guidance: list headings first, read the relevant sections completely, and follow related documentation links\./);
});
