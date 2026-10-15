import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { mkdir, readFile, realpath, rm, stat, utimes, writeFile } from "node:fs/promises";
import { createWorkspace, importHost, isolatedAgentDir, pi, hostRoot, packageRoot } from "./helpers/pi-host.mjs";
import { paths, snapshot, save, readConfiguration, resolveAssignment, validateAssignments, validateCatalog, validateSession } from "../extensions/models/store.mjs";
import { profilesPanel } from "../extensions/models/panel.mjs";
import { publicModel } from "../extensions/subagent/bridge.mjs";
import { BatchController } from "../extensions/subagent/controller.mjs";
import { BackgroundTasks, recoverReceipts, RECEIPT } from "../extensions/subagent/background.mjs";
const ai = await importHost("node_modules/@earendil-works/pi-ai/dist/index.js");
const model = { provider: "registered-extension", id: "fixture", api: "openai-completions", name: "Fixture", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 };
const usage = { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

test("field precedence preserves explicit off and inheritance", () => {
	const personal = { defaults: { model: "a/b", reasoning: "high", mode: "background" }, explore: { reasoning: "low" } };
	const project = { defaults: { reasoning: "medium" }, explore: { reasoning: null, mode: "sync" } };
	assert.deepEqual(resolveAssignment("explore", { reasoning: "off" }, project, personal).values, { model: "a/b", reasoning: "off", mode: "sync", timeout: 10, parallel: 5 });
	assert.equal(resolveAssignment("explore", {}, project, personal).values.reasoning, "medium");
	assert.throws(() => resolveAssignment("implement", {}, {}, personal), /synchronous/);
	assert.throws(() => validateAssignments({ review: { reasoning: "unknown" } }), /reasoning/);
	assert.throws(() => validateCatalog({}, [], () => [], { model: "a/b" }), /unavailable/);
});

test("profiles set each role's deadline and parallelism, which tasks and the parent cannot override", () => {
	const personal = { defaults: { timeout: 20, parallel: 3 }, implement: { timeout: "off", parallel: 1 } };
	const project = { review: { timeout: 5 } };
	const resolved = role => resolveAssignment(role, { timeout: 1, parallel: 10 }, project, personal, { model: "a/b", timeout: 1, parallel: 10 });
	assert.deepEqual(["explore", "review", "implement"].map(role => [resolved(role).values.timeout, resolved(role).values.parallel]), [[20, 3], [5, 3], ["off", 1]]);
	assert.deepEqual(resolved("review").sources, { model: "parent", reasoning: "default", mode: "default", timeout: "project:role", parallel: "personal:defaults" });
	assert.deepEqual(resolveAssignment("explore").values, { model: undefined, reasoning: undefined, mode: "sync", timeout: 10, parallel: 5 });
	assert.doesNotThrow(() => validateAssignments({ defaults: { timeout: 60, parallel: 10 }, explore: { timeout: "off", parallel: 1 }, review: { timeout: null, parallel: null } }));
	for (const [values, error] of [[{ timeout: 0 }, /Invalid timeout/], [{ timeout: 61 }, /Invalid timeout/], [{ timeout: 1.5 }, /Invalid timeout/], [{ timeout: "10" }, /Invalid timeout/],
		[{ parallel: 0 }, /Invalid parallel limit: use 1 to 10/], [{ parallel: 11 }, /Invalid parallel/], [{ parallel: "2" }, /Invalid parallel/]]) {
		assert.throws(() => validateAssignments({ explore: values }), error, JSON.stringify(values));
	}
});

test("atomic profile updates reject stale and concurrent snapshots without losing unrelated fields", async t => {
	const cwd = await createWorkspace(t), path = join(cwd, "config.json");
	const before = await snapshot(path);
	await save(before, { unrelated: true });
	await assert.rejects(save(before, { stale: true }), /concurrent/);
	const current = await snapshot(path);
	const attempts = await Promise.allSettled([save(current, { ...current.data, winner: 1 }), save(current, { ...current.data, winner: 2 })]);
	assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
	assert.equal((await snapshot(path)).data.unrelated, true);
});

test("a lock left by a writer that died mid-save expires while a live lock still blocks", async t => {
	const cwd = await createWorkspace(t), path = join(cwd, "config.json"), lock = `${path}.lock`;
	await writeFile(lock, "");
	await assert.rejects(save(await snapshot(path), { early: true }), /being changed/);
	const abandoned = new Date(Date.now() - 60_000);
	await utimes(lock, abandoned, abandoned);
	await save(await snapshot(path), { recovered: true });
	assert.deepEqual((await snapshot(path)).data, { recovered: true });
	await assert.rejects(stat(lock), { code: "ENOENT" });
	for (let round = 0; round < 20; round++) {
		const current = await snapshot(path);
		const attempts = await Promise.allSettled([save(current, { round, writer: 1 }), save(current, { round, writer: 2 })]);
		const saved = attempts.filter(result => result.status === "fulfilled");
		assert.equal(saved.length, 1, `round ${round}: exactly one concurrent save succeeds`);
		assert.deepEqual((await snapshot(path)).data, saved[0].value.data);
	}
});

/** Pause the store's own file-system calls to reproduce lock interleavings; restored after the test. */
function interceptFs(t, replacements) {
	const fs = createRequire(import.meta.url)("node:fs/promises");
	const real = Object.fromEntries(Object.keys(replacements).map(name => [name, fs[name]]));
	for (const [name, replace] of Object.entries(replacements)) fs[name] = (...args) => replace(real[name], ...args);
	syncBuiltinESMExports();
	t.after(() => { Object.assign(fs, real); syncBuiltinESMExports(); });
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("a writer whose lock was reclaimed as stale leaves the new owner's lock in place", async t => {
	const cwd = await createWorkspace(t), path = join(cwd, "config.json"), lock = `${path}.lock`;
	const ownerHolds = deferred(), ownerMayFinish = deferred();
	let renames = 0, owner;
	interceptFs(t, { rename: async (rename, from, to) => {
		if (to === path && ++renames === 1) {
			// The first writer stalls past the stale limit, so a second writer reclaims its lock.
			const abandoned = new Date(Date.now() - 60_000);
			await utimes(lock, abandoned, abandoned);
			owner = save(await snapshot(path), { writer: "second" });
			owner.catch(() => {});
			await ownerHolds.promise;
		} else if (to === path) { ownerHolds.resolve(); await ownerMayFinish.promise; }
		return rename(from, to);
	} });
	await save(await snapshot(path), { writer: "first" });
	assert.ok((await stat(lock)).isFile(), "the stalled writer must not remove the lock it no longer owns");
	ownerMayFinish.resolve();
	await owner;
	await assert.rejects(stat(lock), { code: "ENOENT" });
});

test("two writers reclaiming the same abandoned lock never both hold it", async t => {
	const cwd = await createWorkspace(t), path = join(cwd, "config.json"), lock = `${path}.lock`;
	await writeFile(lock, "");
	const abandoned = new Date(Date.now() - 60_000);
	await utimes(lock, abandoned, abandoned);
	const bothSawStale = deferred(), firstHolds = deferred(), otherSettled = deferred();
	let ages = 0, renames = 0;
	interceptFs(t, {
		lstat: async (lstat, target, ...rest) => {
			const result = await lstat(target, ...rest);
			if (target !== lock) return result;
			const turn = ++ages;
			// Both writers see the abandoned lock; the second acts on that view only after the first relocked.
			if (turn === 1) await bothSawStale.promise;
			if (turn === 2) { bothSawStale.resolve(); await firstHolds.promise; }
			return result;
		},
		rename: async (rename, from, to) => {
			if (to === path && ++renames === 1) { firstHolds.resolve(); await otherSettled.promise; }
			return rename(from, to);
		},
	});
	const before = await snapshot(path);
	const writers = [save(before, { writer: 1 }), save(before, { writer: 2 })];
	Promise.race(writers.map(writer => writer.then(() => {}, () => {}))).then(otherSettled.resolve);
	const attempts = await Promise.allSettled(writers);
	assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1, JSON.stringify(attempts.map(result => result.reason?.message ?? "saved")));
	assert.match(attempts.find(result => result.status === "rejected").reason.message, /being changed/);
	await assert.rejects(stat(lock), { code: "ENOENT" });
});

test("null assignments load as empty and subagent_run still resolves the parent model", async t => {
	const cwd = await realpath(await createWorkspace(t)), temporary = join(cwd, "agent"), files = paths(isolatedAgentDir, cwd);
	await mkdir(dirname(files.personal), { recursive: true });
	await writeFile(files.personal, JSON.stringify({ assignments: null }));
	t.after(() => rm(dirname(files.personal), { recursive: true, force: true }));
	assert.deepEqual((await readConfiguration(files)).personal.data.assignments, {});
	const modelRuntime = await pi.ModelRuntime.create({ authPath: join(temporary, "auth.json"), modelsPath: null, refreshOnCreate: false });
	let parentCalls = 0;
	modelRuntime.registerProvider(model.provider, { api: model.api, baseUrl: "https://example.invalid", apiKey: "fixture", models: [model],
		streamSimple(_model, context) {
			if (JSON.stringify(context.messages[0]).includes("bounded child worker")) return streamResponse("fixture child result");
			return parentCalls++ === 0 ? streamResponse([{ type: "toolCall", id: "launch", name: "subagent_run", arguments: { tasks: [{ role: "explore", instruction: "inspect" }] } }], "toolUse") : streamResponse("parent verified");
		} });
	const settingsManager = pi.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
	const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir: temporary, settingsManager, noExtensions: true, additionalExtensionPaths: [join(packageRoot, "extensions/subagents.ts")], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await resourceLoader.reload();
	const { session } = await pi.createAgentSession({ cwd, agentDir: temporary, settingsManager, resourceLoader, modelRuntime, model: (await modelRuntime.getAvailable())[0],
		tools: ["read", "subagent_run"], sessionManager: pi.SessionManager.inMemory(cwd) });
	t.after(() => session.dispose());
	await session.bindExtensions({ mode: "print", onError: error => assert.fail(String(error)) });
	await session.prompt("Delegate the fixture");
	const launch = session.sessionManager.getEntries().find(entry => entry.type === "message" && entry.message.toolCallId === "launch").message;
	assert.equal(launch.isError, false, launch.content[0].text);
	assert.equal(launch.details.results[0].status, "completed");
	assert.equal(launch.details.results[0].model, `${model.provider}/${model.id}`);
});

async function panelFixture(t, selects, inputs = [], confirms = [], ui = {}) {
	const cwd = await createWorkspace(t), files = paths(join(cwd, "personal"), cwd), notifications = [], confirmations = [];
	const ctx = { hasUI: true, isProjectTrusted: () => true, modelRegistry: { getAvailable: () => [model], async refresh() {} }, ui: {
		async select(title, options) { const next = selects.shift(); return typeof next === "function" ? next(title, options) : next; },
		async input() { return inputs.shift(); }, async confirm(title, message) { confirmations.push([title, message]); return confirms.shift(); }, notify(...args) { notifications.push(args); } } };
	return { files, ctx, notifications, confirmations, run: () => profilesPanel(ctx, files, ai.getSupportedThinkingLevels, { model: `${model.provider}/${model.id}`, reasoning: "high", mode: "sync" }, undefined, ui) };
}
/** Selects the editor row of a role, whose label carries its current values. */
const row = role => (_title, options) => options.find(option => option.replace("★", "").trim().startsWith(role)) ?? assert.fail(`No ${role} row`);
const scopeToggle = (_title, options) => options.find(option => option.startsWith("Scope:")) ?? assert.fail("No scope toggle");

test("native panel creates, applies, duplicates, renames and deletes without deleting applied assignments", async t => {
	const pick = (_title, options) => options[0];
	const f = await panelFixture(t, ["Create profile", row("explore"), "inherit", "off", "inherit", "no limit", "max 2", "Save and apply", pick, "Duplicate", "Save and apply", pick, "Rename", "Save and apply", pick, "Delete", "Close"], ["First", "Second", "Renamed"], [true, true, true, true]);
	await f.run();
	assert.deepEqual((await snapshot(f.files.personal)).data.assignments, { explore: { reasoning: "off", timeout: "off", parallel: 2 } });
	assert.equal((await snapshot(f.files.profiles)).data.profiles.length, 1);
	assert.equal(f.notifications.length, 3);
});

test("cancel leaves disk unchanged and session changes invalidate editor", async t => {
	const f = await panelFixture(t, [scopeToggle, "Create profile", "Cancel", "Close"], ["Discard"]);
	await f.run(); assert.deepEqual((await snapshot(f.files.profiles)).data, {});
	let calls = 0;
	await assert.rejects(profilesPanel(f.ctx, f.files, ai.getSupportedThinkingLevels, {}, () => ++calls < 2), /Session changed/);
	assert.deepEqual((await snapshot(f.files.project)).data, {});
});

function streamResponse(text, stopReason = "stop") {
	const stream = ai.createAssistantMessageEventStream();
	const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason, usage, content: typeof text === "string" ? [{ type: "text", text }] : text };
	stream.push({ type: "done", reason: stopReason, message }); stream.end(message); return stream;
}
function manifest(cwd, id = "bridge") { return { id, cwd, role: "explore", instruction: "inspect", files: [], skills: [], contextFiles: [], model: `${model.provider}/${model.id}`, bridgeModel: publicModel(model), reasoning: "high", tools: ["read", "search", "list"] }; }

