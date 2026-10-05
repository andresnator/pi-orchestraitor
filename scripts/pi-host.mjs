import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HOST_NAME = "@earendil-works/pi-coding-agent";

export async function findHostRoot() {
	if (process.env.PI_TEST_PACKAGE_DIR) return resolve(process.env.PI_TEST_PACKAGE_DIR);
	const executable = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
	let directory = dirname(await realpath(executable));
	while (true) {
		try {
			const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
			if (manifest.name === HOST_NAME) return directory;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		const parent = dirname(directory);
		if (parent === directory) throw new Error("Cannot locate the installed Pi package; set PI_TEST_PACKAGE_DIR.");
		directory = parent;
	}
}

export async function importTui() {
	const requireHost = createRequire(join(await findHostRoot(), "package.json"));
	const ui = await import(pathToFileURL(requireHost.resolve("@earendil-works/pi-tui")).href);
	for (const name of ["TuiAltScreen", "ProcessTerminal", "ScrollView", "VStack", "Box", "Text", "parseColor", "styleText", "visibleWidth", "truncateToWidth", "wrapTextWithAnsi", "matchesKey"]) {
		if (typeof ui[name] !== "function") throw new Error(`Installed Pi TUI lacks ${name}; use a compatible Pi host. No dependency was installed.`);
	}
	return ui;
}

export async function importPi() {
	return import(pathToFileURL(join(await findHostRoot(), "dist/index.js")).href);
}
