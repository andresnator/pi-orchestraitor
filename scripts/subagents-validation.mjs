import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findHostRoot } from "./pi-host.mjs";

export const SUBAGENTS_VERSION = "0.78.0";
export const PI_VERSION = "1.2.0";

export async function integrationFingerprint(root) {
	const files = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "scripts/subagents-config.mjs", "scripts/subagents-validation.mjs", "scripts/validate-subagents.mjs", "scripts/install-pi.mjs",
		"scripts/pi-host.mjs", "scripts/pretty-config.mjs", "scripts/skill-migration.mjs", "tests/integration/native-subagents.test.mjs", "tests/integration/claude-bridge.test.mjs",
		...(await readdir(join(root, "agents"))).map(name => `agents/${name}`), "extensions/nan.ts", "extensions/status-ui.ts", "extensions/compact-tools.ts",
		"extensions/skill-registry.ts", ...(await readdir(join(root, "extensions/skills"))).map(name => `extensions/skills/${name}`)];
	const hash = createHash("sha256");
	for (const file of files.sort()) { hash.update(file); hash.update(await readFile(join(root, file))); }
	return hash.digest("hex");
}

export async function readReleasePolicy(root = fileURLToPath(new URL("../", import.meta.url))) {
	const require = createRequire(join(await findHostRoot(), "package.json"));
	const policy = require("yaml").parse(await readFile(join(root, "pnpm-workspace.yaml"), "utf8"));
	if (!Number.isSafeInteger(policy.minimumReleaseAge) || policy.minimumReleaseAge < 0
		|| !Array.isArray(policy.minimumReleaseAgeExclude ?? [])
		|| (policy.minimumReleaseAgeExclude ?? []).some(entry => typeof entry !== "string" || !/^(@[a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9._-]+)@\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/.test(entry))) {
		throw new Error("Release policy requires an age in minutes and exact version-qualified exceptions");
	}
	return { minutes: policy.minimumReleaseAge, exceptions: policy.minimumReleaseAgeExclude ?? [] };
}

export async function assertReleaseAge(name, version, now = Date.now(), policy) {
	policy ??= await readReleasePolicy();
	if (policy.exceptions.includes(`${name}@${version}`)) return;
	const times = JSON.parse(execFileSync("npm", ["view", name, "time", "--json"], { encoding: "utf8", timeout: 30000 }));
	const published = Date.parse(times[version]);
	if (!Number.isFinite(published)) throw new Error(`Cannot establish publication time for ${name}@${version}`);
	const eligible = published + policy.minutes * 60_000;
	if (now < eligible) throw new Error(`${name}@${version} has not completed the 24-hour dependency cooldown; eligible at ${new Date(eligible).toISOString()}`);
}

export function releaseAgeEnvironment(source, policy, environment = process.env) {
	const spec = source.startsWith("npm:") ? source.slice(4).trim() : undefined;
	// npm's exclusion matcher accepts names only. Exempt a name only during the
	// install command for its explicitly authorized, exactly pinned source.
	const npmException = spec && policy.exceptions.includes(spec) ? spec.slice(0, spec.lastIndexOf("@")) : "";
	return { ...environment,
		npm_config_before: new Date(Date.now() - policy.minutes * 60_000).toISOString(),
		npm_config_min_release_age: String(policy.minutes / 1440),
		npm_config_min_release_age_exclude: npmException,
		PNPM_CONFIG_MINIMUM_RELEASE_AGE: String(policy.minutes),
		PNPM_CONFIG_MINIMUM_RELEASE_AGE_EXCLUDE: JSON.stringify(policy.exceptions),
		PNPM_CONFIG_IGNORE_SCRIPTS: "true",
		npm_config_ignore_scripts: "true",
	};
}

/** Check Pi's effective command before migration or configuration writes. */
export function assertReleaseAgeSupport(configuredCommand, { cwd, env = process.env } = {}) {
	const [command, ...args] = configuredCommand?.length ? configuredCommand : ["npm"];
	const normalize = value => basename(value).replace(/\.(cmd|exe)$/i, "");
	const direct = normalize(command), separator = args.lastIndexOf("--");
	const managers = [...new Set(args.map(normalize).filter(value => ["npm", "pnpm", "bun"].includes(value)))];
	const manager = separator >= 0 ? normalize(args[separator + 1] ?? command)
		: ["npm", "pnpm", "bun"].includes(direct) ? direct : managers.length === 1 ? managers[0] : direct;
	const help = 'Release-age exceptions require npm >=11.19.0 or pnpm 12.9.1. Configure Pi npmCommand with a supported command; no configuration or skills were changed.';
	if (!["npm", "pnpm"].includes(manager)) throw new Error(help);
	const version = execFileSync(command, [...args, "--version"], { cwd, env, encoding: "utf8", timeout: 30000 }).trim();
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	const supported = match && (manager === "pnpm" ? version === "12.9.1"
		: Number(match[1]) > 11 || (Number(match[1]) === 11 && Number(match[2]) >= 19));
	if (!supported) throw new Error(`${manager} ${version}: ${help}`);
	return { manager, version };
}

export async function requireNativeValidation(path, root, hostRoot) {
	if (!path) throw new Error("Activation requires --subagents-validation <receipt> from pnpm run test:subagents on Pi 1.2.0. No daily configuration was changed.");
	const host = JSON.parse(await readFile(join(hostRoot, "package.json"), "utf8"));
	const receipt = JSON.parse(await readFile(path, "utf8"));
	if (host.version !== PI_VERSION || receipt.pi !== PI_VERSION || receipt.plugin !== SUBAGENTS_VERSION || receipt.status !== "passed"
		|| receipt.fingerprint !== await integrationFingerprint(root)) throw new Error("Native subagents validation is missing, failed, stale, or uses the wrong host/plugin. Rerun test:subagents before activation.");
	await assertReleaseAge("pi-subagents", SUBAGENTS_VERSION, Date.now(), await readReleasePolicy(root));
	return receipt;
}
