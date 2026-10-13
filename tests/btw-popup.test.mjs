import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import {
	initTheme, CURSOR_MARKER, KeybindingsManager, TUI_KEYBINDINGS, visibleWidth,
	BtwPopup, BUSY_HELP, EMPTY_RESPONSE_TEXT, FOOTER_HELP, LOADING_TEXT, STATUS_TICK_MS, SideConversation, firstQuestion, waitFor,
} from "./helpers/btw-harness.mjs";

const QUESTION = "¿Qué hemos decidido?";
const ANSWER = "Usar una ventana emergente.";
const MODEL = { id: "test-model", provider: "test-provider" };
const theme = { fg: (_color, text) => text };
const user = (text) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });
const response = (text = ANSWER) => ({
	role: "assistant", content: [{ type: "text", text }],
	api: "openai-completions", provider: MODEL.provider, model: MODEL.id, stopReason: "stop", timestamp: 1,
});
const streamEvents = (...events) => (async function* () { yield* events; })();

before(() => initTheme("dark", false));

function fixture(streamSimple = mock.fn(() => streamEvents({ type: "done", message: response(), reason: "stop" })), rows = 24) {
	const tui = { terminal: { rows }, requestRender: mock.fn() };
	const done = mock.fn();
	const context = { messages: [user("Main question")], tools: [] };
	const ctx = { model: MODEL, modelRegistry: { streamSimple } };
	const conversation = new SideConversation(ctx, context);
	const popup = new BtwPopup(tui, theme, new KeybindingsManager(TUI_KEYBINDINGS), conversation, done);
	return { popup, tui, done, streamSimple, context, ctx };
}

