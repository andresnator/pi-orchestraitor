import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, readlink, realpath, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { exists } from "../scripts/skill-migration.mjs";
import { createWorkspace, packageRoot } from "./helpers/pi-host.mjs";

const SKILL_NAME = "jag-plan";
const SKILL_TEXT = `---\nname: ${SKILL_NAME}\ndescription: Temporary migration fixture.\n---\nPreserve this original skill.\n`;

async function fixture(t, { linkedAgent = false, verificationFailure = false } = {}) {
	const root = await realpath(await createWorkspace(t));
	const cwd = join(root, "consumer");
	const agentTarget = join(root, "agent-data");
	const agentDir = linkedAgent ? join(root, "agent-link") : agentTarget;
	await mkdir(join(cwd, ".git"), { recursive: true });
	await mkdir(agentTarget);
	if (linkedAgent) await symlink(agentTarget, agentDir);
	const sharedSkills = join(process.env.HOME ?? homedir(), ".agents", "skills");
	const settings = { skills: [`!${sharedSkills}/**`] };
	if (verificationFailure) settings.packages = [{ source: `~/${relative(process.env.HOME ?? homedir(), packageRoot)}`, skills: [] }];
	const settingsPath = join(agentDir, "settings.json");
	const saveSettings = () => writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
	await saveSettings();
	const run = (...args) => spawnSync(process.execPath, [join(packageRoot, "scripts/install-pi.mjs"), ...args,
		...(args.includes("--restore") ? [] : ["--without-pretty"])], {
		cwd, encoding: "utf8", env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
	});
	return { root, cwd, agentDir, agentTarget, settings, settingsPath, saveSettings, run };
}

async function createSkill(directory) {
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, "SKILL.md"), SKILL_TEXT);
	return directory;
}

function previewMoves(context, expected) {
	const result = context.run("--dry-run");
	assert.equal(result.status, 0, result.stderr);
	const preview = JSON.parse(result.stdout);
	// These assertions must precede native installation: discovery must stay inside the fixture.
	assert.deepEqual(preview.blockers, []);
	assert.deepEqual(preview.moves, expected.sort((left, right) => left.original.localeCompare(right.original)));
	return preview;
}

function install(context) {
	const result = context.run();
	assert.equal(result.status, 0, result.stderr);
	const receiptStart = result.stdout.lastIndexOf('{\n  "installed"');
	assert.notEqual(receiptStart, -1, result.stdout);
	const receipt = JSON.parse(result.stdout.slice(receiptStart));
	assert.equal(receipt.verifiedSkills, 51);
	return receipt;
}

function restore(context, backup) {
	const result = context.run("--restore", backup);
	assert.equal(result.status, 0, result.stderr);
}

for (const verificationFailure of [false, true]) {
	test(`shouldPreserveSymlinkedAgentConfigurationWhenInstallation${verificationFailure ? "RollsBack" : "Succeeds"}`, async (t) => {
		// Given
		const context = await fixture(t, { linkedAgent: true, verificationFailure });
		const selected = await createSkill(join(context.agentDir, "skills", SKILL_NAME));
		const settingsBefore = await readFile(context.settingsPath, "utf8");
		previewMoves(context, [{ original: selected, names: [SKILL_NAME], kind: "directory" }]);
		// When
		if (verificationFailure) {
			const result = context.run();
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /package adaptation is not the effective skill/);
			assert.match(result.stderr, /Migration rolled back/);
			assert.equal(await readFile(context.settingsPath, "utf8"), settingsBefore);
		} else {
			const receipt = install(context);
			assert.equal(await exists(selected), false);
			restore(context, receipt.backup);
		}
		// Then
		assert.equal((await lstat(context.agentDir)).isSymbolicLink(), true);
		assert.equal(await readlink(context.agentDir), context.agentTarget);
		assert.equal(await readFile(join(selected, "SKILL.md"), "utf8"), SKILL_TEXT);
		assert.equal(await exists(join(context.agentDir, "pi-orchestraitor-backups", ".lock")), false);
	});
}

test("shouldMigrateConfiguredSymlinkTreeWithoutMovingItsSourceSkills", async (t) => {
	// Given
	const context = await fixture(t);
	const sourceRoot = join(context.root, "skill-source");
	const sourceSkill = await createSkill(join(sourceRoot, "workflow", SKILL_NAME));
	await mkdir(join(sourceRoot, ".git"));
	const configuredTree = join(context.root, "configured-skills");
	await symlink(sourceRoot, configuredTree);
	context.settings.skills.push(configuredTree);
	await context.saveSettings();
	previewMoves(context, [{ original: configuredTree, names: [SKILL_NAME], kind: "symlink" }]);
	// When
	const receipt = install(context);
	assert.equal(await exists(configuredTree), false);
	assert.equal(await readFile(join(sourceSkill, "SKILL.md"), "utf8"), SKILL_TEXT);
	restore(context, receipt.backup);
	// Then
	assert.equal(await readlink(configuredTree), sourceRoot);
	assert.equal(await exists(join(sourceRoot, ".git")), true);
	assert.equal(await readFile(join(sourceSkill, "SKILL.md"), "utf8"), SKILL_TEXT);
});

test("shouldBlockMigrationWhenConfiguredSkillDirectoryIsARepositoryRoot", async (t) => {
	// Given
	const context = await fixture(t);
	const sourceSkill = await createSkill(join(context.root, SKILL_NAME));
	await mkdir(join(sourceSkill, ".git"));
	context.settings.skills.push(sourceSkill);
	await context.saveSettings();
	const settingsBefore = await readFile(context.settingsPath, "utf8");
	// When
	const result = context.run("--dry-run");
	const preview = JSON.parse(result.stdout);
	// Then
	assert.notEqual(result.status, 0);
	assert.deepEqual(preview.moves, []);
	assert.equal(preview.blockers.length, 1);
	assert.match(preview.blockers[0], /belongs to a source repository/);
	assert.ok(preview.blockers[0].includes(sourceSkill));
	assert.equal(await readFile(join(sourceSkill, "SKILL.md"), "utf8"), SKILL_TEXT);
	assert.equal(await exists(join(sourceSkill, ".git")), true);
	assert.equal(await readFile(context.settingsPath, "utf8"), settingsBefore);
});

test("shouldMigrateAndRestoreEveryDiscoveryAliasForTheSameSkill", async (t) => {
	// Given
	const context = await fixture(t);
	const sourceSkill = await createSkill(join(context.root, "skill-source", SKILL_NAME));
	const aliases = [join(context.cwd, ".pi", "skills", SKILL_NAME), join(context.cwd, ".agents", "skills", SKILL_NAME)];
	for (const alias of aliases) {
		await mkdir(join(alias, ".."), { recursive: true });
		await symlink(sourceSkill, alias);
	}
	previewMoves(context, aliases.map((original) => ({ original, names: [SKILL_NAME], kind: "symlink" })));
	// When
	const receipt = install(context);
	for (const alias of aliases) assert.equal(await exists(alias), false);
	assert.equal(await readFile(join(sourceSkill, "SKILL.md"), "utf8"), SKILL_TEXT);
	restore(context, receipt.backup);
	// Then
	for (const alias of aliases) assert.equal(await readlink(alias), sourceSkill);
	assert.equal(await readFile(join(sourceSkill, "SKILL.md"), "utf8"), SKILL_TEXT);
});
