import { realpathSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import nativePaths from "node:path";
import { fileURLToPath } from "node:url";

export const TASK_TIMEOUT_MS = 10 * 60 * 1000;
/** Children per batch, and pending background readers per parent; profiles set lower limits per role. */
export const MAX_TASKS = 10;
export const START_TIMEOUT_MS = 30 * 1000;
export const READ_TOOLS = ["read", "search", "list"];
export const WRITE_TOOLS = [...READ_TOOLS, "edit", "write"];
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export const PROTECTED_PARTS = new Set([".git", ".pi", ".codex", ".agents", "node_modules"]);
// Pi context files (resource-loader.js loadContextFileFromDir) and system prompt overrides.
const PROTECTED_FILES = new Set(["agents.override.md", "agents.md", "claude.md", "system.md", "append_system.md"]);
const PROJECT_SKILL_HOSTS = new Set([".pi", ".agents", ".codex"]);
// Pi's project package stores: .pi/npm/node_modules/<package> and .pi/git/<host>/<path>.
const PACKAGE_STORES = [[".pi", "npm", "node_modules"], [".pi", "git"]];
const HARNESS_DIRS = new Set(["extensions", "instructions", "skills", "prompts"]);
const HARNESS_ROOT = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
// Approximates case-insensitive volumes: APFS folds U+017F to "s", which toLowerCase() keeps.
const fold = (path) => path.toUpperCase().toLowerCase();

/** Keep model-facing file names portable while accepting native Windows operation paths. */
function normalizeSeparators(path, paths = nativePaths) {
	return paths.sep === "\\" ? path.replace(/\\/g, "/") : path;
}

export function projectRelativePath(root, target, paths = nativePaths) {
	return normalizeSeparators(paths.relative(root, target), paths);
}

export function within(root, path, paths = nativePaths) {
	const rel = projectRelativePath(root, path, paths);
	return rel === "" || (!rel.startsWith("../") && rel !== ".." && !paths.isAbsolute(rel));
}

export function concreteFile(input, paths = nativePaths) {
	const path = typeof input === "string" ? normalizeSeparators(input, paths) : "";
	if (!path || paths.isAbsolute(path) || /[\\\x00-\x1f*?]/u.test(path) ||
		(paths.sep === "\\" && path.includes(":")) || path.split("/").some((part) => !part || part === "." || part === "..")) {
		throw new Error("Editable files must be concrete project-relative paths");
	}
	if (protectedPath(path, true)) throw new Error(`Protected path: ${path}`);
	return path;
}

export function protectedPath(path, writing = false) {
	const parts = fold(path).split(/[\\/]/);
	return parts.some((part) => PROTECTED_PARTS.has(part)) || (writing && parts.some((part) => PROTECTED_FILES.has(part)));
}

/** This package's own manifest and top-level sources, wherever Pi runs. */
function harnessPath(target, paths) {
	const root = fold(HARNESS_ROOT), folded = fold(target);
	if (!within(root, folded, paths)) return false;
	const [first] = projectRelativePath(root, folded, paths).split("/");
	return HARNESS_DIRS.has(first) || first === "package.json";
}

/** A concrete skill directory below a protected host or Pi's project package stores. */
function readableSkillDirectory(parts) {
	const store = PACKAGE_STORES.find((prefix) => prefix.every((part, index) => parts[index] === part));
	if (store) {
		const rest = parts.slice(store.length), skills = rest.indexOf("skills", 1);
		return !rest.some((part) => PROTECTED_PARTS.has(part)) && skills > 0 && skills + 1 < rest.length;
	}
	return parts.every((part, index) => !PROTECTED_PARTS.has(part) ||
		(PROJECT_SKILL_HOSTS.has(part) && parts[index + 1] === "skills" && index + 2 < parts.length));
}

export function validateBatch(tasks) {
	if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > MAX_TASKS) throw new Error(`Use one to ${MAX_TASKS} readers, or one to ${MAX_TASKS} implementers`);
	const implementers = tasks.filter((task) => task?.role === "implement").length;
	if (implementers && implementers !== tasks.length) throw new Error("Readers and implementers cannot share a batch");
	// Parallel implementers share one working tree: each file has exactly one writer.
	const owners = new Map();
	for (const [index, task] of tasks.entries()) {
		if (!["explore", "review", "implement"].includes(task.role) || typeof task.instruction !== "string" || !task.instruction.trim()) throw new Error("Each task needs a role and instruction");
		if (task.reasoning !== undefined && !THINKING_LEVELS.includes(task.reasoning)) throw new Error("Unsupported reasoning level");
		if (task.mode !== undefined && !["sync", "background"].includes(task.mode)) throw new Error("Unsupported execution mode");
		if (task.role === "implement") {
			if (task.mode === "background") throw new Error("Implementation must be synchronous");
			if (!Array.isArray(task.files) || !task.files.length) throw new Error("An implementer requires assigned files");
			for (const file of task.files) {
				const key = fold(concreteFile(file));
				if ((owners.get(key) ?? index) !== index) throw new Error(`Implementers' editable files must not overlap: ${file}`);
				owners.set(key, index);
			}
		} else if (task.files?.length) throw new Error("Readers cannot have editable files; name the paths to inspect in instruction or context");
	}
}

