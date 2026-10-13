import { execFileSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HOST_NAME = "@earendil-works/pi-coding-agent";
const SHIM_DIRECTORY = ".bin";

export async function findHostRoot() {
	if (process.env.PI_TEST_PACKAGE_DIR) return resolve(process.env.PI_TEST_PACKAGE_DIR);
	const executable = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
	const selected = await realpath(executable);
	let directory = dirname(selected);
	const launcher = await readFile(selected, "utf8");
	// Resolve only the managed launcher selected on PATH, never a stale global SDK.
	if (launcher.includes("PI_MANAGED_INSTALL_ROOT=$pi_agent_dir/install") && launcher.includes("install/current-version")) {
		const installRoot = join(dirname(directory), "install");
		const version = (await readFile(join(installRoot, "current-version"), "utf8")).trim();
		if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(version) || [".", ".."].includes(version)) throw new Error("Invalid managed Pi version.");
		const host = join(installRoot, "releases", version, "node_modules", HOST_NAME);
		if (!await isHostPackage(host)) throw new Error(`Managed Pi SDK is missing: ${host}`);
		const manifest = JSON.parse(await readFile(join(host, "package.json"), "utf8"));
		if (manifest.version !== version) throw new Error(`Managed Pi SDK version mismatch: ${manifest.version} != ${version}`);
		return realpath(host);
	}
	// pnpm's selected executable is a shim beside the linked package, not a symlink into it.
	if (basename(directory) === SHIM_DIRECTORY) {
		const linkedHost = resolve(directory, "..", HOST_NAME);
		if (await isHostPackage(linkedHost)) return realpath(linkedHost);
	}
	while (true) {
		if (await isHostPackage(directory)) return directory;
		const parent = dirname(directory);
		if (parent === directory) throw new Error("Cannot locate the installed Pi package; set PI_TEST_PACKAGE_DIR.");
		directory = parent;
	}
}

async function isHostPackage(directory) {
	try {
		const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
		return manifest.name === HOST_NAME;
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		return false;
	}
}

export async function importPi() {
	return import(pathToFileURL(join(await findHostRoot(), "dist/index.js")).href);
}
