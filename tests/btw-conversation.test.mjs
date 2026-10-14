import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
	SideConversation, CHAT_STATUS, CANCELLED_RESPONSE_TEXT, EMPTY_RESPONSE_TEXT, FAILED_RESPONSE_TEXT,
	TRUNCATED_RESPONSE_TEXT, TOOL_REQUEST_TEXT, firstQuestion, selectTranscript, waitFor,
} from "./helpers/btw-harness.mjs";

const MODEL = { id: "main-model", provider: "test", reasoning: true };
const OTHER_MODEL = { id: "other-model", provider: "other", reasoning: true };
const PARENT_SESSION = "0199c0de-parent-session";
const user = (text) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });
const response = {
	role: "assistant", content: [{ type: "text", text: "Answer" }],
	api: "openai-completions", provider: MODEL.provider, model: MODEL.id, stopReason: "stop", timestamp: 1,
	responseId: "provider-continuation", deferred: { id: "deferred-handle" },
};
const events = () => (async function* () { yield { type: "done", message: response, reason: "stop" }; })();
const failure = (errorMessage) => () => (async function* () {
	yield { type: "error", reason: "error", error: { ...response, content: [], stopReason: "error", errorMessage } };
})();

function fixture(streamSimple = mock.fn(events)) {
	const context = { systemPrompt: "Main instructions", messages: [user("Main question")], tools: [] };
	const ctx = { model: MODEL, thinkingLevel: "high", modelRegistry: { streamSimple }, sessionManager: { getSessionId: () => PARENT_SESSION } };
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
			user("Main question").content, firstQuestion("First question"), response.content, user("Follow up").content,
		]);
		// The provider's default retention, as for the parent, so follow-ups and the parent prefix hit the cache.
		assert.deepEqual({ tools: second[1].tools, sessionId: second[2].sessionId, cacheRetention: second[2].cacheRetention },
			{ tools: [], sessionId: first[2].sessionId, cacheRetention: undefined });
		assert.partialDeepStrictEqual(second[1].messages[2], { responseId: undefined, deferred: undefined, content: response.content });
	});

	it("shouldShareThePromptCacheButNotTheConnectionOfTheParentSession", async () => {
		// Given
		const { conversation, streamSimple, ctx } = fixture();
		// When
		await conversation.send("Primera pregunta");
		ctx.sessionManager.getSessionId = () => "parent-after-switch";
		await conversation.send("Segunda pregunta");
		// Then
		assert.deepEqual(streamSimple.mock.calls.map(call => [call.arguments[2].sessionId, call.arguments[2].transport]),
			[[PARENT_SESSION, "sse"], ["parent-after-switch", "sse"]]);
	});

	it("shouldUseLowThinkingUntilShiftTabSelectsInheritOrOff", async () => {
		// Given
		const { conversation, streamSimple, ctx } = fixture();
		// When
		await conversation.send("Default");
		conversation.cycleThinking();
		ctx.model = OTHER_MODEL;
		await conversation.send("Inherited");
		ctx.thinkingLevel = "medium";
		await conversation.send("Inherited after a parent change");
		conversation.cycleThinking();
		await conversation.send("Off");
		conversation.cycleThinking();
		// Then
		assert.deepEqual(streamSimple.mock.calls.map(({ arguments: [model, , options] }) => ({ model: model.id, reasoning: options.reasoning })), [
			{ model: MODEL.id, reasoning: "low" }, { model: OTHER_MODEL.id, reasoning: "high" },
			{ model: OTHER_MODEL.id, reasoning: "medium" }, { model: OTHER_MODEL.id, reasoning: undefined },
		]);
		assert.deepEqual({ thinking: conversation.thinking, parent: ctx.thinkingLevel }, { thinking: "low", parent: "medium" });
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
		conversation.thinking = "inherit";
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
		assert.deepEqual({ status: conversation.status, phase: conversation.progress.phase, pending: conversation.pending, turns: conversation.turns },
			{ status: CHAT_STATUS.cancelled, phase: "cancelled", pending: [], turns: [{ question: "First", answer: "", note: CANCELLED_RESPONSE_TEXT, progress: conversation.progress }] });
		// When
		await conversation.send("New question");
		// Then
		assert.equal(streamSimple.mock.calls.length, 2);
		assert.deepEqual(conversation.turns.at(-1), { question: "New question", answer: "Answer", progress: conversation.progress });
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
		assert.deepEqual(conversation.turns, [{ question: "Question", answer: "", note: "Select a model before using /btw.", progress: conversation.progress }]);
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
			const notice = { toolUse: TOOL_REQUEST_TEXT, deferred: TOOL_REQUEST_TEXT, length: TRUNCATED_RESPONSE_TEXT, error: "Provider error" };
			const answered = ["toolUse", "deferred", "length"].includes(reason);
			assert.deepEqual({ status: conversation.status, phase: conversation.progress.phase, note: conversation.turns[0].note }, {
				status: answered ? CHAT_STATUS.ready : CHAT_STATUS.error,
				phase: answered ? "done" : "error",
				note: notice[reason] ?? FAILED_RESPONSE_TEXT,
			});
		});
	}

	it("shouldRetryATransientProviderErrorBeforeAnyAnswerText", async () => {
		// Given
		const streamSimple = mock.fn(events);
		streamSimple.mock.mockImplementationOnce(failure("429 Too Many Requests"));
		const { conversation } = fixture(streamSimple);
		conversation.retryPolicy = { maxRetries: 2, baseDelayMs: 1 };
		// When
		await conversation.send("Question");
		// Then
		assert.equal(streamSimple.mock.calls.length, 2);
		assert.deepEqual({ status: conversation.status, turns: conversation.turns.map(({ answer, note }) => ({ answer, note })) },
			{ status: CHAT_STATUS.ready, turns: [{ answer: "Answer", note: undefined }] });
	});

	for (const errorMessage of ["429 insufficient_quota: check your plan and billing details", "500 Internal error: prompt is too long: 213462 tokens > 200000 maximum"]) {
		it(`shouldFailFastWhenTheProviderErrorIsNotTransient: ${errorMessage.slice(0, 24)}`, async () => {
			// Given
			const streamSimple = mock.fn(failure(errorMessage));
			const { conversation } = fixture(streamSimple);
			conversation.retryPolicy = { maxRetries: 2, baseDelayMs: 1 };
			// When
			await conversation.send("Question");
			// Then
			assert.deepEqual({ requests: streamSimple.mock.calls.length, status: conversation.status, note: conversation.turns[0].note },
				{ requests: 1, status: CHAT_STATUS.error, note: errorMessage });
		});
	}

	it("shouldStopRetryingWhenCancelledDuringBackoff", async () => {
		// Given
		const streamSimple = mock.fn(failure("503 Service Unavailable"));
		const { conversation } = fixture(streamSimple);
		conversation.retryPolicy = { maxRetries: 2, baseDelayMs: 60_000 };
		const running = conversation.send("Question");
		await waitFor(() => assert.match(conversation.turns[0].note ?? "", /Retrying \(1\/2\) in 60s/));
		// When
		conversation.cancel();
		await running;
		// Then
		assert.deepEqual({ requests: streamSimple.mock.calls.length, busy: conversation.busy, status: conversation.status, note: conversation.turns[0].note },
			{ requests: 1, busy: false, status: CHAT_STATUS.cancelled, note: CANCELLED_RESPONSE_TEXT });
	});

	it("shouldKeepAnEmptyAnswerOutOfTheSideHistoryAndTheMainThread", async () => {
		// Given
		const streamSimple = mock.fn(events);
		streamSimple.mock.mockImplementationOnce(() => (async function* () {
			yield { type: "done", message: { ...response, content: [{ type: "thinking", thinking: "Only thoughts" }] }, reason: "stop" };
		})());
		const { conversation } = fixture(streamSimple);
		// When
		await conversation.send("Empty");
		const latest = (() => { try { return selectTranscript(conversation.turns, "latest"); } catch (error) { return error.message; } })();
		await conversation.send("Next");
		// Then
		assert.equal(latest, "The side conversation has no answers yet.");
		assert.deepEqual(conversation.turns.map(({ answer, note }) => ({ answer, note })),
			[{ answer: "", note: EMPTY_RESPONSE_TEXT }, { answer: "Answer", note: undefined }]);
		assert.deepEqual(streamSimple.mock.calls[1].arguments[1].messages.map(message => message.content),
			[user("Main question").content, firstQuestion("Empty"), user("Next").content]);
	});

	it("shouldNeverReplayToolCallsWhenTheModelRequestsATool", async () => {
		// Given
		const call = { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "rm -rf /" } };
		const streamSimple = mock.fn(events);
		streamSimple.mock.mockImplementationOnce(() => (async function* () {
			yield { type: "done", reason: "toolUse", message: { ...response, content: [{ type: "text", text: "Let me check." }, call], stopReason: "toolUse" } };
		})());
		streamSimple.mock.mockImplementationOnce(() => (async function* () {
			yield { type: "done", reason: "toolUse", message: { ...response, content: [call], stopReason: "toolUse" } };
		})(), 1);
		const { conversation } = fixture(streamSimple);
		// When
		await conversation.send("With text");
		await conversation.send("Only a call");
		await conversation.send("Next");
		// Then
		assert.deepEqual(conversation.turns.map(({ answer, note }) => ({ answer, note })), [
			{ answer: "Let me check.", note: TOOL_REQUEST_TEXT }, { answer: "", note: TOOL_REQUEST_TEXT }, { answer: "Answer", note: undefined },
		]);
		const replayed = streamSimple.mock.calls[2].arguments[1].messages;
		assert.deepEqual(replayed.map(message => message.content), [
			user("Main question").content, firstQuestion("With text"), [{ type: "text", text: "Let me check." }],
			user("Only a call").content, user("Next").content,
		]);
	});

	it("shouldTrackSendingThinkingStreamingAndDonePhasesWithUsage", async () => {
		// Given
		const usage = { input: 200, output: 30, cacheRead: 1800, cacheWrite: 0, totalTokens: 2030, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
		const thinking = { ...response, content: [{ type: "thinking", thinking: "Comparing options" }] };
		const streamSimple = mock.fn(() => (async function* () {
			yield { type: "thinking_delta", partial: thinking };
			yield { type: "text_delta", partial: response };
			yield { type: "done", message: { ...response, usage }, reason: "stop" };
		})());
		const { conversation } = fixture(streamSimple);
		const phases = [];
		conversation.onChange = () => phases.push(conversation.progress?.phase);
		// When
		await conversation.send("Question");
		// Then
		assert.deepEqual([...new Set(phases)], ["sending", "thinking", "streaming", "done"]);
		const { progress } = conversation;
		assert.deepEqual({ thinking: progress.thinking, answerChars: progress.answerChars, usage: progress.usage },
			{ thinking: "Comparing options", answerChars: "Answer".length, usage });
		assert.ok(progress.startedAt <= progress.firstTextAt && progress.firstTextAt <= progress.endedAt);
	});

	it("shouldRetryOnlyAnUnansweredQuestionAndReplaceItsFailedAttempt", async () => {
		// Given
		const streamSimple = mock.fn(events);
		const { conversation } = fixture(streamSimple);
		await conversation.send("First question");
		streamSimple.mock.mockImplementationOnce(() => (async function* () { throw new Error("Connection failed"); })());
		await conversation.send("Follow up");
		// When
		const retryable = conversation.canRetry;
		await conversation.retry();
		await conversation.retry();
		// Then
		assert.equal(retryable, true);
		assert.equal(streamSimple.mock.calls.length, 3);
		assert.deepEqual(streamSimple.mock.calls[2].arguments[1].messages.map(message => message.content), [
			user("Main question").content, firstQuestion("First question"), response.content, user("Follow up").content,
		]);
		assert.deepEqual({ status: conversation.status, canRetry: conversation.canRetry,
			turns: conversation.turns.map(({ question, answer, note }) => ({ question, answer, note })) },
			{ status: CHAT_STATUS.ready, canRetry: false, turns: [
				{ question: "First question", answer: "Answer", note: undefined }, { question: "Follow up", answer: "Answer", note: undefined },
			] });
	});

	it("shouldResendTheInstructionsWhenRetryingACancelledFirstQuestion", async () => {
		// Given
		const { conversation, streamSimple, release } = blockedFixture();
		const running = conversation.send("First");
		conversation.cancel();
		release();
		await running;
		// When
		await conversation.retry();
		// Then
		assert.deepEqual(streamSimple.mock.calls[1].arguments[1].messages.at(-1).content, firstQuestion("First"));
		assert.deepEqual(conversation.turns.map(turn => turn.answer), ["Answer"]);
	});

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
