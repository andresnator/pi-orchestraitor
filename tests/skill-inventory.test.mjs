import assert from "node:assert/strict";
import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { inventorySkills } from "../scripts/skill-inventory.mjs";
import { isWithin } from "../scripts/skill-migration.mjs";
import { createWorkspace, pi } from "./helpers/pi-host.mjs";

const SKILL_NAME = "jag-plan";

async function fixture(t) {
	const root = await realpath(await createWorkspace(t));
	const cwd = join(root, "consumer");
	const agentDir = join(root, "agent");
	await mkdir(join(cwd, ".git"), { recursive: true });
	await mkdir(agentDir);
	const userSettings = { skills: [`!${join(process.env.HOME ?? homedir(), ".agents", "skills")}/**`] };
	const projectSettings = {};
	const saveSettings = async () => {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(join(agentDir, "settings.json"), JSON.stringify(userSettings));
		await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify(projectSettings));
	};
	const inventory = async () => {
		await saveSettings();
		const result = await inventorySkills(pi, { cwd, agentDir });
		assert.ok(result.migrationSkills.filter(({ enabled }) => enabled).every(({ path }) => isWithin(path, root)));
		return result;
	};
	return { root, cwd, agentDir, userSettings, projectSettings, inventory };
}

async function createSkill(directory) {
	await mkdir(directory, { recursive: true });
	const file = join(directory, "SKILL.md");
	await writeFile(file, `---\nname: ${SKILL_NAME}\ndescription: Inventory fixture.\n---\nOriginal skill.\n`);
	return file;
}

async function createLink(target, link) {
	await mkdir(dirname(link), { recursive: true });
	await symlink(target, link);
	return link;
}

for (const broadFirst of [true, false]) {
	test(`shouldPreserveConfiguredTreeBoundaryWhenItIsDeclared${broadFirst ? "Before" : "After"}ItsLeaf`, async (t) => {
		// Given
		const context = await fixture(t);
		const sourceRoot = join(context.root, "source");
		await createSkill(join(sourceRoot, "nested", SKILL_NAME));
		const tree = await createLink(sourceRoot, join(context.root, "configured-tree"));
		const leaf = join(tree, "nested", SKILL_NAME, "SKILL.md");
		context.userSettings.skills.push(...(broadFirst ? [tree, leaf] : [leaf, tree]));
		// When
		const result = await context.inventory();
		// Then
		assert.deepEqual(result.migrationSkills.filter(({ path }) => path === leaf).map(({ enabled, metadata }) => ({ enabled, root: metadata.discoveryRoot })),
			[{ enabled: true, root: tree }]);
	});
}

test("shouldPreserveUserTreeBoundaryWhenProjectSettingsSelectTheSameLeaf", async (t) => {
	// Given
	const context = await fixture(t);
	const sourceRoot = join(context.root, "source");
	await createSkill(join(sourceRoot, "nested", SKILL_NAME));
	const tree = await createLink(sourceRoot, join(context.root, "configured-tree"));
	const leaf = join(tree, "nested", SKILL_NAME, "SKILL.md");
	context.userSettings.skills.push(tree);
	context.projectSettings.skills = [leaf];
	// When
	const result = await context.inventory();
	// Then
	const resource = result.migrationSkills.find(({ path }) => path === leaf);
	assert.deepEqual({ root: resource.metadata.discoveryRoot, scope: resource.metadata.scope, enabled: resource.enabled },
		{ root: tree, scope: "project", enabled: true });
});

test("shouldPreserveAutomaticDiscoveryBoundaryWhenSettingsSelectTheSameLeaf", async (t) => {
	// Given
	const context = await fixture(t);
	const sourceRoot = join(context.root, "source");
	await createSkill(join(sourceRoot, "nested", SKILL_NAME));
	const autoRoot = join(context.agentDir, "skills");
	const tree = await createLink(sourceRoot, join(autoRoot, "configured-tree"));
	const leaf = join(tree, "nested", SKILL_NAME, "SKILL.md");
	context.userSettings.skills.push(leaf);
	// When
	const result = await context.inventory();
	// Then
	const resource = result.migrationSkills.find(({ path }) => path === leaf);
	assert.deepEqual({ root: resource.metadata.discoveryRoot, source: resource.metadata.source, enabled: resource.enabled },
		{ root: autoRoot, source: "local", enabled: true });
});

test("shouldKeepDisabledAliasesDisabledWhilePreservingNativeEffectiveResources", async (t) => {
	// Given
	const context = await fixture(t);
	const sourceRoot = join(context.root, "source", SKILL_NAME);
	await createSkill(sourceRoot);
	const piAlias = await createLink(sourceRoot, join(context.cwd, ".pi", "skills", SKILL_NAME));
	const agentsAlias = await createLink(sourceRoot, join(context.cwd, ".agents", "skills", SKILL_NAME));
	context.projectSettings.skills = [`-${piAlias}`];
	// When
	const result = await context.inventory();
	const settingsManager = pi.SettingsManager.create(context.cwd, context.agentDir, { projectTrusted: true });
	const native = await new pi.DefaultPackageManager({ cwd: context.cwd, agentDir: context.agentDir, settingsManager }).resolve(async () => "skip");
	// Then
	assert.deepEqual(result.migrationSkills.filter(({ path }) => isWithin(path, context.cwd)).map(({ path, enabled }) => ({ path, enabled })), [
		{ path: join(piAlias, "SKILL.md"), enabled: false },
		{ path: join(agentsAlias, "SKILL.md"), enabled: true },
	]);
	assert.deepEqual(result.skills, native.skills);
});

test("shouldPreservePackageOwnershipForAnAliasHiddenByNativeDeduplication", async (t) => {
	// Given
	const context = await fixture(t);
	const otherPackage = join(context.root, "other-package");
	const packagedSkill = await createSkill(join(otherPackage, "skills", SKILL_NAME));
	await writeFile(join(otherPackage, "package.json"), JSON.stringify({ name: "inventory-fixture", version: "1.0.0", pi: { skills: ["./skills"] } }));
	context.userSettings.packages = [otherPackage];
	const alias = await createLink(dirname(packagedSkill), join(context.cwd, ".pi", "skills", SKILL_NAME));
	// When
	const result = await context.inventory();
	// Then
	const managed = result.migrationSkills.find(({ path }) => path === packagedSkill);
	assert.deepEqual({ origin: managed.metadata.origin, packageRoot: managed.metadata.packageRoot, enabled: managed.enabled },
		{ origin: "package", packageRoot: otherPackage, enabled: true });
	assert.ok(result.migrationSkills.some(({ path, enabled }) => path === join(alias, "SKILL.md") && enabled));
	assert.equal(result.skills.some(({ path }) => path === packagedSkill), false);
});