test("real child uses parent-only provider, guarded tools and finalized native usage", async t => {
	const cwd = await realpath(await createWorkspace(t)); await writeFile(join(cwd, "target.txt"), "BRIDGE_EVIDENCE");
	let calls = 0, observed;
	const registry = { streamSimple(actual, context, options) {
		assert.equal(actual, model); assert.equal(options.reasoning, "high"); observed = context;
		return calls++ === 0 ? streamResponse([{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "target.txt" } }], "toolUse") : streamResponse("Verified fixture target.txt");
	} };
	const controller = new BatchController({ sdkRoot: hostRoot, registry, modelFor: () => model, stopGrace: 50 });
	const [result] = await controller.run([manifest(cwd)], () => "Read target.txt");
	assert.equal(result.status, "completed", result.diagnostic);
	assert.equal(calls, 2); assert.match(JSON.stringify(observed), /BRIDGE_EVIDENCE/);
	assert.equal(result.usage.totalTokens, 10); assert.equal(result.usageComplete, true);
});

test("background capacity includes completed uncollected readers and receipts account once", async t => {
	const cwd = await createWorkspace(t), pool = new BackgroundTasks(), receipts = [];
	const options = { sdkRoot: hostRoot, registry: { streamSimple: () => streamResponse("done") }, modelFor: () => model, stopGrace: 50 };
	const first = { ...manifest(cwd, "one"), mode: "background" };
	const batch = await pool.run([first], () => "inspect", undefined, undefined, options, data => receipts.push({ type: "custom", customType: RECEIPT, data }));
	assert.deepEqual(batch.pending, ["one"]); assert.deepEqual(batch.results, []);
	await pool.wait();
	await assert.rejects(pool.run(Array.from({ length: 10 }, (_, index) => manifest(cwd, `next-${index}`)), () => "", undefined, undefined, options, () => {}), /At most 10 pending/);
	await assert.rejects(pool.run([{ ...manifest(cwd, "writer"), role: "implement", files: ["target"] }], () => "", undefined, undefined, options, () => {}), /Collect pending/);
	const results = pool.collect(); assert.equal(results[0].status, "completed", results[0].diagnostic);
	assert.deepEqual(pool.collect(), []); assert.equal(recoverReceipts(receipts).size, 1);
	assert.equal(recoverReceipts([...receipts, { type: "message", message: { role: "toolResult", details: { results } } }]).size, 0);
});

