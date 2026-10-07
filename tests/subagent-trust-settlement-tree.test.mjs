import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createWorkspace, importHost, isolatedAgentDir, packageRoot, pi } from "./helpers/pi-host.mjs";
import { paths } from "../extensions/models/store.mjs";
import { RECEIPT, recoverReceipts } from "../extensions/subagent/background.mjs";

const ai = await importHost("node_modules/@earendil-works/pi-ai/dist/index.js");
const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const childUsage = { ...zero, input: 200, output: 100, totalTokens: 300 };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const modelConfig = { id: "fixture", name: "Offline fixture", reasoning: false, input: ["text"], cost: zero.cost, contextWindow: 8192, maxTokens: 1024 };
function response(model, value, usage = zero, stopReason) {
	const stream = ai.createAssistantMessageEventStream();
	const finish = content => {
		const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), usage,
			stopReason: stopReason ?? (typeof content === "string" ? "stop" : "toolUse"), content: typeof content === "string" ? [{ type: "text", text: content }] : content };
		stream.push(message.stopReason === "aborted" ? { type: "error", reason: "aborted", error: message } : { type: "done", reason: message.stopReason, message }); stream.end(message);
	};
	if (value?.then) void value.then(finish); else finish(value);
	return stream;
}
const call = (id, name, args) => [{ type: "toolCall", id, name, arguments: args }];
async function fixture(t, { trusted = false, project, onParent, childContent = "Child evidence", tools = ["read", "subagent_run", "subagent_collect"], maxParentCalls = 7 } = {}) {
	const cwd = await realpath(await createWorkspace(t)), agentDir = join(cwd, "agent");
	if (project !== undefined) { await mkdir(join(cwd, ".pi")); await writeFile(paths(agentDir, cwd).project, typeof project === "string" ? project : JSON.stringify(project)); }
	const eventBus = pi.createEventBus(), childDone = deferred(), childProviders = [], errors = [];
	eventBus.on("orchestraitor:subagent-progress", event => { if (event.tasks.some(task => task.phase === "completed")) childDone.resolve(); });
	const modelRuntime = await pi.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	let parentCalls = 0;
	for (const provider of ["trust-parent", "trust-project", "trust-personal"]) modelRuntime.registerProvider(provider, { api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "local", models: [modelConfig],
		streamSimple(model, context) {
			if (JSON.stringify(context.messages[0]).includes("bounded child worker")) { childProviders.push(provider); return response(model, childContent, childUsage); }
			const turn = parentCalls++;
			// Reproductions must remain finite even if the pre-fix boundary loops forever.
			if (turn >= maxParentCalls) return response(model, "Fixture stops unbounded continuation", zero, "aborted");
			return response(model, onParent ? onParent(turn, childDone.promise) : turn === 0 ? call("launch", "subagent_run", { tasks: [{ role: "explore", instruction: "Inspect fixture" }] }) : "Parent verified");
		} });
	const settingsManager = pi.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } }, { projectTrusted: trusted });
	const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir, eventBus, settingsManager, noExtensions: true,
		additionalExtensionPaths: [join(packageRoot, "extensions/subagents.ts")], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await resourceLoader.reload();
	const { session } = await pi.createAgentSession({ cwd, agentDir, settingsManager, resourceLoader, modelRuntime, model: modelRuntime.getModel("trust-parent", "fixture"),
		tools, sessionManager: pi.SessionManager.create(cwd, join(agentDir, "sessions")) });
	t.after(async () => { await session.abort(); await session.extensionRunner.emit({ type: "session_shutdown" }); session.dispose(); });
	await session.bindExtensions({ mode: "print", onError: error => errors.push(error) });
	return { cwd, session, childProviders, errors, childDone, get parentCalls() { return parentCalls; } };
}

for (const trusted of [false, true]) test(`native delegation ${trusted ? "applies" : "ignores"} project provider assignments according to Pi trust`, async t => {
	const f = await fixture(t, { trusted, project: { assignments: { explore: { model: "trust-project/fixture" } } } });
	assert.equal(f.session.extensionRunner.createContext().isProjectTrusted(), trusted);
	await f.session.prompt("Delegate fixture exploration");
	assert.deepEqual(f.childProviders, [trusted ? "trust-project" : "trust-parent"]);
	assert.deepEqual(f.errors, []);
});

