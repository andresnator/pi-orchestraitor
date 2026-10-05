import assert from "node:assert/strict";
import { mkdtemp, chmod, lstat, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createWorkbenchPublisher, readWorkbenchSnapshot, withWorkbenchLock, writeWorkbenchOwnership, readWorkbenchOwnership } from "../extensions/ui/workbench-bridge.mjs";
import { projectSessionUsage } from "../extensions/ui/workbench-usage.mjs";

const data = () => ({ tasks: { revision: 0, rows: [], bindingCurrent: true }, agents: { live: [], recent: [], launchBlocked: false, historyLimited: false, nestedHistoryUnavailable: false }, usage: projectSessionUsage([]) });
async function fixture(t, options = {}) {
	const base = await mkdtemp(join(tmpdir(), "workbench-bridge-"));
	t.after(() => rm(base, { recursive: true, force: true }));
	const publisher = createWorkbenchPublisher({ base, ...options });
	t.after(() => publisher.stop());
	const socket = join(base, "server.sock");
	const server = createServer();
	await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socket, resolve); });
	t.after(() => new Promise(resolve => server.close(resolve)));
	const source = { pid: process.pid, pane: "origin", workspace: "workspace", socket, project: base, session: "session", generation: 1 };
	return { base, publisher, source };
}

test("shouldAllocateNothingUntilExplicitPublisherStart", async (t) => {
	// Given / When
	const { base, publisher } = await fixture(t, { timers: { setTimeout() { assert.fail("Unexpected timer"); }, clearTimeout() {} } });
	publisher.update(data());
	await publisher.stop();
	// Then
	assert.deepEqual(await readdir(base), ["server.sock"]);
	assert.equal(publisher.enabled, false);
});

test("shouldPublishPrivateAtomicValidatedSnapshotsAndRemoveOnlyOwnedArtifacts", async (t) => {
	// Given
	const { publisher, source } = await fixture(t);
	await publisher.start(source);
	// When
	publisher.update(data());
	await publisher.flush();
	const result = await readWorkbenchSnapshot(publisher.paths);
	// Then
	assert.equal(result.status, "live");
	assert.equal((await lstat(publisher.paths.directory)).mode & 0o777, 0o700);
	assert.equal((await lstat(publisher.paths.snapshot)).mode & 0o777, 0o600);
	assert.equal(result.snapshot.publisher.instance, publisher.identity.instance);
	assert.deepEqual(result.snapshot.usage.total, data().usage.total);
	const paths = publisher.paths;
	await writeFile(join(paths.directory, "foreign"), "untouched");
	await publisher.stop(); await publisher.stop();
	assert.equal((await readWorkbenchSnapshot(paths)).status, "disconnected");
	assert.equal(await readFile(join(paths.directory, "foreign"), "utf8"), "untouched");
});

test("shouldRejectStaleRegressingAndChangedSourcesWithoutFollowingThem", async (t) => {
	// Given
	let now = 10000;
	const { publisher, source } = await fixture(t, { clock: () => now });
	await publisher.start(source); publisher.update(data()); await publisher.flush();
	const first = await readWorkbenchSnapshot(publisher.paths, { now });
	// When / Then
	assert.equal((await readWorkbenchSnapshot(publisher.paths, { now: now + 10000 })).status, "stale");
	assert.equal((await readWorkbenchSnapshot(publisher.paths, { now, expected: { ...first.snapshot.publisher, instance: "different" } })).status, "disconnected");
	assert.equal((await readWorkbenchSnapshot(publisher.paths, { now, expected: { ...first.snapshot.publisher, sequence: 50 } })).status, "error");
	assert.equal((await readWorkbenchSnapshot(publisher.paths, { now, alive: () => false })).status, "disconnected");
});