test("mixed background and sync readers share capacity and cancellation reaches the parent provider", { timeout: 15000 }, async t => {
	const cwd = await realpath(await createWorkspace(t)), pool = new BackgroundTasks();
	let cancelled = 0, started;
	const providerStarted = new Promise(resolve => { started = resolve; });
	const options = { sdkRoot: hostRoot, modelFor: () => model, stopGrace: 50, registry: { streamSimple(_model, _ctx, options) {
		const stream = ai.createAssistantMessageEventStream();
		started();
		options.signal.addEventListener("abort", () => { cancelled++; stream.end(); }, { once: true }); return stream;
	} } };
	await pool.run([{ ...manifest(cwd, "cancel-me"), mode: "background" }], () => "inspect", undefined, undefined, options, () => {});
	await providerStarted;
	await pool.cancel();
	const results = pool.collect();
	assert.equal(results[0].status, "cancelled"); assert.equal(results[0].terminated, true); assert.equal(cancelled, 1);
	const immediate = { ...options, registry: { streamSimple: () => streamResponse("done") } };
	const batch = await pool.run([{ ...manifest(cwd, "bg"), mode: "background" }, { ...manifest(cwd, "sync"), mode: "sync" }], () => "inspect", undefined, undefined, immediate, () => {});
	assert.equal(batch.results.length, 1); assert.deepEqual(batch.pending, ["bg"]);
	await pool.wait(); assert.equal(pool.collect().length, 1);
});

