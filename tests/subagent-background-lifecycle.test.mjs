import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createWorkspace, importHost, packageRoot, pi } from "./helpers/pi-host.mjs";
import { fakeUIContext } from "./helpers/ui-harness.mjs";
import { RECEIPT } from "../extensions/subagent/background.mjs";
const { createAssistantMessageEventStream } = await importHost("node_modules/@earendil-works/pi-ai/dist/index.js");
const PROGRESS_EVENT = "orchestraitor:subagent-progress";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function within(promise, label, ms = 5000) {
	let timer;
	try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms); })]); }
	finally { clearTimeout(timer); }
}
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const fixtureModel = { id: "model", name: "Local fixture", reasoning: false, input: ["text"], cost: usage.cost, contextWindow: 8192, maxTokens: 1024 };
function finish(stream, model, content, stopReason = "stop") {
	const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason, usage, content: typeof content === "string" ? [{ type: "text", text: content }] : content };
	stream.push(stopReason === "aborted" ? { type: "error", reason: "aborted", error: message } : { type: "done", reason: stopReason, message }); stream.end(message);
}
async function fixture(t, { abortAtBoundary = false } = {}) {
	const cwd = await realpath(await createWorkspace(t)), agentDir = join(cwd, "agent");
	const childStarted = deferred(), collectedStarted = deferred(), launchReturned = deferred(), providerAborted = deferred(), childComplete = deferred();
	let childStream, childModel, parentCalls = 0, abortSession;
	const events = [], nativeUpdates = [], errors = [];
	const eventBus = pi.createEventBus(); eventBus.on(PROGRESS_EVENT, event => { events.push(event); if (event.tasks.some(task => task.phase === "completed")) childComplete.resolve(); });
	const modelRuntime = await pi.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerProvider("lifecycle-fixture", { api: "openai-completions", apiKey: "local", baseUrl: "https://example.invalid", models: [fixtureModel], streamSimple(model, context, options) {
		const stream = createAssistantMessageEventStream();
		if (JSON.stringify(context.messages[0]).includes("bounded child worker")) {
			childStream = stream; childModel = model; childStarted.resolve();
			options.signal.addEventListener("abort", () => { providerAborted.resolve(); finish(stream, model, "", "aborted"); }, { once: true });
			return stream;
		}
		const count = parentCalls++;
		if (count === 0) finish(stream, model, [{ type: "toolCall", id: "launch", name: "subagent_run", arguments: { tasks: [{ role: "explore", instruction: "inspect", mode: "background" }] } }], "toolUse");
		else if (count === 1) {
			if (abortAtBoundary) void childStarted.promise.then(() => finish(stream, model, "Parent initial work finished"));
			else finish(stream, model, "Parent initial work finished");
		}
		else if (count === 2) finish(stream, model, [{ type: "toolCall", id: "wait", name: "subagent_collect", arguments: { action: "wait" } }], "toolUse");
		else finish(stream, model, "Collected and verified");
		return stream;
	} });
	const settingsManager = pi.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
	const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir, eventBus, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		additionalExtensionPaths: [join(packageRoot, "extensions/subagents.ts"), join(packageRoot, "extensions/status-ui.ts")],
		extensionFactories: [extension => {
			extension.on("agent_before_settle", event => { if (abortAtBoundary && event.outcome === "completed") void abortSession(); });
			extension.on("tool_execution_start", event => { if (event.toolName === "subagent_collect") collectedStarted.resolve(); });
			extension.on("tool_execution_end", event => { if (event.toolName === "subagent_run") launchReturned.resolve(); });
			extension.on("tool_execution_update", event => { if (event.toolName === "subagent_run") nativeUpdates.push(event.partialResult.details.progress); });
		}] });
	await resourceLoader.reload();
	const { session } = await pi.createAgentSession({ cwd, agentDir, settingsManager, resourceLoader, modelRuntime, model: (await modelRuntime.getAvailable())[0], tools: ["read", "subagent_run", "subagent_collect"], sessionManager: pi.SessionManager.inMemory(cwd) });
	abortSession = () => session.abort();
	const ui = fakeUIContext();
	await session.bindExtensions({ mode: "tui", onError: error => errors.push(error) });
	session.extensionRunner.setUIContext(ui.ctx.ui, "tui");
	await session.extensionRunner.emit({ type: "session_start", reason: "startup" });
	const release = () => { if (childStream) finish(childStream, childModel, "Child complete"); };
	t.after(async () => { release(); await session.abort(); await session.extensionRunner.emit({ type: "session_shutdown" }); session.dispose(); });
	return { session, ui, eventBus, events, errors, nativeUpdates, childStarted, collectedStarted, launchReturned, providerAborted, childComplete, release };
}

