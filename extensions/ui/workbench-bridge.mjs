import * as nativeFs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MAX_SNAPSHOT_BYTES, validateWorkbenchSnapshot, validateWorkbenchOwnership } from "./workbench-contract.mjs";

export const WORKBENCH_HEARTBEAT_MS = 2000;
export const WORKBENCH_STALE_MS = 6000;
const PUBLISH_INTERVAL_MS = 200;
const uid = () => process.getuid?.();
const nativeTimers = { setTimeout, clearTimeout };
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const safeIdentity = value => typeof value === "string" && value.length > 0 && value.length <= 1000 && !/[\x00-\x1f\x7f-\x9f]/.test(value);

async function privateDirectory(path, fs, create = false) {
	if (create) await fs.mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
	const stat = await fs.lstat(path);
	if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || (uid() !== undefined && stat.uid !== uid())) throw new Error("Unsafe workbench directory");
}

export async function workbenchPaths(socket, pane, { base = tmpdir(), fs = nativeFs, create = false } = {}) {
	if (!safeIdentity(socket) || !safeIdentity(pane)) throw new Error("Invalid workbench origin");
	const root = join(await fs.realpath(base), `pi-orchestraitor-workbench-${uid() ?? "user"}`);
	const namespace = createHash("sha256").update(`${socket}\0${pane}`).digest("hex");
	const directory = join(root, namespace);
	if (create) { await privateDirectory(root, fs, true); await privateDirectory(directory, fs, true); }
	return { root, directory, snapshot: join(directory, "source.json"), ownership: join(directory, "ownership.json"), lock: join(directory, "operation.lock") };
}

async function checkPaths(paths, fs) {
	await privateDirectory(paths.root, fs);
	await privateDirectory(paths.directory, fs);
}
async function readPrivate(paths, path, fs) {
	await checkPaths(paths, fs);
	const file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await file.stat();
		if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || (uid() !== undefined && stat.uid !== uid()) || stat.size > MAX_SNAPSHOT_BYTES) throw new Error("Unsafe workbench file");
		// Bounded allocation even when a same-user writer grows the file after stat.
		const buffer = Buffer.alloc(MAX_SNAPSHOT_BYTES + 1);
		let length = 0;
		while (length < buffer.length) {
			const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
			if (!bytesRead) break;
			length += bytesRead;
		}
		if (length > MAX_SNAPSHOT_BYTES) throw new Error("Oversized workbench file");
		return JSON.parse(buffer.toString("utf8", 0, length));
	} finally { await file.close(); }
}
async function atomicWrite(paths, path, value, fs) {
	await checkPaths(paths, fs);
	const bytes = JSON.stringify(value);
	if (Buffer.byteLength(bytes) > MAX_SNAPSHOT_BYTES) throw new Error("Oversized workbench file");
	await fs.lstat(path).then(stat => {
		if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 || (uid() !== undefined && stat.uid !== uid())) throw new Error("Unsafe workbench destination");
	}).catch(error => { if (error.code !== "ENOENT") throw error; });
	const temporary = join(paths.directory, `${randomUUID()}.tmp`);
	try {
		const file = await fs.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
		try { await file.writeFile(bytes, "utf8"); } finally { await file.close(); }
		await fs.rename(temporary, path);
	} finally { await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}

/** Same-user cooperation, not a sandbox. Never break an ambiguous or abandoned lock. */
export async function withWorkbenchLock(paths, operation, { fs = nativeFs, waitMs = 1000 } = {}) {
	await checkPaths(paths, fs);
	const deadline = Date.now() + waitMs;
	for (;;) {
		try { await fs.mkdir(paths.lock, { mode: 0o700 }); break; }
		catch (error) {
			if (error.code !== "EEXIST") throw error;
			if (Date.now() >= deadline) throw new Error("Workbench operation busy; retry after inspecting its owner");
			await sleep(25);
		}
	}
	try { return await operation(); } finally { await fs.rmdir(paths.lock); }
}

