import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { exists } from "../scripts/skill-migration.mjs";
import { createWorkspace, packageRoot, pi } from "./helpers/pi-host.mjs";

test("shouldMigrateAndLoadAllSkillsWhenNativeInstallationRunsInTemporaryConfiguration", async (t) => {
	// Given
	const root = await realpath(await createWorkspace(t));
	const cwd = join(root, "consumer");
	const agentDir = join(root, "agent");
	const projectSkill = join(cwd, ".pi", "skills", "execution-plan");
	const ancestorSkill = join(cwd, ".agents", "skills", "adr");
	await mkdir(join(cwd, ".git"), { recursive: true });
	await mkdir(agentDir);
	const sharedRoot = join(process.env.HOME ?? homedir(), ".agents", "skills");
	await writeFile(join(agentDir, "settings.json"), JSON.stringify({ skills: [`!${sharedRoot}/**`] }));
	for (const [path, name] of [[projectSkill, "execution-plan"], [ancestorSkill, "adr"]]) {
		await mkdir(path, { recursive: true });
		await writeFile(join(path, "SKILL.md"), `---\nname: ${name}\ndescription: Temporary original.\n---\nOriginal fixture.\n`);
	}
	const run = (...args) => execFileSync(process.execPath, [join(packageRoot, "scripts/install-pi.mjs"), ...args], {
		cwd, encoding: "utf8", env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
	});
	// When
	const preview = JSON.parse(run("--local", "--dry-run"));
	// Stop before mutation if the host discovers any path outside this fixture.
	assert.deepEqual(preview.moves.map(({ original }) => original).sort(), [ancestorSkill, projectSkill].sort());
	assert.equal(await exists(projectSkill), true);
	const installed = run("--local");
	const receipt = JSON.parse(installed.slice(installed.lastIndexOf('{\n  "installed"')));
	const repeated = run("--local");
	const settingsManager = pi.SettingsManager.create(cwd, agentDir, { projectTrusted: true });
	const loader = new pi.DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, noThemes: true, noPromptTemplates: true, noContextFiles: true });
	await loader.reload();
	const effectiveSkills = loader.getSkills();
	const nativeConfig = JSON.parse(await readFile(join(cwd, ".pi", "settings.json"), "utf8"));
	run("--restore", receipt.backup, "--dry-run");
	const stillMoved = !await exists(projectSkill);
	run("--restore", receipt.backup);
	// Then
	assert.deepEqual({
		previewMoves: preview.moves.map(({ original }) => original).sort(), blockers: preview.blockers,
		verified: receipt.verifiedSkills, count: effectiveSkills.skills.length, diagnostics: effectiveSkills.diagnostics,
		packageRegistered: nativeConfig.packages.some((entry) => resolve(dirname(join(cwd, ".pi", "settings.json")), typeof entry === "string" ? entry : entry.source) === resolve(packageRoot)),
		previewRestorationDidNotMove: stillMoved, restored: await exists(projectSkill) && await exists(ancestorSkill),
	}, {
		previewMoves: [ancestorSkill, projectSkill].sort(), blockers: [], verified: 61, count: 61, diagnostics: [],
		packageRegistered: true, previewRestorationDidNotMove: true, restored: true,
	});
	assert.match(repeated, /"moves": \[\]/);
	assert.ok(effectiveSkills.skills.every(({ filePath }) => filePath.startsWith(join(packageRoot, "skills"))));
});
