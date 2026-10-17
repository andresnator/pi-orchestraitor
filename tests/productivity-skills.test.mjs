import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createSkillRegistry } from "../extensions/skills/registry.mjs";
import { createWorkspace, importHost, loadPackage, packageRoot, pi } from "./helpers/pi-host.mjs";

// Structural/native checks, not evidence of real-model explanation quality.
const { AgentSession } = await importHost("dist/core/agent-session.js");
const SOURCE_REPOSITORY = "https://github.com/mattpocock/skills";
const SOURCE_REVISION = "49dd158d1076134a641b33efb035946536778336";
const WAIT_SKILL = "jag-wait-what";
const WAIT_SOURCE_PATH = "skills/productivity/wait-what/SKILL.md";
const WAIT_SOURCE_HASH = "d961bb37defd975c539427edb8f450cdbccdcdd552e213c1ece46676a7970905";
const GRILL_SOURCE_PATH = "skills/productivity/grilling/SKILL.md";
const GRILL_SOURCE_HASH = "befdff1e27a1dfe2a294d5871169ac1afe16d983911daa4f32627514a48c1e15";
const EXPECTED_PROMPTS = ["orchestraitor", "plan", "review"];
const readSkill = (name) => readFile(join(packageRoot, "skills", name, "SKILL.md"), "utf8");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("grill/shouldKeepDecisionsSequentialAndSeparateAgreementFromAuthorityWhenInterviewing", async () => {
	// Given / When
	const body = await readSkill("jag-grill");
	// Then
	for (const criterion of [
		/prerequisites are settled/i, /reconsider downstream questions/i, /reopen.*invalidates/i,
		/facts.*your job/i, /decisions.*user/i, /one at a time/i, /do not add question headings/i,
		/yes.*accepts.*recommendation/i, /cancelled.*unavailable.*busy/i,
		/summarize.*settled choices/i, /confirm.*shared understanding/i, /agreement.*not.*authorize.*implementation/i,
	]) assert.match(body, criterion);
	assert.equal(body.split("\n---\n", 1)[0], [
		"---", "name: jag-grill",
		'description: "Interview the user to stress-test a plan or design; activates on grill requests."',
		"license: MIT",
	].join("\n"));
	assert.doesNotMatch(body, /ask the whole frontier|call the Skill tool|dispatch a sub-agent/i);
});

test("wait-what/shouldRestoreContextWithoutAdvancingWorkWhenTheUserRequestsReExplanation", async () => {
	// Given / When
	const body = await readSkill(WAIT_SKILL);
	// Then
	for (const criterion of [
		/only the user invokes/i, /most recent relevant answer/i, /missing premise.*context/i,
		/user's language/i, /plain.*sentences/i, /caveats.*negations.*evidence.*uncertainty/i,
		/canonical.*vocabulary/i, /CONTEXT-MAP\.md/, /GLOSSARY-MAP\.md/, /missing.*glossar.*fine/i,
		/do not create.*domain documents/i, /inline explanation only/i,
		/do not.*continue.*task/i, /change task status/i, /delegate/i, /write files/i, /compact.*switch sessions/i,
	]) assert.match(body, criterion);
	assert.equal(body.split("\n---\n", 1)[0], [
		"---", "name: jag-wait-what",
		'description: "Re-explain a confusing answer with the missing context in plain language."',
		"disable-model-invocation: true", "license: MIT",
	].join("\n"));
	assert.doesNotMatch(body, /ASD-STE100|call the Skill tool|load.*jag-domain/i);
});

