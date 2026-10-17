import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { packageRoot, pi } from "./helpers/pi-host.mjs";
import { createSkillRegistry } from "../extensions/skills/registry.mjs";

const names = ["jag-slidev", "jag-whisper"];
const revision = "ea3158595b56d832e79b41c4c16175f45cd67ea2";
const sourceHashes = ["e0369d54093b4e6d829610bdd4e4a6768b0bd7fa08f9b683c11f736315313811", "aafe1e855749b874476014011dbdb4dff9f4c48bd196effd36edcdced39a0d0c"];

test("shouldDiscoverAndLoadBothAutomaticMediaSkillsWhenRegistryCapturesThem", async (t) => {
	// Given
	const { skills, diagnostics } = pi.loadSkillsFromDir({ dir: join(packageRoot, "skills"), source: "package" });
	const registry = createSkillRegistry(pi);
	t.after(() => registry.dispose());
	const ctx = { cwd: packageRoot, isProjectTrusted: () => true };
	// When
	await registry.capture(skills, ctx);
	// Then
	assert.deepEqual({ total: skills.length, automatic: skills.filter((s) => !s.disableModelInvocation).length, diagnostics }, {
		total: 37, automatic: 33, diagnostics: [],
	});
	for (const name of names) {
		const result = await registry.search(name, 5, ctx);
		assert.ok(result.matches.some((match) => match.name === name));
		const [loaded] = await registry.resolveNames([name], ctx);
		assert.equal(loaded.skill.name, name);
		assert.match(loaded.body, new RegExp(`name: ${name}`));
	}
});

test("shouldPinNewSourcesAndAllMaterializedResourcesWhenMediaSkillsArePackaged", async () => {
	// Given
	const provenance = JSON.parse(await readFile(join(packageRoot, "docs/skills-provenance.json"), "utf8"));
	// When / Then
	for (const [index, name] of names.entries()) {
		const entry = provenance.skills.find((s) => s.name === name);
		assert.deepEqual({ revision: entry?.upstreamRevision, hash: entry?.upstreamSha256, license: entry?.license }, {
			revision, hash: sourceHashes[index], license: "MIT",
		});
		const actual = (await readdir(join(packageRoot, "skills", name), { recursive: true, withFileTypes: true }))
			.filter((f) => f.isFile()).map((f) => join(f.parentPath, f.name).slice(join(packageRoot, "skills", name).length + 1).replaceAll("\\", "/")).sort();
		assert.deepEqual(entry.resources.map((r) => r.path).sort(), actual);
		for (const resource of entry.resources) {
			const data = await readFile(join(packageRoot, "skills", name, resource.path));
			assert.equal(createHash("sha256").update(data).digest("hex"), resource.sha256);
		}
	}
});

test("shouldRequireSafeBoundedMediaWorkflowsWhenSkillBodiesAreLoaded", async () => {
	// Given
	const slidev = await readFile(join(packageRoot, "skills/jag-slidev/SKILL.md"), "utf8");
	const whisper = await readFile(join(packageRoot, "skills/jag-whisper/SKILL.md"), "utf8");
	// When / Then
	for (const body of [slidev, whisper]) {
		assert.match(body, /status: testing/);
		assert.match(body, /pi_adaptation: "2.0.0"/);
		assert.match(body, /authorization/i);
	}
	assert.match(slidev, /every.*PNG/i);
	assert.match(slidev, /incomplete/i);
	assert.match(whisper, /transcript-only/i);
	assert.match(whisper, /provider/i);
	assert.match(whisper, /Engram/);
	assert.match(whisper, /partial/i);
	assert.doesNotMatch(whisper, /clear.*\/tmp|language_code_or_auto|literal transcript|source of truth/i);
});
