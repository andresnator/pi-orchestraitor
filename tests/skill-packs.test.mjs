import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";
import { createSkillRegistry } from "../extensions/skills/registry.mjs";
import { createWorkspace, importHost, packageRoot, pi } from "./helpers/pi-host.mjs";
import { CORE_SKILLS, MANUAL_SKILLS } from "./helpers/skill-packs.mjs";

const { AgentSession } = await importHost("dist/core/agent-session.js");
const RETIRED = ["jag-routing", "jag-prd-lite", "jag-arch-state", "jag-boundaries"];
const SCANNED_ROOTS = ["skills", "prompts", "instructions", "extensions"];
const catalog = () => pi.loadSkillsFromDir({ dir: join(packageRoot, "skills"), source: "package" });

test("shouldOfferOnlyCoreSkillsToTheModelWhenTheCatalogIsCaptured", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const { skills, diagnostics } = catalog();
	const registry = createSkillRegistry(pi);
	t.after(() => registry.dispose());
	const ctx = { cwd, isProjectTrusted: () => false };
	// When
	await registry.capture(skills, ctx);
	const loaded = await registry.resolveNames(CORE_SKILLS, ctx);
	// Then
	assert.deepEqual({ diagnostics, manual: skills.filter(({ disableModelInvocation }) => disableModelInvocation).map(({ name }) => name).sort(),
		automatic: registry.status().available, manualOnly: registry.status().manualOnly, loaded: loaded.map(({ skill }) => skill.name),
	}, { diagnostics: [], manual: MANUAL_SKILLS, automatic: CORE_SKILLS.length, manualOnly: MANUAL_SKILLS.length, loaded: CORE_SKILLS });
	for (const name of MANUAL_SKILLS) {
		const search = await registry.search(name, 20, ctx);
		assert.ok(!search.matches.some((match) => match.name === name), `${name} must not be offered to the model`);
		await assert.rejects(registry.resolveNames([name], ctx), /manual-only|explicit.*skill/i);
	}
});

test("shouldExpandEveryManualSkillWhenTheUserInvokesItExplicitly", () => {
	// Given
	const { skills } = catalog();
	const context = { resourceLoader: { getSkills: () => ({ skills }) }, _extensionRunner: { emitError: (error) => { throw error; } } };
	// When
	const expanded = MANUAL_SKILLS.map((name) => AgentSession.prototype._expandSkillCommand.call(context, `/skill:${name} current scope`));
	// Then
	for (const [index, name] of MANUAL_SKILLS.entries()) {
		assert.ok(expanded[index].startsWith(`<skill name="${name}"`), name);
		assert.ok(expanded[index].endsWith("\n\ncurrent scope"), name);
	}
});

test("shouldNeverAskTheModelToLoadManualOrRetiredSkillsWhenPackageTextIsInspected", async () => {
	// Given
	const files = [];
	for (const root of SCANNED_ROOTS) {
		const entries = await readdir(join(packageRoot, root), { recursive: true, withFileTypes: true });
		files.push(...entries.filter((entry) => entry.isFile() && /\.(md|mjs|ts)$/.test(entry.name)).map((entry) => join(entry.parentPath, entry.name)));
	}
	// When
	const failures = [];
	for (const file of files) {
		const text = await readFile(file, "utf8");
		const path = relative(packageRoot, file);
		for (const name of RETIRED) if (new RegExp(`\\b${name}\\b`).test(text)) failures.push(`${path}: retired ${name}`);
		// Explicit commands and bundled relative paths stay valid for manual-only skills.
		const loadable = text.replaceAll(/\/skill:jag-[a-z0-9-]+|\.\.\/jag-[a-z0-9-]+\//g, "");
		for (const name of MANUAL_SKILLS) {
			if (new RegExp(`\\b(load|pair with|use)\\b[^.\\n]{0,40}\`?${name}\\b`, "i").test(loadable)) failures.push(`${path}: loads ${name}`);
		}
	}
	// Then
	assert.deepEqual(failures, []);
});
