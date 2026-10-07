import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import {
	initTheme, SessionManager, KeybindingsManager, TUI_KEYBINDINGS,
	btw, WELCOME_TEXT, waitFor,
} from "./helpers/btw-harness.mjs";

const MODEL = { id: "main-model", provider: "test", reasoning: true };
const OTHER_MODEL = { id: "other-model", provider: "other", reasoning: true };
const ANSWER = "Private answer";
const theme = { fg: (_color, text) => text };
const user = (text) => ({ role: "user", content: text, timestamp: 1 });
const response = { role: "assistant", content: [{ type: "text", text: ANSWER }], api: "openai-completions",
	provider: MODEL.provider, model: MODEL.id, stopReason: "stop", timestamp: 1 };
const events = () => (async function* () { yield { type: "done", message: response, reason: "stop" }; })();

before(() => initTheme("dark", false));

function fixture() {
	let handler;
	let shutdown;
	const pi = {
		on: mock.fn((name, callback) => { if (name === "session_shutdown") shutdown = callback; }),
		registerCommand: mock.fn((_name, command) => { handler = command.handler; }),
		sendMessage: mock.fn(), setModel: mock.fn(), setThinkingLevel: mock.fn(),
	};
	btw(pi);
	const session = SessionManager.inMemory();
	session.appendMessage(user("Main context"));
	const streamSimple = mock.fn(events);
	const panels = [];
	const finishDialogs = [];
	const tui = { terminal: { rows: 24 }, requestRender: mock.fn() };
	const ctx = {
		mode: "tui", model: MODEL, thinkingLevel: "high", modelRegistry: { streamSimple },
		sessionManager: session, getSystemPrompt: () => "Main instructions",
		isIdle: () => false, waitForIdle: mock.fn(() => { throw new Error("Must not wait for the parent"); }),
		ui: {
			notify: mock.fn(), select: mock.fn(),
			custom: mock.fn(factory => new Promise(resolve => {
				finishDialogs.push(() => resolve(undefined));
				panels.push(factory(tui, theme, new KeybindingsManager(TUI_KEYBINDINGS), resolve));
			})),
		},
	};
	return { run: (args = "") => handler(args, ctx), shutdown: () => shutdown(), ctx, session, streamSimple, panels, pi, tui, finishDialogs };
}

function blockStream(streamSimple) {
	let release;
	const gate = new Promise(resolve => { release = resolve; });
	streamSimple.mock.mockImplementationOnce(() => (async function* () {
		yield { type: "text_delta", partial: response };
		await gate;
		yield { type: "text_delta", partial: response };
		yield { type: "done", message: response, reason: "stop" };
	})());
	return release;
}

