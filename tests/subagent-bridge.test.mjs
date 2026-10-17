import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { childBridge, parentBridge, publicModel, MAX_BRIDGE_RECORD } from "../extensions/subagent/bridge.mjs";
import { BatchController } from "../extensions/subagent/controller.mjs";
import { createWorkspace, hostRoot, importHost, packageRoot, pi } from "./helpers/pi-host.mjs";

const { createAssistantMessageEventStream, parseStreamingJson } = await importHost("node_modules/@earendil-works/pi-ai/dist/index.js");
const model = { provider: "bridge-regression", id: "fixture", api: "openai-completions", name: "Fixture", reasoning: true,
	input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 32768 };
const usage = n => ({ input: n / 3, output: n * 2 / 3, cacheRead: 0, cacheWrite: 0, totalTokens: n,
	cost: { input: n / 1024, output: n / 512, cacheRead: 0, cacheWrite: 0, total: n * 3 / 1024 } });
const assistant = (content, tokens = 30, stopReason = "stop") => ({ role: "assistant", api: model.api, provider: model.provider,
	model: model.id, timestamp: 1, stopReason, usage: usage(tokens), content });
const finalStream = message => {
	const stream = createAssistantMessageEventStream();
	stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message); return stream;
};
const manifest = cwd => ({ id: "bridge", cwd, role: "explore", instruction: "inspect", files: [], skills: [], contextFiles: [],
	model: `${model.provider}/${model.id}`, bridgeModel: publicModel(model), reasoning: "high", tools: ["read", "search", "list"] });

function channels() {
	const parent = new EventEmitter(), child = new EventEmitter();
	let wireBytes = 0;
	for (const [sender, receiver] of [[parent, child], [child, parent]]) {
		sender.connected = true;
		sender.send = (message, callback) => {
			const serialized = JSON.stringify(message);
			if (sender === parent) wireBytes += Buffer.byteLength(serialized);
			queueMicrotask(() => { receiver.emit("message", JSON.parse(serialized)); callback?.(); });
		};
	}
	return { parent, child, wireBytes: () => wireBytes };
}

test("bridge delta transport preserves long Pi cumulative text and thinking snapshots with linear wire size", async () => {
	const { parent, child, wireBytes } = channels();
	const expected = assistant([{ type: "thinking", thinking: "" }, { type: "text", text: "" }]);
	const registry = { async *streamSimple() {
		yield { type: "start", partial: expected };
		for (const [index, type, key, delta] of [[0, "thinking", "thinking", "abcd"], [1, "text", "text", "é🙂"]]) {
			yield { type: `${type}_start`, contentIndex: index, partial: expected };
			for (let count = 0; count < 6000; count++) {
				expected.content[index][key] += delta;
				yield { type: `${type}_delta`, contentIndex: index, delta, partial: expected };
			}
			yield { type: `${type}_end`, contentIndex: index, content: expected.content[index][key], partial: expected };
		}
		yield { type: "done", reason: "stop", message: expected };
	} };
	const dispose = parentBridge(parent, registry, model, undefined, assert.fail);
	try {
		const stream = childBridge(child, createAssistantMessageEventStream, model)(model, { messages: [] });
		const lengths = [0, 0];
		for await (const event of stream) {
			assert.notEqual(event.type, "error", event.error?.errorMessage);
			if (event.type.endsWith("_delta")) {
				lengths[event.contentIndex] += event.delta.length;
				assert.equal(event.partial.content[event.contentIndex][event.contentIndex ? "text" : "thinking"].length, lengths[event.contentIndex]);
			}
		}
		assert.deepEqual(await stream.result(), expected);
		assert.equal(expected.content[0].thinking.length, 24000);
		assert.equal(Buffer.byteLength(expected.content[1].text), 36000);
		assert.ok(wireBytes() < 2 * 1024 * 1024, `transport used ${wireBytes()} bytes`);
		assert.equal(child.listenerCount("message"), 0);
	} finally { dispose(); }
});