test("catalog refresh exposes new models and incompatible explicit efforts are rejected", async t => {
	const supported = ai.getSupportedThinkingLevels;
	const noThinking = { ...model, reasoning: false };
	assert.throws(() => validateCatalog({ review: { reasoning: "high" } }, [noThinking], supported, { model: `${model.provider}/${model.id}`, reasoning: "off" }, { review: { reasoning: "high" } }), /Unsupported/);
	const maxModel = { ...model, thinkingLevelMap: { off: "none", high: "high", max: "max" } };
	assert.ok(supported(maxModel).includes("max"));
	const f = await panelFixture(t, ["Refresh catalog", "Create profile", row("explore"), (_title, options) => { assert.ok(options.includes("new/provider")); return "new/provider"; }, "inherit", "inherit", "Cancel", "Close"], ["New"]);
	let models = [model]; f.ctx.modelRegistry.getAvailable = () => models;
	f.ctx.modelRegistry.refresh = async () => { models = [...models, { ...model, provider: "new", id: "provider" }]; };
	await f.run();
});

test("profile application removes old overrides and reports partial save failures", async t => {
	const f = await panelFixture(t, ["Create profile", "Save and apply", "Close"], ["Inherited"], [true]);
	await save(await snapshot(f.files.personal), { assignments: { explore: { reasoning: "low" } }, unrelated: 42 });
	await f.run(); assert.deepEqual((await snapshot(f.files.personal)).data.assignments, {}); assert.equal((await snapshot(f.files.personal)).data.unrelated, 42);
	const g = await panelFixture(t, ["Create profile", "Save and apply"], ["Partial"], [true]);
	g.ctx.ui.confirm = async () => { await writeFile(`${g.files.personal}.lock`, "locked"); return true; };
	// The personal directory is shared with profiles; prepare it without creating config.
	await save(await snapshot(g.files.profiles), { profiles: [] });
	await assert.rejects(g.run(), /Profile saved; configuration NOT applied/);
	assert.equal((await snapshot(g.files.profiles)).data.profiles[0].name, "Partial");
	assert.deepEqual((await snapshot(g.files.personal)).data, {});
});