export async function readWorkbenchSnapshot(paths, { fs = nativeFs, now = Date.now(), expected, alive: isAlive = alive } = {}) {
	try {
		const snapshot = validateWorkbenchSnapshot(await readPrivate(paths, paths.snapshot, fs));
		const source = snapshot.publisher;
		if (!(await fs.lstat(source.socket)).isSocket()) return { status: "disconnected" };
		if (expected && ["instance", "pid", "pane", "workspace", "socket", "project", "session"].some(key => expected[key] !== undefined && source[key] !== expected[key])) return { status: "disconnected" };
		if (expected && (source.sequence < expected.sequence || source.generation < expected.generation)) return { status: "error", message: "Workbench source regressed" };
		if (source.publishedAt > now + 1000) return { status: "error", message: "Workbench clock mismatch" };
		if (!isAlive(source.pid)) return { status: "disconnected" };
		return { status: now - source.publishedAt > WORKBENCH_STALE_MS ? "stale" : "live", snapshot };
	} catch (error) {
		return error.code === "ENOENT" ? { status: "disconnected" } : { status: "error", message: "Workbench data is malformed or its private storage is unsafe" };
	}
}
export async function readWorkbenchOwnership(paths, { fs = nativeFs } = {}) {
	try { return validateWorkbenchOwnership(await readPrivate(paths, paths.ownership, fs)); }
	catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}
export async function writeWorkbenchOwnership(paths, record, { fs = nativeFs } = {}) {
	await atomicWrite(paths, paths.ownership, validateWorkbenchOwnership(record), fs);
}

/** Resolves only this process's explicit Herdr origin. No UI-focus fallback or shell interpolation. */
export async function resolveWorkbenchSource(ctx, { env = process.env, fs = nativeFs, run = promisify(execFile) } = {}) {
	if (ctx.mode !== "tui" || !ctx.hasUI || env.HERDR_ENV !== "1" || ![env.HERDR_SOCKET_PATH, env.HERDR_PANE_ID, env.HERDR_WORKSPACE_ID].every(safeIdentity)) throw new Error("Workbench requires an interactive Pi terminal inside Herdr");
	const socket = await fs.realpath(env.HERDR_SOCKET_PATH);
	if (!(await fs.lstat(socket)).isSocket()) throw new Error("Workbench requires a live Herdr socket");
	const query = async args => {
		const result = await run(env.HERDR_BIN_PATH || "herdr", args, { env: { ...env, HERDR_SOCKET_PATH: socket }, timeout: 2000, maxBuffer: 262144, encoding: "utf8" });
		const response = JSON.parse(result.stdout);
		if (response.error || !response.result) throw new Error("Herdr rejected the origin lookup");
		return response.result;
	};
	const pane = (await query(["pane", "current", "--pane", env.HERDR_PANE_ID])).pane;
	const processes = (await query(["pane", "process-info", "--pane", env.HERDR_PANE_ID])).process_info;
	if (pane?.pane_id !== env.HERDR_PANE_ID || pane.workspace_id !== env.HERDR_WORKSPACE_ID || processes?.pane_id !== pane.pane_id || !processes.foreground_processes?.some(item => item.pid === process.pid)) throw new Error("Herdr cannot confirm this Pi process in its original pane");
	const cwd = await fs.realpath(ctx.cwd);
	let project = cwd;
	for (let path = cwd;; path = dirname(path)) {
		try { await fs.lstat(join(path, ".git")); project = path; break; } catch (error) { if (error.code !== "ENOENT") throw error; }
		if (dirname(path) === path) break;
	}
	return { pid: process.pid, pane: pane.pane_id, workspace: pane.workspace_id, socket, project, session: ctx.sessionManager.getSessionId(), generation: 0 };
}