// Varying chunk sizes defeat prefix and suffix reuse between consecutive deltas.
const chunks = text => {
	const parts = [];
	for (let at = 0, size = 5; at < text.length; at += size, size = size * 7 % 37 + 1) parts.push(text.slice(at, at + size));
	return parts;
};
const lines = (label, count) => Array.from({ length: count }, (_, index) => `${label} ${index}: ${"x".repeat(index % 23)}\n`).join("");
const writeArguments = { path: "target.txt", content: lines("line", 2400) };
// Like Pi providers, mutate one shared partial message and finish with a tool call.
async function* writeStream(output) {
	yield { type: "start", partial: output };
	for (const [type, key, value] of [["thinking", "thinking", lines("think", 900)], ["text", "text", lines("say", 900)]]) {
		const contentIndex = output.content.push({ type, [key]: "" }) - 1;
		yield { type: `${type}_start`, contentIndex, partial: output };
		for (const delta of chunks(value)) {
			output.content[contentIndex][key] += delta;
			yield { type: `${type}_delta`, contentIndex, delta, partial: output };
		}
		yield { type: `${type}_end`, contentIndex, content: value, partial: output };
	}
	const contentIndex = output.content.push({ type: "toolCall", id: "write", name: "write", arguments: {}, partialJson: "" }) - 1, block = output.content[contentIndex];
	yield { type: "toolcall_start", contentIndex, partial: output };
	for (const delta of chunks(JSON.stringify(writeArguments))) {
		block.partialJson += delta; block.arguments = parseStreamingJson(block.partialJson);
		yield { type: "toolcall_delta", contentIndex, delta, partial: output };
	}
	delete block.partialJson;
	yield { type: "toolcall_end", contentIndex, toolCall: block, partial: output };
	Object.assign(output, { stopReason: "toolUse", usage: usage(90) });
	yield { type: "done", reason: "toolUse", message: output };
}
// Compare partial content as of each event. Provider scratch fields such as
// partialJson are not part of Pi's event contract, and mid-stream partial usage
// is never accounted: the terminal message stays authoritative.
const fingerprint = ({ partial, ...event }) => JSON.stringify({ ...event,
	content: partial?.content.map(({ partialJson: _scratch, ...block }) => block) });

// Providers keep mutating the shared partial while earlier events wait for transport.
for (const ahead of [false, true]) test(`bridge keeps wire size linear for varying text, thinking and tool-call deltas${ahead ? " produced ahead of transport" : ""}`, { timeout: 20000 }, async () => {
	const { parent, child, wireBytes } = channels();
	const output = assistant([], 0), sent = [], received = [];
	const registry = { async *streamSimple() {
		const queued = [];
		for await (const event of writeStream(output)) { sent.push(fingerprint(event)); if (ahead) queued.push(event); else yield event; }
		yield* queued;
	} };
	const dispose = parentBridge(parent, registry, model, undefined, assert.fail);
	try {
		const stream = childBridge(child, createAssistantMessageEventStream, model, parseStreamingJson)(model, { messages: [] });
		for await (const event of stream) {
			assert.notEqual(event.type, "error", event.error?.errorMessage);
			received.push(fingerprint(event));
		}
		assert.equal(received.length, sent.length);
		for (const [index, event] of received.entries()) assert.equal(event, sent[index], `event ${index} differs`);
		assert.deepEqual(await stream.result(), output);
		const size = Buffer.byteLength(JSON.stringify(output));
		assert.ok(JSON.stringify(writeArguments).length > 50 * 1024);
		// About 160 framing bytes per small delta; cumulative snapshots exceeded the 32 MiB stream budget.
		assert.ok(wireBytes() < 10 * size, `transport used ${wireBytes()} bytes for a ${size}-byte message`);
		assert.equal(child.listenerCount("message"), 0);
	} finally { dispose(); }
});

