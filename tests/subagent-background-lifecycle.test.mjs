import assert from "node:assert/strict";
import test from "node:test";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { createWorkspace, importHost, packageRoot, pi } from "./helpers/pi-host.mjs";
import { fakeUIContext } from "./helpers/ui-harness.mjs";
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
