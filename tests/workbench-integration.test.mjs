import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { createPackageUISession, createWorkspace, packageRoot } from "./helpers/ui-harness.mjs";
const run = promisify(execFile);

test("shouldKeepFullPackageToolsFiltersAndNativeUiUntouchedWhenPublisherIsUnavailable", async (t) => {
	// Given
	const { session, calls, errors } = await createPackageUISession(t, "tui", { selection: { tools: ["read"] } });
	const runner = session.extensionRunner;
	const original = process.env.HERDR_ENV; process.env.HERDR_ENV = "0";
	t.after(() => { if (original === undefined) delete process.env.HERDR_ENV; else process.env.HERDR_ENV = original; });
	// When
	await runner.getCommand("orchestraitor:workbench").handler("enable", runner.createCommandContext());
	await session.reload();
	// Then
	assert.deepEqual(session.getActiveToolNames(), ["read"]);
	assert.deepEqual(errors, []);
	assert.ok(calls.some(call => call[0] === "notify" && /Workbench/.test(call[1])));
	assert.ok(!calls.some(call => ["widget", "status"].includes(call[0])));
});

test("shouldValidateIsolatedSdkLauncherWithoutCredentialsModelsOrPersonalWrites", async (t) => {
	// Given
	const root = await createWorkspace(t);
	const before = await readdir(root);
	// When
	const { stdout } = await run(process.execPath, [join(packageRoot, "tests/fixtures/workbench-session.mjs"), "--validate-only", "--root", root, "--mode", "fullscreen"]);
	// Then
	assert.deepEqual(JSON.parse(stdout), { valid: true, synthetic: true, mode: "fullscreen", personalWrites: false, modelCalls: false });
	assert.deepEqual(await readdir(root), before);
});

test("shouldRunActualGuardedReadersWithPublicSdkAndSyntheticAccountingOnly", { timeout: 30000 }, async (t) => {
	// Given
	const root = await createWorkspace(t);
	// When
	const { stdout } = await run(process.execPath, [join(packageRoot, "tests/fixtures/workbench-session.mjs"), "--synthetic-check", "--root", root], { timeout: 25000 });
	const result = JSON.parse(stdout);
	// Then
	assert.equal(result.synthetic, true);
	assert.equal(result.taskCount, 2);
	assert.deepEqual(result.children?.map(child => ({ status: child.status, terminated: child.terminated, writes: child.writes, usageComplete: child.usageComplete })), [
		{ status: "completed", terminated: true, writes: [], usageComplete: true }, { status: "completed", terminated: true, writes: [], usageComplete: true },
	]);
	assert.deepEqual(result.usage, { input: 80, output: 20, cacheRead: 0, cacheWrite: 0, total: 100 });
	assert.ok(result.children.every(child => /marker\.txt/.test(child.finalResponse)));
});

test("shouldRefuseLiveLauncherWithoutExplicitQuotaAuthorizationBeforeCreatingAnything", async (t) => {
	// Given
	const root = await createWorkspace(t);
	// When / Then
	await assert.rejects(run(process.execPath, [join(packageRoot, "tests/fixtures/workbench-session.mjs"), "--live", "--root", root, "--model", "openai-codex/configured"]), /authorization|authorize/i);
	assert.deepEqual(await readdir(root), []);
});

test("shouldShipOnlyDeclarativePaneActionsWithoutInstallOrAutomaticOpenHooks", async () => {
	// Given
	const text = await readFile(join(packageRoot, "herdr/workbench/herdr-plugin.toml"), "utf8");
	// When / Then
	assert.equal((text.match(/\[\[panes\]\]/g) ?? []).length, 1);
	assert.equal((text.match(/\[\[actions\]\]/g) ?? []).length, 3);
	assert.match(text, /id = "pi\.orchestraitor"/);
	assert.doesNotMatch(text, /\[.*hooks|install_command|build_command|auto_open|curl|wget/);
});
