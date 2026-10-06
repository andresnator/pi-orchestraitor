import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
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
	const projectSkill = join(cwd, ".pi", "skills", "jag-plan");
	const ancestorSkill = join(cwd, ".agents", "skills", "jag-adr");
	await mkdir(join(cwd, ".git"), { recursive: true });
	await mkdir(agentDir);
	const sharedRoot = join(process.env.HOME ?? homedir(), ".agents", "skills");
	await writeFile(join(agentDir, "settings.json"), JSON.stringify({ skills: [`!${sharedRoot}/**`] }));
	const prettyPath = join(agentDir, "pi-pretty.json"), prettyText = '{"theme":"retained"}';
	await writeFile(prettyPath, prettyText);
	for (const [path, name] of [[projectSkill, "jag-plan"], [ancestorSkill, "jag-adr"]]) {
		await mkdir(path, { recursive: true });
		await writeFile(join(path, "SKILL.md"), `---\nname: ${name}\ndescription: Temporary original.\n---\nOriginal fixture.\n`);
	}
	const run = (...args) => execFileSync(process.execPath, [join(packageRoot, "scripts/install-pi.mjs"), ...args, ...(args.includes("--restore") ? [] : ["--without-pretty"])], {
		cwd, encoding: "utf8", env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PRETTY_CONFIG_DIR: agentDir, PRETTY_DISABLE_TOOLS: "read" },
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
		previewMoves: [ancestorSkill, projectSkill].sort(), blockers: [], verified: 51, count: 51, diagnostics: [],
		packageRegistered: true, previewRestorationDidNotMove: true, restored: true,
	});
	assert.match(repeated, /"moves": \[\]/);
	assert.ok(effectiveSkills.skills.every(({ filePath }) => filePath.startsWith(join(packageRoot, "skills"))));
	assert.equal(await readFile(prettyPath, "utf8"), prettyText);
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
const identity = entry => { const value = typeof entry === "string" ? entry : entry.source; return value.startsWith("npm:") ? value.slice(4).trim().replace(/@[^@]+$/, "") : value; };
const index = (settings.packages ?? []).findIndex(entry => identity(entry) === identity(source));
settings.packages ??= [];
if (index < 0) settings.packages.push(source);
else { const entry = settings.packages[index]; settings.packages[index] = typeof entry === "string" ? source : {...entry,source}; }
if (process.env.PRETTY_TEST_CONCURRENT === "1" && source.startsWith("npm:")) {
  settings.theme = "concurrent"; settings.packages.push("npm:unrelated-concurrent");
  settings.packages = settings.packages.map(entry => identity(entry) === "neighbor" ? {...entry,source:"npm:neighbor@2",extensions:["concurrent"]} : entry);
  const prettyPath = path.join(process.env.PRETTY_CONFIG_DIR,"pi-pretty.json");
  const config = JSON.parse(fs.readFileSync(prettyPath,"utf8"));
  fs.writeFileSync(prettyPath,JSON.stringify({...config,theme:"concurrent",disableTools:[...config.disableTools,"grep"]}));
}
fs.writeFileSync(settingsPath,JSON.stringify(settings));
const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath,"utf8")) : [];
fs.writeFileSync(callsPath, JSON.stringify([...calls,args]));
if (process.env.PRETTY_TEST_FAIL === "1" && source.startsWith("npm:")) process.exit(1);
`, { mode: 0o755 });
	const faultModule = join(root, "config-fault.mjs");
	await writeFile(faultModule, `
