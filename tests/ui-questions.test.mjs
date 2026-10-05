import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { createUISession, fakeUIContext, importHost, loadUiModule, plainTheme, tui } from "./helpers/ui-harness.mjs";

const choice = (id = "opaque-id") => ({ id, prompt: "Pick a marker", selection: "single", options: [{ label: "Alpha", value: "opaque/alpha" }, { label: "Beta", value: "opaque/beta" }] });
const keys = { matches: (data, action) => ({ "tui.select.cancel": "\x1b", "tui.select.pageDown": "\x1b[6~", "tui.select.pageUp": "\x1b[5~" })[action] === data };
const down = "\x1b[B", enter = "\r";

test("shouldRenderApprovedBorderedRadioCheckboxTextAndReviewCards", async (t) => {
	// Given
	const { createQuestionnaire } = await setup(t);
	const frame = selection => createQuestionnaire([{ ...choice(), selection, allowText: true }], { terminal: { rows: 24 }, requestRender() {} }, () => plainTheme, keys, () => {});
	const single = frame("single"), multiple = frame("multiple");
	// When / Then
	assert.match(single.render(80).join("\n"), /╭.*QUESTION/);
	assert.match(single.render(80).join("\n"), /\( \)/);
	assert.match(multiple.render(80).join("\n"), /\[ \]/);
	single.handleInput(enter); assert.match(single.render(80).join("\n"), /\(●\)/);
	for (const key of [down, down, enter]) single.handleInput(key);
	single.focused = true;
	assert.match(single.render(80).join("\n"), /TEXT ENTRY/);
	single.handleInput("Exact draft"); single.handleInput(enter);
	assert.match(single.render(80).join("\n"), /REVIEW/);
	assert.match(single.render(80).join("\n"), /Submit answers/);
});

test("shouldReserveNativeLayoutRowsWhenQuestionCardUsesAShortTerminal", async (t) => {
	// Given
	const { createQuestionnaire } = await setup(t);
	const outcomes = [];
	const component = createQuestionnaire([{ ...choice(), allowText: true }], { terminal: { rows: 12 }, requestRender() {} }, () => plainTheme, keys, result => outcomes.push(result));
	// When
	const lines = component.render(64);
	// Then
	assert.ok(lines.length <= 6, "Native footer, status/widget and chat spacing must remain outside the card");
	assert.match(lines[0], /QUESTION/);
	assert.match(lines.at(-1), /^╰/);
	assert.deepEqual(outcomes, []);
});

