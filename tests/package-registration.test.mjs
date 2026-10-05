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
