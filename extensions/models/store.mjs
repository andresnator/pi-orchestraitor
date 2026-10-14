import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, open, rename, rm, lstat, link } from "node:fs/promises";
import { dirname, join } from "node:path";

export const ROLES = ["explore", "review", "implement"];
export const FIELDS = ["model", "reasoning", "mode"];
export const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const hash = text => createHash("sha256").update(text).digest("hex");
// Saves finish in milliseconds; Pi's own auth lock treats 30 s as abandoned.
const STALE_LOCK_MS = 30_000;
export function paths(agentDir, cwd) {
	return { profiles: join(agentDir, "orchestraitor", "profiles.json"), personal: join(agentDir, "orchestraitor", "config.json"), project: join(cwd, ".pi", "orchestraitor.json") };
}
export async function snapshot(path) {
	let raw;
	try {
		const stat = await lstat(path);
		if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error(`Unsafe or oversized configuration: ${path}`);
		raw = await readFile(path, "utf8");
	} catch (error) { if (error.code !== "ENOENT") throw error; }
	if (raw !== undefined && Buffer.byteLength(raw) > 1024 * 1024) throw new Error("Configuration grew beyond byte limit");
	const data = raw === undefined ? {} : JSON.parse(raw);
	if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Configuration must be a JSON object");
	return { path, revision: hash(raw ?? ""), data };
}
const busy = () => new Error("Configuration is being changed; reopen the panel");
const expired = path => lstat(path).then(stat => Date.now() - stat.mtimeMs >= STALE_LOCK_MS, error => { if (error.code === "ENOENT") return true; throw error; });
/** Exclusive lock holding the writer's own token. One left by a writer that died mid-save is moved
 * aside once stale; a live lock moved there by a racing reclaim goes back unless a third writer relocked. */
async function acquire(lock, stale = true) {
	const token = randomUUID();
	try { await writeFile(lock, token, { flag: "wx", mode: 0o600 }); return token; }
	catch (error) {
		if (error.code !== "EEXIST") throw error;
		if (!stale || !await expired(lock)) throw busy();
		const aside = `${lock}.${token}.stale`;
		try { await rename(lock, aside); }
		catch (error) { if (error.code === "ENOENT") return acquire(lock, false); throw error; }
		if (!await expired(aside)) {
			await link(aside, lock).catch(() => {});
			await rm(aside, { force: true });
			throw busy();
		}
		await rm(aside, { force: true });
		return acquire(lock, false);
	}
}
/** A lock reclaimed while this writer stalled belongs to its new owner. */
async function release(lock, token) {
	if (await readFile(lock, "utf8").catch(() => undefined) === token) await rm(lock, { force: true });
}
/** Cooperative lock plus revision check; never overwrite a changed snapshot. */
export async function save(snapshotBefore, data) {
	const { path, revision } = snapshotBefore;
	await mkdir(dirname(path), { recursive: true });
	const lock = `${path}.lock`, temporary = `${path}.${randomUUID()}.tmp`;
	const token = await acquire(lock);
	try {
		if ((await snapshot(path)).revision !== revision) throw new Error("Configuration changed concurrently; reopen the panel");
		const file = await open(temporary, "wx", 0o600);
		try { await file.writeFile(JSON.stringify(data, null, 2) + "\n"); await file.sync(); } finally { await file.close(); }
		if ((await snapshot(path)).revision !== revision) throw new Error("Configuration changed concurrently; reopen the panel");
		await rename(temporary, path);
	} finally { await rm(temporary, { force: true }); await release(lock, token); }
	return snapshot(path);
}
export function validateAssignments(assignments) {
	if (!assignments || typeof assignments !== "object" || Array.isArray(assignments)) throw new Error("Invalid assignments");
	for (const [role, values] of Object.entries(assignments)) {
		if (![...ROLES, "defaults"].includes(role) || !values || typeof values !== "object" || Array.isArray(values)) throw new Error("Invalid assignment role");
		for (const [field, value] of Object.entries(values)) {
			if (!FIELDS.includes(field)) throw new Error(`Unknown assignment field: ${field}`);
			if (value === null) continue; // Explicit inheritance removes this scope's override.
			if (field === "model" && (typeof value !== "string" || !value.includes("/"))) throw new Error("Invalid model ID");
			if (field === "reasoning" && !LEVELS.includes(value)) throw new Error("Invalid reasoning level");
			if (field === "mode" && !["sync", "background"].includes(value)) throw new Error("Invalid execution mode");
			if (role === "implement" && field === "mode" && value === "background") throw new Error("Implementation must be synchronous");
		}
	}
	return assignments;
}
export function resolveAssignment(role, task = {}, project = {}, personal = {}, parent = {}) {
	const values = {}, sources = {};
	for (const field of FIELDS) {
		const candidates = [[task, "task"], [project[role], "project:role"], [project.defaults, "project:defaults"],
			[personal[role], "personal:role"], [personal.defaults, "personal:defaults"], [parent, "parent"]];
		const found = candidates.find(([entry]) => entry?.[field] !== undefined && entry[field] !== null);
		values[field] = found?.[0][field] ?? (field === "mode" ? "sync" : undefined);
		sources[field] = found?.[1] ?? "default";
	}
	if (role === "implement" && values.mode !== "sync") throw new Error("Implementation must be synchronous");
	return { values, sources };
}
export async function readConfiguration(files, { projectTrusted = false } = {}) {
	// An untrusted checkout cannot influence routing, effort, or execution mode,
	// nor make personal configuration unusable with malformed project JSON.
	const [personal, project] = await Promise.all([snapshot(files.personal), projectTrusted ? snapshot(files.project) :
		Promise.resolve({ path: files.project, revision: null, data: {}, ignored: true })]);
	// A null field means no assignments, like a missing one.
	for (const { data } of [personal, project]) data.assignments = validateAssignments(data.assignments ?? {});
	return { personal, project };
}
export function validateCatalog(assignments, catalog, supported, parent, personal = {}, project = {}) {
	validateAssignments(assignments);
	for (const role of [...ROLES, "defaults"]) {
		const choice = assignments[role] ?? {};
		const explicitModel = choice.model ?? assignments.defaults?.model;
		if (!explicitModel) continue;
		const model = catalog.find(model => `${model.provider}/${model.id}` === explicitModel);
		if (!model) throw new Error(`Model unavailable in profile: ${explicitModel}`);
		const effort = choice.reasoning ?? assignments.defaults?.reasoning;
		if (effort !== undefined && effort !== null && !supported(model).includes(effort)) throw new Error(`Unsupported effort in profile: ${effort} (${explicitModel})`);
	}
	for (const role of ROLES) {
		const { values, sources } = resolveAssignment(role, {}, project, personal, parent);
		const model = catalog.find(model => `${model.provider}/${model.id}` === values.model);
		if (!model) throw new Error(`Model unavailable for ${role}: ${values.model}`);
		if (sources.reasoning !== "parent" && values.reasoning !== undefined && !supported(model).includes(values.reasoning)) throw new Error(`Unsupported effort for ${role}: ${values.reasoning} (${values.model})`);
	}
}
export function profileName(name) {
	if (typeof name !== "string" || !name.trim() || name.length > 80 || /[\x00-\x1f]/u.test(name)) throw new Error("Profile names require 1–80 printable characters");
	return name.trim();
}