test("shouldBoundQuestionCardHeightAndHonorResolvedNativeHintsAcrossThemes", async (t) => {
	// Given
	const { createQuestionnaire } = await setup(t);
	const configured = { ...keys, getKeys: action => action === "tui.select.cancel" ? ["ctrl+q"] : ["enter"] };
	let theme = plainTheme;
	const component = createQuestionnaire([{ ...choice(), prompt: "日本語 🧩 café ".repeat(50), allowText: true }], { terminal: { rows: 13 }, requestRender() {} }, () => theme, configured, () => {});
	// When / Then
	for (const width of [1, 20, 40, 48, 80, 120]) {
		const lines = component.render(width);
		assert.ok(lines.every(line => tui.visibleWidth(line) <= width));
		assert.ok(lines.length <= 13);
	}
	assert.match(component.render(120).join("\n"), /ctrl\+q/);
	theme = { ...plainTheme, fg: (_token, text) => `\x1b[32m${text}\x1b[0m` }; component.invalidate();
	assert.match(component.render(80).join("\n"), /\x1b\[32m/);
});

test("shouldSynchronizeEveryTransitionWithoutRenderBetweenQuestionnaireKeystrokes", async (t) => {
	const { createQuestionnaire } = await setup(t);
	const outcomes = [];
	const component = createQuestionnaire([choice("first"), { ...choice("last"), allowText: true }],
		{ terminal: { rows: 20 }, requestRender() {} }, () => plainTheme, keys, (value) => outcomes.push(value));
	const press = (...inputs) => inputs.forEach((data) => component.handleInput(data));
	component.focused = true;
	component.render(40);
	press(enter, down, down, enter); // Answer first and advance without rendering.
	press(down, down, enter, "free text", enter, enter); // Save last text, then reopen first review row.
	assert.deepEqual(outcomes, []); // Neither Enter submits the form implicitly.
	press(down, enter, down, enter); // Correct first answer to Beta, advance again.
	press(down, down, down, enter); // Keep last text and enter review.
	assert.deepEqual(outcomes, []);
	press(down, down, enter); // Explicit submission on the new review controls.
	assert.deepEqual(outcomes, [{ status: "answered", answers: [
		{ id: "first", values: ["opaque/beta"] }, { id: "last", values: [], text: "free text" },
	] }]);
});

test("shouldBackOutOfTextEntryBeforeCancellingWhenNativeEscapeBindingsOverlap", async (t) => {
	// Given
	const { createQuestionnaire } = await setup(t);
	const { KeybindingsManager } = await importHost("dist/core/keybindings.js");
	const nativeKeys = new KeybindingsManager();
	const outcomes = [];
	const component = createQuestionnaire([{ ...choice(), allowText: true }], { terminal: { rows: 24 }, requestRender() {} }, () => plainTheme, nativeKeys, result => outcomes.push(result));
	component.focused = true;
	for (const key of [down, down, enter, "Unsubmitted draft"]) component.handleInput(key);
	assert.equal(nativeKeys.matches("\x1b", "app.interrupt"), true);
	assert.equal(nativeKeys.matches("\x1b", "tui.select.cancel"), true);
	// When
	component.handleInput("\x1b");
	// Then
	assert.match(component.render(80).join("\n"), /CHOICES/);
	assert.deepEqual(outcomes, []);
	component.handleInput("\x1b");
	assert.deepEqual(outcomes, [{ status: "cancelled" }]);
});

test("shouldRetainConfiguredWholeQuestionInterruptDuringTextEntry", async (t) => {
	// Given
	const { createQuestionnaire } = await setup(t);
	const { KeybindingsManager } = await importHost("dist/core/keybindings.js");
	const nativeKeys = new KeybindingsManager({ "app.interrupt": "ctrl+x", "tui.select.cancel": "ctrl+q" });
	const outcomes = [];
	const component = createQuestionnaire([{ ...choice(), allowText: true }], { terminal: { rows: 24 }, requestRender() {} }, () => plainTheme, nativeKeys, result => outcomes.push(result));
	component.focused = true;
	for (const key of [down, down, enter, "Unsubmitted draft"]) component.handleInput(key);
	// When
	component.handleInput("\x18");
	// Then
	assert.deepEqual(outcomes, [{ status: "cancelled" }]);
});

test("shouldTransferTextFocusImmediatelyWhenEditingStartsAndEndsWithoutRender", async (t) => {
	const { createQuestionnaire } = await setup(t);
	let editor;
	const original = tui.Input.prototype.handleInput;
	t.mock.method(tui.Input.prototype, "handleInput", function(data) { editor = this; return original.call(this, data); });
	const component = createQuestionnaire([{ ...choice(), allowText: true }],
		{ terminal: { rows: 20 }, requestRender() {} }, () => plainTheme, keys, () => {});
	component.focused = true;
	component.render(40);
	for (const data of [down, down, enter, "draft"]) component.handleInput(data);
	assert.equal(editor.focused, true);
	component.handleInput("\x1b");
	assert.equal(editor.focused, false);
	component.handleInput(enter); // Escape kept the selection on Write text.
	component.handleInput("saved");
	assert.equal(editor.focused, true);
	component.handleInput(enter);
	assert.equal(editor.focused, false);
});

for (const ending of ["submit", "cancel", "dispose"]) {
	test(`shouldIgnoreAllFurtherInputAfterQuestionnaireEndsBy${ending}`, async (t) => {
		const { createQuestionnaire } = await setup(t);
		const outcomes = [];
		const component = createQuestionnaire([choice()], { terminal: { rows: 20 }, requestRender() {} },
			() => plainTheme, keys, (value) => outcomes.push(value));
		for (const data of [enter, down, down, enter, down]) { component.render(40); component.handleInput(data); }
		component.render(40);
		if (ending === "dispose") component.dispose();
		else component.handleInput(ending === "submit" ? enter : "\x1b");
		const expected = structuredClone(outcomes);
		for (const data of [enter, enter, down, enter, "\x1b"]) component.handleInput(data);
		assert.equal(expected.length, ending === "dispose" ? 0 : 1);
		assert.deepEqual(outcomes, expected);
	});
}

async function setup(t, mode = "tui") {
	const question = await loadUiModule(t, "extensions/ui/questions.ts");
	const { createUIOwner } = await loadUiModule(t, "extensions/status-ui.ts");
	const ui = fakeUIContext(mode);
	const owner = createUIOwner();
	owner.activate(ui.ctx);
	return { ...question, ...ui, owner, tool: question.createQuestionTool(owner) };
}

for (const [input, pattern] of [
	[{ questions: [] }, /question/i],
	[{ questions: Array.from({ length: 7 }, (_, i) => choice(String(i))) }, /question/i],
	[{ questions: [choice(), choice()] }, /unique/i],
	[{ questions: [{ ...choice(), options: [choice().options[0], choice().options[0]] }] }, /unique/i],
	[{ questions: [{ ...choice(), options: [choice().options[0]] }] }, /option/i],
	[{ questions: [{ ...choice(), prompt: "x".repeat(1001) }] }, /prompt/i],
	[{ questions: [{ ...choice(), selection: "automatic" }] }, /selection/i],
	[{ questions: [{ ...choice(), allowText: "yes" }] }, /allowText/i],
]) {
	test(`shouldRejectBeforeOpeningUiWhenQuestionsAre${JSON.stringify(input).slice(0, 85)}`, async (t) => {
		// Given
		const { tool, ctx, calls, dialogs } = await setup(t);
		// When / Then
		await assert.rejects(tool.execute("invalid", input, undefined, undefined, ctx), pattern);
		assert.deepEqual({ calls, dialogs }, { calls: [], dialogs: [] });
	});
}

for (const mode of ["rpc", "json", "print"]) {
	test(`shouldReturnUnavailableWithoutDefaultsWhenModeIs${mode}`, async (t) => {
		// Given
		const { tool, ctx, calls } = await setup(t, mode);
		// When
		const result = await tool.execute("ask", { questions: [choice()] }, undefined, undefined, ctx);
		// Then
		assert.deepEqual({ details: result.details, calls }, { details: { version: 1, status: "unavailable" }, calls: [] });
	});
}

test("shouldPreserveOpaqueIdsAndValuesAndAllowCorrectionWhenNativeSingleChoiceSubmits", async (t) => {
	// Given
	const { tool, ctx, dialogs } = await setup(t);
	const question = choice("id\x1b[31m原");
	question.options[1] = { label: "\x1b[31mBeta\x1b[0m\nnext", value: "\x1b[32mexact\nopaque" };
	const pending = tool.execute("ask", { questions: [question] }, undefined, undefined, ctx);
	await Promise.resolve();
	const component = dialogs.at(-1)?.component;
	assert.ok(component, "Simple questions must use the same native card");
	// When
	for (const key of [down, enter, down, enter, enter]) component.handleInput(key); // Choose Beta, review, then correct.
	for (const key of [enter, down, down, enter, down, enter]) component.handleInput(key); // Choose Alpha, review and explicitly submit.
	const result = await pending;
	// Then
	assert.deepEqual(result.details, { version: 1, status: "answered", answers: [{ id: question.id, values: ["opaque/alpha"] }] });
	assert.doesNotMatch(stripVTControlCharacters(component.render(80).join("\n")), /\x1b/);
	assert.equal(tool.exposure, "model-only");
	assert.equal(tool.executionMode, "sequential");
});

for (const action of ["cancel", "abort", "session-change"]) {
	test(`shouldDiscardAllAnswersWhenNativeInteractionEndsBy${action}`, { timeout: 3000 }, async (t) => {
		// Given
		const { tool, owner, ctx, dialogs } = await setup(t);
		const controller = new AbortController();
		const pending = tool.execute("ask", { questions: [choice()] }, controller.signal, undefined, ctx);
		await Promise.resolve();
		assert.ok(dialogs.at(-1));
		// When
		if (action === "cancel") dialogs.at(-1).done({ status: "cancelled" });
		else if (action === "abort") controller.abort();
		else owner.activate(ctx);
		// Then
		assert.deepEqual((await pending).details, { version: 1, status: "cancelled" });
		assert.equal(owner.awaitingInput, false);
	});
}

test("shouldRejectConcurrentQuestionAndPanelWithoutDisplacingInputWhenNativeDialogIsOwned", async (t) => {
	// Given
	const { tool, owner, ctx, dialogs } = await setup(t);
	const first = tool.execute("ask", { questions: [choice()] }, undefined, undefined, ctx);
	await Promise.resolve();
	// When
	const second = await tool.execute("ask2", { questions: [choice()] }, undefined, undefined, ctx);
	const panel = await owner.modal("panel", () => ({ render: () => [], invalidate() {} }));
	dialogs[0].done({ status: "cancelled" });
	// Then
	assert.deepEqual({ second: second.details, panel, first: (await first).details }, {
		second: { version: 1, status: "busy" }, panel: { status: "busy" }, first: { version: 1, status: "cancelled" },
	});
});

test("shouldValidateRequiredAnswersAndExactOptionValuesWhenFormIsSubmitted", async (t) => {
	// Given
	const { validateQuestions, validateAnswers } = await setup(t);
	const questions = validateQuestions({ questions: [choice(), { ...choice("text"), allowText: true }] });
	// When / Then
	assert.throws(() => validateAnswers(questions, []), /required/i);
	assert.throws(() => validateAnswers(questions, [{ id: questions[0].id, values: ["default"] }]), /value/i);
	assert.throws(() => validateAnswers(questions, [{ id: questions[0].id, values: [], text: "not allowed" }]), /text/i);
	assert.throws(() => validateAnswers(questions, [{ id: questions[0].id, values: ["opaque/alpha", "opaque/alpha"] }]), /single|unique/i);
	assert.throws(() => validateAnswers(questions, [{ id: "unknown", values: [] }]), /unknown/i);
	const answers = [{ id: questions[0].id, values: ["opaque/alpha"] }, { id: "text", values: [], text: "  原 é  " }];
	assert.deepEqual(validateAnswers(questions, answers), answers);
});

test("shouldUseNativeSelectionInputAndScrollWithoutImplicitApprovalWhenQuestionnaireIsCorrected", async (t) => {
	// Given
	const { createQuestionnaire, validateQuestions } = await setup(t);
	const questions = validateQuestions({ questions: [{ ...choice("many"), selection: "multiple" }, { ...choice("text"), allowText: true }] });
	let result;
	const terminal = { rows: 20, columns: 40 };
	const component = createQuestionnaire(questions, { terminal, requestRender() {} }, () => plainTheme, keys, (value) => { result = value; });
	const input = (data) => { component.render(40); component.handleInput(data); };
	// When
	input(enter); // Explicitly choose first option.
	input(down); input(enter); // Explicitly choose second option.
	input(down); input(enter); // Continue to text question.
	input(down); input(down); input(enter); // Write text.
	component.focused = true;
	input("原é");
	const cursor = component.render(40).join("\n");
	input(enter); // Commit draft text, then review.
	input(enter); // Reopen first answer for correction.
	input(enter); // Remove first selected option.
	input(down); input(down); input(enter); // Continue to second question.
	input(down); input(down); input(down); input(enter); // Keep text and review.
	input(down); input(down); input(enter); // Submit answers explicitly.
	// Then
	assert.ok(cursor.includes(tui.CURSOR_MARKER));
	assert.deepEqual(result, { status: "answered", answers: [{ id: "many", values: ["opaque/beta"] }, { id: "text", values: [], text: "原é" }] });
	for (const width of [1, 20, 40, 80, 120]) assert.ok(component.render(width).every((line) => tui.visibleWidth(line) <= width));
	component.dispose();
});

test("shouldBlockRequiredSubmissionAndDiscardDraftsWhenQuestionnaireCancels", async (t) => {
	// Given
	const { createQuestionnaire, validateQuestions } = await setup(t);
	let result;
	const component = createQuestionnaire(validateQuestions({ questions: [{ ...choice(), selection: "multiple" }] }),
		{ terminal: { rows: 12 }, requestRender() {} }, () => plainTheme, keys, (value) => { result = value; });
	const input = (data) => { component.render(20); component.handleInput(data); };
	// When
	input(down); input(down); input(enter); // Continue without choosing.
	input(down); input(enter); // Attempt explicit submission.
	const warning = component.render(20).map(stripVTControlCharacters).join("\n");
	input("\x1b");
	// Then
	assert.match(warning, /required/i);
	assert.deepEqual(result, { status: "cancelled" });
	component.dispose();
});

for (const action of ["submit", "abort", "session-change", "unavailable"]) {
	test(`shouldPersistOnlyExplicitAnswersWhenNativeModelQuestionEndsBy${action}`, { timeout: 5000 }, async (t) => {
		// Given
		const { createAssistantMessageEventStream } = await importHost("node_modules/@earendil-works/pi-ai/dist/index.js");
		const { session, ctx, errors, dialogs } = await createUISession(t, action === "unavailable" ? "print" : "tui");
		let entered;
		const started = new Promise((resolve) => { entered = resolve; });
		let requests = 0;
		session.modelRuntime.registerProvider("question-fixture", {
			api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "fixture",
			models: [{ id: "model", name: "Local questions fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1024 }],
			streamSimple(model) {
				const stream = createAssistantMessageEventStream(), first = requests++ === 0;
				const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: first ? "toolUse" : "stop",
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					content: first ? [{ type: "toolCall", name: "orchestraitor_ask", id: "native-ask", arguments: { questions: [choice()] } }] : [{ type: "text", text: "done" }] };
				stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message); return stream;
			},
		});
		await session.setModel((await session.modelRuntime.getAvailable()).find(({ provider }) => provider === "question-fixture"));
		const original = ctx.ui.custom;
		ctx.ui.custom = (factory, options) => {
			const pending = original(factory, options); entered();
			if (action === "submit") for (const key of [enter, down, down, enter, down, enter]) dialogs.at(-1).component.handleInput(key);
			return pending;
		};
		// When
		const running = session.prompt("Use the harmless native question fixture.");
		if (action === "abort" || action === "session-change") {
			await Promise.race([started, running.then(() => { throw new Error("Native question did not open"); })]);
			if (action === "abort") await session.abort();
			else await session.extensionRunner.emit({ type: "session_before_switch", reason: "new" });
		}
		await running;
		const receipts = session.messages.filter((message) => message.role === "toolResult" && message.toolName === "orchestraitor_ask");
		// Then
		assert.deepEqual(errors, []);
		assert.equal(receipts.length, 1);
		if (action === "submit") assert.deepEqual(receipts[0].details, { version: 1, status: "answered", answers: [{ id: "opaque-id", values: ["opaque/alpha"] }] });
		else if (action === "unavailable") assert.deepEqual(receipts[0].details, { version: 1, status: "unavailable" });
		else assert.ok(receipts.every((message) => message.details?.status !== "answered" && !message.details?.answers));
	});
}

test("shouldRejectStaleContextWithoutOpeningNewSessionUiWhenOwnerWasReactivated", async (t) => {
	// Given
	const { tool, owner, ctx } = await setup(t);
	const next = fakeUIContext();
	let opened = 0;
	next.ctx.ui.select = async (_title, options) => { opened++; return options[0]; };
	owner.activate(next.ctx);
	// When
	const result = await tool.execute("stale", { questions: [choice()] }, undefined, undefined, ctx);
	// Then
	assert.deepEqual({ details: result.details, opened }, { details: { version: 1, status: "cancelled" }, opened: 0 });
});

test("shouldHonorConfiguredNativeInterruptWithoutSubmittingTextWhenInputHasFocus", async (t) => {
	// Given
	const { createQuestionnaire, validateQuestions } = await setup(t);
	let result;
	const configured = { matches: (data, action) => action === "app.interrupt" && data === "\x03" };
	const component = createQuestionnaire(validateQuestions({ questions: [{ ...choice(), allowText: true }] }),
		{ terminal: { rows: 20 }, requestRender() {} }, () => plainTheme, configured, (value) => { result = value; });
	const input = (data) => { component.render(40); component.handleInput(data); };
	input(down); input(down); input(enter); input("draft");
	// When
	input("\x03");
	// Then
	assert.deepEqual(result, { status: "cancelled" });
	component.dispose();
});

test("shouldRejectNativeNestedExecutionWhenQuestionToolIsModelOnly", async (t) => {
	// Given
	const { session, dialogs } = await createUISession(t, "tui");
	const ctx = session.extensionRunner.createToolContext("probe", undefined);
	// When
	const result = await ctx.executeTool("orchestraitor_ask", { questions: [choice()] });
	// Then
	assert.equal(result.isError, true);
	assert.ok(!ctx.tools.some(({ name }) => name === "orchestraitor_ask"));
	assert.deepEqual(dialogs, []);
});
