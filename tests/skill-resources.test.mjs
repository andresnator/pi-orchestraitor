import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { packageRoot } from "./helpers/pi-host.mjs";

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
