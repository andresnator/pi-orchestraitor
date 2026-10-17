import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { packageRoot } from "./helpers/pi-host.mjs";

// Structural checks, not evidence of real-model planning quality.
const SOURCE_REPOSITORY = "https://github.com/affaan-m/ECC";
const SOURCE_REVISION = "76aaa77df6adc5b889e689007bf99b9a4f74af34";
const SOURCE_PATH = "pi/core/skills/intent-driven-development/SKILL.md";
const SOURCE_HASH = "e34045f7b3bf6a6fbd364f85c7bc81d8208e18bb929ceff80bbc987f78aadea8";
const CONSULTATION_PURPOSE = "Consulted for business-constraint and observable-acceptance guidance; wording rewritten and original import identity retained.";
const GUIDED_SKILLS = ["jag-evidence", "jag-plan", "jag-issue"];
const readSkillFile = (name, path = "SKILL.md") => readFile(join(packageRoot, "skills", name, path), "utf8");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const section = (body, heading) => body.split(`\n## ${heading}\n`)[1].split("\n## ")[0];
const versionOf = (body) => body.match(/^ {2}version: "([^"]+)"$/m)?.[1];

test("evidence/shouldRecordBusinessRulesAsOpenQuestionsWhenCodeOnlyShowsCurrentBehavior", async () => {
	// Given / When
	const body = await readSkillFile("jag-evidence");
	const economy = await readSkillFile("jag-evidence", "references/question-economy.md");
	const userOnly = economy.split("\n").find((line) => line.startsWith("- **Only the user can answer it**"));
	// Then
	assert.match(section(body, "Method"), /Code proves current behavior, not business requirements\./);
	assert.match(section(body, "Method"), /business rules, compliance, SLAs, pricing, retention, priorities or target users found in code as open questions until the user or an authoritative product document confirms them/);
	assert.match(userOnly, /business rules, compliance, SLAs, pricing, retention\)/);
	assert.match(userOnly, /Code can show today's value, never whether the business requires it\./);
	assert.equal(versionOf(body), "5.0.2");
});

test("plan/shouldRequireUserSourcedRequirementsAndObservableWordingWhenSelfChecking", async () => {
	// Given / When
	const body = await readSkillFile("jag-plan");
	const selfCheck = section(body, "Self-check");
	// Then
	assert.match(selfCheck, /^- Business requirements cite the user or a product document, not code\.$/m);
	assert.match(selfCheck, /^- Required behavior avoids "correctly", "securely", "fast", "robust" or "intuitive" unless it states observable evidence; otherwise mark it as human review\.$/m);
	assert.equal(versionOf(body), "1.1.2");
});

test("issue/shouldRejectUnqualifiedVagueClaimsWhenValidatingAcceptanceScenarios", async () => {
	// Given / When
	const body = await readSkillFile("jag-issue");
	const checklist = section(body, "Quality Checklist");
	// Then
	assert.match(checklist, /^- \[ \] Acceptance scenarios are observable, use Given\/When\/Then, and back any "correct", "secure", "fast" or "robust" claim with evidence or mark it as human review\.$/m);
	assert.equal(versionOf(body), "2.1.4");
});

test("provenance/shouldCreditEccConsultationAndRefreshFingerprintsWhenPlanningGuidanceChanges", async () => {
	// Given
	const provenance = JSON.parse(await readFile(join(packageRoot, "docs/skills-provenance.json"), "utf8"));
	const notices = await readFile(join(packageRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
	// When
	const entries = GUIDED_SKILLS.map((name) => provenance.skills.find((skill) => skill.name === name));
	// Then
	for (const entry of entries) {
		assert.deepEqual(entry.sourceConsultations.filter(({ upstreamRepository }) => upstreamRepository === SOURCE_REPOSITORY), [{ upstreamRepository: SOURCE_REPOSITORY, upstreamRevision: SOURCE_REVISION,
			purpose: CONSULTATION_PURPOSE, resources: [{ path: SOURCE_PATH, sha256: SOURCE_HASH }] }], entry.name);
		for (const resource of entry.resources) {
			assert.equal(sha256(await readFile(join(packageRoot, "skills", entry.name, resource.path))), resource.sha256, `${entry.name}/${resource.path}`);
		}
	}
	assert.match(notices, /\[ECC\]\(https:\/\/github\.com\/affaan-m\/ECC\)/);
	assert.match(notices, new RegExp(SOURCE_REVISION));
	assert.match(notices, /Copyright \(c\) 2026 Affaan Mustafa/);
});
