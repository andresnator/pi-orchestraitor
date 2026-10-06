import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { restoreRegistration } from "../scripts/package-registration.mjs";
import { applyMigration, exists } from "../scripts/skill-migration.mjs";
import { createWorkspace, packageRoot } from "./helpers/pi-host.mjs";

const homeDirectory = process.env.HOME || homedir();

test("shouldRestoreHomeRelativeRegistrationAndFiltersWhenNativeInstallationVerificationFails", async (t) => {
	// Given
	const root = await createWorkspace(t);
	const agentDir = join(root, "agent");
	const settingsPath = join(agentDir, "settings.json");
	await mkdir(agentDir);
	const before = { packages: ["npm:unrelated-before", { source: `~/${relative(homeDirectory, packageRoot)}`, skills: [] }, "npm:unrelated-after"] };
	const beforeText = `${JSON.stringify(before, null, 4)}\n`;
	await writeFile(settingsPath, beforeText);
	let installed;
	// When
	await assert.rejects(applyMigration({
		plan: { moves: [], blockers: [] }, agentDir,
		register: async () => execFileSync("pi", ["install", packageRoot], {
			cwd: root, encoding: "utf8", env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
		}),
		verify: async () => {
			installed = JSON.parse(await readFile(settingsPath, "utf8"));
			throw new Error("Fixture verification failure: skill filter excludes the package skills");
		},
		rollbackRegistration: () => restoreRegistration(settingsPath, beforeText, packageRoot),
	}), /Fixture verification failure[\s\S]*Migration rolled back/);
	// Then
	assert.deepEqual(installed.packages, [before.packages[0], { ...before.packages[1], source: relative(agentDir, packageRoot) }, before.packages[2]]);
	assert.equal(await readFile(settingsPath, "utf8"), beforeText);
});

test("shouldRetainUnrelatedConcurrentChangesAndPackageOrderWhenRestoringNormalizedRegistration", async (t) => {
	// Given
	const root = await createWorkspace(t);
	const settingsPath = join(root, "settings.json");
	const original = { source: `~/${relative(homeDirectory, packageRoot)}`, skills: ["execution-plan"], extensions: [] };
	const before = { packages: ["npm:before", original, "npm:after"], theme: "before" };
	const current = { packages: ["npm:concurrent-first", "npm:before", { ...original, source: relative(root, packageRoot) }, "npm:after", "npm:concurrent-last"], theme: "after", customValue: true };
	await writeFile(settingsPath, JSON.stringify(current));
	// When
	await restoreRegistration(settingsPath, JSON.stringify(before), packageRoot);
	// Then
	assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { ...current, packages: ["npm:concurrent-first", "npm:before", original, "npm:after", "npm:concurrent-last"] });
});

for (const [form, sourceFor] of [
	["AbsolutePath", () => packageRoot],
	["RelativePath", (root) => relative(root, packageRoot)],
	["HomeRelativePath", () => `~/${relative(homeDirectory, packageRoot)}`],
	["FileUrl", () => pathToFileURL(packageRoot).href],
	["WhitespacePaddedHomePath", () => `  ~/${relative(homeDirectory, packageRoot)}  `],
]) {
	test(`shouldMatch${form}WhenRestoringPackageRegistration`, async (t) => {
		// Given
		const root = await createWorkspace(t);
		const settingsPath = join(root, "settings.json");
		const original = { source: sourceFor(root), skills: ["!**"] };
		const beforeText = JSON.stringify({ packages: [original] });
		await writeFile(settingsPath, JSON.stringify({ packages: [relative(root, packageRoot)] }));
		// When
		await restoreRegistration(settingsPath, beforeText, packageRoot);
		// Then
		assert.equal(await readFile(settingsPath, "utf8"), beforeText);
	});
}

test("shouldRemoveOnlyTheNewRegistrationWhenOtherSettingsWereAddedDuringInstallation", async (t) => {
	// Given
	const root = await createWorkspace(t);
	const settingsPath = join(root, "settings.json");
	const unrelated = ["npm:pi-orchestraitor", "git:https://example.com/pi-orchestraitor", "https://example.com/pi-orchestraitor", "builtin:pi-orchestraitor"];
	await writeFile(settingsPath, JSON.stringify({ packages: [packageRoot, ...unrelated], theme: "new" }));
	// When
	await restoreRegistration(settingsPath, undefined, packageRoot);
	// Then
	assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { packages: unrelated, theme: "new" });
});

