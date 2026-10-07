import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
	SideConversation, CHAT_STATUS, CANCELLED_RESPONSE_TEXT, FAILED_RESPONSE_TEXT,
	TRUNCATED_RESPONSE_TEXT, waitFor,
} from "./helpers/btw-harness.mjs";

const MODEL = { id: "main-model", provider: "test", reasoning: true };
const OTHER_MODEL = { id: "other-model", provider: "other", reasoning: true };
const user = (text) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });
const response = {
	role: "assistant", content: [{ type: "text", text: "Answer" }],
	api: "openai-completions", provider: MODEL.provider, model: MODEL.id, stopReason: "stop", timestamp: 1,
	responseId: "provider-continuation", deferred: { id: "deferred-handle" },
};
const events = () => (async function* () { yield { type: "done", message: response, reason: "stop" }; })();

function fixture(streamSimple = mock.fn(events)) {
	const context = { systemPrompt: "Main instructions", messages: [user("Main question")], tools: [] };
	const ctx = { model: MODEL, thinkingLevel: "high", modelRegistry: { streamSimple } };
	const changed = mock.fn();
	const conversation = new SideConversation(ctx, context);
	conversation.onChange = changed;
	return { conversation, context, streamSimple, changed, ctx };
}

function blockedFixture() {
	let release;
	const gate = new Promise(resolve => { release = resolve; });
	const streamSimple = mock.fn(events);
	streamSimple.mock.mockImplementationOnce(() => (async function* () {
		await gate;
		yield { type: "text_delta", partial: response };
		yield { type: "done", message: response, reason: "stop" };
	})());
	return { ...fixture(streamSimple), release };
}