test("shouldCoalesceUpdatesAndHeartbeatCachedDataWithoutReadingHistory", async (t) => {
	// Given
	let now = 10000;
	const scheduled = new Map(); let id = 0;
	const timers = { setTimeout(callback, delay) { const token = ++id; scheduled.set(token, { callback, at: now + delay }); return token; }, clearTimeout(token) { scheduled.delete(token); } };
	const { publisher, source } = await fixture(t, { clock: () => now, timers });
	await publisher.start(source);
	for (let i = 0; i < 100; i++) publisher.update({ ...data(), tasks: { ...data().tasks, revision: i } });
	// When
	await publisher.flush();
	const first = await readWorkbenchSnapshot(publisher.paths, { now });
	now += 2000;
	for (const [key, timer] of [...scheduled]) if (timer.at <= now) { scheduled.delete(key); timer.callback(); }
	await publisher.flush();
	const second = await readWorkbenchSnapshot(publisher.paths, { now });
	// Then
	assert.equal(first.snapshot.tasks.revision, 99);
	assert.equal(first.snapshot.publisher.sequence, 1);
	assert.equal(second.snapshot.publisher.sequence, 2);
	assert.equal(second.snapshot.publisher.publishedAt, now);
	await publisher.stop();
	assert.equal(scheduled.size, 0);
});

test("shouldCoalesceUpdatesDuringDelayedWritesAndRespectTheIntervalAfterCompletion", async (t) => {
	// Given: hold the first atomic rename while eight native updates arrive.
	const fs = await import("node:fs/promises");
	let now = 10000, release, entered;
	const held = new Promise(resolve => { release = resolve; });
	const writing = new Promise(resolve => { entered = resolve; });
	const writes = [], scheduled = new Map(); let id = 0;
	const timers = { setTimeout(callback, delay) { const token = ++id; scheduled.set(token, { callback, at: now + delay }); return token; }, clearTimeout(token) { scheduled.delete(token); } };
	const tick = milliseconds => {
		now += milliseconds;
		for (const [key, timer] of [...scheduled]) if (timer.at <= now) { scheduled.delete(key); timer.callback(); }
	};
	const { publisher, source } = await fixture(t, { clock: () => now, timers, fs: { ...fs, async rename(from, to) {
		if (!writes.length) { entered(); await held; }
		await fs.rename(from, to);
		writes.push({ at: now, revision: JSON.parse(await fs.readFile(to, "utf8")).tasks.revision });
	} } });
	try {
		await publisher.start(source); publisher.update(data());
		const first = publisher.flush(); await writing;
		const pending = [];
		for (let revision = 1; revision <= 8; revision++) {
			publisher.update({ ...data(), tasks: { ...data().tasks, revision } });
			tick(30); pending.push(publisher.flush());
		}
		// When
		release(); await Promise.all([first, ...pending]);
		// Then: only the active snapshot writes now; newer data waits 200 ms.
		assert.deepEqual(writes, [{ at: now, revision: 0 }]);
		assert.equal(scheduled.size, 1);
		assert.equal([...scheduled.values()][0].at, now + 200);
		tick(199); await publisher.flush();
		assert.equal(writes.length, 1);
		tick(1); await publisher.flush();
		assert.deepEqual(writes.map(write => write.revision), [0, 8]);
		assert.equal(writes[1].at - writes[0].at, 200);
		assert.equal((await readWorkbenchSnapshot(publisher.paths, { now })).snapshot.publisher.sequence, 2);
		// Explicit flushes also respect the limit while no write is active.
		publisher.update({ ...data(), tasks: { ...data().tasks, revision: 9 } });
		await publisher.flush(); assert.equal(writes.length, 2);
		tick(200); await publisher.flush();
		assert.deepEqual(writes.map(write => write.revision), [0, 8, 9]);
		assert.equal(writes[2].at - writes[1].at, 200);
	} finally { release(); }
});