test("native implementer writes a 50 KB file streamed through varying tool-call deltas", { timeout: 20000 }, async t => {
	const cwd = await realpath(await createWorkspace(t));
	await writeFile(join(cwd, "target.txt"), "fixture");
	let calls = 0;
	// Pull-paced like a network provider: each event is serialized before the next mutation.
	const registry = { streamSimple: () => calls++ ? finalStream(assistant([{ type: "text", text: "done" }])) : writeStream(assistant([], 0)) };
	const writer = { ...manifest(cwd), role: "implement", instruction: "write", files: ["target.txt"], tools: ["read", "search", "list", "edit", "write"] };
	const [result] = await new BatchController({ sdkRoot: hostRoot, registry, modelFor: () => model, stopGrace: 100 }).run([writer], () => "write");
	assert.equal(result.status, "completed", result.diagnostic);
	assert.equal(result.finalResponse, "done");
	assert.equal(await readFile(join(cwd, "target.txt"), "utf8"), writeArguments.content);
	assert.deepEqual(result.usage, usage(120));
	assert.equal(result.usageComplete, true);
});

test("native implementer completes when its final transcript exceeds the RPC record limit", { timeout: 20000 }, async t => {
	const cwd = await realpath(await createWorkspace(t));
	const files = ["a.txt", "b.txt"], content = "z".repeat(600 * 1024);
	let calls = 0;
	const registry = { streamSimple: () => {
		const path = files[calls++];
		return finalStream(path ? assistant([{ type: "toolCall", id: path, name: "write", arguments: { path, content } }], 30, "toolUse") : assistant([{ type: "text", text: "done" }]));
	} };
	const writer = { ...manifest(cwd), role: "implement", instruction: "write", files, tools: ["read", "search", "list", "edit", "write"] };
	const [result] = await new BatchController({ sdkRoot: hostRoot, registry, modelFor: () => model, stopGrace: 100 }).run([writer], () => "write");
	assert.equal(result.status, "completed", result.diagnostic);
	assert.deepEqual(await Promise.all(files.map(file => readFile(join(cwd, file), "utf8"))), [content, content]);
	assert.match(result.diagnostic, /Skipped oversized agent_end RPC record/);
	assert.deepEqual(result.usage, usage(90));
	assert.equal(result.usageComplete, true);
});

test("native child completes a stream of four-byte deltas beyond the previous 16264-byte failure", { timeout: 20000 }, async t => {
	const cwd = await realpath(await createWorkspace(t));
	const message = assistant([{ type: "text", text: "" }]);
	const registry = { async *streamSimple() {
		yield { type: "start", partial: message };
		for (let count = 0; count < 5500; count++) {
			message.content[0].text += "abcd";
			yield { type: "text_delta", contentIndex: 0, delta: "abcd", partial: message };
		}
		yield { type: "done", reason: "stop", message };
	} };
	const [result] = await new BatchController({ sdkRoot: hostRoot, registry, modelFor: () => model, stopGrace: 100 }).run([manifest(cwd)], () => "inspect");
	assert.equal(result.status, "completed", result.diagnostic);
	assert.equal(result.finalResponse, "abcd".repeat(5500));
	assert.deepEqual(result.usage, usage(30));
	assert.equal(result.usageComplete, true);
});

