import { execFileSync } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importPi } from "./pi-host.mjs";
import { restoreRegistration } from "./package-registration.mjs";
import { planPrettyConfig } from "./pretty-config.mjs";
import { inventorySkills } from "./skill-inventory.mjs";
import { applyMigration, exists, planMigration, restoreBackup } from "./skill-migration.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const HELP = "Usage: npm run install:pi -- [--local] [--cwd <project>] [--without-pretty] [--dry-run]\n       npm run install:pi -- --restore <backup-directory> [--dry-run]";

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
	const prettySource = JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8")).config.piPretty;
	const companionPackages = options.withoutPretty ? [] : [prettySource];
	const catalog = JSON.parse(await readFile(join(PACKAGE_ROOT, "docs/skills-provenance.json"), "utf8")).skills;
	const settingsPath = join(options.local ? join(cwd, ".pi") : agentDir, "settings.json");
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
	console.log(JSON.stringify({ scope: options.local ? "project" : "user", cwd, settingsPath, skills: catalog.length, companionPackages, prettyConfig: prettyConfig?.preview, ...plan }, null, 2));
	if (plan.blockers.length) throw new Error("Resolve the listed configuration conflicts before installing. No skills were moved.");
	if (options.dryRun) return;
	const result = await applyMigration({
		plan, agentDir,
		register: async () => {
			await prettyConfig?.apply();
			for (const source of [PACKAGE_ROOT, ...companionPackages]) {
				execFileSync("pi", ["install", ...(options.local ? ["--local", "--approve"] : []), source], { cwd, stdio: "inherit" });
			}
		},
		rollbackRegistration: async () => {
			const results = await Promise.allSettled([
				restoreRegistration(settingsPath, previousSettings, PACKAGE_ROOT, companionPackages),
				prettyConfig?.rollback(),
			]);
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
		else if (argument === "--cwd" || argument === "--restore") {
			const value = args[++index];
			if (!value || value.startsWith("--")) throw new Error(`${argument} requires a path.`);
			options[argument.slice(2)] = value;
		} else throw new Error(`Unknown option: ${argument}\n${HELP}`);
	}
	if (options.restore && (options.local || options.cwd || options.withoutPretty)) throw new Error("Use --restore separately from installation options.");
	return options;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