describe("open, converse, discard", () => {
	it("shouldOpenAnEmptyPanelDirectlyWhenBtwHasNoArguments", async () => {
		// Given
		const { run, panels, streamSimple, ctx } = fixture();
		// When
		const running = run();
		const screen = panels[0].render(200).join("\n");
		panels[0].close();
		await running;
		// Then
		assert.ok(screen.includes(WELCOME_TEXT));
		assert.equal(streamSimple.mock.calls.length, 0);
		assert.equal(ctx.ui.select.mock.calls.length, 0);
		assert.equal(ctx.ui.custom.mock.calls.length, 1);
		assert.deepEqual(ctx.ui.custom.mock.calls[0].arguments[1],
			{ overlay: true, overlayOptions: { anchor: "center", width: "70%", maxHeight: "70%" } });
	});

	it("shouldSendImmediatelyWithoutChangingTheParentWhenBtwHasAQuestion", async () => {
		// Given
		const { run, panels, streamSimple, ctx, session, pi } = fixture();
		const before = structuredClone(session.getEntries());
		// When
		const running = run("Private question");
		await waitFor(() => assert.ok(panels[0].render(200).join("\n").includes(ANSWER)));
		panels[0].close();
		await running;
		// Then
		const firstRequest = streamSimple.mock.calls[0].arguments;
		assert.partialDeepStrictEqual(firstRequest, [MODEL, {
			tools: [], messages: [user("Main context"), { role: "user", content: [{ type: "text", text: "Private question" }] }],
		}, { reasoning: "high" }]);
		assert.deepEqual({ argumentCount: firstRequest.length, tools: firstRequest[1].tools,
			messageCount: firstRequest[1].messages.length, questionBlocks: firstRequest[1].messages.at(-1).content.length },
			{ argumentCount: 3, tools: [], messageCount: 2, questionBlocks: 1 });
		assert.deepEqual({ entries: session.getEntries(), imports: pi.sendMessage.mock.calls.map(call => call.arguments),
			modelChanges: pi.setModel.mock.calls.map(call => call.arguments), thinkingChanges: pi.setThinkingLevel.mock.calls.map(call => call.arguments),
			waits: ctx.waitForIdle.mock.calls.map(call => call.arguments) },
			{ entries: before, imports: [], modelChanges: [], thinkingChanges: [], waits: [] });
	});

	it("shouldUseFreshContextAndForgetAnswersAndDraftWhenReopened", async () => {
		// Given
		const { run, panels, streamSimple, session, ctx } = fixture();
		const first = run("Old private question");
		await waitFor(() => assert.ok(panels[0].render(200).join("\n").includes(ANSWER)));
		panels[0].handleInput("Old private draft");
		panels[0].handleInput("\x11");
		await first;
		session.appendMessage(user("New parent context"));
		ctx.model = OTHER_MODEL;
		ctx.thinkingLevel = "low";
		// When
		const second = run();
		const reopened = panels[1].render(200).join("\n");
		await panels[1].submit("New private question");
		panels[1].close();
		await second;
		// Then
		assert.ok(reopened.includes(WELCOME_TEXT));
		assert.doesNotMatch(reopened, /Old private|Private answer/);
		assert.deepEqual(panels[0].render(200), []);
		const secondRequest = streamSimple.mock.calls[1].arguments;
		assert.partialDeepStrictEqual(secondRequest, [OTHER_MODEL, {
			messages: [user("Main context"), user("New parent context"), { role: "user", content: [{ type: "text", text: "New private question" }] }],
		}, { reasoning: "low" }]);
		assert.deepEqual({ argumentCount: secondRequest.length, messageCount: secondRequest[1].messages.length,
			questionBlocks: secondRequest[1].messages.at(-1).content.length },
			{ argumentCount: 3, messageCount: 3, questionBlocks: 1 });
		assert.notEqual(secondRequest[2].sessionId, streamSimple.mock.calls[0].arguments[2].sessionId);
	});

	for (const method of ["close", "shutdown", "dispose"]) {
		it(`shouldAbortAndDiscardTheQueueWhenClosingVia${method}`, async () => {
			// Given
			const { run, panels, streamSimple, shutdown, pi, tui, finishDialogs } = fixture();
			const release = blockStream(streamSimple);
			const running = run("First question");
			await panels[0].submit("Queued question");
			await waitFor(() => assert.ok(panels[0].render(200).join("\n").includes(ANSWER)));
			// When
			if (method === "shutdown") shutdown();
			else if (method === "dispose") {
				// The UI may dispose the component independently while replacing its runtime.
				panels[0].dispose();
				finishDialogs[0]();
			} else panels[0].handleInput("\x11");
			const renders = tui.requestRender.mock.calls.length;
			release();
			await new Promise(resolve => setImmediate(resolve));
			await running;
			// Then
			assert.deepEqual({ aborted: streamSimple.mock.calls[0].arguments[2].signal.aborted, requests: streamSimple.mock.calls.length,
				imports: pi.sendMessage.mock.calls.map(call => call.arguments), screen: panels[0].render(200), renders: tui.requestRender.mock.calls.length },
				{ aborted: true, requests: 1, imports: [], screen: [], renders });
		});
	}

	it("shouldIgnoreTheOldStreamWhenASecondPanelOpensBeforeItFinishes", async () => {
		// Given
		const { run, panels, streamSimple, pi } = fixture();
		const release = blockStream(streamSimple);
		const first = run("Old question");
		await waitFor(() => assert.ok(panels[0].render(200).join("\n").includes(ANSWER)));
		panels[0].close();
		await first;
		// When
		const second = run("New question");
		await waitFor(() => assert.ok(panels[1].render(200).join("\n").includes(ANSWER)));
		release();
		await new Promise(resolve => setImmediate(resolve));
		const screen = panels[1].render(200).join("\n");
		panels[1].close();
		await second;
		// Then
		assert.ok(screen.includes("New question"));
		assert.ok(!screen.includes("Old question"));
		assert.equal(streamSimple.mock.calls[1].arguments[1].messages.length, 2);
		assert.equal(pi.sendMessage.mock.calls.length, 0);
	});

	for (const selection of ["latest", "1+", "1-1", "all"]) {
		it(`shouldImportOnlyTheSelectionAndCloseWhenBringUses${selection}`, async () => {
			// Given
			const { run, panels, streamSimple, pi, session } = fixture();
			const before = structuredClone(session.getEntries());
			const release = blockStream(streamSimple);
			const running = run("Private question");
			await waitFor(() => assert.ok(panels[0].render(200).join("\n").includes(ANSWER)));
			await panels[0].submit("Never sent");
			// When
			await panels[0].submit(`/bring ${selection}`);
			await running;
			release();
			await new Promise(resolve => setImmediate(resolve));
			// Then
			const content = selection === "latest" ? ANSWER : `## Question 1\nPrivate question\n\n## Answer\n${ANSWER}`;
			assert.deepEqual(pi.sendMessage.mock.calls.map(call => call.arguments),
				[[{ customType: "btw-import", content, display: true }, { triggerTurn: false }]]);
			assert.deepEqual({ aborted: streamSimple.mock.calls[0].arguments[2].signal.aborted, requests: streamSimple.mock.calls.length,
				entries: session.getEntries(), screen: panels[0].render(200) },
				{ aborted: true, requests: 1, entries: before, screen: [] });
		});
	}

	it("shouldRejectAnotherPanelWhenOneIsAlreadyOpen", async () => {
		// Given
		const { run, panels, ctx } = fixture();
		const first = run();
		// When
		await run("Second");
		panels[0].close();
		await first;
		// Then
		assert.equal(ctx.ui.custom.mock.calls.length, 1);
		assert.deepEqual(ctx.ui.notify.mock.calls.map(call => call.arguments), [["A BTW panel is already open.", "warning"]]);
	});

	it("shouldCleanUpAndAllowReopeningWhenTheUiThrowsAfterStartingARequest", async () => {
		// Given
		const { run, panels, ctx, streamSimple, tui } = fixture();
		const release = blockStream(streamSimple);
		ctx.ui.custom.mock.mockImplementationOnce(factory => {
			panels.push(factory(tui, theme, new KeybindingsManager(TUI_KEYBINDINGS), mock.fn()));
			throw new Error("UI failed");
		});
		// When
		await run("Private question");
		release();
		const second = run();
		panels[1].close();
		await second;
		// Then
		assert.deepEqual(ctx.ui.notify.mock.calls.map(call => call.arguments), [["UI failed", "error"]]);
		assert.deepEqual({ aborted: streamSimple.mock.calls[0].arguments[2].signal.aborted, screen: panels[0].render(200), openings: ctx.ui.custom.mock.calls.length },
			{ aborted: true, screen: [], openings: 2 });
	});

	it("shouldRejectNonTerminalModesWhenInvoked", async () => {
		// Given
		const { run, ctx, streamSimple } = fixture();
		ctx.mode = "rpc";
		// When
		await run("Question");
		// Then
		assert.equal(ctx.ui.custom.mock.calls.length, 0);
		assert.equal(streamSimple.mock.calls.length, 0);
		assert.deepEqual(ctx.ui.notify.mock.calls.map(call => call.arguments), [["/btw requires interactive terminal mode.", "error"]]);
	});
});