test("shouldRemoveNewSettingsFileWhenItOnlyContainsTheFailedRegistration", async (t) => {
	// Given
	const root = await createWorkspace(t);
	const settingsPath = join(root, "settings.json");
	await writeFile(settingsPath, JSON.stringify({ packages: [packageRoot] }));
	// When
	await restoreRegistration(settingsPath, undefined, packageRoot);
	// Then
	assert.equal(await exists(settingsPath), false);
});

test("shouldRecoverMissingOriginalRegistrationsWithoutDiscardingOtherPackages", async (t) => {
	// Given
	const root = await createWorkspace(t);
	const settingsPath = join(root, "settings.json");
	const before = { packages: ["npm:before", { source: packageRoot, skills: [] }, "npm:after"] };
	await writeFile(settingsPath, JSON.stringify({ packages: ["npm:before", "npm:after", "npm:new"] }));
	// When
	await restoreRegistration(settingsPath, JSON.stringify(before), packageRoot);
	// Then
	assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { packages: [...before.packages, "npm:new"] });
});

for (const existingPretty of [undefined, "npm:@heyhuynhgiabuu/pi-pretty", { source: "npm:@heyhuynhgiabuu/pi-pretty@0.6.29", extensions: [] }]) {
	test(`shouldRestoreHarnessAndPrettyRegistrationsWhenInstallationFailsWith${existingPretty === undefined ? "NoPretty" : typeof existingPretty === "string" ? "UnpinnedPretty" : "FilteredPretty"}`, async (t) => {
		// Given
		const root = await createWorkspace(t), settingsPath = join(root, "settings.json");
		const harness = { source: packageRoot, skills: [] };
		const unrelated = "npm:@casualjim/pi-pretty@0.7.7";
		const before = { packages: [harness, ...(existingPretty ? [existingPretty] : []), unrelated], theme: "old" };
		const current = { packages: [harness, "npm:@heyhuynhgiabuu/pi-pretty@0.6.30", unrelated, "npm:concurrent"], theme: "new" };
		await writeFile(settingsPath, JSON.stringify(current));
		// When
		await restoreRegistration(settingsPath, JSON.stringify(before), packageRoot, ["npm:@heyhuynhgiabuu/pi-pretty@0.6.30"]);
		// Then
		assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { ...current, packages: [...before.packages, "npm:concurrent"] });
	});
}

for (const name of ["@heyhuynhgiabuu/pi-pretty", "unscoped-pretty"]) {
	for (const concurrent of [false, true]) {
		test(`shouldRestoreWhitespacePaddedNpmSourcesVersionsFiltersAndPositionFor${name}WithConcurrentChanges${concurrent}`, async (t) => {
			const root = await createWorkspace(t), settingsPath = join(root, "settings.json");
			const original = { source: `npm:  ${name}@0.6.29  `, extensions: ["!src/other.ts"], skills: [], prompts: ["*.md"], themes: [] };
			const before = { packages: ["npm:before", original, "npm:after", { source: packageRoot, skills: [] }], theme: "old" };
			const beforeText = `${JSON.stringify(before, null, 4)}\n`;
			const current = { ...before, packages: ["npm:before", "npm:after", packageRoot, `npm: ${name}@0.6.30 `, ...(concurrent ? ["npm:unrelated"] : [])] };
			if (concurrent) { current.theme = "new"; current.editor = "custom"; }
			await writeFile(settingsPath, JSON.stringify(current));
			await restoreRegistration(settingsPath, beforeText, packageRoot, [`npm:  ${name}@0.6.30  `]);
			if (concurrent) assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { ...current, packages: [...before.packages, "npm:unrelated"] });
			else assert.equal(await readFile(settingsPath, "utf8"), beforeText);
		});
	}
}