import fs from "node:fs/promises";
import { basename, dirname } from "node:path";
import { syncBuiltinESMExports } from "node:module";
const fault = process.env.PRETTY_TEST_CONFIG_FAULT;
const method = fault.endsWith("partial-write") ? "writeFile" : "rename";
const original = fs[method];
let seen = 0;
fs[method] = async (path, ...args) => {
  if (dirname(path) === process.env.PRETTY_CONFIG_DIR && basename(path).startsWith("pi-pretty.json")) {
    if (++seen === (fault.startsWith("recovery-") ? 2 : 1)) {
      if (method === "writeFile") await original(path, args[0].slice(0, 8), ...args.slice(1));
      throw Object.assign(new Error("Fixture " + fault), {code:method === "writeFile" ? "ENOSPC" : "EACCES"});
    }
  }
  return original(path, ...args);
};
syncBuiltinESMExports();
`);
	let failPretty = false;
	const runWithEnv = (env, ...args) => execFileSync(process.execPath, [...(env.PRETTY_TEST_CONFIG_FAULT ? ["--import", faultModule] : []), join(packageRoot, "scripts/install-pi.mjs"), "--local", ...args], {
		cwd, encoding: "utf8", stdio: "pipe", env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_TEST_PACKAGE_DIR: hostRoot,
			PATH: `${bin}:${process.env.PATH}`, PRETTY_TEST_FAIL: failPretty ? "1" : "0", PRETTY_CONFIG_DIR: agentDir, PRETTY_DISABLE_TOOLS: "", ...env },
	});
	const run = (...args) => runWithEnv({}, ...args);
	// When
	const preview = JSON.parse(run("--dry-run"));
	assert.deepEqual({ moves: preview.moves, blockers: preview.blockers, companions: preview.companionPackages }, { moves: [], blockers: [], companions: [source] });
	assert.equal(await exists(callsPath), false);
	assert.deepEqual(preview.prettyConfig, { path: join(agentDir, "pi-pretty.json"), disableTools: ["bash"], changed: true });
	assert.equal(await exists(join(agentDir, "pi-pretty.json")), false);
	const output = run();
	const receipt = JSON.parse(output.slice(output.lastIndexOf('{\n  "installed"')));
	// Then
	assert.deepEqual(JSON.parse(await readFile(callsPath, "utf8")), [["install", "--local", "--approve", packageRoot], ["install", "--local", "--approve", source]]);
	assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")).packages, [packageRoot, source]);
	assert.equal(receipt.verifiedSkills, 51);
	assert.deepEqual(receipt.companionPackages, [source]);
	assert.deepEqual(JSON.parse(await readFile(join(agentDir, "pi-pretty.json"), "utf8")), { disableTools: ["bash"] });
	const settingsBefore = await readFile(settingsPath, "utf8");
	const prettyPath = join(agentDir, "pi-pretty.json"), prettyBefore = await readFile(prettyPath, "utf8");
	run();
	assert.equal(await readFile(prettyPath, "utf8"), prettyBefore);
	assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")).packages, [packageRoot, source]);
	const callsBefore = await readFile(callsPath, "utf8");
	assert.throws(() => runWithEnv({ PRETTY_DISABLE_TOOLS: " read,grep " }), /PRETTY_DISABLE_TOOLS overrides.*No files were changed/);
	assert.equal(await readFile(callsPath, "utf8"), callsBefore);
	assert.equal(await readFile(settingsPath, "utf8"), settingsBefore);
	assert.equal(await readFile(prettyPath, "utf8"), prettyBefore);
	// A companion failure after modifying registration restores both targets.
	failPretty = true;
	assert.throws(() => run(), /Migration rolled back/);
	assert.equal(await readFile(settingsPath, "utf8"), settingsBefore);
	assert.equal(await readFile(prettyPath, "utf8"), prettyBefore);
	await rm(prettyPath);
	assert.throws(() => run(), /Migration rolled back/);
	assert.equal(await exists(prettyPath), false);
	const originalPretty = { theme: "github-dark", disableTools: ["ls"], workingIndicator: { enabled: false } };
	const originalPrettyText = `${JSON.stringify(originalPretty, null, 4)}\n`;
	await writeFile(prettyPath, originalPrettyText);
	const existingPreview = JSON.parse(run("--dry-run"));
	assert.deepEqual(existingPreview.prettyConfig, { path: prettyPath, disableTools: ["ls", "bash"], changed: true });
	assert.equal(await readFile(prettyPath, "utf8"), originalPrettyText);
	assert.throws(() => run(), /Migration rolled back/);
	assert.equal(await readFile(prettyPath, "utf8"), originalPrettyText);
	assert.throws(() => runWithEnv({ PRETTY_TEST_CONCURRENT: "1" }), /Migration rolled back/);
	assert.deepEqual(JSON.parse(await readFile(prettyPath, "utf8")), { ...originalPretty, theme: "concurrent", disableTools: ["ls", "grep"] });
	// Dotfile-managed configuration retains its lexical link through both a
	// successful install and rollback of a later failed registration.
	const dotfiles = join(root, "dotfiles"), managedPretty = join(dotfiles, "pi-pretty.json");
	await mkdir(dotfiles);
	await writeFile(managedPretty, originalPrettyText);
	await rm(prettyPath);
	await symlink("../dotfiles/pi-pretty.json", prettyPath);
	await writeFile(settingsPath, settingsBefore);
	failPretty = false;
	run();
	assert.equal(await readlink(prettyPath), "../dotfiles/pi-pretty.json");
	assert.deepEqual(JSON.parse(await readFile(managedPretty, "utf8")), { ...originalPretty, disableTools: ["ls", "bash"] });
	await writeFile(managedPretty, originalPrettyText);
	failPretty = true;
	assert.throws(() => runWithEnv({ PRETTY_TEST_CONCURRENT: "1" }), /Migration rolled back/);
	assert.equal(await readlink(prettyPath), "../dotfiles/pi-pretty.json");
	assert.deepEqual(JSON.parse(await readFile(managedPretty, "utf8")), { ...originalPretty, theme: "concurrent", disableTools: ["ls", "grep"] });
	assert.deepEqual(await readdir(dotfiles), ["pi-pretty.json"]);
	// Restore the ordinary fixture before the remaining registration cases.
	await rm(prettyPath);
	await writeFile(prettyPath, JSON.stringify({ ...originalPretty, theme: "concurrent", disableTools: ["ls", "grep"] }));
	assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { packages: [packageRoot, source, "npm:unrelated-concurrent"], theme: "concurrent" });
	// Exercise the actual installer transaction, including staging failures
	// before registration and failures while recovering after registration.
	for (const existing of [false, true]) {
		for (const failure of ["partial-write", "publication"]) {
			await writeFile(settingsPath, settingsBefore);
			if (existing) await writeFile(prettyPath, originalPrettyText);
			else await rm(prettyPath, { force: true });
			const callsBefore = await readFile(callsPath, "utf8");
			assert.throws(() => runWithEnv({ PRETTY_TEST_CONFIG_FAULT: `apply-${failure}` }), /Fixture apply-[\s\S]*Migration rolled back/);
			assert.equal(await readFile(settingsPath, "utf8"), settingsBefore);
			assert.equal(await readFile(callsPath, "utf8"), callsBefore);
			if (existing) assert.equal(await readFile(prettyPath, "utf8"), originalPrettyText);
			else assert.equal(await exists(prettyPath), false);
			assert.deepEqual((await readdir(agentDir)).filter((name) => name.startsWith("pi-pretty.json")), existing ? ["pi-pretty.json"] : []);
		}
	}
	for (const concurrent of [false, true]) {
		for (const failure of ["partial-write", "publication"]) {
			await writeFile(settingsPath, settingsBefore);
			await writeFile(prettyPath, originalPrettyText);
			assert.throws(() => runWithEnv({ PRETTY_TEST_CONFIG_FAULT: `recovery-${failure}`, PRETTY_TEST_CONCURRENT: concurrent ? "1" : "0" }), /Rollback needs attention: Fixture recovery-/);
			assert.deepEqual(JSON.parse(await readFile(prettyPath, "utf8")), {
				...originalPretty, ...(concurrent ? { theme: "concurrent" } : {}), disableTools: ["ls", "bash", ...(concurrent ? ["grep"] : [])],
			});
			if (concurrent) assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { packages: [packageRoot, source, "npm:unrelated-concurrent"], theme: "concurrent" });
			else assert.equal(await readFile(settingsPath, "utf8"), settingsBefore);
			assert.deepEqual((await readdir(agentDir)).filter((name) => name.startsWith("pi-pretty.json")), ["pi-pretty.json"]);
		}
	}
	const neighbor = { source: "npm:neighbor@1", extensions: ["original"], skills: [] };
	const oldPretty = { source: "npm:@heyhuynhgiabuu/pi-pretty@0.6.29", extensions: [] };
	await writeFile(settingsPath, JSON.stringify({ packages: [packageRoot, "npm:anchor", neighbor, oldPretty, "npm:next"], theme: "original" }));
	await writeFile(prettyPath, originalPrettyText);
	assert.throws(() => runWithEnv({ PRETTY_TEST_CONCURRENT: "1" }), /Migration rolled back/);
	assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
		packages: [packageRoot, "npm:anchor", { ...neighbor, source: "npm:neighbor@2", extensions: ["concurrent"] }, oldPretty, "npm:next", "npm:unrelated-concurrent"], theme: "concurrent",
	});
	assert.deepEqual(JSON.parse(await readFile(prettyPath, "utf8")), { ...originalPretty, theme: "concurrent", disableTools: ["ls", "grep"] });
});
