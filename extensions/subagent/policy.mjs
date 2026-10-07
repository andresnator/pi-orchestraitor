import { lstat, realpath } from "node:fs/promises";
import nativePaths from "node:path";

export const TASK_TIMEOUT_MS = 10 * 60 * 1000;
export const START_TIMEOUT_MS = 30 * 1000;
export const READ_TOOLS = ["read", "search", "list"];
export const WRITE_TOOLS = [...READ_TOOLS, "edit", "write"];
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const PROTECTED_PARTS = new Set([".git", ".pi", ".codex", ".agents", "node_modules"]);
const PROTECTED_FILES = new Set(["agents.md", "system.md", "append_system.md"]);
const PROJECT_SKILL_HOSTS = new Set([".pi", ".agents", ".codex"]);
const HARNESS_DIRS = new Set(["extensions", "instructions", "skills", "prompts"]);

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
	if (!path || paths.isAbsolute(path) || /[\\\x00-\x1f*?\[\]{}]/u.test(path) ||
		(paths.sep === "\\" && path.includes(":")) || path.split("/").some((part) => !part || part === "." || part === "..")) {
		throw new Error("Editable files must be concrete project-relative paths");
	}
	if (protectedPath(path, true)) throw new Error(`Protected path: ${path}`);
	return path;
}

export function protectedPath(path, writing = false) {
	const parts = path.toLowerCase().split(/[\\/]/);
	return parts.some((part) => PROTECTED_PARTS.has(part)) ||
		(writing && (parts.some((part) => PROTECTED_FILES.has(part)) || HARNESS_DIRS.has(parts[0]) || parts[0] === "package.json"));
}

export function validateBatch(tasks) {
	if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 2) throw new Error("Use one or two readers, or one implementer");
	for (const task of tasks) {
		if (!["explore", "review", "implement"].includes(task.role) || typeof task.instruction !== "string" || !task.instruction.trim()) throw new Error("Each task needs a role and instruction");
		if (task.reasoning !== undefined && !THINKING_LEVELS.includes(task.reasoning)) throw new Error("Unsupported reasoning level");
		if (task.mode !== undefined && !["sync", "background"].includes(task.mode)) throw new Error("Unsupported execution mode");
		if (task.role === "implement") {
			if (task.mode === "background") throw new Error("Implementation must be synchronous");
			if (tasks.length !== 1 || !Array.isArray(task.files) || !task.files.length) throw new Error("An implementer requires exclusive execution and assigned files");
			task.files.forEach((file) => concreteFile(file));
		} else if (task.files?.length) throw new Error("Readers cannot have editable files");
	}
}

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
	const selectedParts = skill && project ? projectRelativePath(manifest.cwd, skill.baseDir, paths).toLowerCase().split("/") : [];
	const readableSkill = skill && selectedParts.every((part, index) => !PROTECTED_PARTS.has(part) ||
		(PROJECT_SKILL_HOSTS.has(part) && selectedParts[index + 1] === "skills" && index + 2 < selectedParts.length));
	const root = readableSkill ? skill.baseDir : manifest.cwd;
	const rel = projectRelativePath(root, target, paths);
	if (protectedPath(rel, writing)) throw new Error("Protected harness or Git path");
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