for (const mode of ["tui", "print", "rpc"]) test(`native ${mode} session collects background results before settlement and counts usage once`, async t => {
	const cwd = await realpath(await createWorkspace(t)), temporary = join(cwd, "agent");
	const modelRuntime = await pi.ModelRuntime.create({ authPath: join(temporary, "auth.json"), modelsPath: null, refreshOnCreate: false });
	let parentCalls = 0, childCalls = 0;
	modelRuntime.registerProvider(model.provider, { api: model.api, baseUrl: "https://example.invalid", apiKey: "fixture", models: [model],
		streamSimple(_model, context) {
			const child = JSON.stringify(context.messages[0]).includes("bounded child worker");
			if (child) { childCalls++; return streamResponse("fixture child result"); }
			const count = parentCalls++;
			if (count === 0) return streamResponse([{ type: "toolCall", id: "launch", name: "subagent_run", arguments: { tasks: [{ role: "explore", instruction: "inspect", mode: "background" }] } }], "toolUse");
			if (count === 1) return streamResponse("parent finished initial work");
			if (count === 2) return streamResponse([{ type: "toolCall", id: "collect", name: "subagent_collect", arguments: { action: "wait" } }], "toolUse");
			return streamResponse("parent verified and finished");
		} });
	const settingsManager = pi.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
	const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir: temporary, settingsManager, noExtensions: true, additionalExtensionPaths: [join(packageRoot, "extensions/subagents.ts")], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await resourceLoader.reload();
	const { session } = await pi.createAgentSession({ cwd, agentDir: temporary, settingsManager, resourceLoader, modelRuntime, model: (await modelRuntime.getAvailable())[0],
		tools: ["read", "subagent_run", "subagent_collect"], sessionManager: pi.SessionManager.create(cwd, join(temporary, "sessions")) });
	t.after(() => session.dispose());
	await session.bindExtensions({ mode, onError: error => assert.fail(String(error)) });
	await session.prompt("Delegate and collect the fixture");
	const entries = (await readFile(session.sessionFile, "utf8")).trim().split("\n").map(JSON.parse);
	assert.equal(childCalls, 1); assert.equal(parentCalls, 4);
	const result = entries.find(entry => entry.type === "message" && entry.message.toolName === "subagent_collect");
	assert.equal(result.message.usage.totalTokens, 5);
	assert.equal(result.message.details.results.length, 1);
	assert.equal(recoverReceipts(entries).size, 0);
	assert.equal(session.getSessionStats().tokens.total, 25);
});