test("wait-what/shouldLoadOnlyByNativeExplicitCommandWhenRegistrySelectionIsAttempted", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const { skills, diagnostics } = pi.loadSkillsFromDir({ dir: join(packageRoot, "skills", WAIT_SKILL), source: "package" });
	const registry = createSkillRegistry(pi);
	t.after(() => registry.dispose());
	const ctx = { cwd, isProjectTrusted: () => false };
	const context = { resourceLoader: { getSkills: () => ({ skills }) }, _extensionRunner: { emitError: (error) => { throw error; } } };
	const expand = (input) => AgentSession.prototype._expandSkillCommand.call(context, input);
	// When
	await registry.capture(skills, ctx);
	const search = await registry.search(WAIT_SKILL, 5, ctx);
	const withoutArgs = expand(`/skill:${WAIT_SKILL}`);
	const withArgs = expand(`/skill:${WAIT_SKILL} explain the decision`);
	// Then
	assert.deepEqual({ names: skills.map(({ name }) => name), diagnostics, manual: skills[0]?.disableModelInvocation,
		automatic: registry.status().available, manualCount: registry.status().manualOnly, search: search.matches,
		explicit: withoutArgs.startsWith(`<skill name="${WAIT_SKILL}"`), args: withArgs.endsWith("\n\nexplain the decision"),
	}, { names: [WAIT_SKILL], diagnostics: [], manual: true, automatic: 0, manualCount: 1, search: [], explicit: true, args: true });
	await assert.rejects(registry.resolveNames([WAIT_SKILL], ctx), /manual-only|explicit.*skill/i);
});

test("provenance/shouldRetainOriginalImportsAndPinNewConsultationsWhenProductivitySkillsAreAdapted", async () => {
	// Given
	const provenance = JSON.parse(await readFile(join(packageRoot, "docs/skills-provenance.json"), "utf8"));
	// When
	const wait = provenance.skills.find(({ name }) => name === WAIT_SKILL);
	const grill = provenance.skills.find(({ name }) => name === "jag-grill");
	// Then
	assert.ok(wait);
	assert.deepEqual({ name: wait.upstreamName, paths: wait.upstreamPaths, version: wait.upstreamVersion, author: wait.author,
		repository: wait.upstreamRepository, revision: wait.upstreamRevision, hash: wait.upstreamSha256, license: wait.license,
	}, { name: "wait-what", paths: [WAIT_SOURCE_PATH], version: null, author: "Matt Pocock",
		repository: SOURCE_REPOSITORY, revision: SOURCE_REVISION, hash: WAIT_SOURCE_HASH, license: "MIT" });
	assert.deepEqual({ version: grill.upstreamVersion, author: grill.author, adaptedBy: grill.adaptedBy,
		hash: grill.upstreamSha256, paths: grill.upstreamPaths, consultations: grill.sourceConsultations,
	}, { version: "2.0.0", author: "Matt Pocock", adaptedBy: "pi-orchestraitor",
		hash: "4e334f292673da288123775ea4d97ec625cef5070508037d112f63be24d97c13",
		paths: ["domains/common/skills/grilling/SKILL.md", "domains/plan/skills/grilling/SKILL.md"],
		consultations: [{ upstreamRepository: SOURCE_REPOSITORY, upstreamRevision: SOURCE_REVISION,
			purpose: "Consulted for dependency, recommendation and authorization clarity; original import identity and sequential interaction retained.",
			resources: [{ path: GRILL_SOURCE_PATH, sha256: GRILL_SOURCE_HASH }] }],
	});
	for (const skill of [wait, grill]) {
		assert.deepEqual(skill.resources, [{ path: "SKILL.md", sha256: sha256(await readSkill(skill.name)) }]);
	}
});

test("integration/shouldKeepPromptCommandsUnchangedAndDocumentManualChecksWhenWaitWhatIsAdded", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const docs = await readFile(join(packageRoot, "docs/skills.md"), "utf8");
	const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
	// When
	const { loader } = await loadPackage(cwd);
	const prompts = loader.getPrompts();
	// Then
	assert.deepEqual({ names: prompts.prompts.map(({ name }) => name).sort(), diagnostics: prompts.diagnostics,
		files: (await readdir(join(packageRoot, "prompts"))).sort(),
		alias: manifest.pi.extensions.filter((path) => path.includes("skill-alias")),
	}, { names: EXPECTED_PROMPTS, diagnostics: [], files: EXPECTED_PROMPTS.map((name) => `${name}.md`), alias: [] });
	assert.match(docs, /\/skill:jag-wait-what/);
	assert.match(docs, /WW1/);
	assert.match(docs, /GR1/);
	assert.match(docs, /handoff.*portable.*compact/i);
});
