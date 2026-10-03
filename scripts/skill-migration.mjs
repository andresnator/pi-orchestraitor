import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const BACKUP_DIRECTORY = "pi-orchestraitor-backups";
const MANIFEST_NAME = "manifest.json";
const MANIFEST_VERSION = 1;

export function isWithin(path, root) {
	const suffix = relative(resolve(root), resolve(path));
	return suffix === "" || (!suffix.startsWith(`..${sep}`) && suffix !== ".." && !isAbsolute(suffix));
}

export async function exists(path) {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
}

/** Plan moves from lexical discovery paths so a symlink's target stays untouched. */
export async function planMigration({ resources, catalog, packageRoot, discover, agentDir, protectedRoots = [] }) {
	const names = new Set(catalog.map(({ name }) => name));
	const moves = new Map();
	const blockers = [];
	const targetRoot = await realpath(packageRoot);
	const configurationRoots = [...protectedRoots, packageRoot, ...(agentDir ? [agentDir, join(agentDir, BACKUP_DIRECTORY)] : []),
		...resources.map(({ metadata }) => metadata.baseDir).filter(Boolean)];
	for (const resource of resources.filter(({ enabled }) => enabled)) {
		const skills = await discover(resource.path);
		for (const skill of skills.filter(({ name }) => names.has(name))) {
			if (isWithin(skill.filePath, packageRoot)) continue;
			if (resource.metadata.origin === "package") {
				if (resource.metadata.packageRoot && await realpath(resource.metadata.packageRoot) === targetRoot) continue;
				blockers.push(`${skill.name}: package ${resource.metadata.source} (${resource.metadata.scope} settings), ${skill.filePath}. Exclude this skill with pi config before installing.`);
				continue;
			}
			const discoveryRoot = resource.metadata.discoveryRoot;
			if (!discoveryRoot || !isWithin(skill.filePath, discoveryRoot)) {
				blockers.push(`${skill.filePath}: cannot establish its configured discovery root. Select an explicit skill path before migrating.`);
				continue;
			}
			const original = await movableEntry(skill.filePath, discoveryRoot);
			const entryStat = await lstat(original);
			if (await containsProtectedRoot(original, configurationRoots)) {
				blockers.push(`${original}: contains a protected configuration or package root. Select individual skill entries before migrating.`);
				continue;
			}
			const contained = entryStat.isDirectory() || entryStat.isSymbolicLink()
				? await discover(original) : [skill];
			if (contained.some(({ name }) => !names.has(name))) {
				blockers.push(`${original}: contains unrelated skills. Select individual skill paths before migrating.`);
				continue;
			}
			if (!entryStat.isSymbolicLink() && await hasRepositoryAncestor(original, resource.metadata.source !== "auto")) {
				blockers.push(`${original}: belongs to a source repository. Remove its configured skill path rather than moving source files.`);
				continue;
			}
			moves.set(original, { original, names: contained.map(({ name }) => name).sort(), kind: entryStat.isSymbolicLink() ? "symlink" : entryStat.isDirectory() ? "directory" : "file" });
		}
	}
	const entries = [...moves.values()].sort((a, b) => a.original.localeCompare(b.original));
	for (const entry of entries) {
		if (entries.some((other) => other !== entry && isWithin(entry.original, other.original))) {
			blockers.push(`${entry.original}: overlapping skill roots require individual configuration paths.`);
		}
	}
	return { moves: entries, blockers };
}

