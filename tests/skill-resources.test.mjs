import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { packageRoot, pi } from "./helpers/pi-host.mjs";

const BUNDLED_SKILL_COUNT = 56;
const MAX_SKILL_NAME_LENGTH = 15;

test("shouldDiscoverShortNamesWithMatchingDirectoriesWhenBundledSkillsAreLoaded", async () => {
	// Given
	const skillRoot = join(packageRoot, "skills");
	const provenance = JSON.parse(await readFile(join(packageRoot, "docs", "skills-provenance.json"), "utf8"));
	const directories = (await readdir(skillRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map(({ name }) => name).sort();
	// When
	const { skills, diagnostics } = pi.loadSkillsFromDir({ dir: skillRoot, source: "package" });
	const names = skills.map(({ name }) => name).sort();
	const invalidNames = names.filter((name) => !/^jag-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > MAX_SKILL_NAME_LENGTH);
	const mismatchedDirectories = skills.filter(({ name, filePath }) => name !== basename(dirname(filePath))).map(({ name }) => name);
	// Then
	assert.deepEqual({ count: names.length, unique: new Set(names).size, names, directories, diagnostics, invalidNames, mismatchedDirectories }, {
		count: BUNDLED_SKILL_COUNT, unique: BUNDLED_SKILL_COUNT, names: provenance.skills.map(({ name }) => name).sort(),
		directories: names, diagnostics: [], invalidNames: [], mismatchedDirectories: [],
	});
	for (const skill of provenance.skills) {
		assert.ok(skill.upstreamName);
		for (const path of skill.upstreamPaths) assert.equal(basename(dirname(path)), skill.upstreamName);
	}
});

test("shouldResolveLocalReferencesWhenAllBundledSkillResourcesAreInspected", async () => {
	// Given
	const provenance = JSON.parse(await readFile(join(packageRoot, "docs", "skills-provenance.json"), "utf8"));
	const failures = [];
	// When
	for (const skill of provenance.skills) {
		for (const resource of skill.resources.filter(({ path }) => path.endsWith(".md"))) {
			const file = join(packageRoot, "skills", skill.name, resource.path);
			const text = (await readFile(file, "utf8")).replace(/```[\s\S]*?```/g, "");
			for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
				const link = match[1].split("#")[0];
				if (!link || link.includes("://") || link.includes("{")) continue;
				try { await access(join(dirname(file), link)); } catch { failures.push(`${skill.name}/${resource.path}: ${link}`); }
			}
		}
	}
	// Then
	assert.deepEqual(failures, []);
});