for (const earlierResponse of [false, true]) test(`native child drains 300 aborted provider tokens exactly once with prior response ${earlierResponse}`, { timeout: 10000 }, async t => {
	const cwd = await realpath(await createWorkspace(t));
	await writeFile(join(cwd, "target.txt"), "fixture");
	const abort = new AbortController();
	let calls = 0, cancellations = 0;
	const registry = { streamSimple(_model, _context, options) {
		if (calls++ === 0 && earlierResponse) return finalStream(assistant([{ type: "toolCall", id: "read", name: "read", arguments: { path: "target.txt" } }], 30, "toolUse"));
		const stream = createAssistantMessageEventStream();
		stream.push({ type: "start", partial: assistant([], 0) });
		options.signal.addEventListener("abort", () => {
			cancellations++;
			setTimeout(() => {
				const message = { ...assistant([], 300, "aborted"), errorMessage: "Provider cancelled with finalized usage" };
				stream.push({ type: "error", reason: "aborted", error: message }); stream.end(message);
			}, 15);
		}, { once: true });
		setImmediate(() => abort.abort());
		return stream;
	} };
	const [result] = await new BatchController({ sdkRoot: hostRoot, registry, modelFor: () => model, stopGrace: 150 }).run([manifest(cwd)], () => "inspect", abort.signal);
	assert.equal(result.status, "cancelled", result.diagnostic);
	assert.equal(result.terminated, true);
	assert.equal(result.usageComplete, false);
	assert.deepEqual(result.usage, usage(earlierResponse ? 330 : 300));
	assert.equal(cancellations, 1);
});

const errorStream = errorMessage => {
	const message = { ...assistant([], 30, "error"), errorMessage }, stream = createAssistantMessageEventStream();
	stream.push({ type: "error", reason: "error", error: message }); stream.end(message); return stream;
};
for (const failure of ["error event", "exception"]) test(`native child retries a transient provider ${failure} and completes`, { timeout: 20000 }, async t => {
	const cwd = await realpath(await createWorkspace(t));
	let calls = 0;
	const registry = { streamSimple() {
		if (calls++) return finalStream(assistant([{ type: "text", text: "recovered" }]));
		if (failure === "exception") throw new Error("fetch failed");
		return errorStream("503 Service Unavailable: overloaded");
	} };
	const [result] = await new BatchController({ sdkRoot: hostRoot, registry, modelFor: () => model, stopGrace: 100 }).run([manifest(cwd)], () => "inspect");
	// The failed attempt is counted once; its reported usage may be partial.
	assert.deepEqual({ status: result.status, finalResponse: result.finalResponse, calls, usage: result.usage, usageComplete: result.usageComplete },
		{ status: "completed", finalResponse: "recovered", calls: 2, usage: usage(failure === "exception" ? 30 : 60), usageComplete: false }, result.diagnostic);
	assert.match(result.diagnostic, /assistant response was not successful/);
});

test("native child fails fast on a non-retryable provider error", { timeout: 20000 }, async t => {
	const cwd = await realpath(await createWorkspace(t));
	let calls = 0;
	const registry = { streamSimple() { calls++; return errorStream("429 insufficient_quota: You exceeded your current quota"); } };
	const [result] = await new BatchController({ sdkRoot: hostRoot, registry, modelFor: () => model, stopGrace: 100 }).run([manifest(cwd)], () => "inspect");
	assert.deepEqual({ status: result.status, calls }, { status: "failed", calls: 1 }, result.diagnostic);
	assert.match(result.diagnostic, /Child response failed: 429 insufficient_quota/);
});

test("cancellation during retry backoff stops the native child before another provider call", { timeout: 20000 }, async t => {
	const cwd = await realpath(await createWorkspace(t));
	const { spawn } = await import("node:child_process");
	const abort = new AbortController();
	let calls = 0, output = "", backoff;
	const registry = { streamSimple() { calls++; return errorStream("503 Service Unavailable: overloaded"); } };
	// Cancel as soon as the child reports Pi's retry backoff.
	const spawnProcess = (...args) => {
		const child = spawn(...args);
		child.stdout.on("data", chunk => {
			output += chunk;
			if (!backoff && output.includes('"type":"auto_retry_start"')) { backoff = Date.now(); abort.abort(); }
		});
		return child;
	};
	const [result] = await new BatchController({ sdkRoot: hostRoot, registry, modelFor: () => model, stopGrace: 100, spawnProcess }).run([manifest(cwd)], () => "inspect", abort.signal);
	assert.deepEqual({ status: result.status, terminated: result.terminated, calls, usage: result.usage, usageComplete: result.usageComplete },
		{ status: "cancelled", terminated: true, calls: 1, usage: usage(30), usageComplete: false }, result.diagnostic);
	assert.ok(Date.now() - backoff < 2000, "cancellation waited out the retry backoff");
});