test("pre-settlement continuation waits in a cancellable native collection call", { timeout: 12000 }, async t => {
	const f = await fixture(t);
	const prompting = f.session.prompt("Delegate a reader then finish");
	await within(f.childStarted.promise, "child provider startup");
	await within(f.collectedStarted.promise, "cancellable collection after final parent response");
	await within(f.session.abort(), "session abort");
	await within(prompting, "parent settlement");
	await within(f.providerAborted.promise, "child provider abort");
	assert.deepEqual(f.errors, []);
});

test("background session progress reaches agents UI after native launch callback closes", { timeout: 12000 }, async t => {
	const f = await fixture(t);
	const prompting = f.session.prompt("Delegate a reader then finish");
	await within(f.launchReturned.promise, "launch returned");
	await within(f.childStarted.promise, "child provider startup");
	const nativeCount = f.nativeUpdates.length;
	const runner = f.session.extensionRunner;
	const panelOpen = runner.getCommand("orchestraitor:agents").handler("", runner.createCommandContext());
	const panel = f.ui.dialogs.at(-1);
	assert.ok(panel);
	assert.match(panel.component.render(80).join("\n"), /explore · running/);
	panel.done({ status: "closed" }); await panelOpen;
	f.release();
	await within(prompting, "normal parent collection");
	assert.equal(f.nativeUpdates.length, nativeCount, "native callbacks must not carry detached progress");
	const phases = f.events.flatMap(event => event.tasks.map(task => task.phase));
	for (const phase of ["running", "stopping", "completed"]) assert.ok(phases.includes(phase), phase);
	assert.ok(f.events.every(event => event.sessionId === f.session.sessionManager.getSessionId()));
	assert.deepEqual(f.errors, []);
});


test("abort exactly at the settlement boundary still cancels background readers", { timeout: 12000 }, async t => {
	const f = await fixture(t, { abortAtBoundary: true });
	await within(f.session.prompt("Delegate and finish"), "boundary abort settlement");
	await within(f.providerAborted.promise, "background cancelled at boundary");
	assert.deepEqual(f.errors, []);
});


test("vetoed tree navigation keeps the cancelled background outcome visible", { timeout: 12000 }, async t => {
	const f = await fixture(t);
	const prompting = f.session.prompt("Delegate a reader then finish");
	await within(f.childStarted.promise, "child started");
	await within(f.collectedStarted.promise, "collection started");
	// A vetoed navigation emits its before hook but no session_tree/reconstruction.
	await f.session.extensionRunner.emit({ type: "session_before_tree", targetId: "vetoed" });
	await within(f.session.abort(), "stop parent after veto");
	await within(prompting, "parent after cancelled navigation");
	await within(f.providerAborted.promise, "child cancelled during navigation");
	const runner = f.session.extensionRunner;
	const panelOpen = runner.getCommand("orchestraitor:agents").handler("", runner.createCommandContext());
	const panel = f.ui.dialogs.at(-1);
	const rendered = panel.component.render(80).join("\n");
	assert.match(rendered, /explore · cancelled/);
	assert.doesNotMatch(rendered, /explore · running/);
	panel.done({ status: "closed" }); await panelOpen;
});

