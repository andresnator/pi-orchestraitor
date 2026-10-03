import assert from "node:assert/strict";
import { mkdir, readFile, readlink, rename, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { applyMigration, exists, planMigration, restoreBackup } from "../scripts/skill-migration.mjs";
import { createWorkspace, pi } from "./helpers/pi-host.mjs";

const CATALOG = [{ name: "execution-plan" }];

async function fixture(t) {
	const root = await createWorkspace(t);
	const packageRoot = join(root, "package");
	const agentDir = join(root, "agent");
	const skillRoot = join(agentDir, "skills");
	await mkdir(packageRoot);
	await mkdir(skillRoot, { recursive: true });
	const discover = async (path) => (await stat(path)).isDirectory()
		? pi.loadSkillsFromDir({ dir: path, source: "path" }).skills
		: pi.loadSkills({ cwd: root, agentDir, skillPaths: [path], includeDefaults: false }).skills;
	const resource = (path, metadata = {}) => ({ path, enabled: true, metadata: { source: "auto", origin: "top-level", scope: "user", discoveryRoot: metadata.source === "local" ? path : skillRoot, ...metadata } });
	return { root, packageRoot, agentDir, skillRoot, discover, resource };
}

async function createSkill(root, name) {
	await mkdir(root, { recursive: true });
	await writeFile(join(root, "SKILL.md"), `---\nname: ${name}\ndescription: Fixture skill.\n---\nFixture instructions.\n`);
	return root;
}

test("shouldMoveOnlyMatchingSkillsAndRestoreThemWhenInstallationSucceeds", async (t) => {
	// Given
	const context = await fixture(t);
	const selected = await createSkill(join(context.skillRoot, "different-directory-name"), "execution-plan");
	const unrelated = await createSkill(join(context.skillRoot, "unrelated"), "unrelated");
	const plan = await planMigration({ ...context, catalog: CATALOG, resources: [context.resource(context.skillRoot)] });
	// When
	let registered = false;
	const result = await applyMigration({ plan, agentDir: context.agentDir, register: async () => { registered = true; }, rollbackRegistration: async () => {}, verify: async () => assert.equal(await exists(selected), false) });
	const movedState = { registered, selectedExists: await exists(selected), unrelatedExists: await exists(unrelated) };
	await restoreBackup(result.backup);
	// Then
	assert.deepEqual({ movedState, names: plan.moves[0].names, restored: await exists(selected) }, {
		movedState: { registered: true, selectedExists: false, unrelatedExists: true }, names: ["execution-plan"], restored: true,
	});
});

test("shouldMoveOnlyTheLinkWhenSkillDiscoveryUsesASymlink", async (t) => {
	// Given
	const context = await fixture(t);
	const target = await createSkill(join(context.root, "source-repository", "execution-plan"), "execution-plan");
	const link = join(context.skillRoot, "execution-plan");
	await symlink(target, link);
	const plan = await planMigration({ ...context, catalog: CATALOG, resources: [context.resource(link)] });
	// When
	const result = await applyMigration({ plan, agentDir: context.agentDir, register: async () => {}, rollbackRegistration: async () => {}, verify: async () => {} });
	const targetPreserved = await readFile(join(target, "SKILL.md"), "utf8");
	await restoreBackup(result.backup);
	// Then
	assert.deepEqual({ kind: plan.moves[0].kind, target: await readlink(link), sourcePreserved: targetPreserved.includes("Fixture instructions") },
		{ kind: "symlink", target, sourcePreserved: true });
});

for (const failureStage of ["registration", "verification"]) {
	test(`shouldRestoreSkillsWhen${failureStage}Fails`, async (t) => {
		// Given
		const context = await fixture(t);
		const selected = await createSkill(join(context.skillRoot, "execution-plan"), "execution-plan");
		const plan = await planMigration({ ...context, catalog: CATALOG, resources: [context.resource(selected)] });
		let rolledBack = false;
		const fail = async () => { throw new Error("Fixture failure"); };
		// When
		await assert.rejects(applyMigration({ plan, agentDir: context.agentDir,
			register: failureStage === "registration" ? fail : async () => {},
			verify: failureStage === "verification" ? fail : async () => {},
			rollbackRegistration: async () => { rolledBack = true; },
		}), /Migration rolled back/);
		// Then
		assert.deepEqual({ rolledBack, restored: await exists(selected) }, { rolledBack: true, restored: true });
	});
}

test("shouldLeaveNewEntriesUntouchedWhenRestorationWouldOverwriteThem", async (t) => {
	// Given
	const context = await fixture(t);
	const selected = await createSkill(join(context.skillRoot, "execution-plan"), "execution-plan");
	const plan = await planMigration({ ...context, catalog: CATALOG, resources: [context.resource(selected)] });
	const result = await applyMigration({ plan, agentDir: context.agentDir, register: async () => {}, rollbackRegistration: async () => {}, verify: async () => {} });
	await createSkill(selected, "replacement");
	// When
	await assert.rejects(restoreBackup(result.backup), /would overwrite/);
	// Then
	assert.match(await readFile(join(selected, "SKILL.md"), "utf8"), /name: replacement/);
	assert.equal(JSON.parse(await readFile(join(result.backup, "manifest.json"), "utf8")).state, "installed");
});

test("shouldReportManagedConflictsBeforeMovingAnyStandaloneSkills", async (t) => {
	// Given
	const context = await fixture(t);
	const standalone = await createSkill(join(context.skillRoot, "execution-plan"), "execution-plan");
	const managedRoot = join(context.root, "another-package");
	const managed = await createSkill(join(managedRoot, "skills", "execution-plan"), "execution-plan");
	const plan = await planMigration({ ...context, catalog: CATALOG, resources: [context.resource(standalone), context.resource(managed, { origin: "package", source: "npm:another-package", packageRoot: managedRoot })] });
	// When
	await assert.rejects(applyMigration({ plan, agentDir: context.agentDir }), /npm:another-package/);
	// Then
	assert.deepEqual({ standalone: await exists(standalone), managed: await exists(managed) }, { standalone: true, managed: true });
});

test("shouldFindNoFurtherMovesWhenInstallationIsRepeated", async (t) => {
	// Given
	const context = await fixture(t);
	const selected = await createSkill(join(context.skillRoot, "execution-plan"), "execution-plan");
	const bundled = await createSkill(join(context.packageRoot, "skills", "execution-plan"), "execution-plan");
	const plan = await planMigration({ ...context, catalog: CATALOG, resources: [context.resource(selected)] });
	await applyMigration({ plan, agentDir: context.agentDir, register: async () => {}, rollbackRegistration: async () => {}, verify: async () => {} });
	// When
	const repeated = await planMigration({ ...context, catalog: CATALOG, resources: [context.resource(bundled, { origin: "package", packageRoot: context.packageRoot })] });
	// Then
	assert.deepEqual(repeated, { moves: [], blockers: [] });
});

test("shouldPreserveSourceRepositoriesWhenConfiguredSkillPathsPointIntoThem", async (t) => {
	// Given
	const context = await fixture(t);
	const source = join(context.root, "upstream");
	await mkdir(join(source, ".git"), { recursive: true });
	const selected = await createSkill(join(source, "skills", "execution-plan"), "execution-plan");
	// When
	const plan = await planMigration({ ...context, catalog: CATALOG, resources: [context.resource(selected, { source: "local" })] });
	// Then
	assert.match(plan.blockers[0], /source repository/);
	assert.equal(await exists(selected), true);
});

test("shouldMoveTheAncestorLinkWhenDiscoveryListsAFileInsideItsTarget", async (t) => {
	// Given
	const context = await fixture(t);
	const target = join(context.root, "source-tree");
	await createSkill(join(target, "nested", "execution-plan"), "execution-plan");
	const link = join(context.skillRoot, "linked-tree");
	await symlink(target, link);
	const file = join(link, "nested", "execution-plan", "SKILL.md");
	// When
	const plan = await planMigration({ ...context, catalog: CATALOG, resources: [context.resource(file, { baseDir: context.agentDir })] });
	const result = await applyMigration({ plan, agentDir: context.agentDir, register: async () => {}, rollbackRegistration: async () => {}, verify: async () => {} });
	await restoreBackup(result.backup);
	// Then
	assert.deepEqual({ original: plan.moves[0].original, kind: plan.moves[0].kind, sourceExists: await exists(join(target, "nested", "execution-plan")), target: await readlink(link) },
		{ original: link, kind: "symlink", sourceExists: true, target });
});

test("shouldPlanBothDeclaredNameConflictsWhenAConfiguredDirectoryContainsDuplicateSkills", async (t) => {
	// Given
	const context = await fixture(t);
	const originals = [];
	for (const directory of ["first", "second"]) originals.push(await createSkill(join(context.skillRoot, directory), "execution-plan"));
	// When
	const plan = await planMigration({ ...context, catalog: CATALOG, resources: [context.resource(context.skillRoot)] });
	// Then
	assert.deepEqual({ originals: plan.moves.map(({ original }) => original).sort(), blockers: plan.blockers }, { originals: originals.sort(), blockers: [] });
});

test("shouldPreserveAnEntireLinkedTreeWhenItAlsoContainsUnrelatedSkills", async (t) => {
	// Given
	const context = await fixture(t);
	const target = join(context.root, "mixed-source");
	await createSkill(join(target, "selected"), "execution-plan");
	await createSkill(join(target, "unrelated"), "unrelated");
	const link = join(context.skillRoot, "linked-tree");
	await symlink(target, link);
	// When
	const plan = await planMigration({ ...context, catalog: CATALOG, resources: [context.resource(link)] });
	// Then
	assert.deepEqual(plan.moves, []);
	assert.match(plan.blockers[0], /unrelated skills/);
	assert.equal(await readlink(link), target);
});

test("shouldKeepTheAgentConfigurationLinkWhenPlanningAutomaticSkills", async (t) => {
	// Given
	const context = await fixture(t);
	const target = join(context.root, "actual-agent");
	await rename(context.agentDir, target);
	await symlink(target, context.agentDir);
	const selected = await createSkill(join(context.skillRoot, "execution-plan"), "execution-plan");
	// When
	const plan = await planMigration({ ...context, catalog: CATALOG, resources: [context.resource(join(selected, "SKILL.md"), { baseDir: context.agentDir })] });
	// Then
	assert.deepEqual(plan.moves.map(({ original }) => original), [selected]);
	assert.equal(await readlink(context.agentDir), target);
});

test("shouldBlockAConfiguredSkillThatIsItselfARepositoryRoot", async (t) => {
	// Given
	const context = await fixture(t);
	const selected = await createSkill(join(context.root, "standalone-checkout"), "execution-plan");
	await mkdir(join(selected, ".git"));
	// When
	const plan = await planMigration({ ...context, catalog: CATALOG, resources: [context.resource(selected, { source: "local" })] });
	// Then
	assert.deepEqual(plan.moves, []);
	assert.match(plan.blockers[0], /source repository/);
});

test("shouldKeepTheConfiguredLinkWhenNativeDiscoveryEmitsNestedFiles", async (t) => {
	// Given
	const context = await fixture(t);
	const target = join(context.root, "source-tree");
	const source = await createSkill(join(target, "nested", "execution-plan"), "execution-plan");
	const link = join(context.root, "configured-tree");
	await symlink(target, link);
	// When
	const plan = await planMigration({ ...context, catalog: CATALOG, resources: [context.resource(join(link, "nested", "execution-plan", "SKILL.md"), { source: "local", discoveryRoot: link })] });
	// Then
	assert.deepEqual(plan.moves.map(({ original, kind }) => ({ original, kind })), [{ original: link, kind: "symlink" }]);
	assert.equal(await exists(source), true);
});

for (const physicalPath of [false, true]) {
	test(`shouldBlockExplicitConfigurationRootMovesThrough${physicalPath ? "Physical" : "Lexical"}Paths`, async (t) => {
		// Given
		const context = await fixture(t);
		const target = join(context.root, "actual-agent");
		await rename(context.agentDir, target);
		await symlink(target, context.agentDir);
		await createSkill(target, "execution-plan");
		const original = physicalPath ? target : context.agentDir;
		// When
		const plan = await planMigration({ ...context, catalog: CATALOG, resources: [context.resource(original, { source: "local" })] });
		// Then
		assert.deepEqual(plan.moves, []);
		assert.match(plan.blockers[0], /protected configuration/);
		// The mutation layer must also reject an unsafe plan before creating a backup.
		await assert.rejects(applyMigration({ plan: { moves: [{ original }], blockers: [] }, agentDir: context.agentDir }), /protected configuration/);
		assert.equal(await exists(join(context.agentDir, "pi-orchestraitor-backups")), false);
		assert.equal(await readlink(context.agentDir), target);
	});
}

test("shouldBlockMigrationWhenTheDiscoveryBoundaryIsUnknown", async (t) => {
	// Given
	const context = await fixture(t);
	const selected = await createSkill(join(context.skillRoot, "execution-plan"), "execution-plan");
	// When
	const plan = await planMigration({ ...context, catalog: CATALOG, resources: [context.resource(selected, { discoveryRoot: undefined })] });
	// Then
	assert.deepEqual(plan.moves, []);
	assert.match(plan.blockers[0], /cannot establish its configured discovery root/);
});

for (const linkedFile of [false, true]) {
	test(`shouldMigrateOnlyTheConfiguredSkillFileWhenItIs${linkedFile ? "ASymlink" : "ARegularFile"}`, async (t) => {
		// Given
		const context = await fixture(t);
		const directory = join(context.skillRoot, "execution-plan");
		const file = join(directory, "SKILL.md");
		const source = await createSkill(join(context.root, "source"), "execution-plan");
		if (linkedFile) {
			await mkdir(directory);
			await symlink(join(source, "SKILL.md"), file);
		} else await createSkill(directory, "execution-plan");
		// When
		const plan = await planMigration({ ...context, catalog: CATALOG, resources: [context.resource(file, { source: "local" })] });
		assert.deepEqual(plan.moves.map(({ original, kind }) => ({ original, kind })), [{ original: file, kind: linkedFile ? "symlink" : "file" }]);
		const result = await applyMigration({ plan, agentDir: context.agentDir, register: async () => {}, rollbackRegistration: async () => {}, verify: async () => {} });
		// Then
		assert.equal(await exists(directory), true);
		assert.equal(await exists(file), false);
		assert.equal(await exists(join(source, "SKILL.md")), true);
		await restoreBackup(result.backup);
		if (linkedFile) assert.equal(await readlink(file), join(source, "SKILL.md"));
		else assert.match(await readFile(file, "utf8"), /Fixture instructions/);
	});
}
