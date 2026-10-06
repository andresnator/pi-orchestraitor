import assert from "node:assert/strict";
import fs, { lstat, mkdir, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname, join, relative } from "node:path";
import test from "node:test";
import { planPrettyConfig } from "../scripts/pretty-config.mjs";
import { exists } from "../scripts/skill-migration.mjs";
import { createWorkspace } from "./helpers/pi-host.mjs";

for (const custom of [false, true]) {
	test(`shouldPreviewWithoutWritesAndApplyIdempotentlyIn${custom ? "Custom" : "Default"}PrettyDirectory`, async (t) => {
		const root = await createWorkspace(t);
		const directory = custom ? join(root, "custom") : join(root, ".pi", "agent");
		const env = { HOME: root, PI_CODING_AGENT_DIR: join(root, "different-agent"), ...(custom ? { PRETTY_CONFIG_DIR: directory } : {}) };
		const path = join(directory, "pi-pretty.json");
		const update = await planPrettyConfig(env);
		assert.deepEqual(update.preview, { path, disableTools: ["bash"], changed: true });
		assert.equal(await exists(directory), false);
		await update.apply();
		const applied = await readFile(path, "utf8");
		const repeated = await planPrettyConfig(env);
		assert.equal(repeated.preview.changed, false);
		await repeated.apply();
		await repeated.rollback();
		assert.equal(await readFile(path, "utf8"), applied);
		await update.rollback();
		assert.equal(await exists(path), false);
	});
}

for (const concurrent of [false, true]) {
	test(`shouldPreservePrettyPreferencesAndRollbackOnlyBashWithConcurrentChanges${concurrent}`, async (t) => {
		const root = await createWorkspace(t), path = join(root, "pi-pretty.json");
		const original = { theme: "github-dark", disableTools: [" ls "], enableTools: ["ls"], workingIndicator: { enabled: false } };
		const text = `${JSON.stringify(original, null, 4)}\n`;
		await writeFile(path, text);
		const update = await planPrettyConfig({ PRETTY_CONFIG_DIR: root });
		await update.apply();
		const applied = JSON.parse(await readFile(path, "utf8"));
		assert.deepEqual(applied, { ...original, disableTools: [" ls ", "bash"] });
		if (concurrent) await writeFile(path, JSON.stringify({ ...applied, theme: "changed", disableTools: [...applied.disableTools, "grep"], custom: true }));
		await update.rollback();
		if (concurrent) assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { ...original, theme: "changed", disableTools: [" ls ", "grep"], custom: true });
		else assert.equal(await readFile(path, "utf8"), text);
	});
}

test("shouldRetainConcurrentPreferencesWhenRemovingBashFromNewPrettyConfig", async (t) => {
	const root = await createWorkspace(t), path = join(root, "pi-pretty.json");
	const update = await planPrettyConfig({ PRETTY_CONFIG_DIR: root });
	await update.apply();
	await writeFile(path, JSON.stringify({ disableTools: ["bash", "find"], icons: "none" }));
	await update.rollback();
	assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { disableTools: ["find"], icons: "none" });
});

test("shouldRetainChangesBetweenPreviewAndApplicationAndAnExistingNormalizedBashExclusion", async (t) => {
	const root = await createWorkspace(t), path = join(root, "pi-pretty.json");
	const update = await planPrettyConfig({ PRETTY_CONFIG_DIR: root });
	const text = '{"theme":"changed","disableTools":[" BASH ","find"]}';
	await writeFile(path, text);
	await update.apply();
	await update.rollback();
	assert.equal(await readFile(path, "utf8"), text);
});

for (const value of ["read", " read, FIND ", " ls, , grep"]) {
	test(`shouldRejectOverridingEnvironmentBeforeCreatingFilesWhenListIs${value}`, async (t) => {
		const root = await createWorkspace(t), directory = join(root, "config");
		await assert.rejects(planPrettyConfig({ PRETTY_CONFIG_DIR: directory, PRETTY_DISABLE_TOOLS: value }), /PRETTY_DISABLE_TOOLS overrides.*Add bash/);
		assert.equal(await exists(directory), false);
	});
}

for (const value of [undefined, "", " , ", " read, BASH "]) {
	test(`shouldHonorUpstreamEnvironmentNormalizationWhenListIs${String(value)}`, async (t) => {
		const root = await createWorkspace(t);
		const update = await planPrettyConfig({ PRETTY_CONFIG_DIR: root, PRETTY_DISABLE_TOOLS: value });
		assert.deepEqual(update.preview.disableTools, ["bash"]);
	});
}

test("shouldRejectInvalidConfigBeforeMutation", async (t) => {
	const root = await createWorkspace(t), path = join(root, "pi-pretty.json");
	for (const text of ["{bad-json", "[]", '{"disableTools":"read"}']) {
		await writeFile(path, text);
		await assert.rejects(planPrettyConfig({ PRETTY_CONFIG_DIR: root }));
		assert.equal(await readFile(path, "utf8"), text);
	}
});

