import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createWorkspace, importHost, packageRoot, pi } from "./helpers/pi-host.mjs";
import { recoverReceipts } from "../extensions/subagent/background.mjs";

const ai = await importHost("node_modules/@earendil-works/pi-ai/dist/index.js");
const model = { provider: "nested-accounting-fixture", id: "fixture", api: "openai-completions", name: "Fixture", reasoning: false, input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 };
const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const childUsage = { ...zeroUsage, input: 200, output: 100, totalTokens: 300 };
const actions = ["status", "collect", "wait", "cancel"];

function response(content, usage = zeroUsage) {
	const stream = ai.createAssistantMessageEventStream();
	const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), usage,
		stopReason: typeof content === "string" ? "stop" : "toolUse", content: typeof content === "string" ? [{ type: "text", text: content }] : content };
	stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message); return stream;
}
const call = (id, name, args) => response([{ type: "toolCall", id, name, arguments: args }]);
const entries = async session => (await readFile(session.sessionFile, "utf8")).trim().split("\n").map(JSON.parse);

for (const caller of ["ctx.executeTool", "codemode"]) test(`native ${caller} cannot consume collection usage before a durable direct receipt`, { timeout: 15000 }, async t => {
	const cwd = await realpath(await createWorkspace(t)), agentDir = join(cwd, "agent");
	const modelRuntime = await pi.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	let parentCalls = 0, childCalls = 0;
	modelRuntime.registerProvider(model.provider, { api: model.api, baseUrl: "https://example.invalid", apiKey: "fixture", models: [model],
		streamSimple(_model, context) {
			if (JSON.stringify(context.messages[0]).includes("bounded child worker")) { childCalls++; return response("Child evidence", childUsage); }
			switch (parentCalls++) {
				case 0: return call("launch", "subagent_run", { tasks: [{ role: "explore", instruction: "Inspect fixture", mode: "background" }] });
				case 1: return caller === "codemode" ? call("outer", "codemode", { code: `for (const action of ${JSON.stringify(actions)}) { try { text(await tools.subagent_collect({action})); } catch (error) { text(String(error)); } }` }) : call("outer", "nested_collect", {});
				case 2: return call("direct", "subagent_collect", { action: "wait" });
				case 4: return call("after-reload", "subagent_collect", { action: "collect" });
				default: return response("Parent verified the collected evidence");
			}
		} });
	const settingsManager = pi.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
	const nested = api => api.registerTool({ name: "nested_collect", label: "Nested collection fixture", description: "Exercise native nested calls", parameters: { type: "object", properties: {} },
		async execute(_id, _args, _signal, _update, ctx) {
			const outcomes = [];
			for (const action of actions) outcomes.push(await ctx.executeTool("subagent_collect", { action }));
			return { content: [{ type: "text", text: JSON.stringify(outcomes) }], details: {} };
		} });
	const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true,
		additionalExtensionPaths: [join(packageRoot, "extensions/subagents.ts")],
		extensionFactories: [caller === "codemode" ? pi.createCodemodeExtension({ mode: "on" }) : nested],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await resourceLoader.reload();
	const { session } = await pi.createAgentSession({ cwd, agentDir, settingsManager, resourceLoader, modelRuntime,
		model: (await modelRuntime.getAvailable())[0], tools: ["read", "subagent_run", "subagent_collect", caller === "codemode" ? "codemode" : "nested_collect"],
		sessionManager: pi.SessionManager.create(cwd, join(agentDir, "sessions")) });
	t.after(async () => { await session.extensionRunner.emit({ type: "session_shutdown" }); session.dispose(); });
	await session.bindExtensions({ mode: "print", onError: error => assert.fail(String(error)) });
	await session.prompt("Launch, probe nested collection, then collect directly");
	const firstEntries = await entries(session);
	const outer = firstEntries.find(entry => entry.type === "message" && entry.message.toolCallId === "outer").message;
	assert.deepEqual(outer.nestedCalls.calls.map(({ name, status }) => ({ name, status })), actions.map(action => ({ name: "subagent_collect", status: action === "status" ? "ok" : "error" })));
	assert.ok(outer.nestedCalls.calls.slice(1).every(({ error }) => /directly.*durable usage accounting/i.test(error)), JSON.stringify(outer.nestedCalls));
	assert.equal(outer.usage, undefined, "Nested callers must not acquire child usage");
	const direct = firstEntries.find(entry => entry.type === "message" && entry.message.toolCallId === "direct").message;
	assert.equal(direct.details.results.length, 1, "Blocked nested actions leave the result directly collectable");
	assert.equal(direct.usage.totalTokens, childUsage.totalTokens);
	assert.equal(recoverReceipts(firstEntries).size, 0);
	assert.equal(session.getSessionStats().tokens.total, childUsage.totalTokens);
	await session.reload();
	await session.prompt("Check collection after reload");
	const finalEntries = await entries(session);
	const repeated = finalEntries.find(entry => entry.type === "message" && entry.message.toolCallId === "after-reload").message;
	assert.deepEqual(repeated.details.results, []);
	assert.equal(repeated.usage, undefined, "Reload must not resurrect already-accounted usage");
	assert.equal(session.getSessionStats().tokens.total, childUsage.totalTokens);
	assert.equal(recoverReceipts(finalEntries).size, 0);
	assert.equal(childCalls, 1);
});

