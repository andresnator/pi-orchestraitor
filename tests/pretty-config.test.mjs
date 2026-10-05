import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