test("child bridge cancellation remains bounded when a provider never finalizes", { timeout: 2500 }, async () => {
	const { child } = channels();
	const abort = new AbortController();
	const stream = childBridge(child, createAssistantMessageEventStream, model)(model, { messages: [] }, { signal: abort.signal });
	abort.abort();
	const result = await stream.result();
	assert.equal(result.stopReason, "aborted");
	assert.equal(result.usage.totalTokens, 0);
	assert.match(result.errorMessage, /before finalized usage arrived/);
	assert.equal(child.listenerCount("message"), 0);
});

test("child rejects oversized decoded snapshots and malformed record references", async () => {
	for (const record of [{ prefix: 1, suffix: 0, text: "" }, { prefix: 0, suffix: 0, text: "x".repeat(MAX_BRIDGE_RECORD + 1) }]) {
		const { child } = channels();
		const stream = childBridge(child, createAssistantMessageEventStream, model)(model, { messages: [] });
		child.emit("message", { type: "model_event", id: "1", sequence: 1, record });
		const result = await stream.result();
		assert.equal(result.stopReason, "error");
		assert.match(result.errorMessage, /bridge (record|stream limit)/);
		assert.equal(child.listenerCount("message"), 0);
	}
});

test("parent still bounds nonduplicated wire content across a stream", async () => {
	const { parent, child } = channels();
	const registry = { async *streamSimple() {
		for (let count = 0; count < 60; count++) yield { type: "text_delta", delta: (count % 2 ? "a" : "b").repeat(700000) };
	} };
	const dispose = parentBridge(parent, registry, model, undefined, assert.fail);
	try {
		const stream = childBridge(child, createAssistantMessageEventStream, model)(model, { messages: [] });
		for await (const event of stream) { if (event.type === "error") assert.match(event.error.errorMessage, /stream limit/); }
		assert.equal((await stream.result()).stopReason, "error");
	} finally { dispose(); }
});

test("child independently bounds total incoming wire content", async () => {
	const { child } = channels();
	const stream = childBridge(child, createAssistantMessageEventStream, model)(model, { messages: [] });
	const record = { prefix: 0, suffix: 0, text: JSON.stringify({ type: "text_delta", delta: "x".repeat(700000) }) };
	const consumed = (async () => { for await (const _event of stream) { /* Drain each decoded snapshot. */ } })();
	for (let count = 0; count < 60; count++) {
		child.emit("message", { type: "model_event", id: "1", sequence: count + 1, record });
		await new Promise(setImmediate);
	}
	await consumed;
	const result = await stream.result();
	assert.equal(result.stopReason, "error");
	assert.match(result.errorMessage, /stream limit/);
	assert.equal(child.listenerCount("message"), 0);
});

test("child bounds reconstructed size even when individual patches fit the wire limit", async () => {
	const { child } = channels();
	const stream = childBridge(child, createAssistantMessageEventStream, model)(model, { messages: [] });
	const initial = JSON.stringify({ type: "text_delta", delta: "x".repeat(600000) });
	child.emit("message", { type: "model_event", id: "1", sequence: 1, record: { prefix: 0, suffix: 0, text: initial } });
	child.emit("message", { type: "model_event", id: "1", sequence: 2, record: { prefix: initial.length - 2, suffix: 2, text: "x".repeat(600000) } });
	const result = await stream.result();
	assert.equal(result.stopReason, "error");
	assert.match(result.errorMessage, /oversized provider bridge record/);
});

