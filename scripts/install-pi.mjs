import { assertConfigurationTargets, planNativeConfig } from "./subagents-config.mjs";
import { assertReleaseAgeSupport, readReleasePolicy, releaseAgeEnvironment, requireNativeValidation } from "./subagents-validation.mjs";
import { execFileSync } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findHostRoot, importPi } from "./pi-host.mjs";
import { restoreRegistration } from "./package-registration.mjs";
import { planPrettyConfig } from "./pretty-config.mjs";
import { inventorySkills } from "./skill-inventory.mjs";
import { applyMigration, exists, planMigration, restoreBackup } from "./skill-migration.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const HELP = "Usage: pnpm run install:pi [--local] [--cwd <project>] [--without-pretty] [--dry-run] [--subagents-validation <receipt>]\n       pnpm run install:pi --restore <backup-directory> [--dry-run]";

async function main() {
	const options = parseOptions(process.argv.slice(2));
	if (options.help) return console.log(HELP);
	if (options.restore) {
		const restored = await restoreBackup(options.restore, options);
		return console.log(JSON.stringify({ action: options.dryRun ? "restore-preview" : "restored", paths: restored }, null, 2));
	}
	const prettyConfig = options.withoutPretty ? undefined : await planPrettyConfig();
	const pi = await importPi();
	const cwd = resolve(options.cwd ?? process.cwd());
	const agentDir = pi.getAgentDir();
	const { piPretty, piClaudeBridge, piSubagents } = JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8")).config;
	const companionPackages = [...(options.withoutPretty ? [] : [piPretty]), piClaudeBridge, piSubagents];
	const catalog = JSON.parse(await readFile(join(PACKAGE_ROOT, "docs/skills-provenance.json"), "utf8")).skills;
	const settingsPath = join(options.local ? join(cwd, ".pi") : agentDir, "settings.json");
	const nativeConfig = await planNativeConfig(settingsPath, agentDir, PACKAGE_ROOT, options.local ? join(cwd, ".pi") : agentDir);
	const previousSettings = await exists(settingsPath) ? await readFile(settingsPath, "utf8") : undefined;
	const discover = async (path) => {
		const result = (await stat(path)).isDirectory()
			? pi.loadSkillsFromDir({ dir: path, source: "path" })
			: pi.loadSkills({ cwd, agentDir, skillPaths: [path], includeDefaults: false });
		if (result.diagnostics.some(({ type }) => type === "error")) throw new Error(`Cannot inspect skills at ${path}`);
		return result.skills;
	};
	const inventory = () => inventorySkills(pi, { cwd, agentDir });
	const { migrationSkills, protectedRoots } = await inventory();
	const plan = await planMigration({ resources: migrationSkills, protectedRoots, agentDir, catalog, packageRoot: PACKAGE_ROOT, discover });
	console.log(JSON.stringify({ scope: options.local ? "project" : "user", cwd, settingsPath, skills: catalog.length, companionPackages, prettyConfig: prettyConfig?.preview, nativeConfig: nativeConfig.preview, activation: "Requires a passing Pi 1.2.0 / pi-subagents 0.78.0 validation receipt and the committed release-age policy", ...plan }, null, 2));
	if (plan.blockers.length) throw new Error("Resolve the listed configuration conflicts before installing. No skills were moved.");
	if (options.dryRun) return;
	await requireNativeValidation(options.validation, PACKAGE_ROOT, await findHostRoot());
	const releasePolicy = await readReleasePolicy(PACKAGE_ROOT);
	const settingsManager = pi.SettingsManager.create(cwd, agentDir, { projectTrusted: options.local || undefined });
	assertReleaseAgeSupport(settingsManager.getNpmCommand(), { cwd });
	const result = await applyMigration({
		configuration: { settingsPath, previousSettings, packageRoot: PACKAGE_ROOT, companionPackages, native: nativeConfig.receipts, prettyReceipt: () => prettyConfig?.receipt },
		plan, agentDir,
		register: async () => {
			await nativeConfig.apply();
			await prettyConfig?.apply();
			// Pi forwards this environment to its package manager. Keep the cooldown
			// on the entire newly resolved graph, including companion transitive ranges.
			for (const source of [PACKAGE_ROOT, ...companionPackages]) {
				execFileSync("pi", ["install", ...(options.local ? ["--local", "--approve"] : []), source], { cwd, stdio: "inherit", env: releaseAgeEnvironment(source, releasePolicy) });
			}
		},
		rollbackRegistration: async () => {
			await assertConfigurationTargets(nativeConfig.receipts);
			const results = await Promise.allSettled([
				restoreRegistration(settingsPath, previousSettings, PACKAGE_ROOT, companionPackages),
				prettyConfig?.rollback(),
			]);
			try { await nativeConfig.rollback(); } catch (reason) { results.push({ status: "rejected", reason }); }
			const failures = results.filter((result) => result.status === "rejected");
			if (failures.length) throw new Error(failures.map((result) => result.reason.message).join("; "));
		},
		verify: async () => {
			const { skills: resources } = await inventory();
			const result = pi.loadSkills({ cwd, agentDir, skillPaths: resources.filter(({ enabled }) => enabled).map(({ path }) => path), includeDefaults: false });
			const failures = [];
			for (const { name } of catalog) {
				const skill = result.skills.find((skill) => skill.name === name);
				const expected = await realpath(join(PACKAGE_ROOT, "skills", name, "SKILL.md"));
				if (!skill || await realpath(skill.filePath) !== expected) failures.push(`${name}: package adaptation is not the effective skill`);
			}
			for (const diagnostic of result.diagnostics) {
				if (diagnostic.collision && catalog.some(({ name }) => name === diagnostic.collision.name)) failures.push(diagnostic.message);
			}
			if (failures.length) throw new Error(failures.join("\n"));
		},
	});
	console.log(JSON.stringify({ installed: PACKAGE_ROOT, companionPackages, verifiedSkills: catalog.length, backup: result.backup ?? null, next: "Restart Pi or run /reload." }, null, 2));
}

function parseOptions(args) {
	const options = {};
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--local") options.local = true;
		else if (argument === "--dry-run") options.dryRun = true;
		else if (argument === "--without-pretty") options.withoutPretty = true;
		else if (argument === "--help") options.help = true;
		else if (argument === "--cwd" || argument === "--restore" || argument === "--subagents-validation") {
			const value = args[++index];
			if (!value || value.startsWith("--")) throw new Error(`${argument} requires a path.`);
			options[argument === "--subagents-validation" ? "validation" : argument.slice(2)] = value;
		} else throw new Error(`Unknown option: ${argument}\n${HELP}`);
	}
	if (options.restore && (options.local || options.cwd || options.withoutPretty || options.validation)) throw new Error("Use --restore separately from installation options.");
	return options;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