test("oversized provider events fail closed and preserve confirmed child termination", async t => {
	const cwd = await realpath(await createWorkspace(t));
	const controller = new BatchController({ sdkRoot: hostRoot, modelFor: () => model, stopGrace: 50, registry: { streamSimple: () => streamResponse("x".repeat(1024 * 1024)) } });
	const [result] = await controller.run([manifest(cwd)], () => "inspect");
	assert.equal(result.status, "failed"); assert.equal(result.terminated, true); assert.equal(result.usageComplete, false);
	assert.match(result.diagnostic, /stream limit/);
});


test("untrusted profile panel exposes only personal scope and ignores malformed project assignments", async t => {
	const f = await panelFixture(t, ["Create profile", "Save and apply", "Close"], ["Safe personal"], [true]);
	const { mkdir } = await import("node:fs/promises");
	await mkdir(dirname(f.files.project), { recursive: true });
	await writeFile(f.files.project, "INVALID PROJECT JSON");
	f.ctx.isProjectTrusted = () => false;
	const select = f.ctx.ui.select;
	f.ctx.ui.select = async (title, options) => { if (title.startsWith("Models profiles")) assert.ok(!options.some(option => option.startsWith("Scope:")), "untrusted projects offer no scope toggle"); return select(title, options); };
	await f.run();
	assert.equal((await snapshot(f.files.personal)).data.lastProfile, (await snapshot(f.files.profiles)).data.profiles[0].id);
	assert.equal(await readFile(f.files.project, "utf8"), "INVALID PROJECT JSON");
});

test("project profile writes require native trust and revalidate it before saving", async t => {
	const f = await panelFixture(t, ["Scope: personal → project", "Close"]);
	f.ctx.isProjectTrusted = () => false;
	await f.run();
	assert.deepEqual((await snapshot(f.files.project)).data, {});
	const g = await panelFixture(t, [scopeToggle, "Create profile", "Save and apply"], ["Revoked"], [true]);
	let trusted = true;
	g.ctx.isProjectTrusted = () => trusted;
	g.ctx.ui.confirm = async () => { trusted = false; return true; };
	await assert.rejects(g.run(), /Project trust changed/);
	assert.deepEqual((await snapshot(g.files.project)).data, {});
	assert.deepEqual((await snapshot(g.files.profiles)).data, {});
});

test("a profile stores the main session model and applies it with its roles", async t => {
	const other = { ...model, id: "fixture-2" }, sessions = [];
	const f = await panelFixture(t, ["Create profile", row("session"), `${other.provider}/${other.id}`, "low", row("review"), "inherit", "inherit", "background", "inherit", "inherit", "Save and apply", "Close"], ["Deep work"], [true],
		{ async applySession(session) { sessions.push(session); } });
	f.ctx.modelRegistry.getAvailable = () => [model, other];
	await f.run();
	assert.deepEqual(sessions, [{ model: "registered-extension/fixture-2", reasoning: "low" }]);
	const [profile] = (await snapshot(f.files.profiles)).data.profiles;
	assert.deepEqual(profile.session, { model: "registered-extension/fixture-2", reasoning: "low" });
	assert.deepEqual((await snapshot(f.files.personal)).data.assignments, { review: { mode: "background" } });
	// The confirmation lists only what changes, session first.
	assert.match(f.confirmations[0][1], /★ session model: registered-extension\/fixture → registered-extension\/fixture-2/);
	assert.match(f.confirmations[0][1], /review .*mode: sync → background/);
	// Roles that inherit the parent follow the new session model.
	assert.match(f.confirmations[0][1], /explore model: registered-extension\/fixture → registered-extension\/fixture-2/);
	assert.match(f.notifications.at(-1)[0], /session → registered-extension\/fixture-2 · low/);
});