test("slow native stream consumer applies backpressure before decoded snapshots can accumulate", async () => {
	const { parent, child } = channels();
	let produced = 0, delivered = 0;
	child.on("message", message => { if (message.type === "model_event") delivered++; });
	const message = assistant([{ type: "text", text: "x".repeat(600000) }]);
	const registry = { async *streamSimple() {
		for (let count = 0; count < 100; count++) {
			produced++;
			yield { type: "text_delta", contentIndex: 0, delta: "", partial: message };
		}
		yield { type: "done", reason: "stop", message };
	} };
	const dispose = parentBridge(parent, registry, model, undefined, assert.fail);
	try {
		const stream = childBridge(child, createAssistantMessageEventStream, model)(model, { messages: [] });
		await new Promise(setImmediate);
		assert.deepEqual({ produced, delivered }, { produced: 1, delivered: 1 });
		const iterator = stream[Symbol.asyncIterator]();
		await iterator.next();
		await new Promise(setImmediate);
		assert.deepEqual({ produced, delivered }, { produced: 1, delivered: 1 });
		for await (const event of iterator) assert.notEqual(event.type, "error", event.error?.errorMessage);
		assert.equal(produced, 100);
		assert.deepEqual(await stream.result(), message);
	} finally { dispose(); }
});

test("child rejects additional unconsumed snapshots even when compressed records are tiny", async () => {
	const { child } = channels();
	const stream = childBridge(child, createAssistantMessageEventStream, model)(model, { messages: [] });
	const initial = JSON.stringify({ type: "text_delta", delta: "x".repeat(600000) });
	child.emit("message", { type: "model_event", id: "1", sequence: 1, record: { prefix: 0, suffix: 0, text: initial } });
	child.emit("message", { type: "model_event", id: "1", sequence: 2, record: { prefix: initial.length, suffix: 0, text: "" } });
	const result = await stream.result();
	assert.equal(result.stopReason, "error");
	assert.match(result.errorMessage, /snapshot window exceeded/);
});

test("cancellation releases outstanding snapshot credit so finalized usage can drain", async () => {
	const { parent, child } = channels();
	const abort = new AbortController();
	const final = assistant([], 300, "aborted");
	const registry = { async *streamSimple() {
		yield { type: "start", partial: assistant([], 0) };
		yield { type: "thinking_delta", delta: "discard during cancellation", contentIndex: 0, partial: assistant([], 0) };
		yield { type: "error", reason: "aborted", error: final };
	} };
	const dispose = parentBridge(parent, registry, model, abort.signal, assert.fail);
	try {
		const stream = childBridge(child, createAssistantMessageEventStream, model)(model, { messages: [] }, { signal: abort.signal });
		await new Promise(setImmediate);
		abort.abort();
		assert.deepEqual(await stream.result(), final);
	} finally { dispose(); }
});

test("parent keys every child request with its assigned provider session and closes it on dispose", async () => {
	const { parent, child } = channels();
	const options = [];
	const registry = { streamSimple(_model, _context, streamOptions) { options.push(streamOptions); return finalStream(assistant([{ type: "text", text: "ok" }])); } };
	let closed = 0;
	const dispose = parentBridge(parent, registry, model, undefined, assert.fail, { id: "derived", close: () => closed++ });
	const request = childBridge(child, createAssistantMessageEventStream, model);
	await request(model, { messages: [] }).result();
	// A child cannot choose another provider session.
	const answered = new Promise(resolve => child.on("message", message => { if (message.id === "chosen") resolve(); }));
	child.send({ type: "model_request", id: "chosen", context: { messages: [] }, reasoning: "off", sessionId: "child-chosen" });
	await answered;
	await request(model, { messages: [] }).result();
	assert.equal(closed, 0);
	dispose();
	assert.deepEqual({ sessions: options.map(({ sessionId }) => sessionId), closed }, { sessions: ["derived", "derived", "derived"], closed: 1 });
});

