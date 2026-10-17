import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createSkillRegistry } from "../extensions/skills/registry.mjs";
import { createWorkspace, importHost, packageRoot, pi } from "./helpers/pi-host.mjs";

// Text checks protect instruction contracts, not live-model compliance or learning efficacy.
const { AgentSession } = await importHost("dist/core/agent-session.js");
const SOURCE_REPOSITORY = "https://github.com/mattpocock/skills";
const SOURCE_REVISION = "49dd158d1076134a641b33efb035946536778336";
const RETRO = "jag-retro";
const SOURCE_HASHES = {
	retro: "33fbc28568e3146f20fd908b12998bc0ab30aa4f4c87288199a40793efa94696",
	wayfinder: "9be7b478c389605a24517d27752f278933588da97a1b5921b165f455edf4c5b7",
	"improve-codebase-architecture": "552240a5ab5cec6b67c15dd1ad6e9f6962b1bca6ce870059a8c2713760c20392",
};
const CONSULTATIONS = { "jag-agent-docs": "retro", "jag-evidence": "wayfinder", "jag-arch-ideas": "improve-codebase-architecture" };
const readSkill = (name, path = "SKILL.md") => readFile(join(packageRoot, "skills", name, path), "utf8");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("retro/shouldAllowNativeExplicitExpansionAndRejectAutomaticSelectionWhenLoaded", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const { skills, diagnostics } = pi.loadSkillsFromDir({ dir: join(packageRoot, "skills", RETRO), source: "package" });
	const registry = createSkillRegistry(pi);
	t.after(() => registry.dispose());
	const ctx = { cwd, isProjectTrusted: () => false };
	const context = { resourceLoader: { getSkills: () => ({ skills }) }, _extensionRunner: { emitError: (error) => { throw error; } } };
	const expand = (input) => AgentSession.prototype._expandSkillCommand.call(context, input);
	// When
	await registry.capture(skills, ctx);
	const search = await registry.search("retrospective", 5, ctx);
	const withoutArgs = expand(`/skill:${RETRO}`);
	const withArgs = expand(`/skill:${RETRO} current session`);
	// Then
	assert.deepEqual({ names: skills.map(({ name }) => name), diagnostics, manual: skills[0]?.disableModelInvocation,
		automatic: registry.status().available, manualCount: registry.status().manualOnly, search: search.matches,
		explicit: withoutArgs.startsWith(`<skill name="${RETRO}"`), args: withArgs.endsWith("\n\ncurrent session"),
	}, { names: [RETRO], diagnostics: [], manual: true, automatic: 0, manualCount: 1, search: [], explicit: true, args: true });
	await assert.rejects(registry.resolveNames([RETRO], ctx), /manual-only|explicit.*skill/i);
});

test("retro/shouldBoundSessionEvidenceAndPersistOnlyTheReportWhenInvoked", async () => {
	// Given / When
	const body = await readSkill(RETRO);
	// Then
	for (const criterion of [
		/only the user invokes/i, /current session/i, /historical.*explicit.*(path|scope)/i,
		/do not scan.*(global|other project)/i, /external instructions.*data/i, /redact.*before/i,
		/observations.*hypotheses/i, /missing.*(source|evidence)/i, /existing.*check command/i,
		/CI.*(wiring|hook)/i, /no.*check.*named.*lint/i,
		/\.ai\/retrospectives\/YYYY-MM-DD-<slug>\.md/, /collision/i, /read-only.*inline/i,
		/only the report.*authorized repository write/i, /not.*(permission|authority).*repair/i,
		/read-only or inline-only requests stay inline/i, /historical logs require.*permission to read/i,
		/do not execute checks/i, /No installation, automatic test runs/i,
		/grants no additional memory access or write authority/i, /memory.*(sync|export)/i,
	]) assert.match(body, criterion);
	assert.ok(body.includes("[../jag-agent-docs/references/agent-writing.md](../jag-agent-docs/references/agent-writing.md)"));
	assert.ok(body.includes("[assets/retrospective-template.md](assets/retrospective-template.md)"));
	assert.doesNotMatch(body, /call the Skill tool|all work.*subagents|no exploration needed/i);
});