test("a recovered receipt without a result is collected once as interrupted while a live reader stays pending", { timeout: 15000 }, async t => {
	const cwd = await realpath(await createWorkspace(t)), agentDir = join(cwd, "agent"), childStarted = deferred(), replies = [], errors = [];
	let childStream, childModel, released = false;
	const release = () => { if (childStream && !released) { released = true; finish(childStream, childModel, "Live child complete"); } };
	const modelRuntime = await pi.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerProvider("recovery-fixture", { api: "openai-completions", apiKey: "local", baseUrl: "https://example.invalid", models: [fixtureModel], streamSimple(model, context) {
		const stream = createAssistantMessageEventStream();
		if (JSON.stringify(context.messages[0]).includes("bounded child worker")) { childStream = stream; childModel = model; childStarted.resolve(); return stream; }
		const next = replies.shift() ?? "Parent verified";
		if (next.action === "wait") void childStarted.promise.then(release);
		if (typeof next === "string") finish(stream, model, next);
		else finish(stream, model, [{ type: "toolCall", id: next.id, name: next.name ?? "subagent_collect", arguments: next.arguments ?? { action: next.action } }], "toolUse");
		return stream;
	} });
	const settingsManager = pi.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
	const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		additionalExtensionPaths: [join(packageRoot, "extensions/subagents.ts")] });
	await resourceLoader.reload();
	// A host killed after the launch receipt, or navigation back to before the result, leaves only the pending receipt.
	const sessionManager = pi.SessionManager.inMemory(cwd);
	sessionManager.appendCustomEntry(RECEIPT, { id: "lost-reader", state: "pending", role: "explore" });
	const { session } = await pi.createAgentSession({ cwd, agentDir, settingsManager, resourceLoader, modelRuntime, model: (await modelRuntime.getAvailable())[0], tools: ["read", "subagent_run", "subagent_collect"], sessionManager });
	const ui = fakeUIContext();
	await session.bindExtensions({ mode: "tui", onError: error => errors.push(error) });
	session.extensionRunner.setUIContext(ui.ctx.ui, "tui");
	t.after(async () => { release(); await session.abort(); await session.extensionRunner.emit({ type: "session_shutdown" }); session.dispose(); });
	const restore = () => session.extensionRunner.emit({ type: "session_start", reason: "startup" });
	const warnings = () => ui.calls.filter(([kind, message, level]) => kind === "notify" && level === "warning" && /subagent/.test(message));
	const output = id => JSON.parse(session.sessionManager.getEntries().find(entry => entry.type === "message" && entry.message.toolCallId === id).message.content[0].text);
	const details = id => session.sessionManager.getEntries().find(entry => entry.type === "message" && entry.message.toolCallId === id).message.details;
	await restore();
	assert.equal(warnings().length, 1);
	replies.push({ id: "launch", name: "subagent_run", arguments: { tasks: [{ role: "explore", instruction: "inspect", mode: "background" }] } },
		{ id: "status", action: "status" }, { id: "collect", action: "collect" }, { id: "wait", action: "wait" }, "Parent verified", { id: "again", action: "collect" });
	await within(session.prompt("Inspect the recovered and the live reader"), "parent collection");
	const live = details("launch").pending[0];
	const status = output("status");
	assert.deepEqual(status.live.map(({ id, status }) => ({ id, status })), [{ id: live, status: "running" }]);
	assert.deepEqual(status.recovered.map(({ id, state, status }) => ({ id, state, status })), [{ id: "lost-reader", state: "interrupted", status: "interrupted" }]);
	assert.deepEqual(output("collect").results.map(({ id, status, finalResponse, usageComplete }) => ({ id, status, finalResponse, usageComplete })),
		[{ id: "lost-reader", status: "interrupted", finalResponse: "", usageComplete: false }]);
	assert.deepEqual(output("collect").pending, [live], "The live reader is unaffected by recovery");
	assert.equal(details("collect").usageComplete, false);
	assert.deepEqual(output("wait").results.map(({ id, status }) => ({ id, status })), [{ id: live, status: "completed" }]);
	assert.deepEqual(output("wait").pending, []);
	await within(session.prompt("Collect again"), "repeated collection");
	assert.deepEqual(output("again"), { results: [], pending: [] });
	await restore();
	assert.equal(warnings().length, 1, "A delivered interrupted receipt no longer warns");
	assert.deepEqual(errors, []);
});

