import { inspectCatalog } from "./sources.mjs";
import { publishRegistry } from "./store.mjs";

export const REGISTRY_RESOLVE_EVENT = "pi-orchestraitor:skill-registry-resolve";
export const DEFAULT_SEARCH_LIMIT = 5;
export const MAX_SEARCH_LIMIT = 20;
const MAX_QUERY_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 512;
const sessionKey = (ctx) => `${ctx.cwd}\0${ctx.sessionManager?.getSessionId?.() ?? ""}`;

/** A per-extension native snapshot. Persistence never participates in selection. */
export function createSkillRegistry(sdk) {
	let key;
	let canonicalCwd;
	const canonicalPaths = new Map();
	let catalog;
	let state;
	let generation = 0;
	let controller = new AbortController();
	let queue = Promise.resolve();
	function invalidate() {
		controller.abort();
		controller = new AbortController();
		generation++;
		key = catalog = state = undefined;
	}
	function enqueue(ctx, operation) {
		const expectedGeneration = generation;
		const signal = ctx.signal ? AbortSignal.any([controller.signal, ctx.signal]) : controller.signal;
		const current = queue.catch(() => {}).then(async () => {
			signal.throwIfAborted();
			const result = await operation(signal);
			if (generation !== expectedGeneration) throw new Error("Skill registry session changed");
			return result;
		});
		queue = current;
		return current;
	}
	async function publish(snapshot, signal) {
		const persistence = await publishRegistry(snapshot, { signal, mutate: sdk.withFileMutationQueue });
		signal.throwIfAborted();
		state = { ...snapshot, persistence };
		return state;
	}
	async function start(ctx) {
		if (canonicalCwd !== ctx.cwd) { canonicalPaths.clear(); canonicalCwd = ctx.cwd; }
		invalidate();
		key = sessionKey(ctx);
		return enqueue(ctx, async (signal) => publish({ ...await inspectCatalog(sdk, [], {
			cwd: ctx.cwd, trusted: ctx.isProjectTrusted(), signal,
		}), pending: true }, signal));
	}
	async function capture(skills, ctx) {
		if (key !== sessionKey(ctx)) await start(ctx);
		catalog = structuredClone(skills);
		const declared = new Set(catalog.map(({ filePath }) => filePath));
		for (const path of canonicalPaths.keys()) if (!declared.has(path)) canonicalPaths.delete(path);
		return refresh(ctx);
	}
	async function refresh(ctx) {
		if (key !== sessionKey(ctx) || !catalog) throw new Error("Native catalog is not captured; use /orchestraitor:skills refresh");
		const native = structuredClone(catalog);
		return enqueue(ctx, async (signal) => publish(await inspectCatalog(sdk, native, {
			cwd: ctx.cwd, trusted: ctx.isProjectTrusted(), signal, canonicalPaths,
		}), signal));
	}
	async function search(query, limit, ctx) {
		if (typeof query !== "string" || !query.trim() || query.length > MAX_QUERY_LENGTH) throw new Error("Provide a non-empty skill query of at most 500 characters");
		if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) throw new Error("Skill search limit must be between 1 and 20");
		const snapshot = await refresh(ctx);
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		const matches = snapshot.entries.filter((entry) => entry.status === "available").map((entry) => ({
			entry, score: terms.reduce((sum, term) => sum + (entry.name.toLowerCase().includes(term) ? 2 : 0) + (entry.description.toLowerCase().includes(term) ? 1 : 0), 0),
		})).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
		return { total: matches.length, matches: matches.slice(0, limit).map(({ entry }) => ({
			name: entry.name, description: entry.description.slice(0, MAX_DESCRIPTION_LENGTH), source: entry.source, filePath: entry.filePath,
		})), truncated: matches.length > limit };
	}
	async function resolveNames(names, ctx) {
		const snapshot = await refresh(ctx);
		return [...new Set(names)].map((name) => {
			const selected = snapshot.entries.filter((entry) => entry.name === name);
			if (selected.length !== 1 || selected[0].status !== "available") {
				throw new Error(`Skill unavailable for model invocation: ${name}. ${selected[0]?.diagnostic ?? "Use native /reload; manual-only skills require an explicit /skill command."}`);
			}
			return { skill: selected[0].skill, body: selected[0].body };
		});
	}
	function status() {
		return { pending: state?.pending ?? true, registered: catalog?.length ?? 0,
			available: state?.entries.filter(({ status }) => status === "available").length ?? 0,
			manualOnly: state?.entries.filter(({ status }) => status === "manual-only").length ?? 0,
			unavailable: state?.entries.filter(({ status }) => status === "unavailable").length ?? 0,
			persistence: state?.persistence };
	}
	return { start, capture, refresh, search, resolveNames, status, dispose: invalidate };
}
