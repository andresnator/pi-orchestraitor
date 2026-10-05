import { readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { findHostRoot } from "./pi-host.mjs";

/** Restore selected registrations, preserving unrelated settings edits. */
export async function restoreRegistration(settingsPath, beforeText, packageRoot, npmSources = []) {
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
	const npmIdentity = (source) => {
		if (typeof source !== "string" || !source.startsWith("npm:")) return;
		const spec = source.slice("npm:".length).trim();
		return /^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/.exec(spec)?.[1] ?? spec;
	};
	const npmNames = new Set(npmSources.map(npmIdentity).filter(Boolean));
	const registrationIdentity = (entry) => {
		const source = typeof entry === "string" ? entry : entry?.source;
		if (typeof source !== "string") return;
		const name = npmIdentity(source);
		if (npmNames.has(name)) return `npm:${name}`;
		if (isLocalPath(source) && resolvePath(source, dirname(settingsPath), pathOptions) === root) return root;
	};
	const originals = (before.packages ?? []).flatMap((entry, index) => {
		const identity = registrationIdentity(entry);
		return identity ? [{ entry, index }] : [];
	});
	current.packages = (current.packages ?? []).filter((entry) => !registrationIdentity(entry));
	// Recover original ordering around surviving declarations, while leaving
	// concurrent unrelated additions and edits in their existing relative order.
	const matches = (left, right) => JSON.stringify(left) === JSON.stringify(right);
	const unchangedPackages = matches(current.packages, (before.packages ?? []).filter((entry) => !registrationIdentity(entry)));
	if (unchangedPackages) current.packages = before.packages ?? [];
	for (const { entry, index } of unchangedPackages ? [] : originals) {
		const previous = (before.packages ?? []).slice(0, index).reverse()
			.map((anchor) => current.packages.findLastIndex((item) => matches(item, anchor)))
			.find((position) => position >= 0);
		const next = (before.packages ?? []).slice(index + 1)
			.map((anchor) => current.packages.findIndex((item) => matches(item, anchor)))
			.find((position) => position >= 0);
		const position = previous !== undefined ? previous + 1 : next ?? Math.min(index, current.packages.length);
		current.packages.splice(position, 0, entry);
	}
	if (!current.packages.length && !Object.hasOwn(before, "packages")) delete current.packages;
	if (JSON.stringify(current) === JSON.stringify(before)) {
		if (beforeText === undefined) await rm(settingsPath);
		else await writeFile(settingsPath, beforeText);
	} else {
		await writeFile(settingsPath, `${JSON.stringify(current, null, 2)}\n`);
	}
}