/** Factory is inert: no filesystem access, timers, history reads or Herdr calls. */
export function createWorkbenchPublisher({ base = tmpdir(), fs = nativeFs, clock = Date.now, timers = nativeTimers, beforePublish = () => {}, onError = () => {} } = {}) {
	let source, paths, cached, timer, socketStamp, due = Infinity, dirty = false, writing = false, sequence = 0, lastWrite = -Infinity, lastCompletedWrite = -Infinity;
	let queue = Promise.resolve();
	const clear = () => { if (timer !== undefined) timers.clearTimeout(timer); timer = undefined; due = Infinity; };
	const report = () => { try { onError("Workbench publication failed; previous data will expire. Disable and re-enable after checking private runtime storage."); } catch { /* Reporting cannot break Pi execution. */ } };
	function schedule(delay) {
		if (!source || !cached || writing || clock() + delay >= due) return;
		clear(); due = clock() + delay;
		timer = timers.setTimeout(() => { timer = undefined; due = Infinity; dirty = true; void flush(); }, delay);
		timer?.unref?.();
	}
	function flush() {
		// Keep one active write and one latest cached update, never a snapshot backlog.
		if (writing) return queue;
		clear();
		if (!source || !cached || !dirty) return queue;
		const delay = Math.max(0, lastCompletedWrite + PUBLISH_INTERVAL_MS - clock());
		if (delay > 0) { schedule(delay); return queue; }
		try { beforePublish(); }
		catch { cached = undefined; dirty = false; report(); return queue; }
		// Refresh may coalesce an update or stop this publisher after a read error.
		clear();
		if (!source || !cached) return queue;
		const instance = source;
		const data = cached;
		const generation = instance.generation;
		dirty = false;
		writing = true;
		queue = queue.then(async () => {
			if (source !== instance) return;
			const socket = await fs.lstat(instance.socket);
			if (!socket.isSocket() || `${socket.dev}:${socket.ino}:${socket.birthtimeMs}` !== socketStamp) throw new Error("Herdr server identity changed");
			await withWorkbenchLock(paths, async () => {
				if (source !== instance) return;
				const existing = await readWorkbenchSnapshot(paths, { fs, now: clock() });
				if (existing.status === "error" || (existing.snapshot && existing.snapshot.publisher.instance !== instance.instance && alive(existing.snapshot.publisher.pid))) throw new Error("Publisher ownership changed");
				const publisher = { ...instance, generation, sequence: sequence + 1, publishedAt: clock() };
				await atomicWrite(paths, paths.snapshot, validateWorkbenchSnapshot({ version: 1, publisher, ...data }), fs);
				sequence = publisher.sequence; lastWrite = publisher.publishedAt;
				lastCompletedWrite = clock();
			}, { fs });
		}).catch(report).finally(() => {
			writing = false;
			schedule(dirty ? Math.max(0, lastCompletedWrite + PUBLISH_INTERVAL_MS - clock()) : WORKBENCH_HEARTBEAT_MS);
		});
		return queue;
	}
	async function stop() {
		const previous = source;
		const previousPaths = paths;
		source = cached = undefined; dirty = false; clear();
		await queue;
		if (!previous) return;
		try {
			await withWorkbenchLock(previousPaths, async () => {
				const value = validateWorkbenchSnapshot(await readPrivate(previousPaths, previousPaths.snapshot, fs));
				if (value.publisher.instance === previous.instance) await fs.unlink(previousPaths.snapshot);
			}, { fs });
		} catch { /* Never follow or remove an unsafe/replaced file during cleanup. */ }
		await fs.rmdir(previousPaths.directory).catch(() => {});
		await fs.rmdir(previousPaths.root).catch(() => {});
	}
	return {
		get enabled() { return !!source; },
		get paths() { return paths; },
		get identity() { return source ? { ...source, sequence, publishedAt: lastWrite } : undefined; },
		async start(identity) {
			await stop();
			const candidate = { ...identity, instance: randomUUID() };
			const socket = await fs.lstat(candidate.socket);
			if (!socket.isSocket()) throw new Error("Herdr socket unavailable");
			socketStamp = `${socket.dev}:${socket.ino}:${socket.birthtimeMs}`;
			const nextPaths = await workbenchPaths(candidate.socket, candidate.pane, { base, fs, create: true });
			const existing = await readWorkbenchSnapshot(nextPaths, { fs, now: clock() });
			if (existing.status === "error" || existing.snapshot && alive(existing.snapshot.publisher.pid)) throw new Error("Another publisher owns this origin");
			paths = nextPaths; source = candidate; sequence = 0; lastWrite = lastCompletedWrite = -Infinity;
		},
		update(data, generation = source?.generation) {
			if (!source) return false;
			try {
				if (!Number.isSafeInteger(generation) || generation < source.generation) throw new Error("Source generation regressed");
				source.generation = generation;
				const copied = structuredClone(data);
				validateWorkbenchSnapshot({ version: 1, publisher: { ...source, sequence: sequence + 1, publishedAt: clock() }, ...copied });
				cached = copied; dirty = true;
				schedule(Math.max(0, lastCompletedWrite + PUBLISH_INTERVAL_MS - clock()));
				return true;
			} catch { cached = undefined; dirty = false; clear(); report(); return false; }
		},
		flush, stop,
	};
}
