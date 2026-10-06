import { createHash } from "node:crypto";
import { lstat, opendir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export const MAX_SKILLS = 1000;
export const MAX_RESOURCE_FILES = 1000;
export const MAX_RESOURCE_ENTRIES = 2000;
export const MAX_RESOURCE_DEPTH = 32;
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_SKILL_BYTES = 40 * 1024;
export const MAX_RESOURCE_BYTES = 8 * MAX_FILE_BYTES;
const RESOURCE_DIRS = new Set(["assets", "references", "scripts", "techniques"]);
const IGNORED_DIRS = new Set(["node_modules"]);
const hash = (value) => createHash("sha256").update(value).digest("hex");

/** Inspect only native-authorized paths. Disk discovery never grants eligibility. */
export async function inspectCatalog(sdk, catalog, { cwd, trusted, signal, canonicalPaths }) {
	if (catalog.length > MAX_SKILLS) throw new Error(`Native skill catalog exceeds ${MAX_SKILLS} entries`);
	signal?.throwIfAborted();
	const names = new Map();
	for (const skill of catalog) names.set(skill.name, (names.get(skill.name) ?? 0) + 1);
	const entries = [];
	for (const skill of catalog) {
		signal?.throwIfAborted();
		const entry = {
			name: skill.name, description: skill.description, filePath: skill.filePath,
			source: classifySource(skill.filePath), scope: skill.sourceInfo?.scope ?? "temporary",
			origin: skill.sourceInfo?.source ?? "native", status: "unavailable", fingerprint: "",
		};
		try {
			if (names.get(skill.name) !== 1) throw new Error("Native skill name is ambiguous");
			if (!trusted && entry.scope === "project") throw new Error("Project skill requires native project trust");
			const filePath = await realpath(skill.filePath);
			const expected = canonicalPaths?.get(skill.filePath);
			if (expected && expected !== filePath) throw new Error("Native skill canonical target changed; run /reload");
			canonicalPaths?.set(skill.filePath, filePath);
			const baseDir = dirname(filePath);
			const body = await boundedRead(filePath);
			if (body.length > MAX_SKILL_BYTES) throw new Error(`Skill instructions exceed ${MAX_SKILL_BYTES} bytes`);
			// Native fallback names come from the authorized lexical path (which
			// may be an alias); canonical paths still bound reads and resources.
			const parsed = sdk.loadSkills({ cwd, skillPaths: [skill.filePath], includeDefaults: false });
			if (await realpath(skill.filePath) !== filePath) throw new Error("Native skill canonical target changed; run /reload");
			const current = parsed.skills[0];
			if (!current || current.name !== skill.name) throw new Error("Skill metadata changed or is invalid; run /reload");
			if (!body.equals(await boundedRead(filePath))) throw new Error("Skill changed during inspection; retry");
			const fingerprint = await resourceFingerprint(filePath, baseDir, body, signal);
			const manual = skill.disableModelInvocation || current.disableModelInvocation;
			Object.assign(entry, {
				filePath, description: current.description, fingerprint,
				status: manual ? "manual-only" : "available",
				skill: { ...skill, filePath, baseDir, description: current.description, disableModelInvocation: Boolean(manual) },
				body: body.toString("utf8"),
			});
		} catch (error) {
			signal?.throwIfAborted();
			entry.diagnostic = error.message;
		}
		entries.push(entry);
	}
	const context = hash(JSON.stringify({ cwd: resolve(cwd), trusted, catalog: catalog.map(({ name, filePath, description, disableModelInvocation, sourceInfo }) => ({ name, filePath, description, disableModelInvocation, sourceInfo })) }));
	return { version: 1, cwd: resolve(cwd), trusted, context, entries };
}

export function classifySource(filePath) {
	const path = filePath.replaceAll("\\", "/");
	if (/(?:^|\/)\.agents\/skills\//.test(path)) return "agents";
	if (/(?:^|\/)\.claude\/skills\//.test(path)) return "claude";
	if (/(?:^|\/)opencode\/skills\//.test(path) || /(?:^|\/)\.opencode\/skills\//.test(path)) return "opencode";
	return "pi";
}

async function boundedRead(filePath) {
	const info = await lstat(filePath);
	if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error(`Skill resource must be a regular file of at most ${MAX_FILE_BYTES} bytes`);
	const bytes = await readFile(filePath);
	if (bytes.length > MAX_FILE_BYTES) throw new Error("Skill resource grew beyond the byte limit");
	return bytes;
}

async function resourceFingerprint(filePath, baseDir, body, signal) {
	const digest = createHash("sha256");
	let files = 1;
	let entries = 0;
	let bytes = body.length;
	digest.update(basename(filePath)).update("\0").update(hash(body)).update("\0");
	async function walk(directory, relative = "", depth = 0) {
		if (depth > MAX_RESOURCE_DEPTH) throw new Error(`Skill exceeds ${MAX_RESOURCE_DEPTH} resource directory depth`);
		signal?.throwIfAborted();
		const children = [];
		for await (const child of await opendir(directory)) {
			signal?.throwIfAborted();
			if (++entries > MAX_RESOURCE_ENTRIES) throw new Error(`Skill exceeds ${MAX_RESOURCE_ENTRIES} resource entries`);
			children.push(child);
		}
		children.sort((a, b) => a.name.localeCompare(b.name));
		for (const child of children) {
			signal?.throwIfAborted();
			if (child.name.startsWith(".") || IGNORED_DIRS.has(child.name)) continue;
			const path = join(directory, child.name);
			const key = relative ? `${relative}/${child.name}` : child.name;
			if (path === filePath) continue;
			if (!relative && basename(filePath) !== "SKILL.md" && !RESOURCE_DIRS.has(child.name)) continue;
			if (child.isSymbolicLink()) throw new Error(`Symbolic resource links are not fingerprinted: ${key}`);
			if (child.isDirectory()) { await walk(path, key, depth + 1); continue; }
			if (!child.isFile()) throw new Error(`Unsupported skill resource: ${key}`);
			if (++files > MAX_RESOURCE_FILES) throw new Error(`Skill exceeds ${MAX_RESOURCE_FILES} resource files`);
			const content = await boundedRead(path);
			bytes += content.length;
			if (bytes > MAX_RESOURCE_BYTES) throw new Error(`Skill exceeds ${MAX_RESOURCE_BYTES} resource bytes`);
			digest.update(key).update("\0").update(hash(content)).update("\0");
		}
	}
	await walk(baseDir);
	return digest.digest("hex");
}