test("untrusted malformed project configuration is never loaded", async t => {
	const f = await fixture(t, { project: "INVALID JSON" });
	await f.session.prompt("Delegate fixture exploration");
	assert.deepEqual(f.childProviders, ["trust-parent"]);
	assert.deepEqual(f.errors, []);
});

test("a finished reader gets one automatic collection reminder, then remains manually recoverable", { timeout: 15000 }, async t => {
	let manualCollection = false, collectionIssued = false;
	const f = await fixture(t, { onParent(turn, finished) {
		if (manualCollection && !collectionIssued) { collectionIssued = true; return call("manual-collect", "subagent_collect", { action: "collect" }); }
		if (turn === 0) return call("launch", "subagent_run", { tasks: [{ role: "explore", instruction: "Inspect fixture", mode: "background" }] });
		if (turn === 1) return finished.then(() => "Parent ignores collection");
		return "Parent still ignores collection";
	} });
	await f.session.prompt("Launch and answer without collecting");
	assert.equal(f.parentCalls, 3, "Only the initial response and one reminder may request provider continuation");
	const entries = f.session.sessionManager.getEntries();
	assert.equal(entries.filter(entry => entry.type === "custom_message" && entry.customType === "orchestraitor-subagents-ready").length, 1);
	assert.ok(entries.some(entry => entry.type === "custom_message" && entry.customType === "orchestraitor-subagents-uncollected" && /uncollected|pending/i.test(entry.content)));
	const pending = recoverReceipts(entries);
	assert.equal(pending.size, 1);
	assert.equal([...pending.values()][0].result.usage.totalTokens, 300);
	assert.equal(f.session.getSessionStats().tokens.total, 0, "Uncollected usage remains explicitly pending");
	await f.session.prompt("Another answer without collection");
	assert.equal(f.parentCalls, 4, "The same pending task cannot restart automatic reminders on a new user turn");
	await f.session.reload();
	manualCollection = true;
	await f.session.prompt("Collect the preserved receipt manually");
	assert.equal(f.session.getSessionStats().tokens.total, 300);
	assert.equal(recoverReceipts(f.session.sessionManager.getEntries()).size, 0);
	assert.equal(f.childProviders.length, 1);
	assert.deepEqual(f.errors, []);
});

test("native tree navigation cannot re-account usage from an abandoned collection branch", { timeout: 15000 }, async t => {
	const f = await fixture(t, { onParent(turn) {
		if (turn === 0) return call("launch", "subagent_run", { tasks: [{ role: "explore", instruction: "Inspect fixture", mode: "background" }] });
		if (turn === 1) return call("first-collect", "subagent_collect", { action: "wait" });
		if (turn === 3 || turn === 5) return call(turn === 3 ? "tree-collect" : "reloaded-tree-collect", "subagent_collect", { action: "collect" });
		return "Parent verified";
	} });
	await f.session.prompt("Launch and collect the reader");
	assert.equal(f.session.getSessionStats().tokens.total, 300);
	const all = f.session.sessionManager.getEntries();
	const resultReceipt = all.find(entry => entry.type === "custom" && entry.customType === RECEIPT && entry.data.state === "result");
	assert.ok(resultReceipt);
	assert.equal((await f.session.navigateTree(resultReceipt.id)).cancelled, false);
	assert.equal(recoverReceipts(f.session.sessionManager.getBranch()).size, 1, "The active branch retains the result, but lacks its abandoned collection receipt");
	await f.session.prompt("Collect again on the earlier branch");
	const repeated = f.session.sessionManager.getEntries().find(entry => entry.type === "message" && entry.message.toolCallId === "tree-collect").message;
	assert.deepEqual(repeated.details.results, []);
	assert.equal(repeated.usage, undefined);
	assert.equal(f.session.getSessionStats().tokens.total, 300);
	assert.equal(f.childProviders.length, 1, "Navigating must not launch another child");
	await f.session.reload();
	await f.session.prompt("Check again after reload of the earlier branch");
	const afterReload = f.session.sessionManager.getEntries().find(entry => entry.type === "message" && entry.message.toolCallId === "reloaded-tree-collect").message;
	assert.equal(afterReload.usage, undefined);
	assert.deepEqual(afterReload.details.results, []);
	assert.equal(f.session.getSessionStats().tokens.total, 300);
	assert.deepEqual(f.errors, []);
});

