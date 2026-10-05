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
	const run = (...args) => execFileSync(process.execPath, [join(packageRoot, "scripts/install-pi.mjs"), ...args, ...(args.includes("--restore") ? [] : ["--without-pretty"])], {
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

test("shouldPreviewAndRegisterPinnedPrettyWithHarnessWhenDefaultInstallerRuns", async (t) => {
	// Given
	const { hostRoot } = await import("./helpers/pi-host.mjs");
	const root = await realpath(await createWorkspace(t)), cwd = join(root, "consumer"), agentDir = join(root, "agent"), bin = join(root, "bin");
	await mkdir(join(cwd, ".git"), { recursive: true }); await mkdir(agentDir); await mkdir(bin);
	const sharedRoot = join(process.env.HOME ?? homedir(), ".agents", "skills");
	await writeFile(join(agentDir, "settings.json"), JSON.stringify({ skills: [`!${sharedRoot}/**`] }));
	const callsPath = join(root, "calls.json"), settingsPath = join(cwd, ".pi", "settings.json");
	const source = "npm:@heyhuynhgiabuu/pi-pretty@0.6.30";
	// Only native registration is substituted; actual Pi discovery verifies the bundled skills.
	await writeFile(join(bin, "pi"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
const args = process.argv.slice(2), source = args.at(-1), settingsPath = ${JSON.stringify(settingsPath)}, callsPath = ${JSON.stringify(callsPath)};
fs.mkdirSync(path.dirname(settingsPath), {recursive:true});
const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath,"utf8")) : {};
settings.packages = [...(settings.packages ?? []), source];
fs.writeFileSync(settingsPath,JSON.stringify(settings));
const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath,"utf8")) : [];
fs.writeFileSync(callsPath, JSON.stringify([...calls,args]));
if (process.env.PRETTY_TEST_FAIL === "1" && source.startsWith("npm:")) process.exit(1);
`, { mode: 0o755 });
	let failPretty = false;
	const run = (...args) => execFileSync(process.execPath, [join(packageRoot, "scripts/install-pi.mjs"), "--local", ...args], {
		cwd, encoding: "utf8", stdio: "pipe", env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_TEST_PACKAGE_DIR: hostRoot,
			PATH: `${bin}:${process.env.PATH}`, PRETTY_TEST_FAIL: failPretty ? "1" : "0" },
	});
	// When
	const preview = JSON.parse(run("--dry-run"));
	assert.deepEqual({ moves: preview.moves, blockers: preview.blockers, companions: preview.companionPackages }, { moves: [], blockers: [], companions: [source] });
	assert.equal(await exists(callsPath), false);
	const output = run();
	const receipt = JSON.parse(output.slice(output.lastIndexOf('{\n  "installed"')));
	// Then
	assert.deepEqual(JSON.parse(await readFile(callsPath, "utf8")), [["install", "--local", "--approve", packageRoot], ["install", "--local", "--approve", source]]);
	assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")).packages, [packageRoot, source]);
	assert.equal(receipt.verifiedSkills, 61);
	assert.deepEqual(receipt.companionPackages, [source]);
	const settingsBefore = await readFile(settingsPath, "utf8");
	// A companion failure after modifying registration restores both targets.
	failPretty = true;
	assert.throws(() => run(), /Migration rolled back/);
	assert.equal(await readFile(settingsPath, "utf8"), settingsBefore);
});