test("the editor shows unsaved changes and keeping the session model leaves it untouched", async t => {
	const titles = [];
	const sessions = [];
	const f = await panelFixture(t, ["Create profile", row("explore"), "inherit", "low", "inherit", "inherit", "inherit", (title, options) => { titles.push(title); return "Save and apply"; }, "Close"], ["Readers"], [true],
		{ async applySession(session) { sessions.push(session); } });
	await f.run();
	assert.match(titles[0], /Profile: Readers · personal · 2 unsaved changes/);
	assert.deepEqual(sessions, [], "a profile without a session model keeps the current one");
	assert.equal((await snapshot(f.files.profiles)).data.profiles[0].session, undefined);
});

test("session model failures report that roles were applied", async t => {
	const f = await panelFixture(t, ["Create profile", row("session"), "keep current", "low", "Save and apply"], ["No session"], [true]);
	await assert.rejects(f.run(), /Subagent roles applied; this client cannot change the session model/);
	const g = await panelFixture(t, ["Create profile", row("session"), "keep current", "low", "Save and apply"], ["Broken"], [true],
		{ async applySession() { throw new Error("no credentials"); } });
	await assert.rejects(g.run(), /session model NOT changed: no credentials/);
	assert.ok((await snapshot(g.files.personal)).data.lastProfile);
});

test("session assignments are validated against the catalog", () => {
	const supported = ai.getSupportedThinkingLevels, id = `${model.provider}/${model.id}`;
	assert.doesNotThrow(() => validateSession(undefined, [model], supported));
	assert.doesNotThrow(() => validateSession({ model: id, reasoning: "high" }, [model], supported));
	assert.throws(() => validateSession({ model: "gone/model" }, [model], supported), /unavailable for session/);
	assert.throws(() => validateSession({ reasoning: "high" }, [{ ...model, reasoning: false }], supported, { model: id }), /Unsupported effort for session/);
	assert.throws(() => validateSession({ mode: "background" }, [model], supported), /Invalid session/);
});

test("applying a profile switches the real session model and thinking level", async t => {
	const cwd = await realpath(await createWorkspace(t)), temporary = join(cwd, "agent");
	const other = { ...model, id: "fixture-2", name: "Fixture 2" };
	const modelRuntime = await pi.ModelRuntime.create({ authPath: join(temporary, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerProvider(model.provider, { api: model.api, baseUrl: "https://example.invalid", apiKey: "fixture", models: [model, other], streamSimple: () => streamResponse("unused") });
	const settingsManager = pi.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
	const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir: temporary, settingsManager, noExtensions: true, additionalExtensionPaths: [join(packageRoot, "extensions/subagents.ts")], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await resourceLoader.reload();
	const available = await modelRuntime.getAvailable();
	const { session } = await pi.createAgentSession({ cwd, agentDir: temporary, settingsManager, resourceLoader, modelRuntime, model: available.find(item => item.id === model.id),
		tools: ["read"], sessionManager: pi.SessionManager.inMemory(cwd) });
	t.after(() => session.dispose());
	await session.bindExtensions({ mode: "print", onError: error => assert.fail(String(error)) });
	const ctx = session.extensionRunner.createCommandContext();
	const selects = ["Create profile", row("session"), `${other.provider}/${other.id}`, "low", "Save and apply", "Close"], errors = [];
	await session.extensionRunner.getCommand("models-profiles").handler("", { ...ctx, hasUI: true, isProjectTrusted: () => false, ui: { ...ctx.ui,
		async select(title, options) { const next = selects.shift(); return typeof next === "function" ? next(title, options) : next; },
		async input() { return "Switch"; }, async confirm() { return true; }, notify(message, level) { if (level === "error") errors.push(message); } } });
	assert.deepEqual(errors, []); assert.equal(selects.length, 0);
	assert.equal(session.model.id, "fixture-2");
	assert.equal(session.thinkingLevel, "low");
});
