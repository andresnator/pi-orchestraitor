import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createSkillRegistry, DEFAULT_SEARCH_LIMIT } from "../extensions/skills/registry.mjs";
import { createWorkspace, packageRoot, pi } from "./helpers/pi-host.mjs";

const ACTIVE_SKILL_COUNT = 51;
const QUALITY_REFERENCE = "references/review-lenses.md";
const SMELL_REFERENCE = "references/smell-lenses.md";
const BOUNDARY_REFERENCE = "references/boundary-review.md";
const LENSES = [
	{ name: "jag-kiss", skill: "jag-practices", path: QUALITY_REFERENCE, section: "simplicity", heading: "Simplicity", query: "KISS YAGNI",
		criteria: ["Prefer explicit code until variation is proven.", "Reject abstractions for hypothetical future cases.", "Recommend deletion of unused speculative structure only when safe and validated."] },
	{ name: "jag-dry", skill: "jag-practices", path: QUALITY_REFERENCE, section: "duplicated-knowledge", heading: "Duplicated Knowledge", query: "DRY duplication",
		criteria: ["Prioritize duplicated rules, validations, formulas, permissions, mappings, or invariants.", "Do not merge coincidentally similar code with different meanings.", "State the business knowledge that would become single-sourced."] },
	{ name: "jag-naming", skill: "jag-practices", path: QUALITY_REFERENCE, section: "naming", heading: "Naming", query: "naming readability",
		criteria: ["Prefer names that reveal intent and domain meaning.", "Flag misleading abbreviations, overloaded terms, and hidden units or formats.", "Distinguish readability issues from purely stylistic preferences.", "Avoid mass renames unless the evidence shows concrete maintenance benefit.", "Lower confidence when the recommendation depends on ecosystem or language-specific naming conventions that are not proven in the repository."] },
	{ name: "jag-srp", skill: "jag-practices", path: QUALITY_REFERENCE, section: "single-responsibility", heading: "Single Responsibility", query: "SRP responsibility",
		criteria: ["Identify separate business rules, orchestration, IO, mapping, validation, and formatting responsibilities.", "Recommend Extract Class or Move Method only when cohesion improves.", "Avoid splitting code merely because it is long."] },
	{ name: "jag-coupling", skill: "jag-practices", path: QUALITY_REFERENCE, section: "cohesion-and-coupling", heading: "Cohesion and Coupling", query: "cohesion coupling",
		criteria: ["Flag classes whose methods use disjoint state subsets.", "Flag layer violations, circular dependencies, high fan-out, and excessive collaborator knowledge.", "Prefer Move Method, Extract Class, Facade, or Port/Adapter only with concrete coupling evidence."] },
	{ name: "jag-functions", skill: "jag-refactor", path: SMELL_REFERENCE, section: "small-functions", heading: "Small Functions", query: "long methods",
		criteria: ["Flag methods with multiple abstraction levels, nested branches, or distinct phases.", "Prefer Extract Method when a block has a meaningful domain name.", "Prefer Split Phase when parsing/validation/calculation/persistence are interleaved.", "Keep recommendations behavior-preserving and incremental."] },
	{ name: "jag-god-object", skill: "jag-refactor", path: SMELL_REFERENCE, section: "god-object", heading: "God Object", query: "God Object",
		criteria: ["Look for many unrelated methods, many collaborators, broad state ownership, and mixed domain concepts.", "Recommend incremental extraction by cohesive responsibility.", "Require characterization tests before risky legacy extractions."] },
	{ name: "jag-spaghetti", skill: "jag-refactor", path: SMELL_REFERENCE, section: "spaghetti-code", heading: "Spaghetti Code", query: "spaghetti code",
		criteria: ["Flag tangled branches, implicit execution order, hidden side effects, and temporal coupling.", "Recommend guard clauses, Split Phase, Extract Method, or explicit state transitions.", "Never recommend a Big Bang rewrite."] },
	{ name: "jag-ocp", skill: "jag-patterns", path: BOUNDARY_REFERENCE, section: "open-closed-principle", heading: "Open-Closed Principle", query: "OCP polymorphism",
		criteria: ["Look for repeated conditionals by type, state, operation, or strategy.", "Suggest strategy, policy, or polymorphism only when new variants are likely or already present.", "Block pattern use when a simple conditional is clearer."] },
	{ name: "jag-dip", skill: "jag-patterns", path: BOUNDARY_REFERENCE, section: "dependency-inversion", heading: "Dependency Inversion", query: "DIP ports interfaces",
		criteria: ["Flag direct dependencies on frameworks, gateways, clients, persistence, or external systems when they hurt testing or coupling.", "Introduce ports/interfaces only for real variation, test seams, or architectural boundaries.", "Do not wrap stable internal classes by default."] },
];