test("parent applies the host's request options without letting them replace its signal, session or effort", async () => {
	const { parent, child } = channels();
	const options = [];
	const registry = { streamSimple(_model, _context, streamOptions) { options.push(streamOptions); return finalStream(assistant([{ type: "text", text: "ok" }])); } };
	const transformHeaders = async headers => ({ ...headers, "x-attribution": "pi" });
	const requestOptions = { timeoutMs: 30000, websocketConnectTimeoutMs: 7000, maxRetries: 4, maxRetryDelayMs: 9000, thinkingBudgets: { high: 8192 }, transport: "sse", transformHeaders,
		signal: "replaced", sessionId: "replaced", reasoning: "replaced" };
	const dispose = parentBridge(parent, registry, model, undefined, assert.fail, { id: "derived", close() {} }, requestOptions);
	try { await childBridge(child, createAssistantMessageEventStream, model)(model, { messages: [] }, { reasoning: "high" }).result(); } finally { dispose(); }
	const { signal, ...sent } = options[0];
	assert.ok(signal instanceof AbortSignal);
	assert.deepEqual(sent, { timeoutMs: 30000, websocketConnectTimeoutMs: 7000, maxRetries: 4, maxRetryDelayMs: 9000, thinkingBudgets: { high: 8192 }, transport: "sse", transformHeaders,
		sessionId: "derived", reasoning: "high" });
});

test("native children send the provider options Pi builds for the parent's own requests", { timeout: 20000 }, async t => {
	const cwd = await realpath(await createWorkspace(t)), agentDir = join(cwd, "agent");
	const fixture = { ...model, provider: "request-options-fixture" };
	const modelRuntime = await pi.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	const requests = { parent: [], child: [] };
	let parentCalls = 0;
	// OpenCode's host adds per-session attribution headers, so the child must send its own session.
	modelRuntime.registerProvider(fixture.provider, { api: fixture.api, baseUrl: "https://opencode.ai/zen/v1", apiKey: "fixture", models: [fixture],
		streamSimple(_model, context, options) {
			const role = JSON.stringify(context.messages[0]).includes("bounded child worker") ? "child" : "parent";
			requests[role].push(options);
			if (role === "child") return finalStream({ ...assistant([{ type: "text", text: "Child evidence" }]), provider: fixture.provider });
			const message = parentCalls++ ? assistant([{ type: "text", text: "Verified" }])
				: assistant([{ type: "toolCall", id: "launch", name: "subagent_run", arguments: { tasks: [{ role: "explore", instruction: "Inspect fixture" }] } }], 30, "toolUse");
			return finalStream({ ...message, provider: fixture.provider });
		} });
	const settingsManager = pi.SettingsManager.inMemory({ compaction: { enabled: false }, websocketConnectTimeoutMs: 7000, thinkingBudgets: { low: 1024, medium: 4096, high: 8192 }, transport: "sse",
		retry: { enabled: false, provider: { timeoutMs: 30000, maxRetries: 4, maxRetryDelayMs: 9000 } } });
	const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, additionalExtensionPaths: [join(packageRoot, "extensions/subagents.ts")],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await resourceLoader.reload();
	const { session } = await pi.createAgentSession({ cwd, agentDir, settingsManager, resourceLoader, modelRuntime, model: (await modelRuntime.getAvailable())[0],
		tools: ["read", "subagent_run", "subagent_collect"], sessionManager: pi.SessionManager.inMemory(cwd) });
	t.after(async () => { await session.extensionRunner.emit({ type: "session_shutdown" }); session.dispose(); });
	await session.bindExtensions({ mode: "print", onError: error => assert.fail(String(error)) });
	await session.prompt("Delegate one reader");
	const pick = ({ timeoutMs, websocketConnectTimeoutMs, maxRetries, maxRetryDelayMs, thinkingBudgets, transport, headers, sessionId }) =>
		({ timeoutMs, websocketConnectTimeoutMs, maxRetries, maxRetryDelayMs, thinkingBudgets, transport, headers, sessionId });
	const [parentRequest] = requests.parent.map(pick), [childRequest] = requests.child.map(pick);
	assert.deepEqual(parentRequest, { timeoutMs: 30000, websocketConnectTimeoutMs: 7000, maxRetries: 4, maxRetryDelayMs: 9000, thinkingBudgets: { low: 1024, medium: 4096, high: 8192 },
		transport: "sse", headers: { "x-opencode-session": parentRequest.sessionId, "x-opencode-client": "pi" }, sessionId: session.sessionManager.getSessionId() });
	assert.match(childRequest.sessionId, /^[0-9a-f]{64}$/);
	assert.deepEqual(childRequest, { ...parentRequest, headers: { "x-opencode-session": childRequest.sessionId, "x-opencode-client": "pi" }, sessionId: childRequest.sessionId });
});