/** A parent whose replies follow `replies` (a `before` hook runs first); children answer through `child`. */
async function scripted(t, { child, seed = () => {}, extensions = async () => [] }) {
	const cwd = await realpath(await createWorkspace(t)), agentDir = join(cwd, "agent"), replies = [], errors = [];
	const modelRuntime = await pi.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerProvider("scripted-fixture", { api: "openai-completions", apiKey: "local", baseUrl: "https://example.invalid", models: [fixtureModel], streamSimple(model, context) {
		const stream = createAssistantMessageEventStream();
		if (JSON.stringify(context.messages[0]).includes("bounded child worker")) { child(stream, model); return stream; }
		const next = replies.shift() ?? "Parent verified";
		next.before?.();
		if (typeof next === "string") finish(stream, model, next);
		else finish(stream, model, [{ type: "toolCall", id: next.id, name: next.name ?? "subagent_collect", arguments: next.arguments ?? { action: next.action } }], "toolUse");
		return stream;
	} });
	const settingsManager = pi.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
	const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		additionalExtensionPaths: [...await extensions(cwd), join(packageRoot, "extensions/subagents.ts")] });
	await resourceLoader.reload();
	const sessionManager = pi.SessionManager.inMemory(cwd);
	seed(sessionManager);
	const { session } = await pi.createAgentSession({ cwd, agentDir, settingsManager, resourceLoader, modelRuntime, model: (await modelRuntime.getAvailable())[0], tools: ["read", "subagent_run", "subagent_collect"], sessionManager });
	await session.bindExtensions({ mode: "tui", onError: error => errors.push(error) });
	session.extensionRunner.setUIContext(fakeUIContext().ctx.ui, "tui");
	t.after(async () => { await session.abort(); await session.extensionRunner.emit({ type: "session_shutdown" }); session.dispose(); });
	await session.extensionRunner.emit({ type: "session_start", reason: "startup" });
	const text = id => session.sessionManager.getEntries().find(entry => entry.type === "message" && entry.message.toolCallId === id).message.content[0].text;
	return { cwd, session, replies, errors, text, output: id => JSON.parse(text(id)) };
}

test("a background result above the handoff cap is collected as its head with a file path and its receipt never holds the full text", { timeout: 15000 }, async t => {
	const full = Array.from({ length: 3000 }, (_, index) => `finding ${index + 1}: ${"evidence ".repeat(4).trim()}`).join("\n");
	const f = await scripted(t, { child: (stream, model) => finish(stream, model, full) });
	const directory = join(f.cwd, "tmp"), previous = process.env.TMPDIR;
	await mkdir(directory);
	process.env.TMPDIR = directory;
	t.after(() => { if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous; });
	f.replies.push({ id: "launch", name: "subagent_run", arguments: { tasks: [{ role: "explore", instruction: "inspect", mode: "background" }] } }, { id: "wait", action: "wait" });
	await within(f.session.prompt("Delegate a long reader and collect it"), "parent collection");
	const [collected] = f.output("wait").results;
	const marker = /\n\n\[Response truncated at 24KB\. Full response: (\S+); continue with read offset=(\d+)\.\]$/.exec(collected.finalResponse);
	assert.ok(marker, collected.finalResponse.slice(-300));
	assert.ok(full.startsWith(`${collected.finalResponse.slice(0, marker.index)}\n`));
	assert.equal(dirname(marker[1]), directory);
	assert.equal(await readFile(marker[1], "utf8"), full);
	const receipts = f.session.sessionManager.getEntries().filter(entry => entry.type === "custom" && entry.customType === RECEIPT);
	assert.deepEqual(receipts.map(entry => entry.data.state), ["pending", "result"]);
	assert.deepEqual({ response: receipts[1].data.result.finalResponse, path: receipts[1].data.result.fullResponsePath }, { response: collected.finalResponse, path: marker[1] });
	assert.ok(!JSON.stringify(receipts).includes(full.slice(-200)), "The persisted receipt holds only the head");
	assert.deepEqual(f.errors, []);
});

test("two synchronous readers whose responses escape heavily return under Pi's 50 KB tool-output cap with both file paths", { timeout: 15000 }, async t => {
	// Each response is under 24 KiB raw; quotes, backslashes and newlines grow it past 25 KiB once JSON-escaped.
	const full = Array.from({ length: 700 }, (_, index) => `"C:\\src\\${index}" -> "\\"quoted\\""`).join("\n");
	const f = await scripted(t, { child: (stream, model) => finish(stream, model, full) });
	const directory = join(f.cwd, "tmp"), previous = process.env.TMPDIR;
	await mkdir(directory);
	process.env.TMPDIR = directory;
	t.after(() => { if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous; });
	f.replies.push({ id: "launch", name: "subagent_run", arguments: { tasks: [{ role: "explore", instruction: "inspect the first half" }, { role: "explore", instruction: "inspect the second half" }] } });
	await within(f.session.prompt("Delegate two readers"), "parent handoff");
	assert.ok(Buffer.byteLength(full) < 24 * 1024 && Buffer.byteLength(f.text("launch")) <= 50 * 1024, `tool output ${Buffer.byteLength(f.text("launch"))} bytes`);
	const results = f.output("launch");
	assert.equal(results.length, 2);
	for (const result of results) {
		const marker = /\n\n\[Response truncated at 24KB\. Full response: (\S+); continue with read offset=(\d+)\.\]$/.exec(result.finalResponse);
		assert.ok(marker, result.finalResponse.slice(-300));
		assert.ok(full.startsWith(`${result.finalResponse.slice(0, marker.index)}\n`));
		assert.equal(await readFile(marker[1], "utf8"), full);
	}
	assert.deepEqual(f.errors, []);
});

