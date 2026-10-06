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
		if (typeof source !== "string") return;
		source = source.trim();
		if (!source.startsWith("npm:")) return;
		const spec = source.slice("npm:".length).trim();
		return /^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/.exec(spec)?.[1] ?? spec;
	};
	const npmNames = new Set(npmSources.map(npmIdentity).filter(Boolean));
	const packageIdentity = (entry) => {
		const source = typeof entry === "string" ? entry : entry?.source;
		if (typeof source !== "string") return `value:${JSON.stringify(entry)}`;
		const name = npmIdentity(source);
		if (name !== undefined) return `npm:${name}`;
		if (isLocalPath(source)) return `local:${resolvePath(source, dirname(settingsPath), pathOptions)}`;
		return `source:${source.trim()}`;
	};
	const selected = new Set([`local:${root}`, ...[...npmNames].map((name) => `npm:${name}`)]);
	const originals = (before.packages ?? []).map((entry, index) => ({ entry, index, identity: packageIdentity(entry) }));
	const live = (current.packages ?? []).map((entry, position) => ({ entry, position, identity: packageIdentity(entry) }));
	const matches = (left, right) => JSON.stringify(left) === JSON.stringify(right);
	// Reserve exact occurrences first so a newly inserted duplicate cannot take
	// the place of a surviving declaration. Pair edited occurrences by identity
	// in encounter order; each live occurrence can anchor only one original.
	for (const exact of [true, false]) {
		for (const original of originals) {
			if (original.live) continue;
			const node = live.find((item) => !item.original && item.identity === original.identity
				&& (!exact || matches(item.entry, original.entry)));
			if (node) { original.live = node; node.original = original; }
		}
	}
	// Keep selected occurrences already in a valid slot. This preserves the
	// placement of concurrent insertions immediately adjacent to them.
	let lastKept = -1;
	for (const original of originals.filter((item) => selected.has(item.identity))) {
		const previous = originals.slice(0, original.index).findLast((item) => !selected.has(item.identity) && item.live)?.live;
		const next = originals.slice(original.index + 1).find((item) => !selected.has(item.identity) && item.live)?.live;
		const node = original.live;
		if (node && node.position > lastKept && (!previous || node.position > previous.position) && (!next || node.position < next.position)) {
			node.entry = original.entry;
			node.keep = true;
			lastKept = node.position;
		} else original.live = undefined;
	}
	const restored = live.filter((node) => !selected.has(node.identity) || node.keep);
	for (const original of originals.filter((item) => selected.has(item.identity) && !item.live)) {
		const previous = originals.slice(0, original.index).findLast((item) => item.live)?.live;
		const next = originals.slice(original.index + 1).find((item) => item.live)?.live;
		// If anchors were reordered concurrently, prefer the preceding one.
		// Without either anchor, use the original index bounded by list length.
		const position = previous ? restored.indexOf(previous) + 1 : next ? restored.indexOf(next) : Math.min(original.index, restored.length);
		const node = { entry: original.entry };
		original.live = node;
		restored.splice(position, 0, node);
	}
	current.packages = restored.map((node) => node.entry);
	if (!current.packages.length && !Object.hasOwn(before, "packages")) delete current.packages;
	if (JSON.stringify(current) === JSON.stringify(before)) {
		if (beforeText === undefined) await rm(settingsPath);
		else await writeFile(settingsPath, beforeText);
	} else {
		await writeFile(settingsPath, `${JSON.stringify(current, null, 2)}\n`);
	}
}