test("native nested mixed launches recover only background usage after reload", { timeout: 15000 }, async t => {
	const cwd = await realpath(await createWorkspace(t)), agentDir = join(cwd, "agent");
	const modelRuntime = await pi.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	let parentCalls = 0, backgroundId, foregroundId, backgroundDone;
	const backgroundFinished = new Promise(resolve => { backgroundDone = resolve; });
	const completed = new Set();
	const eventBus = pi.createEventBus();
	eventBus.on("orchestraitor:subagent-progress", event => {
		for (const task of event.tasks) if (task.phase === "completed") completed.add(task.id);
		if (completed.has(backgroundId)) backgroundDone();
	});
	modelRuntime.registerProvider(model.provider, { api: model.api, baseUrl: "https://example.invalid", apiKey: "fixture", models: [model],
		streamSimple(_model, context) {
			if (JSON.stringify(context.messages[0]).includes("bounded child worker")) return response("Child evidence", childUsage);
			switch (parentCalls++) {
				case 0: return call("mixed-outer", "nested_mixed", {});
				case 1: {
					// End this parent turn without collection, then exercise real reload recovery.
					const stream = ai.createAssistantMessageEventStream();
					void backgroundFinished.then(() => {
						const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
							usage: zeroUsage, stopReason: "aborted", content: [], errorMessage: "Fixture interruption before collection" };
						stream.push({ type: "error", reason: "aborted", error: message }); stream.end(message);
					});
					return stream;
				}
				case 2: return call("mixed-recovered", "subagent_collect", { action: "collect" });
				default: return response("Parent verified the recovered background evidence");
			}
		} });
	const settingsManager = pi.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
	const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir, eventBus, settingsManager, noExtensions: true,
		additionalExtensionPaths: [join(packageRoot, "extensions/subagents.ts")], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		extensionFactories: [api => api.registerTool({ name: "nested_mixed", label: "Nested mixed fixture", description: "Exercise a native nested mixed launch", parameters: { type: "object", properties: {} },
			async execute(_id, _args, _signal, _update, ctx) {
				const outcome = await ctx.executeTool("subagent_run", { tasks: [
					{ role: "explore", instruction: "Background fixture", mode: "background" },
					{ role: "review", instruction: "Foreground fixture", mode: "sync" },
				] });
				assert.equal(outcome.isError, false, JSON.stringify(outcome));
				foregroundId = outcome.result.details.results[0].id;
				backgroundId = outcome.result.details.pending[0];
				if (completed.has(backgroundId)) backgroundDone();
				// The SDK records this nested result's usage on the outer native receipt.
				return { content: outcome.result.content, details: {} };
			} })] });
	await resourceLoader.reload();
	const { session } = await pi.createAgentSession({ cwd, agentDir, settingsManager, resourceLoader, modelRuntime,
		model: (await modelRuntime.getAvailable())[0], tools: ["read", "subagent_run", "subagent_collect", "nested_mixed"],
		sessionManager: pi.SessionManager.create(cwd, join(agentDir, "sessions")) });
	t.after(async () => { await session.abort(); await session.extensionRunner.emit({ type: "session_shutdown" }); session.dispose(); });
	await session.bindExtensions({ mode: "print", onError: error => assert.fail(String(error)) });
	await session.prompt("Launch a mixed batch through a native nested tool");
	const beforeReload = await entries(session);
	const outer = beforeReload.find(entry => entry.type === "message" && entry.message.toolCallId === "mixed-outer").message;
	assert.equal(outer.usage.totalTokens, childUsage.totalTokens);
	assert.equal(outer.details.results, undefined, "Native outer receipts omit nested result details");
	assert.equal(outer.nestedCalls.calls[0].name, "subagent_run");
	const recovered = recoverReceipts(beforeReload);
	assert.deepEqual([...recovered.keys()], [backgroundId]);
	assert.equal(recovered.has(foregroundId), false, "Already-accounted foreground usage must not become recoverable");
	assert.equal(recovered.get(backgroundId).result.usage.totalTokens, childUsage.totalTokens);
	assert.equal(session.getSessionStats().tokens.total, childUsage.totalTokens);
	await session.reload();
	await session.prompt("Collect pending background evidence directly");
	const afterReload = await entries(session);
	const collection = afterReload.find(entry => entry.type === "message" && entry.message.toolCallId === "mixed-recovered").message;
	assert.deepEqual(collection.details.results.map(result => result.id), [backgroundId]);
	assert.equal(collection.usage.totalTokens, childUsage.totalTokens);
	assert.equal(session.getSessionStats().tokens.total, childUsage.totalTokens * 2);
	assert.equal(recoverReceipts(afterReload).size, 0);
});