const ADDITIONAL_QUERIES = [
	{ query: "circular dependencies", skill: "jag-practices" },
	{ query: "mixed layers", skill: "jag-practices" },
	{ query: "maintainability", skill: "jag-practices" },
	{ query: "small functions", skill: "jag-refactor" },
	{ query: "temporal coupling", skill: "jag-refactor" },
	{ query: "hidden side effects", skill: "jag-refactor" },
	{ query: "factory", skill: "jag-patterns" },
	{ query: "builder", skill: "jag-patterns" },
	{ query: "decorator", skill: "jag-patterns" },
	{ query: "observer", skill: "jag-patterns" },
];
const ORIGINAL_TRIGGER_QUERIES = [
	{ query: "overengineering", skill: "jag-practices" },
	{ query: "identifiers", skill: "jag-practices" },
	{ query: "speculative", skill: "jag-practices" },
	{ query: "oversized", skill: "jag-refactor" },
	{ query: "extraction", skill: "jag-refactor" },
	{ query: "collaborators", skill: "jag-refactor" },
	{ query: "extension pressure", skill: "jag-patterns" },
];
const catalog = () => pi.loadSkillsFromDir({ dir: join(packageRoot, "skills"), source: "package" });

test("shouldExposeOnlyRemainingSkillsWhenNativeCatalogIsLoaded", async () => {
	// Given / When
	const { skills, diagnostics } = catalog();
	const names = skills.map(({ name }) => name);
	// Then
	assert.deepEqual({ count: names.length, retired: names.filter((name) => LENSES.some((lens) => lens.name === name)), diagnostics }, {
		count: ACTIVE_SKILL_COUNT, retired: [], diagnostics: [],
	});
	for (const { name } of LENSES) await assert.rejects(access(join(packageRoot, "skills", name)), { code: "ENOENT" });
});

test("shouldPreserveReviewCriteriaAndAttributionWhenConsolidatedReferencesAreInspected", async () => {
	// Given
	const provenance = JSON.parse(await readFile(join(packageRoot, "docs/skills-provenance.json"), "utf8"));
	// When / Then
	assert.deepEqual(provenance.consolidatedSkills?.map(({ name }) => name).sort(), LENSES.map(({ name }) => name).sort());
	for (const lens of LENSES) {
		const archived = provenance.consolidatedSkills.find(({ name }) => name === lens.name);
		assert.deepEqual(archived.replacement, { skill: lens.skill, path: lens.path, section: lens.section });
		assert.equal(archived.license, "Apache-2.0");
		assert.equal(archived.author, "gentle-ai");
		assert.equal(archived.adaptedBy, "andresnator");
		assert.match(archived.previousInstructionSha256, /^[a-f0-9]{64}$/);
		const reference = await readFile(join(packageRoot, "skills", lens.skill, lens.path), "utf8");
		const body = await readFile(join(packageRoot, "skills", lens.skill, "SKILL.md"), "utf8");
		assert.ok(body.includes(`[${lens.path}](${lens.path})`), `${lens.skill} must route to ${lens.path}`);
		assert.ok(reference.includes(`## ${lens.heading}\n`));
		for (const criterion of lens.criteria) assert.ok(reference.includes(criterion), `${lens.name}: ${criterion}`);
		assert.match(reference, /Apache-2\.0/);
		assert.match(reference, /gentle-ai/);
		assert.match(reference, /andresnator/);
		assert.match(reference, /Modified for Pi by pi-orchestraitor/);
		assert.match(reference, /calling agent's output contract/);
		assert.match(reference, /no_findings/);
		assert.match(reference, /validation and rollback/i);
		assert.match(reference, /Preserve observable behavior/);
		assert.match(reference, /hypothesis/);
	}
});

test("shouldResolveConsolidatedSignalsAndRejectRetiredNamesWhenRegistryUsesCurrentNativeCatalog", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const registry = createSkillRegistry(pi);
	t.after(() => registry.dispose());
	const ctx = { cwd, isProjectTrusted: () => false };
	await registry.capture(catalog().skills, ctx);
	// When
	const selected = await registry.resolveNames([...new Set(LENSES.map(({ skill }) => skill))], ctx);
	// Then
	assert.equal(registry.status().available, ACTIVE_SKILL_COUNT);
	assert.equal(selected.length, new Set(LENSES.map(({ skill }) => skill)).size);
	for (const lens of LENSES) {
		const search = await registry.search(lens.query, 5, ctx);
		assert.ok(search.matches.some(({ name }) => name === lens.skill), `${lens.query} must find ${lens.skill}`);
		await assert.rejects(registry.resolveNames([lens.name], ctx), /unavailable/i);
		const body = selected.find(({ skill }) => skill.name === lens.skill).body;
		assert.ok(!body.includes(lens.criteria[0]), `${lens.skill} must not inline its full lens reference`);
	}
	for (const { query, skill } of ADDITIONAL_QUERIES) {
		const search = await registry.search(query, 5, ctx);
		assert.ok(search.matches.some(({ name }) => name === skill), `${query} must find ${skill}`);
	}
});

test("shouldFindReplacementSkillsWhenOriginalReviewTriggersAreSearched", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const registry = createSkillRegistry(pi);
	t.after(() => registry.dispose());
	const ctx = { cwd, isProjectTrusted: () => false };
	await registry.capture(catalog().skills, ctx);
	// When
	const results = [];
	for (const { query, skill } of ORIGINAL_TRIGGER_QUERIES) {
		const search = await registry.search(query, DEFAULT_SEARCH_LIMIT, ctx);
		results.push({ query, expectedSkill: skill, found: search.matches.some(({ name }) => name === skill) });
	}
	// Then
	assert.deepEqual(results, ORIGINAL_TRIGGER_QUERIES.map(({ query, skill }) => ({ query, expectedSkill: skill, found: true })));
});
