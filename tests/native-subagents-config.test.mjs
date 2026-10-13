import assert from "node:assert/strict";
import { mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { nativeSettings, planNativeConfig, restoreNativeConfig } from "../scripts/subagents-config.mjs";
import { applyMigration, exists, restoreBackup } from "../scripts/skill-migration.mjs";
import { assertReleaseAge, integrationFingerprint, readReleasePolicy, releaseAgeEnvironment, requireNativeValidation } from "../scripts/subagents-validation.mjs";
import { createWorkspace, hostRoot, packageRoot } from "./helpers/pi-host.mjs";

test("fresh native configuration is previewable, repeatable and restores through a settings symlink", async t => {
	const root = await createWorkspace(t), agent = join(root, "agent"), settings = join(agent, "settings.json"), target = join(root, "managed.json");
	await mkdir(agent);
	await writeFile(target, '{"theme":"retained"}\n');
	await symlink("../managed.json", settings);
	const plan = await planNativeConfig(settings, agent, packageRoot);
	assert.equal(plan.preview.every(row => row.changed), true);
	assert.equal(await exists(join(agent, "extensions/subagent/config.json")), false);
	await plan.apply();
	assert.equal(await readlink(settings), "../managed.json");
	assert.deepEqual(JSON.parse(await readFile(target)).subagents, nativeSettings(packageRoot, agent).subagents);
	const repeated = await planNativeConfig(settings, agent, packageRoot);
	assert.equal(repeated.preview.every(row => !row.changed), true);
	const current = JSON.parse(await readFile(target));
	await writeFile(target, JSON.stringify({ ...current, theme: "concurrent" }));
	await restoreNativeConfig(JSON.parse(JSON.stringify(plan.receipts)), { dryRun: true });
	assert.ok(JSON.parse(await readFile(target)).subagents);
	await restoreNativeConfig(JSON.parse(JSON.stringify(plan.receipts)));
	assert.deepEqual(JSON.parse(await readFile(target)), { theme: "concurrent" });
	assert.equal(await readlink(settings), "../managed.json");
	assert.equal(await exists(join(agent, "extensions/subagent/config.json")), false);
});

test("durable installer restoration removes native config even without migrated skills", async t => {
	const root = await createWorkspace(t), agent = join(root, "agent"), settingsPath = join(agent, "settings.json");
	await mkdir(agent);
	const previousSettings = '{"theme":"original"}';
	await writeFile(settingsPath, previousSettings);
	const native = await planNativeConfig(settingsPath, agent, packageRoot);
	const result = await applyMigration({ plan: { moves: [], blockers: [] }, agentDir: agent,
		configuration: { settingsPath, previousSettings, packageRoot, companionPackages: [], native: native.receipts },
		register: () => native.apply(), rollbackRegistration: () => native.rollback(), verify: async () => {},
	});
	assert.ok(result.backup);
	await restoreBackup(result.backup, { dryRun: true });
	assert.ok(JSON.parse(await readFile(settingsPath)).subagents);
	await restoreBackup(result.backup);
	assert.equal(await readFile(settingsPath, "utf8"), previousSettings);
	assert.equal(await exists(join(agent, "extensions/subagent/config.json")), false);
	await restoreBackup(result.backup);
});

test("native config conflicts and stale validation prevent activation", async t => {
	const root = await createWorkspace(t), settings = join(root, "settings.json");
	await writeFile(settings, '{"subagents":{"defaultModel":"old/profile"}}');
	await assert.rejects(planNativeConfig(settings, root, packageRoot), /conflicting native subagents/);
	await assert.rejects(requireNativeValidation(undefined, packageRoot, hostRoot), /Activation requires/);
	const receipt = join(root, "validation.json");
	await writeFile(receipt, JSON.stringify({ status: "passed", pi: "1.0.4", plugin: "0.78.0", fingerprint: await integrationFingerprint(packageRoot) }));
	await assert.rejects(requireNativeValidation(receipt, packageRoot, hostRoot), /wrong host/);
	await writeFile(receipt, JSON.stringify({ status: "passed", pi: "1.2.0", plugin: "0.78.0", fingerprint: "stale" }));
	await assert.rejects(requireNativeValidation(receipt, packageRoot, hostRoot), /stale/);
});

test("restoration rejects a retargeted settings link before changing either configuration", async t => {
	const root = await createWorkspace(t), agent = join(root, "agent"), settingsPath = join(agent, "settings.json");
	const original = join(root, "original.json"), replacement = join(root, "replacement.json");
	await mkdir(agent);
	const previousSettings = JSON.stringify({ packages: ["npm:unrelated@1"], theme: "original" });
	await writeFile(original, previousSettings);
	await symlink(original, settingsPath);
	const native = await planNativeConfig(settingsPath, agent, packageRoot);
	const result = await applyMigration({ plan: { moves: [], blockers: [] }, agentDir: agent,
		configuration: { settingsPath, previousSettings, packageRoot, companionPackages: ["npm:pi-subagents@0.78.0"], native: native.receipts },
		register: async () => {
			await native.apply();
			const value = JSON.parse(await readFile(settingsPath));
			value.packages.push(packageRoot, "npm:pi-subagents@0.78.0");
			await writeFile(settingsPath, JSON.stringify(value));
		}, rollbackRegistration: () => native.rollback(), verify: async () => {},
	});
	const installed = await readFile(original, "utf8");
	const replacementText = JSON.stringify({ packages: ["npm:pi-subagents@0.77.0"], theme: "replacement" });
	await writeFile(replacement, replacementText);
	await rm(settingsPath);
	await symlink(replacement, settingsPath);
	const configPath = join(agent, "extensions/subagent/config.json"), configText = await readFile(configPath, "utf8");
	for (const dryRun of [true, false]) {
		await assert.rejects(restoreBackup(result.backup, { dryRun }), /target changed since installation/);
		assert.equal(await readFile(original, "utf8"), installed);
		assert.equal(await readFile(replacement, "utf8"), replacementText);
		assert.equal(await readFile(configPath, "utf8"), configText);
		assert.equal(JSON.parse(await readFile(join(result.backup, "manifest.json"))).state, "installed");
	}
	await rm(settingsPath);
	await symlink(original, settingsPath);
	await restoreBackup(result.backup);
	assert.equal(await readFile(original, "utf8"), previousSettings);
	assert.equal(await readFile(replacement, "utf8"), replacementText);
	assert.equal(await readlink(settingsPath), original);
});

test("authorized release exceptions remain exact and flow into native installation", async () => {
	const policy = await readReleasePolicy();
	assert.equal(policy.minutes, 1440);
	await assertReleaseAge("pi-subagents", "0.78.0", 0, policy);
	await assertReleaseAge("@earendil-works/pi-coding-agent", "1.2.0", 0, policy);
	assert.equal(releaseAgeEnvironment("npm:pi-subagents@0.78.0", policy, {}).npm_config_min_release_age_exclude, "pi-subagents");
	for (const source of ["npm:pi-subagents@0.78.1", "npm:pi-subagents@latest", "npm:unrelated@0.78.0", packageRoot]) {
		const env = releaseAgeEnvironment(source, policy, {});
		assert.equal(env.npm_config_min_release_age_exclude, "");
		assert.equal(env.npm_config_min_release_age, "1");
		assert.equal(env.PNPM_CONFIG_MINIMUM_RELEASE_AGE, "1440");
		assert.deepEqual(JSON.parse(env.PNPM_CONFIG_MINIMUM_RELEASE_AGE_EXCLUDE), policy.exceptions);
		assert.equal(env.npm_config_ignore_scripts, "true");
	}
});
