import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { writeFile, realpath, readFile } from "node:fs/promises";
import { createWorkspace, importHost, pi, hostRoot, packageRoot } from "./helpers/pi-host.mjs";
import { paths, snapshot, save, resolveAssignment, validateAssignments, validateCatalog } from "../extensions/models/store.mjs";
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
	assert.deepEqual(resolveAssignment("explore", { reasoning: "off" }, project, personal).values, { model: "a/b", reasoning: "off", mode: "sync" });
	assert.equal(resolveAssignment("explore", {}, project, personal).values.reasoning, "medium");
	assert.throws(() => resolveAssignment("implement", {}, {}, personal), /synchronous/);
	assert.throws(() => validateAssignments({ review: { reasoning: "unknown" } }), /reasoning/);
	assert.throws(() => validateCatalog({}, [], () => [], { model: "a/b" }), /unavailable/);
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

async function panelFixture(t, selects, inputs = [], confirms = []) {
	const cwd = await createWorkspace(t), files = paths(join(cwd, "personal"), cwd), notifications = [];
	const ctx = { hasUI: true, isProjectTrusted: () => true, modelRegistry: { getAvailable: () => [model], async refresh() {} }, ui: {
		async select(title, options) { const next = selects.shift(); return typeof next === "function" ? next(title, options) : next; },
		async input() { return inputs.shift(); }, async confirm() { return confirms.shift(); }, notify(...args) { notifications.push(args); } } };
	return { files, ctx, notifications, run: () => profilesPanel(ctx, files, ai.getSupportedThinkingLevels, { model: `${model.provider}/${model.id}`, reasoning: "high", mode: "sync" }) };
}

test("native panel creates, applies, duplicates, renames and deletes without deleting applied assignments", async t => {
	const pick = (_title, options) => options[0];
	const f = await panelFixture(t, ["personal", "Create profile", "explore", "reasoning", "off", "Save and apply", pick, "Duplicate", "Save and apply", pick, "Rename", "Save and apply", pick, "Delete", "Close"], ["First", "Second", "Renamed"], [true, true, true, true]);
	await f.run();
	assert.deepEqual((await snapshot(f.files.personal)).data.assignments, { explore: { reasoning: "off" } });
	assert.equal((await snapshot(f.files.profiles)).data.profiles.length, 1);
	assert.equal(f.notifications.length, 3);
});

test("cancel leaves disk unchanged and session changes invalidate editor", async t => {
	const f = await panelFixture(t, ["project", "Create profile", "Cancel", "Close"], ["Discard"]);
	await f.run(); assert.deepEqual((await snapshot(f.files.profiles)).data, {});
	let calls = 0;
	await profilesPanel(f.ctx, f.files, ai.getSupportedThinkingLevels, {}, () => ++calls < 2);
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
	await assert.rejects(pool.run([manifest(cwd, "two"), manifest(cwd, "three")], () => "", undefined, undefined, options, () => {}), /two pending/);
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
	const f = await panelFixture(t, ["personal", "Refresh catalog", "Create profile", "explore", "model", (_title, options) => { assert.ok(options.includes("new/provider")); return "new/provider"; }, "Cancel", "Close"], ["New"]);
	let models = [model]; f.ctx.modelRegistry.getAvailable = () => models;
	f.ctx.modelRegistry.refresh = async () => { models = [...models, { ...model, provider: "new", id: "provider" }]; };
	await f.run();
});

test("profile application removes old overrides and reports partial save failures", async t => {
	const f = await panelFixture(t, ["personal", "Create profile", "Save and apply", "Close"], ["Inherited"], [true]);
	await save(await snapshot(f.files.personal), { assignments: { explore: { reasoning: "low" } }, unrelated: 42 });
	await f.run(); assert.deepEqual((await snapshot(f.files.personal)).data.assignments, {}); assert.equal((await snapshot(f.files.personal)).data.unrelated, 42);
	const g = await panelFixture(t, ["personal", "Create profile", "Save and apply"], ["Partial"], [true]);
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
	const f = await panelFixture(t, ["personal", "Create profile", "Save and apply", "Close"], ["Safe personal"], [true]);
	const { mkdir } = await import("node:fs/promises");
	await mkdir(dirname(f.files.project), { recursive: true });
	await writeFile(f.files.project, "INVALID PROJECT JSON");
	f.ctx.isProjectTrusted = () => false;
	const select = f.ctx.ui.select;
	f.ctx.ui.select = async (title, options) => { if (title === "Profile scope") assert.deepEqual(options, ["personal"]); return select(title, options); };
	await f.run();
	assert.equal((await snapshot(f.files.personal)).data.lastProfile, (await snapshot(f.files.profiles)).data.profiles[0].id);
	assert.equal(await readFile(f.files.project, "utf8"), "INVALID PROJECT JSON");
});

test("project profile writes require native trust and revalidate it before saving", async t => {
	const f = await panelFixture(t, ["project"]);
	f.ctx.isProjectTrusted = () => false;
	await assert.rejects(f.run(), /native Pi project trust/);
	assert.deepEqual((await snapshot(f.files.project)).data, {});
	const g = await panelFixture(t, ["project", "Create profile", "Save and apply"], ["Revoked"], [true]);
	let trusted = true;
	g.ctx.isProjectTrusted = () => trusted;
	g.ctx.ui.confirm = async () => { trusted = false; return true; };
	await assert.rejects(g.run(), /Project trust changed/);
	assert.deepEqual((await snapshot(g.files.project)).data, {});
	assert.deepEqual((await snapshot(g.files.profiles)).data, {});
});