test("shouldRestoreExactPositionBetweenDuplicateUnrelatedAnchorsWhenNoConcurrentPackagesChanged", async (t) => {
	const root = await createWorkspace(t), settingsPath = join(root, "settings.json");
	const original = { source: "npm:  @heyhuynhgiabuu/pi-pretty@0.6.29  ", extensions: [] };
	const beforeText = `${JSON.stringify({ packages: ["npm:duplicate", original, "npm:duplicate"] }, null, 4)}\n`;
	await writeFile(settingsPath, JSON.stringify({ packages: ["npm:duplicate", "npm:duplicate", "npm:@heyhuynhgiabuu/pi-pretty@0.6.30"] }));
	await restoreRegistration(settingsPath, beforeText, packageRoot, ["npm:@heyhuynhgiabuu/pi-pretty@0.6.30"]);
	assert.equal(await readFile(settingsPath, "utf8"), beforeText);
});

const prettySource = "npm:@heyhuynhgiabuu/pi-pretty@0.6.30";
const originalPretty = { source: "npm:@heyhuynhgiabuu/pi-pretty@0.6.29", extensions: [], themes: ["*.json"] };

for (const present of [false, true]) {
	for (const insertions of [false, true]) {
		test(`shouldRestorePositionAroundEditedNeighborWithRegistrationPresent${present}AndConcurrentInsertions${insertions}`, async (t) => {
			const root = await createWorkspace(t), settingsPath = join(root, "settings.json");
			const neighbor = { source: "npm:neighbor@1", extensions: ["old"], skills: [] };
			const edited = { ...neighbor, source: "npm:neighbor@2", extensions: ["new"], prompts: ["*.md"] };
			const before = { packages: ["npm:anchor", neighbor, originalPretty, "npm:next"], theme: "original" };
			const leading = insertions ? ["npm:concurrent-first"] : [];
			const adjacent = insertions ? ["npm:concurrent-adjacent"] : [];
			const trailing = insertions ? ["npm:concurrent-last"] : [];
			const current = { packages: [...leading, "npm:anchor", edited, ...adjacent, ...(present ? [prettySource] : []), "npm:next", ...trailing], theme: "concurrent", custom: true };
			await writeFile(settingsPath, JSON.stringify(current));
			await restoreRegistration(settingsPath, JSON.stringify(before), packageRoot, [prettySource]);
			// Preserve a valid slot, including any new package immediately before
			// it; if absent, reconstruct immediately after the surviving neighbor.
			const expected = [...leading, "npm:anchor", edited, ...(present ? adjacent : []), originalPretty, ...(present ? [] : adjacent), "npm:next", ...trailing];
			assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { ...current, packages: expected });
		});
	}
}

test("shouldKeepOccurrenceOrderBetweenEditedDuplicateAnchors", async (t) => {
	const root = await createWorkspace(t), settingsPath = join(root, "settings.json");
	const first = { source: "npm:duplicate@1", extensions: ["first"] };
	const second = { source: "npm:duplicate@1", extensions: ["second"] };
	const changedFirst = { ...first, source: "npm:duplicate@2", extensions: ["changed-first"] };
	const changedSecond = { ...second, extensions: ["changed-second"] };
	const before = { packages: ["npm:anchor", first, originalPretty, second] };
	const current = { packages: ["npm:anchor", changedFirst, changedSecond, prettySource, "npm:new"], theme: "concurrent" };
	await writeFile(settingsPath, JSON.stringify(current));
	await restoreRegistration(settingsPath, JSON.stringify(before), packageRoot, [prettySource]);
	assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { ...current, packages: ["npm:anchor", changedFirst, originalPretty, changedSecond, "npm:new"] });
});

test("shouldDistinguishIdenticalAnchorOccurrencesDespiteConcurrentInsertions", async (t) => {
	const root = await createWorkspace(t), settingsPath = join(root, "settings.json");
	const before = { packages: ["npm:anchor", "npm:duplicate", originalPretty, "npm:duplicate", "npm:next"] };
	await writeFile(settingsPath, JSON.stringify({ packages: ["npm:new", "npm:anchor", "npm:duplicate", "npm:duplicate", "npm:next", prettySource] }));
	await restoreRegistration(settingsPath, JSON.stringify(before), packageRoot, [prettySource]);
	assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { packages: ["npm:new", "npm:anchor", "npm:duplicate", originalPretty, "npm:duplicate", "npm:next"] });
});