test("shouldDiscardCoalescedUpdatesWhenStoppedDuringAnActiveWrite", async (t) => {
	// Given
	const fs = await import("node:fs/promises"); let release, entered, writes = 0;
	const held = new Promise(resolve => { release = resolve; });
	const writing = new Promise(resolve => { entered = resolve; });
	const scheduled = new Map(); let id = 0;
	const timers = { setTimeout(callback) { const token = ++id; scheduled.set(token, callback); return token; }, clearTimeout(token) { scheduled.delete(token); } };
	const { publisher, source } = await fixture(t, { timers, fs: { ...fs, async rename(...args) {
		entered(); await held; await fs.rename(...args); writes++;
	} } });
	try {
		await publisher.start(source); publisher.update(data());
		const first = publisher.flush(); await writing;
		publisher.update({ ...data(), tasks: { ...data().tasks, revision: 1 } });
		const pending = publisher.flush(), paths = publisher.paths;
		// When
		const stopped = publisher.stop(); release(); await Promise.all([first, pending, stopped]);
		// Then
		assert.equal(writes, 1);
		assert.equal(scheduled.size, 0);
		assert.equal(publisher.enabled, false);
		assert.equal((await readWorkbenchSnapshot(paths)).status, "disconnected");
	} finally { release(); }
});

test("shouldRefreshIdleDataBeforeHeartbeatWithoutSchedulingExtraWrites", async (t) => {
	// Given
	let now = 10000, reading = data(), publisher;
	const scheduled = new Map(); let id = 0;
	const timers = { setTimeout(callback, delay) { const token = ++id; scheduled.set(token, { callback, at: now + delay }); return token; }, clearTimeout(token) { scheduled.delete(token); } };
	const fixtureData = await fixture(t, { clock: () => now, timers, beforePublish: () => publisher.update(reading) });
	publisher = fixtureData.publisher;
	await publisher.start(fixtureData.source); publisher.update(reading); await publisher.flush();
	// When: only the timer runs after native idle usage changes.
	reading = { ...data(), usage: projectSessionUsage([{ type: "usage", id: "idle", provider: "openai-codex", model: "idle-model", usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 4, totalTokens: 104 } }]) };
	now += 2000;
	for (const [key, timer] of [...scheduled]) if (timer.at <= now) { scheduled.delete(key); timer.callback(); }
	await publisher.flush();
	// Then
	const result = await readWorkbenchSnapshot(publisher.paths, { now });
	assert.equal(result.status, "live");
	assert.equal(result.snapshot.publisher.sequence, 2);
	assert.equal(result.snapshot.usage.total.total, 104);
	assert.equal(scheduled.size, 1);
	assert.equal([...scheduled.values()][0].at, now + 2000);
});

test("shouldLetPreviousDataExpireWhenHeartbeatRefreshFails", async (t) => {
	// Given
	let now = 10000, fail = false, errors = 0;
	const scheduled = new Map(); let id = 0;
	const timers = { setTimeout(callback, delay) { const token = ++id; scheduled.set(token, { callback, at: now + delay }); return token; }, clearTimeout(token) { scheduled.delete(token); } };
	const { publisher, source } = await fixture(t, { clock: () => now, timers,
		beforePublish: () => { if (fail) throw new Error("Native receipts unavailable"); }, onError: () => { errors++; } });
	await publisher.start(source); publisher.update(data()); await publisher.flush();
	// When
	fail = true; now += 2000;
	for (const [key, timer] of [...scheduled]) if (timer.at <= now) { scheduled.delete(key); timer.callback(); }
	await publisher.flush();
	// Then
	assert.equal(errors, 1);
	assert.equal(scheduled.size, 0);
	const result = await readWorkbenchSnapshot(publisher.paths, { now: now + 6000 });
	assert.equal(result.status, "stale");
	assert.equal(result.snapshot.publisher.sequence, 1);
});

