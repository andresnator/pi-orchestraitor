import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { childBridge, parentBridge, publicModel, MAX_BRIDGE_RECORD } from "../extensions/subagent/bridge.mjs";
import { BatchController } from "../extensions/subagent/controller.mjs";
import { createWorkspace, hostRoot, importHost } from "./helpers/pi-host.mjs";

const { createAssistantMessageEventStream } = await importHost("node_modules/@earendil-works/pi-ai/dist/index.js");
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
