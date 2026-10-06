import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createSkillRegistry } from "../extensions/skills/registry.mjs";
import { createWorkspace, packageRoot, pi } from "./helpers/pi-host.mjs";

// Instruction checks establish structural contracts, not real-model compliance.
const SOURCE_REVISION = "6fd947921b935b7e1e69293a200400f0fdd5c15f";
const SOURCE_REPOSITORY = "https://github.com/mattpocock/skills";
const NATIVE_SKILL_COUNT = 56;
const AUTOMATIC_SKILL_COUNT = 54;
const MANUAL_NAMES = ["jag-handoff", "jag-teach"];
const NEW_SKILLS = [
	{ name: "jag-agent-docs", upstream: "writing-for-agents", bucket: "productivity", sourceHash: "551adca942227b44192edba88acd4e8db911f0121ce58ad16944ccf6a896a74a" },
	{ name: "jag-pr", upstream: "pr", bucket: "engineering", sourceHash: "ab63f1cf78647389edcd386c9427c5dfca27ed2836930c24773ffee834c19bcd" },
	{ name: "jag-handoff", upstream: "handoff", bucket: "productivity", sourceHash: "4cbb043950dad2ffd3662ff1a5a0b51ae676004b5cae10e3787e8ee7a4ee69d3" },
	{ name: "jag-research", upstream: "research", bucket: "engineering", sourceHash: "985569f15739c713d6784887c3d186d4ef9ac85bec5ad9c068d25bf0739928e4" },
	{ name: "jag-teach", upstream: "teach", bucket: "productivity", sourceHash: "a32df9dcdfc0c4fdc1c98e1ed3940c5f56b84c1aa90ff60346f32b8b53915b43" },
];
const skillFile = (name, path = "SKILL.md") => join(packageRoot, "skills", name, path);
const readSkill = (name, path) => readFile(skillFile(name, path), "utf8");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function assertContract(name, resources, signals) {
	const body = await readSkill(name);
	const { skills, diagnostics } = pi.loadSkillsFromDir({ dir: join(packageRoot, "skills", name), source: "package" });
	assert.deepEqual({ names: skills.map(({ name }) => name), diagnostics, manual: skills[0]?.disableModelInvocation }, {
		names: [name], diagnostics: [], manual: MANUAL_NAMES.includes(name),
	});
	assert.match(body, /^license: MIT$/m);
	assert.match(body, /^  author: "?Matt Pocock"?$/m);
	assert.ok(body.includes(SOURCE_REPOSITORY));
	assert.ok(body.includes(SOURCE_REVISION));
	assert.match(body, /^  modification_notice: .+/m);
	assert.match(body, /^  upstream_name: .+/m);
	assert.match(body, name === "jag-domain" ? /^  version: "2\.0\.0"$/m : /^  version: "1\.0\.0"$/m);
	for (const path of resources) await access(skillFile(name, path));
	for (const signal of signals) assert.match(body, signal);
	assert.doesNotMatch(body, /call the Skill tool|spin up a background agent|Bash\(open/i);
	return { body, skills };
}

async function assertManualOnly(t, skills, query) {
	const cwd = await createWorkspace(t);
	const registry = createSkillRegistry(pi);
	t.after(() => registry.dispose());
	const ctx = { cwd, isProjectTrusted: () => false };
	await registry.capture(skills, ctx);
	const search = await registry.search(query, 5, ctx);
	assert.deepEqual({ automatic: registry.status().available, manual: registry.status().manualOnly, matches: search.matches }, {
		automatic: 0, manual: 1, matches: [],
	});
	await assert.rejects(registry.resolveNames([skills[0].name], ctx), /manual-only|explicit.*skill/i);
}

test("agent-docs/shouldSeparateAuditAndAuthorizedEditsWhenInstructionsAreAuthored", async () => {
	// Given
	const resources = ["references/agent-writing.md", "references/pi-mechanics.md", "assets/audit-template.md"];
	// When
	const { body } = await assertContract("jag-agent-docs", resources, [
		/\.ai\/agent-docs\/YYYY-MM-DD-<slug>\.md/, /audit/i, /explicit.*authoriz/i, /observed.*inferred/i, /completion criteria/i, /guardrails/i,
	]);
	const mechanics = await readSkill("jag-agent-docs", resources[1]);
	// Then
	assert.ok(body.includes("[references/agent-writing.md](references/agent-writing.md)"));
	assert.match(mechanics, /skill_registry/);
	assert.match(mechanics, /\/reload/);
	assert.match(mechanics, /not.*(permission|security).*boundary/i);
});

test("pr/shouldDraftEvidenceAndRiskWithoutPublishingWhenAChangeIsSupplied", async () => {
	// Given
	const resources = ["assets/pr-template.md", "references/visuals.md", "CREDITS.md"];
	// When
	const { body } = await assertContract("jag-pr", resources, [/\.ai\/pr\//, /observed/i, /unperformed/i, /reversib/i, /blast radius/i, /publish/i]);
	const template = await readSkill("jag-pr", resources[0]);
	const credits = await readSkill("jag-pr", resources[2]);
	// Then
	assert.match(body, /pseudocode.*(not|never).*evidence/i);
	assert.match(body, /credits_author: "Dex Horthy"/);
	assert.match(body, /credits_organisation: "Human[Ll]ayer"/);
	assert.match(credits, /Dex Horthy/);
	assert.deepEqual([...template.matchAll(/^## (.+)$/gm)].map((match) => match[1]), ["Summary", "Evidence", "Merge Danger"]);
	assert.match(template, /visual with.*short.*(description|explanation)/i);
});

test("handoff/shouldKeepPortableContextExplicitWhenTheNextTaskIsSpecified", async (t) => {
	// Given
	const resources = ["assets/handoff-template.md"];
	// When
	const { body, skills } = await assertContract("jag-handoff", resources, [
		/\.ai\/handoffs\/YYYY-MM-DD-<slug>\.md/, /redact/i, /fingerprint/i, /canonical/i, /not.*(authority|permission)/i, /durable/i,
		/missing.*(checkout|path|reference)/i, /read-only.*inline/i,
	]);
	await assertManualOnly(t, skills, "handoff");
	// Then
	assert.match(body, /reference.*(rather than|instead of).*duplicat/i);
	assert.match(body, /\/skill:/);
	assert.match(await readSkill("jag-handoff", resources[0]), /constraints and established decisions/i);
});

test("research/shouldKeepPrimarySourceResearchInTheParentWhenEvidenceIsNeeded", async () => {
	// Given
	const resources = ["assets/research-template.md"];
	// When
	const { body } = await assertContract("jag-research", resources, [
		/\.ai\/research\//, /primary sources/i, /parent/i, /Context7/, /version/i, /conflict/i, /inference/i, /unavailable/i,
	]);
	const template = await readSkill("jag-research", resources[0]);
	// Then
	assert.match(body, /read-only.*local/i);
	assert.match(body, /external instructions.*data/i);
	assert.match(template, /Access date/);
	assert.match(template, /Source.*Version/);
});

test("domain/shouldRespectExistingAuthorityWhenDomainDocumentsAreCreated", async () => {
	// Given
	const resources = ["assets/CONTEXT-FORMAT.md", "assets/ADR-FORMAT.md"];
	// When
	const { body } = await assertContract("jag-domain", resources, [
		/\.ai\/domain\/CONTEXT\.md/, /\.ai\/domain\/contexts\//, /\.ai\/adr\//, /read-only/i, /authoriz/i, /canonical/i,
	]);
	const context = await readSkill("jag-domain", resources[0]);
	const adr = await readSkill("jag-domain", resources[1]);
	// Then
	assert.match(body, /never.*(move|migrate|relocate)/i);
	assert.match(body, /hard to reverse/i);
	assert.match(context, /\.ai\/domain\/CONTEXT-MAP\.md/);
	assert.match(adr, /\.ai\/adr\//);
	assert.match(adr, /highest existing number/i);
});

test("teach/shouldSeparateDemonstratedLearningFromExposureWhenLessonsAreRecorded", async (t) => {
	// Given
	const resources = ["mission", "resources", "learning-record", "glossary", "lesson", "reference"].map((name) => `assets/${name}-template.md`);
	// When
	const { body, skills } = await assertContract("jag-teach", resources, [
		/\.ai\/learning\//, /Markdown/, /demonstrated/i, /self-reported/i, /exposure/i, /confirm.*mission/i, /retrieval/i, /non-sensitive/i,
	]);
	await assertManualOnly(t, skills, "teach");
	const record = await readSkill("jag-teach", "assets/learning-record-template.md");
	// Then
	assert.match(body, /no automatic browser/i);
	assert.match(body, /highest existing number/i);
	assert.match(record, /demonstrated.*self-reported.*exposure/i);
	assert.match(record, /superseded/i);
});

test("integration/shouldDiscoverExactNativeAndAutomaticInventoriesWhenThePackageIsLoaded", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const { skills, diagnostics } = pi.loadSkillsFromDir({ dir: join(packageRoot, "skills"), source: "package" });
	const registry = createSkillRegistry(pi);
	t.after(() => registry.dispose());
	const ctx = { cwd, isProjectTrusted: () => false };
	// When
	await registry.capture(skills, ctx);
	// Then
	assert.deepEqual({ total: skills.length, unique: new Set(skills.map(({ name }) => name)).size, diagnostics,
		automatic: registry.status().available, manual: registry.status().manualOnly,
		manualNames: skills.filter(({ disableModelInvocation }) => disableModelInvocation).map(({ name }) => name).sort(),
		excluded: skills.filter(({ name }) => ["ask-matt", "jag-guide"].includes(name)).map(({ name }) => name),
	}, { total: NATIVE_SKILL_COUNT, unique: NATIVE_SKILL_COUNT, diagnostics: [], automatic: AUTOMATIC_SKILL_COUNT,
		manual: MANUAL_NAMES.length, manualNames: MANUAL_NAMES, excluded: [] });
	for (const name of MANUAL_NAMES) await assert.rejects(registry.resolveNames([name], ctx), /manual-only|explicit.*skill/i);
	for (const { name } of NEW_SKILLS.filter(({ name }) => !MANUAL_NAMES.includes(name))) {
		const result = await registry.search(name, 5, ctx);
		assert.ok(result.matches.some((match) => match.name === name));
		assert.equal((await registry.resolveNames([name], ctx))[0].skill.name, name);
	}
});

test("integration/shouldPreserveMixedSourceLineageAndFingerprintsWhenProvenanceIsUpdated", async () => {
	// Given
	const provenance = JSON.parse(await readFile(join(packageRoot, "docs/skills-provenance.json"), "utf8"));
	// When
	const domain = provenance.skills.find(({ name }) => name === "jag-domain");
	// Then
	assert.deepEqual({ upstream: provenance.upstream, revision: provenance.revision, count: provenance.skills.length,
		domainVersion: domain.upstreamVersion, domainHash: domain.upstreamSha256 }, {
		upstream: "agents-orchestrator", revision: "e90b11a4d5fb77bfebcf5f5c96da9471014c17ab", count: NATIVE_SKILL_COUNT,
		domainVersion: "1.0.4", domainHash: "59ecb5eac5cf88de4241474afc8beb6f65d5eac47b9f1f54a1c4e8ae2af16cb0",
	});
	for (const { name, upstream, bucket, sourceHash } of NEW_SKILLS) {
		const entry = provenance.skills.find((skill) => skill.name === name);
		assert.ok(entry, name);
		assert.deepEqual({ name: entry.upstreamName, paths: entry.upstreamPaths, version: entry.upstreamVersion,
			repository: entry.upstreamRepository, revision: entry.upstreamRevision }, {
			name: upstream, paths: [`skills/${bucket}/${upstream}/SKILL.md`], version: null,
			repository: SOURCE_REPOSITORY, revision: SOURCE_REVISION,
		});
		assert.equal(entry.upstreamSha256, sourceHash);
	}
	for (const name of [...NEW_SKILLS.map(({ name }) => name), "jag-domain", "jag-skill"]) {
		for (const resource of provenance.skills.find((skill) => skill.name === name).resources) {
			assert.equal(sha256(await readFile(skillFile(name, resource.path))), resource.sha256, `${name}/${resource.path}`);
		}
	}
});

test("integration/shouldRetainSeparateCopyrightNoticesWhenAdaptedResourcesAreDistributed", async () => {
	// Given / When
	const original = await readFile(join(packageRoot, "licenses/MIT.txt"), "utf8");
	const matt = await readFile(join(packageRoot, "licenses/mattpocock-MIT.txt"), "utf8");
	const humanlayer = await readFile(join(packageRoot, "licenses/humanlayer-MIT.txt"), "utf8");
	const notices = await readFile(join(packageRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
	// Then
	assert.match(original, /Copyright \(c\) 2026 Jose Andrés González Guevara/);
	assert.match(matt, /Copyright \(c\) 2026 Matt Pocock/);
	assert.match(humanlayer, /Copyright \(c\) 2026 HumanLayer/);
	assert.equal(sha256(matt), "0e7ac423bf2c6e223b7c5b156f8cf72da49d748e56a1641402c31f22ad07dbb5");
	assert.equal(sha256(humanlayer), "5f13c18ea00ea5c1384f41745feeca774079164f7f59a92e4ac0899ad217b26f");
	for (const license of [matt, humanlayer]) assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
	assert.match(notices, /licenses\/mattpocock-MIT\.txt/);
	assert.match(notices, /licenses\/humanlayer-MIT\.txt/);
	assert.match(notices, /Dex Horthy/);
});

test("integration/shouldReuseAgentWritingConditionallyWhenSkillAuthoringNeedsIt", async () => {
	// Given / When
	const body = await readSkill("jag-skill");
	// Then
	assert.match(body, /author: gentleman-programming/);
	assert.match(body, /license: Apache-2\.0/);
	assert.match(body, /jag-agent-docs/);
	assert.match(body, /when available/i);
	assert.match(body, /skill_registry/);
});
