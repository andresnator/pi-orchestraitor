import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const NATIVE_CONFIG = {
	toolActivation: "eager",
	asyncByDefault: false,
	maxSubagentDepth: 1,
	globalConcurrencyLimit: 2,
	maxActiveAsyncRunsPerSession: 2,
	capacity: { abandonedSlotReleaseAfterMs: false },
	timeoutMs: 600000,
	worktreeProvider: "native",
	artifactDir: "session",
	artifactConfig: { cleanupDays: 7 },
	fleetView: true,
	missions: { enabled: false },
	scheduledRuns: { enabled: false },
	disabledFeatures: ["watchdog", "missions", "external-machines", "workflow-scripts"],
	intercomBridge: { mode: "off" },
};

export function nativeSettings(packageRoot, agentDir, packageDirectory = agentDir) {
	return { subagents: {
		disableBuiltins: true,
		defaultExtensions: [join(packageRoot, "extensions/nan.ts"), join(packageDirectory, "npm/node_modules/pi-claude-bridge/src/index.ts")],
		watchdog: { enabled: false },
	} };
}

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function snapshot(path) {
	const info = await lstat(path).catch(error => { if (error.code !== "ENOENT") throw error; });
	const destination = info?.isSymbolicLink() ? await realpath(path) : path;
	const text = await readFile(destination, "utf8").catch(error => { if (error.code !== "ENOENT") throw error; });
	const value = JSON.parse(text ?? "{}");
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path}: expected a JSON object`);
	return { path, destination, text, value };
}
async function publish(path, text) {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, text, { flag: "wx", mode: 0o600 });
		await rename(temporary, path);
	} finally { await rm(temporary, { force: true }); }
}

/** Fresh native configuration. Conflicting prior plugin settings require explicit resolution. */
export async function planNativeConfig(settingsPath, agentDir, packageRoot, packageDirectory = agentDir) {
	const settings = nativeSettings(packageRoot, agentDir, packageDirectory);
	const inputs = [[settingsPath, settings], [join(agentDir, "extensions/subagent/config.json"), NATIVE_CONFIG]];
	const receipts = [];
	for (const [path, patch] of inputs) {
		const before = await snapshot(path);
		for (const [key, value] of Object.entries(patch)) {
			if (Object.hasOwn(before.value, key) && !equal(before.value[key], value)) throw new Error(`${path}: conflicting native ${key} configuration. Resolve it before installation; old orchestraitor profiles are not migrated.`);
		}
		const after = { ...before.value, ...patch };
		receipts.push({ ...before, patch, afterText: `${JSON.stringify(after, null, 2)}\n`, changed: !equal(before.value, after) });
	}
	return {
		preview: receipts.map(({ path, patch, changed }) => ({ path, values: patch, changed })),
		receipts,
		async apply() {
			for (const receipt of receipts) {
				if (!receipt.changed) continue;
				const current = await snapshot(receipt.path);
				if (current.destination !== receipt.destination || current.text !== receipt.text) throw new Error(`${receipt.path}: changed since preview; rerun installation`);
				await publish(receipt.destination, receipt.afterText);
				receipt.applied = true;
			}
		},
		async rollback() { await restoreNativeConfig(receipts.filter(receipt => receipt.applied)); },
	};
}

export async function restoreNativeConfig(receipts, { dryRun = false } = {}) {
	const paths = [];
	for (const before of receipts) {
		if (!before.changed) continue;
		const current = await snapshot(before.destination);
		if (current.destination !== before.destination) throw new Error(`${before.path}: target changed; cannot restore through another link`);
		const value = current.value;
		for (const [key, installed] of Object.entries(before.patch)) {
			if (!equal(value[key], installed)) continue; // Preserve concurrent operator changes.
			if (Object.hasOwn(before.value, key)) value[key] = before.value[key];
			else delete value[key];
		}
		paths.push(before.path);
		if (dryRun) continue;
		if (equal(value, before.value)) {
			if (before.text === undefined) await rm(before.destination, { force: true });
			else await publish(before.destination, before.text);
		} else await publish(before.destination, `${JSON.stringify(value, null, 2)}\n`);
	}
	return paths;
}

/** Validate every recorded target before restoring any part of a transaction. */
export async function assertConfigurationTargets(receipts) {
	for (const before of receipts ?? []) {
		const current = await snapshot(before.path);
		if (current.destination !== before.destination) {
			throw new Error(`${before.path}: target changed since installation; restore the original link before restoring this backup`);
		}
		const destination = await snapshot(before.destination);
		if (destination.destination !== before.destination) throw new Error(`${before.path}: recorded target changed; cannot restore through another link`);
	}
}