test("request options that cannot be built fail the task before any child process starts", { timeout: 5000 }, async t => {
	const cwd = await realpath(await createWorkspace(t));
	let spawned = 0;
	// Pi rejects an invalid timeout setting when its getter runs, as for its own requests.
	const requestOptionsFor = () => { throw new Error("Invalid websocketConnectTimeoutMs setting: soon"); };
	const controller = new BatchController({ sdkRoot: hostRoot, registry: { streamSimple: assert.fail }, modelFor: () => model, requestOptionsFor, stopGrace: 100,
		spawnProcess: () => { spawned++; throw new Error("spawned"); } });
	const [result] = await controller.run([manifest(cwd)], () => "inspect");
	assert.deepEqual({ status: result.status, spawned, diagnostic: result.diagnostic.split("\n")[0] }, { status: "failed", spawned: 0, diagnostic: "Invalid websocketConnectTimeoutMs setting: soon" });
});

test("parent without an assigned provider session sends none, and a failing close still disposes", async () => {
	const { parent, child } = channels();
	const options = [];
	const registry = { streamSimple(_model, _context, streamOptions) { options.push(streamOptions); return finalStream(assistant([{ type: "text", text: "ok" }])); } };
	const dispose = parentBridge(parent, registry, model, undefined, assert.fail);
	try { await childBridge(child, createAssistantMessageEventStream, model)(model, { messages: [] }).result(); } finally { dispose(); }
	assert.equal("sessionId" in options[0], false);
	parentBridge(parent, registry, model, undefined, assert.fail, { id: "derived", close() { throw new Error("already closed"); } })();
	assert.equal(parent.listenerCount("message"), 0);
});

test("native child reuses its parent-assigned provider session without a skills catalog", { timeout: 20000 }, async t => {
	const cwd = await realpath(await createWorkspace(t));
	await writeFile(join(cwd, "target.txt"), "fixture");
	const skillsRoot = await realpath(await createWorkspace(t));
	await mkdir(join(skillsRoot, "chosen"));
	const skill = { name: "chosen", description: "Selected", filePath: join(skillsRoot, "chosen/SKILL.md"), baseDir: join(skillsRoot, "chosen"), disableModelInvocation: false };
	await writeFile(skill.filePath, "Chosen skill");
	const requests = [], closed = [];
	const registry = { streamSimple(_model, context, options) {
		requests.push({ sessionId: options.sessionId, context: JSON.stringify(context) });
		return finalStream(requests.length === 1 ? assistant([{ type: "toolCall", id: "read", name: "read", arguments: { path: "target.txt" } }], 30, "toolUse")
			: assistant([{ type: "text", text: "done" }]));
	} };
	const providerSessionFor = ({ id }) => ({ id: `derived-${id}`, close: () => closed.push(id) });
	const [result] = await new BatchController({ sdkRoot: hostRoot, registry, modelFor: () => model, providerSessionFor, stopGrace: 100 })
		.run([{ ...manifest(cwd), skills: [skill] }], () => "inspect");
	assert.equal(result.status, "completed", result.diagnostic);
	assert.deepEqual({ sessions: requests.map(({ sessionId }) => sessionId), closed }, { sessions: ["derived-bridge", "derived-bridge"], closed: ["bridge"] });
	assert.doesNotMatch(requests[0].context, /available_skills|SKILL\.md/);
	assert.deepEqual(result.usage, usage(60));
	assert.equal(result.usageComplete, true);
});
