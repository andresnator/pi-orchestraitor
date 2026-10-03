import { readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { findHostRoot } from "./pi-host.mjs";

/** Restore only this package's registrations, preserving unrelated settings edits. */
export async function restoreRegistration(settingsPath, beforeText, packageRoot) {
	let currentText;
	try {
		currentText = await readFile(settingsPath, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw error;
	}
	if (currentText === beforeText) return;
	const before = JSON.parse(beforeText ?? "{}");
	const current = JSON.parse(currentText);
	const { isLocalPath, resolvePath } = await import(pathToFileURL(join(await findHostRoot(), "dist/utils/paths.js")).href);
	const pathOptions = { homeDir: process.env.HOME || homedir(), trim: true };
	const root = resolvePath(packageRoot, process.cwd(), pathOptions);
	const belongsToPackage = (entry) => {
		const source = typeof entry === "string" ? entry : entry?.source;
		return typeof source === "string" && isLocalPath(source)
			&& resolvePath(source, dirname(settingsPath), pathOptions) === root;
	};
	const originals = (before.packages ?? []).flatMap((entry, index) => belongsToPackage(entry) ? [{ entry, index }] : []);
	let restored = 0;
	current.packages = (current.packages ?? []).flatMap((entry) => {
		if (!belongsToPackage(entry)) return [entry];
		return restored < originals.length ? [originals[restored++].entry] : [];
	});
	// Native installation normally replaces a registration in place. If a target
	// entry disappeared, recover its original position without dropping other entries.
	for (const { entry, index } of originals.slice(restored)) {
		current.packages.splice(Math.min(index, current.packages.length), 0, entry);
	}
	if (!current.packages.length && !Object.hasOwn(before, "packages")) delete current.packages;
	if (JSON.stringify(current) === JSON.stringify(before)) {
		if (beforeText === undefined) await rm(settingsPath);
		else await writeFile(settingsPath, beforeText);
	} else {
		await writeFile(settingsPath, `${JSON.stringify(current, null, 2)}\n`);
	}
}