test("shouldLeaveConcurrentReplacementOfDisabledToolsUntouchedOnRollback", async (t) => {
	const root = await createWorkspace(t), path = join(root, "pi-pretty.json");
	const update = await planPrettyConfig({ PRETTY_CONFIG_DIR: root });
	await update.apply();
	for (const disableTools of [["read"], "changed-by-another-writer"]) {
		const text = JSON.stringify({ disableTools, theme: "changed" });
		await writeFile(path, text);
		await update.rollback();
		assert.equal(await readFile(path, "utf8"), text);
	}
});

// Inject an actual partial write, rather than only rejecting before any bytes
// reach the filesystem. Match both the old destination and any staged file.
function failConfigIO(t, root, failure) {
	const method = failure === "partial-write" ? "writeFile" : "rename";
	const original = fs[method];
	let pending = true;
	const mock = t.mock.method(fs, method, async (path, ...args) => {
		if (pending && dirname(path) === root && basename(path).startsWith("pi-pretty.json")) {
			pending = false;
			if (method === "writeFile") await original(path, args[0].slice(0, 8), ...args.slice(1));
			throw Object.assign(new Error(`Fixture ${failure}`), { code: method === "writeFile" ? "ENOSPC" : "EACCES" });
		}
		return original(path, ...args);
	});
	syncBuiltinESMExports();
	t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
}

for (const existing of [false, true]) {
	for (const failure of ["partial-write", "publication"]) {
		test(`shouldKeepOriginalAndCleanStagingWhenApplyFailsWith${failure}AndExistingConfig${existing}`, async (t) => {
			const root = await createWorkspace(t), path = join(root, "pi-pretty.json");
			const before = '{ "theme": "original", "disableTools": ["read"] }\n';
			if (existing) await writeFile(path, before);
			const update = await planPrettyConfig({ PRETTY_CONFIG_DIR: root });
			failConfigIO(t, root, failure);
			await assert.rejects(update.apply(), new RegExp(`Fixture ${failure}`));
			if (existing) assert.equal(await readFile(path, "utf8"), before);
			else assert.equal(await exists(path), false);
			// Preparation failed: rollback must not undo another writer's edit.
			const concurrent = '{"theme":"concurrent","disableTools":["bash","find"]}';
			await writeFile(path, concurrent);
			await update.rollback();
			assert.equal(await readFile(path, "utf8"), concurrent);
			assert.deepEqual(await readdir(root), ["pi-pretty.json"]);
		});
	}
}

for (const concurrent of [false, true]) {
	for (const failure of ["partial-write", "publication"]) {
		test(`shouldKeepPublishedConfigAndRetryRollbackAfter${failure}WithConcurrentEdits${concurrent}`, async (t) => {
			const root = await createWorkspace(t), path = join(root, "pi-pretty.json");
			const before = '{ "theme": "original", "disableTools": ["read"] }\n';
			await writeFile(path, before);
			const update = await planPrettyConfig({ PRETTY_CONFIG_DIR: root });
			await update.apply();
			if (concurrent) await writeFile(path, '{"theme":"concurrent","disableTools":["read","bash","find"]}');
			const published = await readFile(path, "utf8");
			failConfigIO(t, root, failure);
			await assert.rejects(update.rollback(), new RegExp(`Fixture ${failure}`));
			assert.equal(await readFile(path, "utf8"), published);
			assert.deepEqual(await readdir(root), ["pi-pretty.json"]);
			await update.rollback();
			if (concurrent) assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { theme: "concurrent", disableTools: ["read", "find"] });
			else assert.equal(await readFile(path, "utf8"), before);
		});
	}
}

for (const failure of ["partial-write", "publication"]) {
	test(`shouldRetryRecoveryOfNewConfigWithoutLosingConcurrentPreferencesAfter${failure}`, async (t) => {
		const root = await createWorkspace(t), path = join(root, "pi-pretty.json");
		const update = await planPrettyConfig({ PRETTY_CONFIG_DIR: root });
		await update.apply();
		const published = '{"theme":"concurrent","disableTools":["bash","find"]}';
		await writeFile(path, published);
		failConfigIO(t, root, failure);
		await assert.rejects(update.rollback(), new RegExp(`Fixture ${failure}`));
		assert.equal(await readFile(path, "utf8"), published);
		assert.deepEqual(await readdir(root), ["pi-pretty.json"]);
		await update.rollback();
		assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { theme: "concurrent", disableTools: ["find"] });
	});
}