test("retro/shouldSeparateLearningEvidenceAndProposedRepairsWhenTheTemplateIsUsed", async () => {
	// Given / When
	const template = await readSkill(RETRO, "assets/retrospective-template.md");
	// Then
	assert.deepEqual([...template.matchAll(/^## (.+)$/gm)].map((match) => match[1]), [
		"Scope", "Evidence", "Learning", "Proposed improvements", "Verification and limits",
	]);
	for (const criterion of [/Observed.*Hypothesis/, /missing.*unwired.*broken.*effective.*unknown/i,
		/target path/i, /expected benefit/i, /verification/i, /not applied/i, /no justified improvements/i]) assert.match(template, criterion);
});

test("prevention/shouldInspectGuardWiringBeforeAddingInstructionsWhenAnAuditFindsAFailure", async () => {
	// Given / When
	const guidance = await readSkill("jag-agent-docs", "references/agent-writing.md");
	const template = await readSkill("jag-agent-docs", "assets/audit-template.md");
	// Then
	for (const criterion of [/missing.*unwired.*broken.*effective.*unknown/i, /deterministic/i,
		/existing.*check command/i, /judgment/i, /navigation/i, /authorization.*(rules|boundaries)/i,
		/(audit|proposal).*not.*permission/i]) assert.match(guidance, criterion);
	assert.match(template, /Existing check.*Wiring evidence.*Proposed remedy.*Verification/i);
});

test("discovery/shouldKeepPreciseBlockedQuestionsSeparateFromUnspecifiedScopeWhenExploring", async () => {
	// Given / When
	const body = await readSkill("jag-evidence");
	const template = await readSkill("jag-evidence", "assets/discovery-template.md");
	// Then
	for (const criterion of [/precise.*blocked/i, /not yet specified/i, /out.of.scope.*(user|scope change)/i,
		/no.*(tracker|claims|scheduler)/i, /resolve.*business.*before.*plan/i]) assert.match(body, criterion);
	assert.deepEqual([...template.matchAll(/^## (.+)$/gm)].map((match) => match[1]), [
		"Destination", "Evidence", "Decisions", "Open questions", "Not yet specified", "Out of scope", "Next",
	]);
	assert.match(template, /prerequisite/i);
	assert.doesNotMatch(template, /Status is final|^## (Status|Phase|Readiness)/m);
	assert.match(await readSkill("jag-evidence", "references/edge-validation.md"), /handled[\s\S]*out of scope[\s\S]*open question/i);
});

test("architecture/shouldStopSurveyBeforeArtifactsOrImplementationWhenCandidatesAreRequested", async () => {
	// Given / When
	const body = await readSkill("jag-arch-ideas");
	const survey = await readSkill("jag-arch-ideas", "references/candidate-survey.md");
	// Then
	assert.match(body, /survey.*(explicit|request)/i);
	assert.ok(body.includes("[references/candidate-survey.md](references/candidate-survey.md)"));
	assert.match(body, /Design mode.*one ADR and one plan/i);
	for (const criterion of [/bounded/i, /change frequency.*not.*proof/i, /ADR.*conflict/i,
		/expected.*hypothes/i, /no material candidates/i, /inline/i, /no.*ADR.*plan/i,
		/selection.*not.*authoriz/i, /browser/i, /CDN/i, /test deletion/i,
	]) assert.match(survey, criterion);
});

test("provenance/shouldPinAbsorbedSourcesWithoutReplacingOriginalIdentitiesWhenWorkflowsChange", async () => {
	// Given
	const provenance = JSON.parse(await readFile(join(packageRoot, "docs/skills-provenance.json"), "utf8"));
	// When
	const retro = provenance.skills.find(({ name }) => name === RETRO);
	// Then
	assert.ok(retro);
	assert.deepEqual({ name: retro.upstreamName, paths: retro.upstreamPaths, version: retro.upstreamVersion,
		author: retro.author, repository: retro.upstreamRepository, revision: retro.upstreamRevision, hash: retro.upstreamSha256, license: retro.license,
	}, { name: "retro", paths: ["skills/engineering/retro/SKILL.md"], version: null, author: "Matt Pocock",
		repository: SOURCE_REPOSITORY, revision: SOURCE_REVISION, hash: SOURCE_HASHES.retro, license: "MIT" });
	for (const [name, upstream] of Object.entries(CONSULTATIONS)) {
		const skill = provenance.skills.find((entry) => entry.name === name);
		const source = skill.sourceConsultations?.find((entry) => entry.upstreamRepository === SOURCE_REPOSITORY && entry.upstreamRevision === SOURCE_REVISION);
		assert.ok(source, name);
		assert.deepEqual(source.resources, [{ path: `skills/engineering/${upstream}/SKILL.md`, sha256: SOURCE_HASHES[upstream] }]);
	}
	for (const name of [...Object.keys(CONSULTATIONS), RETRO]) {
		for (const resource of provenance.skills.find((entry) => entry.name === name).resources) {
			assert.equal(sha256(await readSkill(name, resource.path)), resource.sha256, `${name}/${resource.path}`);
		}
	}
});

test("docs/shouldDocumentManualEvaluationAndReloadWhenTheNewWorkflowIsDistributed", async () => {
	// Given / When
	const docs = await readFile(join(packageRoot, "docs/skills.md"), "utf8");
	const notices = await readFile(join(packageRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
	// Then
	for (const criterion of [/\/skill:jag-retro/, /\.ai\/retrospectives\//, /RETRO-01/, /RETRO-02/, /DISCOVERY-01/, /ARCH-SURVEY-01/, /\/reload/]) assert.match(docs, criterion);
	assert.match(notices, /jag-retro/);
	assert.match(notices, /49dd158d1076134a641b33efb035946536778336/);
});