describe("popup", () => {
	it("shouldOpenWithTheInputFocusedWithoutCallingTheModel", () => {
		// Given
		const { popup, streamSimple } = fixture();
		// When
		const lines = popup.render(100);
		popup.handleInput("Hola");
		// Then
		assert.deepEqual({ focused: popup.focused, cursor: lines.some(line => line.includes(CURSOR_MARKER)),
			requests: streamSimple.mock.calls.length }, { focused: true, cursor: true, requests: 0 });
		assert.ok(popup.render(100).join("\n").includes("Hola"));
	});

	it("shouldSendTypedQuestionsAndKeepFollowupsInsideThePopup", async () => {
		// Given
		const { popup, streamSimple, done } = fixture();
		// When
		popup.handleInput(QUESTION);
		popup.handleInput("\r");
		await waitFor(() => assert.ok(popup.render(100).join("\n").includes(ANSWER)));
		popup.handleInput("Explica por qué");
		popup.handleInput("\r");
		await waitFor(() => assert.equal(streamSimple.mock.calls.length, 2));
		// Then
		assert.deepEqual(streamSimple.mock.calls[1].arguments[1].messages.map(m => m.content), [
			user("Main question").content, firstQuestion(QUESTION), response().content, user("Explica por qué").content,
		]);
		assert.equal(done.mock.calls.length, 0);
	});

	it("shouldInsertNewlinesWithoutSubmittingWhenShiftEnterIsPressed", async () => {
		// Given
		const { popup, streamSimple } = fixture();
		// When
		popup.handleInput("Primera línea");
		popup.handleInput("\u001b[13;2u");
		popup.handleInput("Segunda línea");
		// Then
		assert.equal(streamSimple.mock.calls.length, 0);
		// When
		popup.handleInput("\r");
		await waitFor(() => assert.equal(streamSimple.mock.calls.length, 1));
		// Then
		assert.deepEqual(streamSimple.mock.calls[0].arguments[1].messages.at(-1).content, firstQuestion("Primera línea\nSegunda línea"));
	});

	it("shouldCancelBeforeClosingAndIgnoreLateEventsWhenEscapeIsPressedTwice", async () => {
		// Given
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		const streamSimple = mock.fn(() => (async function* () {
			await gate;
			yield { type: "done", message: response(), reason: "stop" };
		})());
		const { popup, tui, done } = fixture(streamSimple);
		const running = popup.submit(QUESTION);
		// When
		popup.handleInput("\u001b");
		// Then
		assert.deepEqual({ aborted: streamSimple.mock.calls[0].arguments[2].signal.aborted, closes: done.mock.calls.length },
			{ aborted: true, closes: 0 });
		// When
		popup.handleInput("\u001b");
		const rendersAfterClose = tui.requestRender.mock.calls.length;
		release();
		await running;
		// Then
		assert.deepEqual({ closes: done.mock.calls.length, renders: tui.requestRender.mock.calls.length,
			focused: popup.focused }, { closes: 1, renders: rendersAfterClose, focused: false });
	});

	it("shouldQueueQuestionsWhenAlreadyResponding", async () => {
		// Given
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		const streamSimple = mock.fn(() => streamEvents({ type: "done", message: response("Nueva respuesta"), reason: "stop" }));
		streamSimple.mock.mockImplementationOnce(() => (async function* () {
			await gate;
			yield { type: "done", message: response(), reason: "stop" };
		})());
		const { popup } = fixture(streamSimple);
		const running = popup.submit(QUESTION);
		// When
		popup.handleInput("Mi borrador");
		popup.handleInput("\r");
		// Then
		assert.equal(streamSimple.mock.calls.length, 1);
		assert.ok(popup.render(100).join("\n").includes("1 queued"));
		// When
		release();
		await running;
		await waitFor(() => assert.ok(popup.render(100).join("\n").includes("Nueva respuesta")));
		// Then
		assert.deepEqual(streamSimple.mock.calls[1].arguments[1].messages.at(-1).content, user("Mi borrador").content);
		assert.deepEqual(streamSimple.mock.calls[1].arguments[1].messages.map(message => message.content), [
			user("Main question").content, firstQuestion(QUESTION), response().content, user("Mi borrador").content,
		]);
	});

	it("shouldDisplayProviderErrorsInsideThePopup", async () => {
		// Given
		const { popup } = fixture(mock.fn(() => { throw new Error("Authentication unavailable"); }));
		// When
		await popup.submit(QUESTION);
		// Then
		assert.match(popup.render(100).join("\n"), /Error[\s\S]*Authentication unavailable/);
	});

	it("shouldDisplayAFallbackWhenTheModelReturnsNoText", async () => {
		// Given
		const { popup } = fixture(mock.fn(() => streamEvents({ type: "done", message: response(""), reason: "stop" })));
		// When
		await popup.submit(QUESTION);
		// Then
		assert.ok(popup.render(100).join("\n").includes(EMPTY_RESPONSE_TEXT));
	});

	it("shouldShowThePhaseThinkingLevelAndBusyHelpWhileResponding", async () => {
		// Given
		const releases = [];
		const gates = [0, 1].map(() => new Promise(resolve => releases.push(resolve)));
		const thinking = { ...response(), content: [{ type: "thinking", thinking: "Weighing *cache* reuse" }] };
		const { popup, ctx } = fixture(mock.fn(() => (async function* () {
			await gates[0];
			yield { type: "thinking_delta", partial: thinking };
			await gates[1];
			yield { type: "done", message: response(), reason: "stop" };
		})()));
		ctx.model = { ...MODEL, reasoning: true };
		const idle = popup.render(100)[0];
		// When
		const running = popup.submit(QUESTION);
		const sending = popup.render(200).join("\n");
		releases[0]();
		await waitFor(() => assert.match(popup.render(200)[0], /◐ Thinking/));
		const thinkingScreen = popup.render(200).join("\n");
		releases[1]();
		await running;
		// Then
		assert.match(idle, /\/btw · Ready · think low /);
		assert.ok(sending.includes("◌ Sending") && sending.includes(LOADING_TEXT) && sending.includes(BUSY_HELP));
		// Escaped reasoning renders literally instead of as emphasis.
		assert.ok(thinkingScreen.includes("Weighing *cache* reuse"));
		const done = popup.render(200).join("\n");
		assert.ok(done.includes("✓ Done") && done.includes(FOOTER_HELP));
	});

	it("shouldCycleThinkingWithShiftTabAndHideThePreviewWithCtrlT", async () => {
		// Given
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		const thinking = { ...response(), content: [{ type: "thinking", thinking: "Private reasoning" }] };
		const { popup, streamSimple, ctx } = fixture(mock.fn(() => (async function* () {
			yield { type: "thinking_delta", partial: thinking };
			await gate;
			yield { type: "done", message: response(), reason: "stop" };
		})()));
		ctx.model = { ...MODEL, reasoning: true };
		// When
		const levels = [];
		for (let press = 0; press < 3; press++) { popup.handleInput("\u001b[Z"); levels.push(popup.render(200)[0].match(/think (\S+)/)[1]); }
		const running = popup.submit(QUESTION);
		await waitFor(() => assert.ok(popup.render(200).join("\n").includes("Private reasoning")));
		popup.handleInput("\u0014");
		const hidden = popup.render(200).join("\n");
		release();
		await running;
		// Then
		assert.deepEqual(levels, ["inherit:off", "off", "low"]);
		assert.equal(streamSimple.mock.calls[0].arguments[2].reasoning, "low");
		assert.ok(hidden.includes("Thinking…") && !hidden.includes("Private reasoning"));
		assert.equal(popup.render(200).join("\n").includes("Shift+Tab"), true);
	});

	it("shouldKeepThePhaseThinkingLevelAndCloseHintWhenThePopupIsNarrow", async () => {
		// Given
		const { popup, ctx } = fixture(mock.fn(() => (async function* () {
			yield { type: "text_delta", partial: response("Respuesta") };
			yield { type: "done", message: { ...response("Respuesta"), usage: { input: 200, output: 25, cacheRead: 5200, cacheWrite: 0 } }, reason: "stop" };
		})()));
		ctx.model = { ...MODEL, reasoning: true };
		ctx.thinkingLevel = "high";
		popup.handleInput("\u001b[Z");
		// When
		await popup.submit(QUESTION);
		const lines = popup.render(60);
		// Then
		assert.match(lines[0], /\/btw · ✓ Done \d\.\ds · .*think inherit:high +╮$/);
		assert.match(lines.at(-2), /↓ latest answer · Enter: send · .*Ctrl\+Q: close and discard/);
		assert.ok(lines.every(line => visibleWidth(line) <= 60));
	});

	it("shouldRefreshTheStatusOnlyWhileARequestIsRunning", async (t) => {
		// Given
		t.mock.timers.enable({ apis: ["setInterval"] });
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		const { popup, tui } = fixture(mock.fn(() => (async function* () {
			await gate;
			yield { type: "done", message: response(), reason: "stop" };
		})()));
		// When
		const running = popup.submit(QUESTION);
		const before = tui.requestRender.mock.calls.length;
		t.mock.timers.tick(STATUS_TICK_MS * 4);
		const ticking = tui.requestRender.mock.calls.length - before;
		release();
		await running;
		const after = tui.requestRender.mock.calls.length;
		t.mock.timers.tick(STATUS_TICK_MS * 4);
		// Then
		assert.deepEqual({ ticking, idle: tui.requestRender.mock.calls.length - after }, { ticking: 4, idle: 0 });
	});

	it("shouldKeepTheCursorAndLinesWithinTheTerminalWhenResizedWithAMultilineDraft", async () => {
		// Given
		const { popup, tui } = fixture();
		await popup.submit(QUESTION);
		popup.handleInput(("中文 🧠 borrador largo\n").repeat(40));
		// When / Then
		for (const rows of [1, 8, 24, 60]) {
			tui.terminal.rows = rows;
			for (const width of [1, 2, 12, 40, 100]) {
				const lines = popup.render(width);
				assert.equal(lines.length, Math.max(1, Math.floor(rows * 0.7)));
				assert.equal(lines.every(line => visibleWidth(line) <= width), true);
				if (width > 2) assert.equal(lines.some(line => line.includes(CURSOR_MARKER)), true);
			}
		}
	});

	for (const rows of [1, 6, 24]) {
		it(`shouldInsertAtTheClickedColumnWhenTerminalRowsAre${rows}`, async () => {
			// Given
			const { popup, streamSimple } = fixture(undefined, rows);
			popup.handleInput("abcdefgh");
			const lines = popup.render(80);
			const editorRow = lines.findIndex(line => line.includes("abcdefgh"));
			const clickColumn = rows === 24 ? 5 : 4;
			// When
			popup.handleMouse({ type: "click", button: "left", x: clickColumn, y: editorRow, width: 80, height: lines.length });
			popup.handleInput("X");
			popup.handleInput("\r");
			await waitFor(() => assert.equal(streamSimple.mock.calls.length, 1));
			// Then
			assert.deepEqual(streamSimple.mock.calls[0].arguments[1].messages.at(-1).content, firstQuestion("abcdXefgh"));
		});
	}

	it("shouldScrollThroughTheTranscriptWithoutMovingTheEditorCursor", async () => {
		// Given
		const text = Array.from({ length: 80 }, (_, i) => `Line ${i}`).join("\n\n");
		const { popup } = fixture(mock.fn(() => streamEvents({ type: "done", message: response(text), reason: "stop" })));
		await popup.submit(QUESTION);
		popup.render(80);
		// When
		popup.handleInput("\u001b[1;3H");
		// Then
		assert.ok(popup.render(80).join("\n").includes(QUESTION));
		// When
		popup.handleInput("\u001b[1;3F");
		// Then
		assert.ok(popup.render(80).join("\n").includes("Line 79"));
	});
});