/** Fails when a role would exceed its profile limit, counting that role's `pending` readers.
 * Callers run it in the same synchronous step that reserves the batch, so parallel calls cannot both pass. */
export function checkRoleLimits(manifests, limits = new Map(), pending = []) {
	for (const [role, limit] of limits) {
		const requested = manifests.filter((manifest) => manifest.role === role).length;
		const waiting = pending.filter((manifest) => manifest.role === role).length;
		if (requested && requested + waiting > limit) throw new Error(`The active profile allows ${limit} ${role} subagent${limit === 1 ? "" : "s"} at once; requested ${requested}${waiting ? ` with ${waiting} pending` : ""}. Use fewer tasks or change the limit in /models-profiles`);
	}
}

/** A profile deadline in milliseconds: whole minutes, or "off" for none. */
export const timeoutMs = (minutes) => minutes === "off" ? Infinity : minutes * 60 * 1000;

export function selectModel(requested, inherited, available) {
	const key = requested ?? (inherited && `${inherited.provider}/${inherited.id}`);
	const model = available.find((candidate) => `${candidate.provider}/${candidate.id}` === key);
	if (!model) throw new Error(`Model unavailable: ${key ?? "no inherited model"}`);
	return model;
}

/** Reject symlinks at every component, including aliases that currently point inside. */
export async function validatePath(manifest, input, writing = false, filesystem = {}) {
	const { paths = nativePaths, realpath: canonicalPath = realpath, lstat: inspectPath = lstat } = filesystem;
	if (typeof input !== "string") throw new Error("Unsafe path");
	const normalized = normalizeSeparators(input, paths);
	if (/[\\\x00-\x1f]/u.test(normalized) || normalized.split("/").includes("..") ||
		(paths.sep === "\\" && (/^[a-z]:($|[^/])/i.test(normalized) || normalized.replace(/^[a-z]:/i, "").includes(":")))) throw new Error("Unsafe path");
	const target = paths.resolve(manifest.cwd, normalized);
	const project = within(manifest.cwd, target, paths);
	const skill = !writing && manifest.skills?.find(({ baseDir }) => within(baseDir, target, paths));
	if (!project && !skill) throw new Error("Path outside project and selected skills");
	// Allow selected project skill subdirectories, never the enclosing harness metadata root.
	const readableSkill = skill && (!project || readableSkillDirectory(fold(projectRelativePath(manifest.cwd, skill.baseDir, paths)).split("/")));
	const root = readableSkill ? skill.baseDir : manifest.cwd;
	const rel = projectRelativePath(root, target, paths);
	if (protectedPath(rel, writing) || (writing && harnessPath(target, paths))) throw new Error("Protected harness or Git path");
	const assigned = writing && manifest.files.some((file) => concreteFile(file, paths) === projectRelativePath(manifest.cwd, target, paths));
	if (writing && (manifest.role !== "implement" || !assigned)) throw new Error("Write outside assigned files");
	if (paths.relative(root, await canonicalPath(root)) !== "") throw new Error("Root is not canonical");
	let cursor = root;
	const parts = rel ? rel.split("/") : [];
	for (let index = 0; index < parts.length; index++) {
		cursor = paths.resolve(cursor, parts[index]);
		let stat;
		try { stat = await inspectPath(cursor); } catch (error) {
			if (writing && error.code === "ENOENT") return target;
			throw error;
		}
		if (stat.isSymbolicLink()) throw new Error("Symbolic links are not accessible");
		if (!stat.isDirectory() && !stat.isFile()) throw new Error("Only regular files and directories are accessible");
		if (writing && stat.isFile() && stat.nlink !== 1) throw new Error("Hard-linked files are not writable");
		if (index < parts.length - 1 && !stat.isDirectory()) throw new Error("Parent is not a directory");
	}
	return target;
}

export function validateManifest(manifest) {
	validateBatch([manifest]);
	const expected = manifest.role === "implement" ? WRITE_TOOLS : READ_TOOLS;
	if (!Array.isArray(manifest.tools) || JSON.stringify([...manifest.tools].sort()) !== JSON.stringify([...expected].sort())) {
		throw new Error("Forbidden child tool selection");
	}
}