describe("temporary conversation", () => {
	it("shouldRememberFollowupsWithoutParentProviderHandlesWhenOpen", async () => {
		// Given
		const { conversation, streamSimple } = fixture();
		// When
		await conversation.send("First question");
		await conversation.send("Follow up");
		// Then
		const [first, second] = streamSimple.mock.calls.map(call => call.arguments);
		assert.deepEqual(second[1].messages.map(message => message.content), [
			user("Main question").content, user("First question").content, response.content, user("Follow up").content,
		]);
		assert.deepEqual({ tools: second[1].tools, sessionId: second[2].sessionId, cacheRetention: second[2].cacheRetention },
			{ tools: [], sessionId: first[2].sessionId, cacheRetention: "none" });
		assert.partialDeepStrictEqual(second[1].messages[2], { responseId: undefined, deferred: undefined, content: response.content });
	});

	it("shouldReadTheCurrentParentModelAndThinkingWhenEachRequestStarts", async () => {
		// Given
		const { conversation, streamSimple, ctx } = fixture();
		// When
		await conversation.send("First");
		ctx.model = OTHER_MODEL;
		ctx.thinkingLevel = "low";
		await conversation.send("Second");
		// Then
		assert.deepEqual(streamSimple.mock.calls.map(({ arguments: [model, , options] }) => ({ model, reasoning: options.reasoning })),
			[{ model: MODEL, reasoning: "high" }, { model: OTHER_MODEL, reasoning: "low" }]);
		assert.partialDeepStrictEqual(ctx, { model: OTHER_MODEL, thinkingLevel: "low" });
	});

	it("shouldDisableReasoningWhenTheParentModelDoesNotSupportIt", async () => {
		// Given
		const { conversation, streamSimple, ctx } = fixture();
		ctx.model = { ...MODEL, reasoning: false };
		// When
		await conversation.send("Question");
		// Then
		assert.equal(streamSimple.mock.calls[0].arguments[2].reasoning, undefined);
	});

	it("shouldSendQueuedQuestionsInOrderWithCurrentParentValuesWhenTheStreamFinishes", async () => {
		// Given
		const { conversation, streamSimple, ctx, release } = blockedFixture();
		const running = conversation.send("First");
		await conversation.send("Second");
		await conversation.send("Third");
		assert.deepEqual(conversation.pending, ["Second", "Third"]);
		// When
		ctx.model = OTHER_MODEL;
		ctx.thinkingLevel = "low";
		release();
		await running;
		await waitFor(() => assert.equal(conversation.busy, false));
		// Then
		assert.deepEqual(conversation.turns.map(turn => turn.question), ["First", "Second", "Third"]);
		assert.deepEqual(streamSimple.mock.calls.map(({ arguments: [model, , options] }) => ({ model, reasoning: options.reasoning })),
			[{ model: MODEL, reasoning: "high" }, { model: OTHER_MODEL, reasoning: "low" }, { model: OTHER_MODEL, reasoning: "low" }]);
		assert.deepEqual(conversation.pending, []);
	});

	it("shouldKeepTheSnapshotAndHistoryIsolatedWhenTheProviderMutatesRequests", async () => {
		// Given
		const received = [];
		const streamSimple = mock.fn((_model, context) => {
			received.push(structuredClone(context.messages));
			context.messages[0].content[0].text = "Provider mutation";
			return events();
		});
		const { conversation, context } = fixture(streamSimple);
		const before = structuredClone(context);
		// When
		await conversation.send("First");
		await conversation.send("Second");
		// Then
		assert.deepEqual(context, before);
		assert.deepEqual(received.map(messages => messages[0]), [user("Main question"), user("Main question")]);
	});

	it("shouldEraseStateAbortTheStreamAndIgnoreLateEventsWhenDisposed", async () => {
		// Given
		const { conversation, context, streamSimple, changed, release } = blockedFixture();
		const running = conversation.send("First");
		await conversation.send("Queued");
		// When
		conversation.dispose();
		conversation.dispose();
		const updates = changed.mock.calls.length;
		release();
		await running;
		await conversation.send("After close");
		// Then
		assert.deepEqual({ aborted: streamSimple.mock.calls[0].arguments[2].signal.aborted, busy: conversation.busy,
			turns: conversation.turns, pending: conversation.pending, updates: changed.mock.calls.length,
			requests: streamSimple.mock.calls.length, context },
			{ aborted: true, busy: false, turns: [], pending: [], updates,
				requests: 1, context: { messages: [], tools: [], systemPrompt: undefined } });
	});

	it("shouldDropTheQueueAndAllowANewQuestionWhenCancelled", async () => {
		// Given
		const { conversation, streamSimple, release } = blockedFixture();
		const running = conversation.send("First");
		await conversation.send("Queued");
		// When
		conversation.cancel();
		release();
		await running;
		// Then
		assert.deepEqual({ status: conversation.status, pending: conversation.pending, turns: conversation.turns },
			{ status: CHAT_STATUS.cancelled, pending: [], turns: [{ question: "First", answer: "", note: CANCELLED_RESPONSE_TEXT }] });
		// When
		await conversation.send("New question");
		// Then
		assert.equal(streamSimple.mock.calls.length, 2);
		assert.deepEqual(conversation.turns.at(-1), { question: "New question", answer: "Answer" });
	});

	it("shouldIgnoreEmptyQuestionsWhenOpen", async () => {
		// Given
		const { conversation, streamSimple } = fixture();
		// When
		await conversation.send(" \n ");
		// Then
		assert.equal(streamSimple.mock.calls.length, 0);
	});

	it("shouldReportMissingParentModelWhenSending", async () => {
		// Given
		const { conversation, streamSimple, ctx } = fixture();
		ctx.model = undefined;
		// When
		await conversation.send("Question");
		// Then
		assert.equal(streamSimple.mock.calls.length, 0);
		assert.deepEqual(conversation.turns, [{ question: "Question", answer: "", note: "Select a model before using /btw." }]);
	});

	for (const reason of ["toolUse", "deferred", "length", "empty", "error"]) {
		it(`shouldHandleTerminalOutcomeWhenItIs${reason}`, async () => {
			// Given
			const streamSimple = mock.fn(() => (async function* () {
				if (reason === "error") yield { type: "error", error: { errorMessage: "Provider error" } };
				else if (reason !== "empty") yield { type: "done", message: response, reason };
			})());
			const { conversation } = fixture(streamSimple);
			// When
			await conversation.send("Question");
			// Then
			assert.deepEqual({ status: conversation.status, note: conversation.turns[0].note }, {
				status: reason === "length" ? CHAT_STATUS.ready : CHAT_STATUS.error,
				note: reason === "length" ? TRUNCATED_RESPONSE_TEXT : reason === "error" ? "Provider error" : FAILED_RESPONSE_TEXT,
			});
		});
	}

	it("shouldDiscardQueuedQuestionsWhenARequestFails", async () => {
		// Given
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		const streamSimple = mock.fn(() => (async function* () {
			await gate;
			throw new Error("Connection failed");
		})());
		const { conversation } = fixture(streamSimple);
		const running = conversation.send("First");
		await conversation.send("Queued");
		// When
		release();
		await running;
		// Then
		assert.deepEqual({ pending: conversation.pending, requests: streamSimple.mock.calls.length, status: conversation.status },
			{ pending: [], requests: 1, status: CHAT_STATUS.error });
	});
});