test("status summarizes recovered and live readers without handoffs, and collect then delivers the recovered handoff once", { timeout: 15000 }, async t => {
	const handoff = `Recovered handoff: ${"observed evidence ".repeat(200)}`;
	const childDone = deferred();
	const recoveredResult = { id: "earlier-reader", role: "review", cwd: "/project", model: "scripted-fixture/model", reasoning: "off", status: "failed",
		finalResponse: handoff, writes: [], diagnostic: `Child response failed: provider overloaded\n${"stderr noise ".repeat(100)}`, terminated: true, usageComplete: false };
	const f = await scripted(t, { child: (stream, model) => void childDone.promise.then(() => finish(stream, model, "Live handoff")), seed: sessionManager => {
		sessionManager.appendCustomEntry(RECEIPT, { id: "earlier-reader", state: "pending", role: "review" });
		sessionManager.appendCustomEntry(RECEIPT, { id: "earlier-reader", state: "result", result: recoveredResult });
	} });
	f.replies.push({ id: "launch", name: "subagent_run", arguments: { tasks: [{ role: "explore", instruction: "inspect", mode: "background" }] } },
		{ id: "status", action: "status" }, { id: "collect", action: "collect" }, { id: "wait", action: "wait", before: childDone.resolve }, "Parent verified", { id: "again", action: "collect" });
	await within(f.session.prompt("Check the readers, then collect them"), "parent collection");
	const live = f.output("launch").pending[0];
	assert.doesNotMatch(f.text("status"), /handoff|finalResponse|writes/i);
	assert.deepEqual(f.output("status"), {
		live: [{ id: live, role: "explore", status: "running", usagePending: true }],
		recovered: [{ id: "earlier-reader", role: "review", state: "result", status: "failed", diagnostic: recoveredResult.diagnostic.slice(0, 200) }],
	});
	assert.deepEqual(f.output("collect").results.map(({ id, finalResponse }) => ({ id, finalResponse })), [{ id: "earlier-reader", finalResponse: handoff }]);
	assert.deepEqual(f.output("wait").results.map(({ id, finalResponse }) => ({ id, finalResponse })), [{ id: live, finalResponse: "Live handoff" }]);
	await within(f.session.prompt("Collect again"), "repeated collection");
	assert.deepEqual(f.output("again"), { results: [], pending: [] });
	assert.deepEqual(f.errors, []);
});

test("collection reminders keep the entries and continuation that earlier settle handlers proposed", { timeout: 15000 }, async t => {
	// Another extension, loaded first, proposes an entry at every settled boundary and one continuation at the second.
	const other = async cwd => { await writeFile(join(cwd, "other-boundary.ts"), `export default function(pi) { let boundaries = 0;
		pi.on("agent_before_settle", event => { if (event.outcome !== "completed") return; boundaries++;
			return { entries: [...event.entries, { type: "custom_message", customType: "other-boundary", display: false, content: "boundary " + boundaries }], continue: event.continue || boundaries === 2 }; }); }`);
		return [join(cwd, "other-boundary.ts")]; };
	const f = await scripted(t, { child: (stream, model) => finish(stream, model, "Child handoff"), extensions: other });
	f.replies.push({ id: "launch", name: "subagent_run", arguments: { tasks: [{ role: "explore", instruction: "inspect", mode: "background" }] } }, "Initial work done", "Still working",
		{ id: "wait", action: "wait" });
	await within(f.session.prompt("Delegate a reader and finish"), "parent settlement");
	const proposed = f.session.sessionManager.getEntries().filter(entry => entry.type === "custom_message").map(({ customType }) => customType);
	assert.deepEqual(proposed, ["other-boundary", "orchestraitor-subagents-ready", "other-boundary", "orchestraitor-subagents-uncollected", "other-boundary"]);
	assert.deepEqual(f.output("wait").results.map(({ finalResponse }) => finalResponse), ["Child handoff"]);
	assert.deepEqual(f.errors, []);
});
