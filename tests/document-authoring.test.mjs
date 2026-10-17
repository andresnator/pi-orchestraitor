import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { packageRoot, pi } from "./helpers/pi-host.mjs";

// Structural contracts do not prove live conversational behavior.
const ORIGINAL_BODY_HASHES = {
	"jag-docs": "22a1808c7c101a8087ddf7d91dbb95cfa1c105dfc2e0ed0255ef939dcc889a41",
	"jag-prd": "7115a36f7ffb585a172f0b5d6a2de93c1f1176cde03e07cc7e03610bb6cd40d4",
	"jag-prd-lite": "1073e484143189d91145b28668a7a5afcd665252605add2392060e3546154c1c",
	"jag-rfc": "7159b24cb5e63375325170950b70eea2c9ef2b4104d70d7e7586e8b1dd4fa229",
	"jag-adr": "013db18c921f8c1f9019283497eb7797a64474567298dd6e8b9da031cb3e4c18",
	"jag-usm": "7aea0926c8baa05190e133f12e3fd6e49e95d1af4cb7181127262b5b0aad6640",
	// Merged Jira Story/Task/Spike default body, deduplicated 2026-10-17.
	"jag-jira": "400070801d0dae32b9449f899ebc1a7a6dde1f2dcec499d15d3f5440af01541b",
};
const VERSIONS = { "jag-docs": ["1.1.0", "2.1.0"], "jag-jira": ["3.0.1", "3.0.1"] };
const SELECTED_NAMES = Object.keys(ORIGINAL_BODY_HASHES);
const BUNDLED_SKILL_COUNT = 37;
const MODE_BLOCK = /## Optional Interactive Mode\n[\s\S]*?\n\n(?=## )/g;
const skillPath = (name) => join(packageRoot, "skills", name, "SKILL.md");
const readSkill = (name) => readFile(skillPath(name), "utf8");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

for (const name of SELECTED_NAMES) {
	test(`${name}/shouldPreserveDefaultInstructionsWhenOptionalSectionReviewIsAdded`, async () => {
		// Given
		const originalHash = ORIGINAL_BODY_HASHES[name];
		// When
		const body = await readSkill(name);
		const blocks = [...body.matchAll(MODE_BLOCK)].map(([block]) => block);
		const canonical = (await readSkill("jag-docs")).match(MODE_BLOCK)?.[0];
		const defaultBody = body.replace(/^---\n[\s\S]*?\n---\n/, "").replace(MODE_BLOCK, "");
		// Then
		assert.equal(blocks.length, 1, "Each selected skill needs one optional mode block");
		assert.equal(blocks[0], canonical, "Keep the short contract identical without cross-skill dependencies");
		assert.equal(sha256(defaultBody), originalHash, "Keep all existing default instructions byte-identical");
	});
}

test("documents/shouldRequireApprovalAndCarryContextWhenInteractiveModeIsRequested", async () => {
	// Given
	const signals = [
		/only on explicit requests.*`interactive mode`.*`section by section`/,
		/Otherwise keep defaults/,
		/replace draft timing and question limits only/,
		/preserve templates, validation, evidence, language, format and save\/publication rules/,
		/Confirm section order.*one missing-input question at a time and wait/,
		/Draft one section.*wait for explicit approval before advancing/,
		/Answering intake questions, cancellation and unavailable UI are not approval/,
		/available Pi choice UI for closed choices, otherwise chat/,
		/Carry approved text and visible open items forward/,
		/do not reprint the whole draft/,
		/Reopen affected sections when earlier decisions change.*never silently rewrite approved text/,
		/all sections are approved and validation passes.*assemble approved text into the complete document for final review/,
		/Approval never authorizes saving or publishing/,
		/Pause or exit on request.*without inventing missing state/,
	];
	// When
	const block = (await readSkill("jag-docs")).match(MODE_BLOCK)?.[0] ?? "";
	const missing = signals.filter((signal) => !signal.test(block)).map(String);
	// Then
	assert.deepEqual(missing, []);
});

test("documents/shouldAdvertiseOptionalReviewWithoutAddingSkillsWhenNativeDiscoveryRuns", async () => {
	// Given
	const directory = join(packageRoot, "skills");
	// When
	const { skills, diagnostics } = pi.loadSkillsFromDir({ dir: directory, source: "package" });
	const selected = skills.filter(({ name }) => SELECTED_NAMES.includes(name));
	const metadataFailures = [];
	for (const { name, description, disableModelInvocation } of selected) {
		const body = await readSkill(name);
		const [version, adaptation] = VERSIONS[name] ?? ["2.1.0", "2.1.0"];
		if (!description.includes("optional section review") || disableModelInvocation ||
			!body.includes(`  version: "${version}"`) || !body.includes(`  pi_adaptation: "${adaptation}"`) ||
			!body.includes("  status: testing")) metadataFailures.push(name);
	}
	// Then
	assert.deepEqual({ count: skills.length, diagnostics, names: selected.map(({ name }) => name).sort(), metadataFailures }, {
		count: BUNDLED_SKILL_COUNT, diagnostics: [], names: [...SELECTED_NAMES].sort(), metadataFailures: [],
	});
});

test("documents/shouldDocumentActivationAndManualCoverageWhenTheModeIsPublishedInTheCatalog", async () => {
	// Given
	const catalogPath = join(packageRoot, "docs", "skills.md");
	// When
	const catalog = await readFile(catalogPath, "utf8");
	const section = catalog.match(/## Optional document authoring\n[\s\S]*?(?=\n## )/)?.[0] ?? "";
	// Then
	assert.ok(SELECTED_NAMES.every((name) => section.includes(`\`${name}\``)));
	assert.match(section, /\/skill:jag-rfc interactive mode/);
	assert.match(section, /defaults remain unchanged/i);
	assert.match(section, /DOC-SECTION-01/);
	assert.match(section, /not.*(live|model).*behavior/i);
});