async function linkedConfig(t, form = "absolute") {
	const root = await realpath(await createWorkspace(t));
	const directory = join(root, "config"), dotfiles = join(root, "dotfiles");
	await mkdir(directory);
	await mkdir(dotfiles);
	const path = join(directory, "pi-pretty.json"), target = join(dotfiles, "pi-pretty.json");
	const before = '{ "theme": "managed", "disableTools": ["read"] }\n';
	await writeFile(target, before);
	let destination = target;
	if (form === "chain") {
		destination = join(dotfiles, "link.json");
		await symlink("pi-pretty.json", destination);
	}
	const link = form === "absolute" ? destination : relative(directory, destination);
	await symlink(link, path);
	return { root, directory, dotfiles, path, target, link, before };
}

for (const form of ["absolute", "relative", "chain"]) {
	for (const concurrent of [false, true]) {
		test(`shouldKeep${form}ConfigLinkAndUpdateItsTargetWithConcurrentEdits${concurrent}`, async (t) => {
			const { directory, dotfiles, path, target, link, before } = await linkedConfig(t, form);
			const update = await planPrettyConfig({ PRETTY_CONFIG_DIR: directory });
			assert.equal(update.preview.path, path);
			assert.equal(await readFile(target, "utf8"), before);
			await update.apply();
			assert.equal((await lstat(path)).isSymbolicLink(), true);
			assert.equal(await readlink(path), link);
			assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { theme: "managed", disableTools: ["read", "bash"] });
			if (concurrent) await writeFile(path, '{"theme":"concurrent","disableTools":["read","bash","find"]}');
			await update.rollback();
			assert.equal(await readlink(path), link);
			if (concurrent) assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { theme: "concurrent", disableTools: ["read", "find"] });
			else assert.equal(await readFile(target, "utf8"), before);
			assert.deepEqual(await readdir(directory), ["pi-pretty.json"]);
			assert.deepEqual((await readdir(dotfiles)).sort(), form === "chain" ? ["link.json", "pi-pretty.json"] : ["pi-pretty.json"]);
		});
	}
}

for (const stage of ["apply", "rollback"]) {
	for (const failure of ["partial-write", "publication"]) {
		test(`shouldKeepLinkAndTargetIntactWhen${stage}FailsWith${failure}`, async (t) => {
			const { directory, dotfiles, path, target, link, before } = await linkedConfig(t);
			const update = await planPrettyConfig({ PRETTY_CONFIG_DIR: directory });
			if (stage === "rollback") await update.apply();
			const published = await readFile(target, "utf8");
			failConfigIO(t, dotfiles, failure);
			await assert.rejects(update[stage](), new RegExp(`Fixture ${failure}`));
			assert.equal(await readlink(path), link);
			assert.equal(await readFile(target, "utf8"), published);
			assert.deepEqual(await readdir(dotfiles), ["pi-pretty.json"]);
			await update.rollback();
			assert.equal(await readFile(target, "utf8"), before);
			assert.equal(await readlink(path), link);
		});
	}
}

test("shouldRejectDanglingConfigLinksBeforeMutation", async (t) => {
	const root = await createWorkspace(t), path = join(root, "pi-pretty.json");
	await symlink("missing.json", path);
	await assert.rejects(planPrettyConfig({ PRETTY_CONFIG_DIR: root }), /configuration link.*target/i);
	assert.equal(await readlink(path), "missing.json");
	assert.deepEqual(await readdir(root), ["pi-pretty.json"]);
});

test("shouldRecoverThePublishedTargetWhenTheConfigAliasIsRetargeted", async (t) => {
	const { directory, dotfiles, path, target, before } = await linkedConfig(t);
	const update = await planPrettyConfig({ PRETTY_CONFIG_DIR: directory });
	await update.apply();
	const replacement = join(dotfiles, "replacement.json"), replacementText = '{"theme":"concurrent","disableTools":["bash"]}';
	await writeFile(replacement, replacementText);
	await rm(path);
	await symlink(replacement, path);
	await update.rollback();
	assert.equal(await readlink(path), replacement);
	assert.equal(await readFile(replacement, "utf8"), replacementText);
	assert.equal(await readFile(target, "utf8"), before);
});

test("shouldRefuseRollbackThroughAReplacementLinkAtThePublishedTarget", async (t) => {
	const { directory, dotfiles, path, target, link } = await linkedConfig(t);
	const update = await planPrettyConfig({ PRETTY_CONFIG_DIR: directory });
	await update.apply();
	const replacement = join(dotfiles, "replacement.json"), replacementText = '{"disableTools":["bash"],"theme":"concurrent"}';
	await writeFile(replacement, replacementText);
	await rm(target);
	await symlink(replacement, target);
	await assert.rejects(update.rollback(), /configuration target changed/);
	assert.equal(await readlink(path), link);
	assert.equal(await readlink(target), replacement);
	assert.equal(await readFile(replacement, "utf8"), replacementText);
});
