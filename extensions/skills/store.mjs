import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const REGISTRY_MARKER = "<!-- pi-orchestraitor:skill-registry:v1 -->";
const MAX_REGISTRY_BYTES = 4 * 1024 * 1024;
const queues = new Map();
const cell = (value = "-") => String(value).replaceAll("|", "\\|").replace(/[\r\n]/g, " ").replaceAll("`", "\\`");

export async function registryPath(cwd) {
	const original = await realpath(cwd);
	let directory = original;
	while (true) {
		try { await lstat(join(directory, ".git")); return join(directory, ".ai", "skills", "registry.md"); }
		catch (error) { if (error.code !== "ENOENT") throw error; }
		const parent = dirname(directory);
		if (parent === directory) return join(original, ".ai", "skills", "registry.md");
		directory = parent;
	}
}

/** Publication is a diagnostic projection, never an availability authority. */
export async function publishRegistry(snapshot, { signal, mutate = (_path, fn) => fn() } = {}) {
	let path;
	try {
		path = await registryPath(snapshot.cwd);
		if (!snapshot.trusted) return { path, persisted: false, changed: false, error: "Project trust is required to persist the registry" };
		return await queued(path, () => mutate(path, () => publish(path, snapshot, signal)));
	} catch (error) {
		signal?.throwIfAborted();
		return { path, persisted: false, changed: false, error: error.message };
	}
}

export function renderRegistry(snapshot) {
	const rows = [...snapshot.entries].sort((a, b) => a.name.localeCompare(b.name)).map((entry) =>
		`| ${[entry.name, entry.description, entry.source, entry.origin, entry.scope, entry.status, entry.filePath, entry.fingerprint || "-", entry.diagnostic || "-"].map(cell).join(" | ")} |`);
	return `${REGISTRY_MARKER}\n# Skill Registry\n\nAuto-generated native Pi catalog. Do not edit. Bodies are loaded only on demand.\nNew sources and names require native configuration and /reload. This file does not enable skills.\n\nContext: \`${snapshot.context}\`\nCatalog: ${snapshot.pending ? "pending the first request or explicit refresh" : "resolved"}\n\n| Skill | Description | Source | Origin | Scope | Status | Location | Fingerprint | Diagnostic |\n|---|---|---|---|---|---|---|---|---|\n${rows.join("\n")}\n`;
}

async function publish(path, snapshot, signal) {
	signal?.throwIfAborted();
	for (const directory of [dirname(dirname(path)), dirname(path)]) {
		await mkdir(directory, { mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
		const info = await lstat(directory);
		if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Registry directories must not be symbolic links or files");
	}
	const text = renderRegistry(snapshot);
	if (Buffer.byteLength(text) > MAX_REGISTRY_BYTES) throw new Error("Registry exceeds the publication byte limit");
	try {
		const info = await lstat(path);
		if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_REGISTRY_BYTES) throw new Error("Unsafe existing registry file");
		const previous = await readFile(path, "utf8");
		if (previous === text) return { path, persisted: true, changed: false };
		if (!previous.startsWith(REGISTRY_MARKER)) throw new Error("Existing registry is not owned by pi-orchestraitor; it was preserved");
		if (snapshot.pending) return { path, persisted: true, changed: false };
	} catch (error) { if (error.code !== "ENOENT") throw error; }
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, text, { flag: "wx", mode: 0o600 });
		signal?.throwIfAborted();
		await rename(temporary, path);
	} finally { await rm(temporary, { force: true }); }
	return { path, persisted: true, changed: true };
}

async function queued(path, operation) {
	const previous = queues.get(path) ?? Promise.resolve();
	const current = previous.catch(() => {}).then(operation);
	queues.set(path, current);
	try { return await current; }
	finally { if (queues.get(path) === current) queues.delete(path); }
}