async function movableEntry(filePath, discoveryRoot) {
	filePath = resolve(filePath);
	discoveryRoot = resolve(discoveryRoot);
	const fileIsLink = (await lstat(filePath)).isSymbolicLink();
	let entry = basename(filePath) === "SKILL.md" && filePath !== discoveryRoot && !fileIsLink ? dirname(filePath) : filePath;
	let directory = entry;
	while (isWithin(directory, discoveryRoot)) {
		if ((await lstat(directory)).isSymbolicLink()) entry = directory;
		if (directory === resolve(discoveryRoot)) break;
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	return entry;
}

async function hasRepositoryAncestor(entry, includeParents) {
	// Resolve parent aliases too: a real directory inside a linked checkout is source.
	let directory = (await lstat(entry)).isDirectory() ? await realpath(entry) : dirname(await realpath(entry));
	while (true) {
		if (await exists(join(directory, ".git"))) return true;
		if (!includeParents) return false;
		const parent = dirname(directory);
		if (parent === directory) return false;
		directory = parent;
	}
}

async function containsProtectedRoot(entry, roots) {
	if (roots.some((root) => isWithin(root, entry))) return true;
	if (!(await lstat(entry)).isDirectory()) return false;
	const physicalEntry = await realpath(entry);
	for (const root of roots) {
		if (await exists(root) && isWithin(await realpath(root), physicalEntry)) return true;
	}
	return false;
}

export async function applyMigration({ plan, agentDir, register, rollbackRegistration, verify }) {
	if (plan.blockers.length) throw new Error(plan.blockers.join("\n"));
	const backupRoot = join(agentDir, BACKUP_DIRECTORY);
	// Independently protect the backup location before creating or moving anything.
	for (const { original } of plan.moves) {
		if (await containsProtectedRoot(original, [agentDir, backupRoot])) {
			throw new Error(`${original}: cannot move a protected configuration or backup root.`);
		}
	}
	await mkdir(backupRoot, { recursive: true, mode: 0o700 });
	const lockPath = join(backupRoot, ".lock");
	try {
		await mkdir(lockPath);
	} catch (error) {
		if (error.code === "EEXIST") throw new Error(`Another migration holds ${lockPath}. Inspect it before removing a stale lock.`);
		throw error;
	}
	let backup;
	let manifest;
	try {
		if (plan.moves.length) {
			const timestamp = new Date().toISOString().replaceAll(":", "-");
			backup = await mkdtemp(join(backupRoot, `${timestamp}-`));
			manifest = { version: MANIFEST_VERSION, state: "prepared", entries: plan.moves.map((move, index) => ({ ...move, stored: `${index}-${basename(move.original)}` })) };
			await writeManifest(backup, manifest);
			for (const entry of manifest.entries) await rename(entry.original, join(backup, entry.stored));
			manifest.state = "moved";
			await writeManifest(backup, manifest);
		}
		await register();
		await verify();
		if (manifest) {
			manifest.state = "installed";
			await writeManifest(backup, manifest);
		}
		return { backup, moved: plan.moves };
	} catch (error) {
		const failures = [];
		try { await rollbackRegistration(); } catch (failure) { failures.push(failure.message); }
		if (backup) {
			try { await restoreBackup(backup); } catch (failure) { failures.push(failure.message); }
		}
		throw new Error(`${error.message}${failures.length ? `\nRollback needs attention: ${failures.join("; ")}. Backup: ${backup ?? "none"}` : "\nMigration rolled back."}`, { cause: error });
	} finally {
		await rm(lockPath, { recursive: true });
	}
}

export async function restoreBackup(backupPath, { dryRun = false } = {}) {
	const backup = resolve(backupPath);
	const manifest = JSON.parse(await readFile(join(backup, MANIFEST_NAME), "utf8"));
	if (manifest.version !== MANIFEST_VERSION || !Array.isArray(manifest.entries)) throw new Error("Unsupported backup manifest.");
	const pending = [];
	for (const entry of manifest.entries) {
		if (!isAbsolute(entry.original) || typeof entry.stored !== "string" || basename(entry.stored) !== entry.stored || [".", ".."].includes(entry.stored)) throw new Error("Invalid backup entry.");
		const stored = join(backup, entry.stored);
		if (!await exists(stored)) {
			if (manifest.state === "restored" || await exists(entry.original)) continue;
			throw new Error(`Backup entry is missing: ${stored}`);
		}
		if (await exists(entry.original)) throw new Error(`Restoration would overwrite ${entry.original}. Move that entry aside first.`);
		pending.push({ ...entry, storedPath: stored });
	}
	if (!dryRun) {
		for (const entry of pending) {
			await mkdir(dirname(entry.original), { recursive: true });
			await rename(entry.storedPath, entry.original);
		}
		manifest.state = "restored";
		await writeManifest(backup, manifest);
	}
	return pending.map(({ original }) => original);
}

async function writeManifest(backup, manifest) {
	const temporary = join(backup, `${MANIFEST_NAME}.tmp`);
	await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
	await rename(temporary, join(backup, MANIFEST_NAME));
}
