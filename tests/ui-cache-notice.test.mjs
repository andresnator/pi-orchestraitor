import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createUISession, importHost, loadUiModule } from "./helpers/ui-harness.mjs";

const SETTLE_MS = 5;
const SOL = { provider: "openai-codex", id: "sol", cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 } };
const OPUS = { provider: "anthropic", id: "opus", cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 } };
const FREE = { provider: "local", id: "free", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const ADVICE = "Switch at session start or right after compaction to avoid it.";

/** Drive the notice with the events Pi emits, against a context the test controls. */
async function noticeHarness(t) {
	const { registerCacheNotice } = await loadUiModule(t, "extensions/ui/cache-notice.ts");
	const handlers = new Map();
	registerCacheNotice({ on: (event, handler) => handlers.set(event, handler) }, SETTLE_MS);
	const notices = [];
	const state = { model: SOL, thinkingLevel: "medium", tokens: 120_000, hasUI: true, stale: false };
	// Pi's context getters throw once the session is replaced.
	const live = (value) => { if (state.stale) throw new Error("stale ctx"); return value; };
	const ctx = {
		get hasUI() { return live(state.hasUI); },
		get model() { return live(state.model); },
		get thinkingLevel() { return live(state.thinkingLevel); },
		getContextUsage: () => live(state.tokens === undefined ? undefined : { tokens: state.tokens, contextWindow: 272_000, percent: null }),
		ui: { notify: (message, level) => notices.push({ message, level }) },
	};
	const emit = (type, fields = {}) => handlers.get(type)({ type, ...fields }, ctx);
	const select = { thinking(level) { state.thinkingLevel = level; emit("thinking_level_select", { level }); },
		model(model, source = "set") { state.model = model; emit("model_select", { model, source }); } };
	emit("session_start", { reason: "startup" });
	return { state, emit, select, notices, settle: () => delay(SETTLE_MS * 10) };
}

test("shouldWarnOnceWithTheSettledSelectionWhenCyclingLeavesTheCachedOne", async (t) => {
	// Given
	const { select, notices, settle } = await noticeHarness(t);
	// When
	select.thinking("high");
	select.model(OPUS);
	const beforeSettling = [...notices];
	await settle();
	// Then
	assert.deepEqual({ beforeSettling, notices }, { beforeSettling: [], notices: [{ level: "warning",
		message: `Model anthropic/opus, thinking high: the next request will likely re-bill 120k context tokens (~$1.38). ${ADVICE}` }] });
});

test("shouldPriceAndSizeTheReBilledContextWhenTheNewSelectionIsKnown", async (t) => {
	// Given
	const cases = [
		{ model: SOL, thinking: "high", tokens: 120_000, expected: `Thinking high: the next request will likely re-bill 120k context tokens (~$0.23). ${ADVICE}` },
		{ model: FREE, thinking: "medium", tokens: 1_250_000, expected: `Model local/free: the next request will likely re-bill 1.3M context tokens. ${ADVICE}` },
		{ model: SOL, thinking: "low", tokens: 20_000, expected: `Thinking low: the next request will likely re-bill 20k context tokens (~$0.04). ${ADVICE}` },
	];
	// When
	const messages = [];
	for (const { model, thinking, tokens } of cases) {
		const { state, select, notices, settle } = await noticeHarness(t);
		state.tokens = tokens;
		if (model !== state.model) select.model(model);
		if (thinking !== state.thinkingLevel) select.thinking(thinking);
		await settle();
		messages.push(...notices.map(({ message }) => message));
	}
	// Then
	assert.deepEqual(messages, cases.map(({ expected }) => expected));
});

test("shouldStaySilentWhenTheNextRequestWouldNotReBillACachedContext", async (t) => {
	// Given
	const scenarios = {
		revertedWhileCycling: ({ select }) => { select.thinking("high"); select.thinking("medium"); },
		restoredSelection: ({ select }) => select.model(OPUS, "restore"),
		unknownAfterCompaction: ({ state, select }) => { state.tokens = null; select.thinking("high"); },
		noContextUsage: ({ state, select }) => { state.tokens = undefined; select.thinking("high"); },
		smallContext: ({ state, select }) => { state.tokens = 19_999; select.thinking("high"); },
		noInteractiveUI: ({ state, select }) => { state.hasUI = false; select.thinking("high"); },
		requestAlreadySent: ({ emit, select }) => { select.thinking("high"); emit("turn_start", { turnIndex: 1 }); },
		sessionShutDown: ({ emit, select }) => { select.thinking("high"); emit("session_shutdown"); },
		sessionReplaced: ({ state, select }) => { select.thinking("high"); state.stale = true; },
	};
	// When
	const outcomes = {};
	for (const [name, act] of Object.entries(scenarios)) {
		const harness = await noticeHarness(t);
		act(harness);
		await harness.settle();
		outcomes[name] = harness.notices;
	}
	// Then
	assert.deepEqual(outcomes, Object.fromEntries(Object.keys(scenarios).map((name) => [name, []])));
});

test("shouldCompareWithTheLatestRequestWhenTheUserSwitchesBack", async (t) => {
	// Given
	const { emit, select, notices, settle } = await noticeHarness(t);
	// When
	select.thinking("high");
	await settle();
	select.thinking("medium");
	await settle();
	select.thinking("high");
	emit("turn_start", { turnIndex: 1 });
	await settle();
	select.thinking("medium");
	await settle();
	// Then
	assert.deepEqual(notices.map(({ message }) => message.split(":")[0]), ["Thinking high", "Thinking medium"]);
});

test("shouldWarnThroughTheStatusUIWithoutTouchingTheTranscriptWhenAPromptedSessionChangesThinking", async (t) => {
	// Given
	const { createAssistantMessageEventStream } = await importHost("node_modules/@earendil-works/pi-ai/dist/index.js");
	const { session, calls, errors } = await createUISession(t, "tui");
	session.modelRuntime.registerProvider("cache-fixture", { api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "fixture",
		models: [{ id: "model", name: "Local cache fixture", reasoning: true, input: ["text"], cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 }, contextWindow: 272000, maxTokens: 1024 }],
		streamSimple(model) {
			const stream = createAssistantMessageEventStream();
			const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: "stop",
				usage: { input: 30000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 30010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				content: [{ type: "text", text: "done" }] };
			stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message); return stream;
		},
	});
	await session.setModel((await session.modelRuntime.getAvailable()).find(({ provider }) => provider === "cache-fixture"));
	await session.prompt("Fill the fixture context.");
	const level = session.thinkingLevel === "high" ? "low" : "high";
	const context = [...session.messages];
	// When
	session.setThinkingLevel(level);
	await delay(1200);
	// Then
	assert.deepEqual(calls.filter(([kind]) => kind === "notify"), [["notify",
		`Thinking ${level}: the next request will likely re-bill 30k context tokens (~$0.06). ${ADVICE}`, "warning"]]);
	assert.deepEqual({ errors, messages: session.messages }, { errors: [], messages: context });
});