for (const restoration of ["reload", "tree navigation"]) test(`native ${restoration} keeps an uncollected reader blocking implementation until collection`, { timeout: 15000 }, async t => {
	let nextCall;
	const f = await fixture(t, { tools: ["read", "edit", "write", "subagent_run", "subagent_collect"], maxParentCalls: 14, onParent(turn, finished) {
		if (turn === 0) return call("launch", "subagent_run", { tasks: [{ role: "explore", instruction: "Inspect fixture", mode: "background" }] });
		if (turn === 1) return finished.then(() => "Parent leaves the reader uncollected");
		if (nextCall) { const result = nextCall; nextCall = undefined; return result; }
		return "Parent verified";
	} });
	const file = join(f.cwd, "fixture.txt"), original = "Keep this fixture unchanged.\n";
	await writeFile(file, original);
	const writer = id => call(id, "subagent_run", { tasks: [{ role: "implement", instruction: "Inspect fixture.txt without changing it", files: ["fixture.txt"], model: "trust-project/fixture" }] });
	const toolResult = id => f.session.sessionManager.getEntries().find(entry => entry.type === "message" && entry.message.toolCallId === id)?.message;
	const assertBlocked = id => {
		assert.equal(toolResult(id)?.isError, true);
		assert.match(JSON.stringify(toolResult(id).content), /Collect pending readers before implementation/);
		assert.deepEqual(f.childProviders, ["trust-parent"], "A rejected implementer cannot call its provider");
	};
	await f.session.prompt("Launch the reader without collecting it");
	const resultReceipt = f.session.sessionManager.getEntries().find(entry => entry.type === "custom" && entry.customType === RECEIPT && entry.data.state === "result");
	assert.equal(resultReceipt?.data.result.usage.totalTokens, 300);
	assert.equal(f.session.getSessionStats().tokens.total, 0);
	nextCall = writer("writer-before-restoration");
	await f.session.prompt("Try implementation before collecting the reader");
	assertBlocked("writer-before-restoration");
	if (restoration === "reload") await f.session.reload();
	else assert.equal((await f.session.navigateTree(resultReceipt.id)).cancelled, false);
	assert.equal(recoverReceipts(f.session.sessionManager.getBranch()).size, 1, "The restored branch still exposes the uncollected result");
	nextCall = writer("writer-after-restoration");
	await f.session.prompt("Try implementation directly after restoration");
	assertBlocked("writer-after-restoration");
	assert.equal(f.session.getSessionStats().tokens.total, 0);
	nextCall = call("collect-reader", "subagent_collect", { action: "collect" });
	await f.session.prompt("Collect the original reader directly");
	assert.equal(toolResult("collect-reader").details.results[0].id, resultReceipt.data.id);
	assert.equal(toolResult("collect-reader").usage.totalTokens, 300);
	assert.equal(f.session.getSessionStats().tokens.total, 300);
	nextCall = writer("writer-after-collection");
	await f.session.prompt("Implementation may now inspect the unchanged fixture");
	const implemented = toolResult("writer-after-collection");
	assert.equal(implemented.isError, false);
	assert.equal(implemented.details.results[0].status, "completed");
	assert.equal(implemented.details.results[0].terminated, true);
	assert.deepEqual(implemented.details.results[0].writes, []);
	assert.deepEqual(f.childProviders, ["trust-parent", "trust-project"]);
	assert.equal(await readFile(file, "utf8"), original);
	nextCall = call("collect-reader-again", "subagent_collect", { action: "collect" });
	await f.session.prompt("Check that the reader cannot be collected twice");
	assert.deepEqual(toolResult("collect-reader-again").details.results, []);
	assert.equal(toolResult("collect-reader-again").usage, undefined);
	assert.equal(f.session.getSessionStats().tokens.total, 600, "The reader and writer each contribute 300 tokens exactly once");
	assert.deepEqual(f.errors, []);
});