test("shouldFailClosedOnSymlinksPermissionsMalformedAndOversizedFiles", async (t) => {
	// Given
	const { publisher, source, base } = await fixture(t);
	await publisher.start(source); publisher.update(data()); await publisher.flush();
	const { paths } = publisher;
	// When / Then
	await chmod(paths.snapshot, 0o644);
	assert.equal((await readWorkbenchSnapshot(paths)).status, "error");
	await chmod(paths.snapshot, 0o600);
	await writeFile(paths.snapshot, "{broken");
	assert.equal((await readWorkbenchSnapshot(paths)).status, "error");
	await writeFile(paths.snapshot, "x".repeat(2097153));
	assert.equal((await readWorkbenchSnapshot(paths)).status, "error");
	await rm(paths.snapshot);
	const foreign = join(base, "foreign"); await writeFile(foreign, "private");
	await symlink(foreign, paths.snapshot);
	assert.equal((await readWorkbenchSnapshot(paths)).status, "error");
	await publisher.stop();
	assert.equal(await readFile(foreign, "utf8"), "private");
});

test("shouldIsolateOriginsAndSerializeBoundedOwnershipUpdates", async (t) => {
	// Given
	const { base, publisher, source } = await fixture(t);
	const other = createWorkbenchPublisher({ base }); t.after(() => other.stop());
	await publisher.start(source); publisher.update(data()); await publisher.flush();
	await other.start({ ...source, pane: "other" }); other.update(data()); await other.flush();
	const record = { version: 1, source: publisher.identity, companion: { pane: "companion", workspace: source.workspace, tab: "tab", terminal: "terminal", pid: process.pid, plugin: "pi.orchestraitor", entrypoint: "workbench", token: "token" }, createdAt: Date.now() };
	// When
	await withWorkbenchLock(publisher.paths, async () => {
		await assert.rejects(withWorkbenchLock(publisher.paths, async () => {}, { waitMs: 0 }), /busy/);
		await writeWorkbenchOwnership(publisher.paths, record);
	});
	// Then
	assert.notEqual(publisher.paths.directory, other.paths.directory);
	assert.deepEqual(await readWorkbenchOwnership(publisher.paths), record);
	await publisher.stop();
	assert.equal((await readWorkbenchSnapshot(other.paths)).status, "live");
});

test("shouldStopRefreshingAnOldSourceWhenItsHerdrSocketIsReplaced", async (t) => {
	// Given
	let now = 10000;
	const { publisher, source } = await fixture(t, { clock: () => now });
	await publisher.start(source); publisher.update(data()); await publisher.flush();
	const sequence = publisher.identity.sequence;
	await rm(source.socket); await writeFile(source.socket, "not a server");
	// When
	now += 200;
	publisher.update(data()); await publisher.flush();
	// Then
	assert.equal(publisher.identity.sequence, sequence);
	assert.equal((await readWorkbenchSnapshot(publisher.paths)).status, "disconnected");
});

test("shouldKeepLastValidSnapshotWhenAtomicReplacementFails", async (t) => {
	// Given
	const fs = await import("node:fs/promises"); let fail = false, now = 10000; const errors = [];
	const { publisher, source } = await fixture(t, { clock: () => now, fs: { ...fs, rename: (...args) => fail ? Promise.reject(new Error("synthetic rename failure")) : fs.rename(...args) }, onError: message => errors.push(message) });
	await publisher.start(source); publisher.update(data()); await publisher.flush();
	const first = await readWorkbenchSnapshot(publisher.paths);
	// When
	now += 200;
	fail = true; publisher.update({ ...data(), tasks: { ...data().tasks, revision: 1 } }); await publisher.flush();
	// Then
	assert.equal((await readWorkbenchSnapshot(publisher.paths)).snapshot.publisher.sequence, first.snapshot.publisher.sequence);
	assert.equal(errors.length, 1);
	assert.deepEqual((await readdir(publisher.paths.directory)).filter(name => name.endsWith(".tmp")), []);
});
