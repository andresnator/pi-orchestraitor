import { mkdir, realpath, rmdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { workbenchPaths, readWorkbenchSnapshot, readWorkbenchOwnership, writeWorkbenchOwnership, withWorkbenchLock } from "../../extensions/ui/workbench-bridge.mjs";
import { validateWorkbenchOwnership } from "../../extensions/ui/workbench-contract.mjs";
import { createHerdrClient, invocationContext, PLUGIN_ID, ENTRYPOINT, isIdentity } from "./herdr-client.mjs";
import { MINIMUM, placement } from "./view.mjs";
const CHROME_CELLS = 2;
const RESIZE_HYSTERESIS = 12;
const PROCESS_WAIT_MS = 2000;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rectKeys = ["x", "y", "width", "height"];
const rect = value => value && rectKeys.every(key => Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 65535);

function checkedLayout(value, source) {
	if (!value || value.workspace_id !== source.workspace || !isIdentity(value.tab_id) || value.zoomed !== false || !rect(value.area) ||
		!Array.isArray(value.panes) || value.panes.length > 128 || !Array.isArray(value.splits) || value.splits.length > 128 ||
		value.panes.some(pane => !isIdentity(pane.pane_id) || !rect(pane.rect)) || new Set(value.panes.map(pane => pane.pane_id)).size !== value.panes.length ||
		value.splits.some(split => !["right", "down"].includes(split.direction) || !rect(split.rect) || !Number.isFinite(split.ratio) || split.ratio <= 0 || split.ratio >= 1)) throw new Error("Unsupported or changed pane layout");
	return value;
}
const foreign = (layout, origin, companion) => layout.panes.filter(pane => ![origin, companion].includes(pane.pane_id)).map(pane => ({ id: pane.pane_id, rect: pane.rect })).sort((a, b) => a.id.localeCompare(b.id));
function ownedPair(layout, record) {
	const origin = layout.panes.find(pane => pane.pane_id === record.source.pane)?.rect;
	const companion = layout.panes.find(pane => pane.pane_id === record.companion.pane)?.rect;
	if (!origin || !companion) throw new Error("Owned pair is no longer present");
	let direction, area;
	if (origin.y === companion.y && origin.height === companion.height && origin.x + origin.width === companion.x) {
		direction = "right"; area = { ...origin, width: origin.width + companion.width };
	} else if (origin.x === companion.x && origin.width === companion.width && origin.y + origin.height === companion.y) {
		direction = "down"; area = { ...origin, height: origin.height + companion.height };
	} else throw new Error("Owned panes were moved or are no longer siblings");
	const split = layout.splits.find(item => item.direction === direction && rectKeys.every(key => item.rect[key] === area[key]));
	if (!split || foreign(layout, record.source.pane, record.companion.pane).some(pane => pane.rect.x < area.x + area.width && pane.rect.x + pane.rect.width > area.x && pane.rect.y < area.y + area.height && pane.rect.y + pane.rect.height > area.y)) throw new Error("Cannot isolate the owned split from foreign panes");
	return { direction, area, split, origin, companion };
}
function mainArguments(process, mainPath) {
	if (!Array.isArray(process?.argv)) return undefined;
	const index = process.argv.indexOf(mainPath);
	if (index < 0) return undefined;
	const args = process.argv.slice(index + 1), values = {};
	for (let i = 0; i < args.length; i += 2) {
		if (!["--origin", "--socket", "--source", "--token", "--palette"].includes(args[i]) || Object.hasOwn(values, args[i]) || !isIdentity(args[i + 1])) return undefined;
		values[args[i]] = args[i + 1];
	}
	return values;
}
function matchesProcess(process, source, token, mainPath) {
	const args = mainArguments(process, mainPath);
	return args && args["--origin"] === source.pane && args["--socket"] === source.socket && args["--source"] === source.instance && args["--token"] === token;
}

export async function createWorkbenchStorage(socket, origin) {
	const paths = await workbenchPaths(socket, origin);
	const pending = join(paths.directory, "opening.lock");
	return {
		readSnapshot: () => readWorkbenchSnapshot(paths), readOwnership: () => readWorkbenchOwnership(paths),
		writeOwnership: record => writeWorkbenchOwnership(paths, record),
		async clearOwnership(record) { const current = await readWorkbenchOwnership(paths); if (current?.companion.token === record.companion.token) await unlink(paths.ownership); },
		async claim() { try { await mkdir(pending, { mode: 0o700 }); } catch { throw new Error("An earlier open is uncertain; inspect its owned pane and runtime lease before retrying"); } },
		async clearClaim() { await rmdir(pending).catch(error => { if (error.code !== "ENOENT") throw error; }); },
		lock: operation => withWorkbenchLock({ ...paths, lock: join(paths.directory, "lifecycle.lock") }, operation, { waitMs: 10000 }),
	};
}

/** Serializes presentation operations; never runs agents, answers questions or mutates tasks. */
export function createWorkbenchActions({ client, storage = createWorkbenchStorage }) {
	async function resolveCaller(context) {
		const caller = await client.pane(context.pane);
		if (!caller || caller.workspace_id !== context.workspace || caller.tab_id !== context.tab) throw new Error("Calling pane identity changed");
		let store = await storage(context.socket, context.pane);
		const sample = await store.readSnapshot(), owner = await store.readOwnership();
		if (sample.snapshot?.publisher.pane === context.pane || owner?.source.pane === context.pane) return { store, origin: context.pane };
		const processes = await client.processes(context.pane);
		const candidates = (processes.foreground_processes ?? []).map(process => ({ process, args: mainArguments(process, client.mainPath) })).filter(item => item.args?.["--socket"] === context.socket);
		if (candidates.length !== 1) throw new Error("Enable the publisher in this Pi pane; no other project session will be guessed");
		const candidate = candidates[0]; store = await storage(context.socket, candidate.args["--origin"]);
		const record = await store.readOwnership();
		if (!record || record.companion.pane !== context.pane || record.companion.pid !== candidate.process.pid || record.companion.token !== candidate.args["--token"] || record.source.instance !== candidate.args["--source"]) throw new Error("Companion ownership was not confirmed");
		return { store, origin: record.source.pane };
	}
	async function originPane(source, context) {
		const pane = await client.pane(source.pane);
		if (!pane || source.socket !== context.socket || pane.workspace_id !== source.workspace || pane.tab_id !== context.tab) throw new Error("Source pane is unavailable or moved");
		const processes = await client.processes(source.pane);
		if (processes.pane_id !== source.pane || !processes.foreground_processes?.some(process => process.pid === source.pid)) throw new Error("Source Pi process was replaced");
		return pane;
	}
	async function companionPane(record) {
		validateWorkbenchOwnership(record);
		const pane = await client.pane(record.companion.pane);
		if (!pane) return undefined;
		if (pane.workspace_id !== record.companion.workspace || pane.tab_id !== record.companion.tab || pane.terminal_id !== record.companion.terminal) throw new Error("Companion pane identity changed");
		const info = await client.processes(pane.pane_id);
		const matches = info.foreground_processes?.filter(process => process.pid === record.companion.pid && matchesProcess(process, record.source, record.companion.token, client.mainPath));
		if (info.pane_id !== pane.pane_id || matches?.length !== 1) throw new Error("Companion process ownership was not confirmed");
		return pane;
	}
	async function liveSource(store, origin, context) {
		const result = await store.readSnapshot();
		if (result.status !== "live" || result.snapshot.publisher.pane !== origin) throw new Error("Publisher is disabled, stale or unavailable; enable it in the originating Pi session");
		await originPane(result.snapshot.publisher, context);
		return result.snapshot.publisher;
	}
	async function openOwned(store, source, context, { direction, localState, focus = true, expectedFocus } = {}) {
		const before = checkedLayout(await client.layout(source.pane), source);
		const area = before.panes.find(pane => pane.pane_id === source.pane)?.rect;
		if (!area || expectedFocus !== undefined && before.focused_pane_id !== expectedFocus) throw new Error("Origin layout or focus changed during relocation");
		if (expectedFocus === undefined && before.focused_pane_id !== source.pane) throw new Error("Focus is outside the originating Pi pane");
		direction ??= placement(area.width - CHROME_CELLS, area.height - CHROME_CELLS);
		if (direction === "unavailable") throw new Error("Terminal too small; keep Pi usable and use its native panels");
		const fresh = await liveSource(store, source.pane, context);
		if (fresh.instance !== source.instance) throw new Error("Publisher changed before opening");
		const token = randomUUID();
		await store.claim(); // Kept on uncertain API failure: a retry must not duplicate a pane.
		const receipt = await client.open(source, direction, token, localState);
		const pane = receipt?.pane;
		if (receipt?.plugin_id !== PLUGIN_ID || receipt.entrypoint !== ENTRYPOINT || !pane || pane.pane_id === source.pane || pane.workspace_id !== source.workspace || pane.tab_id !== before.tab_id || !isIdentity(pane.terminal_id)) throw new Error("Unconfirmed plugin open receipt");
		let processes = [];
		const deadline = Date.now() + PROCESS_WAIT_MS;
		do {
			const info = await client.processes(pane.pane_id);
			if (info.pane_id !== pane.pane_id) throw new Error("Opened pane process lookup changed");
			processes = (info.foreground_processes ?? []).filter(process => matchesProcess(process, source, token, client.mainPath));
			if (processes.length === 1) break;
			await sleep(25);
		} while (Date.now() < deadline);
		if (processes.length !== 1) throw new Error("Renderer startup was not confirmed; retain its opening lease");
		const record = validateWorkbenchOwnership({ version: 1, source, companion: { pane: pane.pane_id, workspace: pane.workspace_id, tab: pane.tab_id, terminal: pane.terminal_id, pid: processes[0].pid, plugin: PLUGIN_ID, entrypoint: ENTRYPOINT, token }, createdAt: Date.now() });
		await store.writeOwnership(record); await store.clearClaim();
		try {
			let after = checkedLayout(await client.layout(source.pane), source);
			let pair = ownedPair(after, record);
			if (!same(foreign(before, source.pane), foreign(after, source.pane, pane.pane_id)) || !rectKeys.every(key => pair.area[key] === area[key])) throw new Error("Layout changed while opening; no foreign panes will be adjusted");
			const size = direction === "right" ? area.width : area.height;
			const minimumSource = (direction === "right" ? MINIMUM.chatColumns : MINIMUM.chatRows) + CHROME_CELLS;
			const minimumPanel = (direction === "right" ? MINIMUM.panelColumns : MINIMUM.panelRows) + CHROME_CELLS;
			const wanted = Math.min(size - minimumPanel, Math.max(minimumSource, Math.floor(size * 0.62)));
			const amount = (wanted + 0.25) / size - pair.split.ratio;
			if (amount > 0) {
				await companionPane(record); await originPane(source, context);
				const check = checkedLayout(await client.layout(source.pane), source);
				if (!same(check, after)) throw new Error("Layout changed before owned resize");
				after = checkedLayout(await client.resize(source.pane, direction, amount), source); pair = ownedPair(after, record);
			}
			if (!same(foreign(before, source.pane), foreign(after, source.pane, pane.pane_id)) || pair.origin.width - CHROME_CELLS < MINIMUM.chatColumns || pair.origin.height - CHROME_CELLS < MINIMUM.chatRows || pair.companion.width - CHROME_CELLS < MINIMUM.panelColumns || pair.companion.height - CHROME_CELLS < MINIMUM.panelRows) throw new Error("Owned split cannot preserve usable Pi and companion dimensions");
			if (focus) {
				await companionPane(record); await originPane(source, context);
				const latest = checkedLayout(await client.layout(source.pane), source);
				if (latest.focused_pane_id !== before.focused_pane_id || !same(foreign(after, source.pane, pane.pane_id), foreign(latest, source.pane, pane.pane_id))) throw new Error("Focus or foreign topology changed before focus");
				const focused = await client.focus(pane.pane_id);
				if (focused?.plugin_id !== PLUGIN_ID || focused.entrypoint !== ENTRYPOINT || focused.pane?.terminal_id !== pane.terminal_id || focused.pane?.pane_id !== pane.pane_id) throw new Error("Companion focus was not confirmed");
			}
			return { status: "opened", record };
		} catch (error) {
			// Roll back only this freshly opened, independently revalidated pane.
			// If topology/process evidence is ambiguous, retain the lease instead.
			try {
				await companionPane(record); await originPane(source, context);
				ownedPair(checkedLayout(await client.layout(source.pane), source), record);
				if (await client.close(record.companion.pane) === record.companion.pane) await store.clearOwnership(record);
			} catch { /* Never guess a cleanup target. */ }
			throw error;
		}
	}
	async function closeOwned(store, record, context, returnFocus = true) {
		await companionPane(record);
		let originValid = true;
		try { await originPane(record.source, context); }
		catch { originValid = false; }
		if (!originValid) {
			// Local quit may remove its exact live companion after source shutdown,
			// but never focuses a replacement process or guesses a different origin.
			if (context.pane !== record.companion.pane) throw new Error("Source process changed; close locally from its verified companion");
			const pane = await companionPane(record);
			if (!pane) return { status: "already-closed" };
			if (await client.close(pane.pane_id) !== pane.pane_id) throw new Error("Local owned close was not confirmed");
			await store.clearOwnership(record); await store.clearClaim();
			return { status: "closed" };
		}
		const layout = checkedLayout(await client.layout(record.source.pane), record.source);
		const pair = ownedPair(layout, record);
		if (returnFocus && ![record.source.pane, record.companion.pane].includes(layout.focused_pane_id)) throw new Error("Focus moved outside the owned pair");
		if (returnFocus && layout.focused_pane_id === record.companion.pane) await client.focusOrigin(record.companion.pane, pair.direction === "right" ? "left" : "up", record.source.pane);
		await companionPane(record); await originPane(record.source, context);
		const check = checkedLayout(await client.layout(record.source.pane), record.source);
		ownedPair(check, record);
		if (!same(foreign(layout, record.source.pane, record.companion.pane), foreign(check, record.source.pane, record.companion.pane))) throw new Error("Foreign topology changed before close");
		if (await client.close(record.companion.pane) !== record.companion.pane) throw new Error("Owned close was not confirmed");
		await store.clearOwnership(record); await store.clearClaim();
		return { status: "closed" };
	}
	return { async run(action, context, { localState } = {}) {
		if (!["open", "close", "toggle", "relocate"].includes(action)) throw new Error("Unknown presentation action");
		const { store, origin } = await resolveCaller(context);
		return store.lock(async () => {
			let record = await store.readOwnership();
			if (record && !await companionPane(record)) { await store.clearOwnership(record); await store.clearClaim(); record = undefined; }
			if (action === "close") return record ? closeOwned(store, record, context) : { status: "already-closed" };
			if (action === "toggle" && record) return closeOwned(store, record, context);
			if (action === "open" && record) {
				const current = await liveSource(store, origin, context);
				if (current.instance !== record.source.instance) throw new Error("Old companion belongs to a previous publisher; close it before reopening");
				await originPane(record.source, context);
				const layout = checkedLayout(await client.layout(origin), record.source);
				if (![record.source.pane, record.companion.pane].includes(layout.focused_pane_id)) throw new Error("Focus is outside the owned pair");
				await client.focus(record.companion.pane); return { status: "focused", record };
			}
			const source = await liveSource(store, origin, context);
			if (action === "relocate") {
				if (!record || record.source.instance !== source.instance) return { status: "unchanged" };
				const layout = checkedLayout(await client.layout(origin), source), pair = ownedPair(layout, record);
				const direction = placement(pair.area.width - CHROME_CELLS, pair.area.height - CHROME_CELLS);
				if (direction === "unavailable") return { status: "too-small" };
				if (direction === pair.direction || pair.direction === "down" || direction === "right" && pair.area.width < MINIMUM.chatColumns + MINIMUM.panelColumns + MINIMUM.separator + CHROME_CELLS + RESIZE_HYSTERESIS) return { status: "unchanged" };
				const focusedCompanion = layout.focused_pane_id === record.companion.pane;
				await closeOwned(store, record, context, false);
				return openOwned(store, source, context, { direction, localState, focus: focusedCompanion, expectedFocus: focusedCompanion ? origin : layout.focused_pane_id });
			}
			return openOwned(store, source, context);
		});
	} };
}

export async function main(action, args = process.argv.slice(3)) {
	if (action === "--help") { console.log("Workbench presentation only: node actions.mjs open|close|toggle --caller \"$HERDR_PANE_ID\". Requires an enabled publisher and a verified Herdr terminal. Native keybinding: pi.orchestraitor.toggle."); return; }
	let caller;
	if (args.length) { if (args.length !== 2 || args[0] !== "--caller") throw new Error("Use an explicit --caller matching this terminal"); caller = args[1]; }
	const context = await invocationContext(process.env, caller);
	const local = process.env.PI_WORKBENCH_VIEW_STATE;
	if (local && Buffer.byteLength(local) > 65536) throw new Error("Oversized local view state");
	const actions = createWorkbenchActions({ client: await createHerdrClient() });
	const result = await actions.run(action, context, { localState: local ? JSON.parse(local) : undefined });
	console.log(JSON.stringify({ status: result.status }));
	return result;
}
export async function runAction(action, args = []) {
	const deadline = setTimeout(() => { console.error("Workbench action exceeded its deadline; inspect its owned lease before retrying."); process.exit(1); }, 15000); deadline.unref();
	try { await main(action, args); } catch (error) { console.error(`Workbench: ${error instanceof Error ? error.message : "presentation action failed"}`); process.exitCode = 1; }
	finally { clearTimeout(deadline); }
}
if (process.argv[1] && pathToFileURL(await realpath(process.argv[1])).href === import.meta.url) await runAction(process.argv[2], process.argv.slice(3));
