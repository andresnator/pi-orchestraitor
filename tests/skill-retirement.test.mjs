import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createSkillRegistry } from "../extensions/skills/registry.mjs";
import { createWorkspace, packageRoot, pi } from "./helpers/pi-host.mjs";
import { CORE_SKILLS, MANUAL_SKILLS, NATIVE_SKILL_COUNT } from "./helpers/skill-packs.mjs";

const LENSES = ["jag-arch-impact", "jag-behavior", "jag-big-o", "jag-java-naming", "jag-legacy", "jag-logs", "jag-nulls", "jag-risk",
	"jag-scope", "jag-seams", "jag-test-scope", "jag-tool-matrix", "jag-tools", "jag-types", "jag-validation"];
const OTHERS = ["jag-java-api", "jag-java-errors", "jag-java-model", "jag-java-secure", "jag-prompts", "jag-refine", "jag-routing"];
const MERGED = {
	"jag-jira-story": { skill: "jag-jira", path: "SKILL.md", section: "user-story" },
	"jag-jira-task": { skill: "jag-jira", path: "SKILL.md", section: "task" },
	"jag-jira-spike": { skill: "jag-jira", path: "SKILL.md", section: "spike" },
	"jag-prd-lite": { skill: "jag-prd", path: "SKILL.md", section: "light-mode" },
	"jag-arch-state": { skill: "jag-arch-map", path: "references/state.md", section: "architecture-state" },
	"jag-boundaries": { skill: "jag-arch-map", path: "references/boundaries.md", section: "service-boundaries" },
};
const RETIRED = [...LENSES, ...OTHERS, ...Object.keys(MERGED)];
const JIRA_TEMPLATES = [
	{ heading: "### User Story\n", quick: "assets/quick.md", refinement: "assets/story-refinement.md", marker: "h2. User Story" },
	{ heading: "### Task\n", quick: "assets/quick.md", refinement: "assets/task-refinement.md", marker: "h2. Expected Outcome" },
	{ heading: "### Spike\n", quick: "assets/quick.md", refinement: "assets/spike-refinement.md", marker: "h2. Research Question" },
];
const TRIMMED = {
	"jag-refactor": ["techniques/", "references/language-idioms.md", "references/language-applicability.md",
		"references/technique-catalog.md", "references/technique-to-pattern.md"],
	"jag-java-test": ["references/dependency-breaking.md", "references/tdd-legacy.md", "references/seam-model.md",
		"references/sensing-separation.md", "references/advanced-patterns.md", "references/sprout-wrap-techniques.md",
		"references/method-object-skin-wrap.md", "references/pass-null-subclass-override.md",
		"references/characterization-tests.md", "references/mockito-patterns.md"],
};
const catalog = () => pi.loadSkillsFromDir({ dir: join(packageRoot, "skills"), source: "package" });
const readProvenance = async () => JSON.parse(await readFile(join(packageRoot, "docs/skills-provenance.json"), "utf8"));
const skillFile = (name, path) => readFile(join(packageRoot, "skills", name, path), "utf8");
const headingSlugs = (text) => [...text.matchAll(/^#+ (.+)$/gm)].map(([, heading]) => heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").replaceAll(" ", "-"));

test("shouldRemoveRetiredSkillsWhenNativeCatalogIsLoaded", async () => {
	// Given
	const provenance = await readProvenance();
	// When
	const { skills, diagnostics } = catalog();
	const names = skills.map(({ name }) => name);
	const recorded = [...provenance.skills, ...provenance.consolidatedSkills, ...provenance.retiredSkills].map(({ name }) => name);
	// Then
	assert.deepEqual({ count: names.length, retired: names.filter((name) => RETIRED.includes(name)), diagnostics }, {
		count: NATIVE_SKILL_COUNT, retired: [], diagnostics: [],
	});
	assert.equal(new Set(recorded).size, recorded.length, "Active, consolidated and retired names must not overlap");
	for (const name of RETIRED) await assert.rejects(access(join(packageRoot, "skills", name)), { code: "ENOENT" });
});

test("shouldRecordOriginalIdentityWhenSkillsAreRetired", async () => {
	// Given
	const provenance = await readProvenance();
	// When
	const retired = provenance.retiredSkills ?? [];
	// Then
	assert.deepEqual(retired.map(({ name }) => name).sort(), [...RETIRED].sort());
	for (const entry of retired) {
		assert.ok(entry.upstreamPaths.every((path) => path.endsWith(`/${entry.upstreamName}/SKILL.md`)), entry.name);
		assert.match(entry.upstreamSha256, /^[a-f0-9]{64}$/);
		assert.match(entry.previousInstructionSha256, /^[a-f0-9]{64}$/);
		if (LENSES.includes(entry.name)) {
			assert.deepEqual([entry.license, entry.author, entry.adaptedBy, entry.source],
				["Apache-2.0", "gentle-ai", "andresnator", "gentle-ai/plan-refactor"], entry.name);
		} else {
			assert.deepEqual([entry.license, entry.author], ["MIT", "andresnator"], entry.name);
		}
		const replacement = MERGED[entry.name];
		assert.deepEqual({ reason: entry.reason, replacement: entry.replacement }, replacement
			? { reason: "merged", replacement }
			: { reason: "redundant", replacement: null }, entry.name);
		if (replacement) assert.ok(headingSlugs(await skillFile(replacement.skill, replacement.path)).includes(replacement.section), entry.name);
	}
	for (const target of new Set(Object.values(MERGED).map(({ skill }) => skill))) {
		assert.deepEqual(provenance.skills.find(({ name }) => name === target)?.mergedFrom,
			Object.keys(MERGED).filter((name) => MERGED[name].skill === target), target);
	}
});

test("shouldRejectRetiredNamesWhenRegistryUsesCurrentCatalog", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const registry = createSkillRegistry(pi);
	t.after(() => registry.dispose());
	const ctx = { cwd, isProjectTrusted: () => false };
	// When
	await registry.capture(catalog().skills, ctx);
	// Then
	assert.deepEqual({ automatic: registry.status().available, manual: registry.status().manualOnly }, {
		automatic: CORE_SKILLS.length, manual: MANUAL_SKILLS.length,
	});
	for (const name of RETIRED) await assert.rejects(registry.resolveNames([name], ctx), /unavailable/i);
});

test("shouldRouteEachTicketTypeToItsTemplatesWhenJiraSkillIsLoaded", async () => {
	// Given
	const body = await skillFile("jag-jira", "SKILL.md");
	// When
	const refinements = await Promise.all(JIRA_TEMPLATES.map(({ refinement }) => skillFile("jag-jira", refinement)));
	// Then
	for (const [index, { heading, quick, refinement, marker }] of JIRA_TEMPLATES.entries()) {
		assert.ok(body.includes(heading), heading);
		assert.ok(body.includes(`[${quick}](${quick})`) && body.includes(`[${refinement}](${refinement})`), quick);
		await access(join(packageRoot, "skills", "jag-jira", quick));
		assert.ok(refinements[index].includes(marker), marker);
	}
	assert.ok(body.includes("- Quick Creation is the default mode."));
	assert.ok(body.includes("- Refinement activates only when explicitly requested by the user."));
	assert.ok(!body.includes("Do not ask for Jira ticket type"));
	assert.ok(!body.includes("sibling skills"));
});

test("shouldDropTextbookCatalogsWithoutDanglingPointersWhenTrimmedSkillsAreInspected", async () => {
	// Given
	const removed = Object.entries(TRIMMED);
	// When
	const dangling = [];
	for (const [name, paths] of removed) {
		for (const path of paths) await assert.rejects(access(join(packageRoot, "skills", name, path)), { code: "ENOENT" });
		const files = (await readdir(join(packageRoot, "skills", name), { recursive: true })).filter((file) => file.endsWith(".md"));
		for (const file of files) {
			const text = await skillFile(name, file);
			for (const path of paths) if (text.includes(path.endsWith("/") ? path : path.split("/").pop())) dangling.push(`${name}/${file} -> ${path}`);
		}
	}
	// Then
	assert.deepEqual(dangling, []);
});