for (const collectionTiming of ["before restoration", "after restoration"]) test(`native implementation ignores a reader accounted off-branch ${collectionTiming} without prior status or collection`, { timeout: 15000 }, async t => {
	let nextCall;
	const f = await fixture(t, { tools: ["read", "edit", "write", "subagent_run", "subagent_collect"], onParent(turn, finished) {
		if (turn === 0) return call("launch", "subagent_run", { tasks: [{ role: "explore", instruction: "Inspect fixture", mode: "background" }] });
		if (turn === 1) return collectionTiming === "before restoration"
			? call("first-collect", "subagent_collect", { action: "wait" }) : finished.then(() => "Parent leaves the reader uncollected");
		if (nextCall) { const result = nextCall; nextCall = undefined; return result; }
		return "Parent verified";
	} });
	const file = join(f.cwd, "fixture.txt"), original = "Keep this fixture unchanged.\n";
	await writeFile(file, original);
	await f.session.prompt("Launch the reader and preserve its receipt");
	const resultReceipt = f.session.sessionManager.getEntries().find(entry => entry.type === "custom" && entry.customType === RECEIPT && entry.data.state === "result");
	assert.ok(resultReceipt);
	if (collectionTiming === "before restoration") assert.equal((await f.session.navigateTree(resultReceipt.id)).cancelled, false);
	else {
		await f.session.reload();
		assert.equal(f.session.getSessionStats().tokens.total, 0);
		// Simulate a native accounting receipt arriving after extension restoration.
		// Move only the session tree pointer so the gate must reconcile this new receipt itself.
		f.session.sessionManager.appendMessage({ role: "toolResult", toolCallId: "late-native-collect", toolName: "subagent_collect",
			content: [{ type: "text", text: "Collected reader" }], details: { results: [resultReceipt.data.result] },
			isError: false, usage: resultReceipt.data.result.usage, timestamp: Date.now() });
		f.session.sessionManager.branch(resultReceipt.id);
	}
	assert.equal(f.session.getSessionStats().tokens.total, 300);
	assert.equal(recoverReceipts(f.session.sessionManager.getBranch()).size, 1, "The active branch lacks the native collection receipt");
	nextCall = call("writer-after-off-branch-collection", "subagent_run", { tasks: [{ role: "implement", instruction: "Inspect fixture.txt without changing it", files: ["fixture.txt"], model: "trust-project/fixture" }] });
	await f.session.prompt("Start implementation directly on the earlier branch");
	const implemented = f.session.sessionManager.getEntries().find(entry => entry.type === "message" && entry.message.toolCallId === "writer-after-off-branch-collection").message;
	assert.equal(implemented.isError, false);
	assert.equal(implemented.details.results[0].status, "completed");
	assert.equal(implemented.details.results[0].terminated, true);
	assert.deepEqual(implemented.details.results[0].writes, []);
	assert.deepEqual(f.childProviders, ["trust-parent", "trust-project"]);
	assert.equal(f.session.getSessionStats().tokens.total, 600, "The off-branch reader remains accounted once alongside the writer");
	assert.equal(await readFile(file, "utf8"), original);
	assert.deepEqual(f.errors, []);
});


test("untrusted project defaults cannot override personal routing, effort or mode", async t => {
	const file = paths(isolatedAgentDir, "/unused").personal;
	await mkdir(join(isolatedAgentDir, "orchestraitor"), { recursive: true });
	const { readFile, rm } = await import("node:fs/promises");
	let previous;
	try { previous = await readFile(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
	t.after(async () => { if (previous === undefined) await rm(file, { force: true }); else await writeFile(file, previous); });
	await writeFile(file, JSON.stringify({ assignments: { explore: { model: "trust-personal/fixture", reasoning: "off", mode: "sync" } } }));
	const f = await fixture(t, { project: { assignments: { defaults: { model: "trust-project/fixture", reasoning: "high", mode: "background" } } } });
	await f.session.prompt("Use personal exploration assignments");
	assert.deepEqual(f.childProviders, ["trust-personal"]);
	const launch = f.session.sessionManager.getEntries().find(entry => entry.type === "message" && entry.message.toolCallId === "launch").message;
	assert.equal(launch.isError, false);
	assert.equal(launch.details.results[0].reasoning, "off");
	assert.equal(launch.details.pending, undefined, "Project background mode must not apply");
	assert.deepEqual(f.errors, []);
});


test("explicit task routing remains available without project trust", async t => {
	const f = await fixture(t, { project: { assignments: { defaults: { model: "unavailable/model" } } }, onParent(turn) {
		return turn === 0 ? call("launch", "subagent_run", { tasks: [{ role: "explore", instruction: "Inspect fixture", model: "trust-project/fixture" }] }) : "Parent verified";
	} });
	await f.session.prompt("Use the explicitly selected task provider");
	assert.deepEqual(f.childProviders, ["trust-project"]);
	assert.deepEqual(f.errors, []);
});