test("shouldAnchorToSurvivingDuplicateWhenEarlierOccurrenceWasRemoved", async (t) => {
	const root = await createWorkspace(t), settingsPath = join(root, "settings.json");
	const first = { source: "npm:duplicate", extensions: ["first"] };
	const second = { source: "npm:duplicate", extensions: ["second"] };
	const before = { packages: [first, originalPretty, second] };
	await writeFile(settingsPath, JSON.stringify({ packages: [second, prettySource, "npm:new"] }));
	await restoreRegistration(settingsPath, JSON.stringify(before), packageRoot, [prettySource]);
	assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { packages: [originalPretty, second, "npm:new"] });
});

test("shouldMatchSurvivingExactDuplicateBeforeAnInsertedOccurrence", async (t) => {
	const root = await createWorkspace(t), settingsPath = join(root, "settings.json");
	const first = { source: "npm:duplicate", extensions: ["first"] };
	const second = { source: "npm:duplicate", extensions: ["second"] };
	const inserted = { source: "npm:duplicate", extensions: ["concurrent"] };
	const before = { packages: [first, originalPretty, second] };
	const current = { packages: [inserted, first, second, prettySource] };
	await writeFile(settingsPath, JSON.stringify(current));
	await restoreRegistration(settingsPath, JSON.stringify(before), packageRoot, [prettySource]);
	assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { packages: [inserted, first, originalPretty, second] });
});

test("shouldRestoreMultipleSelectedOccurrencesInOriginalOrder", async (t) => {
	const root = await createWorkspace(t), settingsPath = join(root, "settings.json");
	const neighbor = { source: "npm:neighbor", extensions: ["old"] };
	const changed = { ...neighbor, extensions: ["new"] };
	const secondPretty = { ...originalPretty, extensions: ["other"], source: "npm:@heyhuynhgiabuu/pi-pretty@0.6.28" };
	const harness = { source: packageRoot, skills: [] };
	const before = { packages: ["npm:anchor", originalPretty, neighbor, secondPretty, harness, "npm:next"] };
	await writeFile(settingsPath, JSON.stringify({ packages: ["npm:anchor", changed, "npm:next", prettySource, packageRoot], custom: "keep" }));
	await restoreRegistration(settingsPath, JSON.stringify(before), packageRoot, [prettySource]);
	assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { packages: ["npm:anchor", originalPretty, changed, secondPretty, harness, "npm:next"], custom: "keep" });
});

for (const surviving of ["previous", "next", "none", "reordered"]) {
	test(`shouldUseDeterministicFallbackWith${surviving}Anchors`, async (t) => {
		const root = await createWorkspace(t), settingsPath = join(root, "settings.json");
		const previous = { source: "npm:previous", extensions: [] };
		const next = { source: "npm:next", skills: [] };
		const changedPrevious = { ...previous, extensions: ["new"] };
		const changedNext = { ...next, skills: ["new"] };
		const before = { packages: [previous, originalPretty, next] };
		const cases = {
			previous: [["npm:new", changedPrevious], ["npm:new", changedPrevious, originalPretty]],
			next: [["npm:new", changedNext], ["npm:new", originalPretty, changedNext]],
			none: [["npm:new", "npm:other"], ["npm:new", originalPretty, "npm:other"]],
			reordered: [[changedNext, changedPrevious], [changedNext, changedPrevious, originalPretty]],
		};
		const [packages, expected] = cases[surviving];
		await writeFile(settingsPath, JSON.stringify({ packages, theme: "concurrent" }));
		await restoreRegistration(settingsPath, JSON.stringify(before), packageRoot, [prettySource]);
		assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { packages: expected, theme: "concurrent" });
	});
}

for (const sourceKind of ["local", "git"]) {
	test(`shouldAnchorToEdited${sourceKind}RegistrationBySource`, async (t) => {
		const root = await createWorkspace(t), settingsPath = join(root, "settings.json");
		const source = sourceKind === "local" ? join(root, "neighbor") : "git:https://example.com/neighbor#v1";
		const neighbor = { source, extensions: [] };
		const changed = { ...neighbor, source: sourceKind === "local" ? "./neighbor" : source, extensions: ["new"] };
		const before = { packages: ["npm:anchor", neighbor, originalPretty, "npm:next"] };
		await writeFile(settingsPath, JSON.stringify({ packages: ["npm:anchor", changed, prettySource, "npm:next"] }));
		await restoreRegistration(settingsPath, JSON.stringify(before), packageRoot, [prettySource]);
		assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { packages: ["npm:anchor", changed, originalPretty, "npm:next"] });
	});
}
