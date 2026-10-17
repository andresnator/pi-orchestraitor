import assert from "node:assert/strict";
import test from "node:test";
import { createUISession, fakeUIContext, importHost, loadUiModule, pi } from "./helpers/ui-harness.mjs";

const questionArgs = { questions: [{ id: "q", prompt: "Choose", selection: "single", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] }] };
const statusKey = "orchestraitor:status";

async function seed(ui) {
	const { session } = ui, runner = session.extensionRunner;
	const target = session.sessionManager.appendMessage({ role: "user", content: "Start here", timestamp: Date.now() });
	session.sessionManager.appendMessage({ role: "toolResult", toolName: "subagent_run", toolCallId: "persisted", content: [], isError: false, timestamp: Date.now(),
		details: { results: [{ id: "persisted-agent", role: "review", status: "completed", terminated: true }] } });
	session.sessionManager.appendMessage({ role: "user", content: "Continue the local inspection", timestamp: Date.now() });
	await runner.emit({ type: "tool_execution_start", toolName: "subagent_run", toolCallId: "agents", args: { tasks: [{ role: "explore", instruction: "Inspect locally" }] } });
	return target;
}

async function agentsPanel(ui) {
	const { session, ctx, dialogs } = ui, runner = session.extensionRunner;
	const opened = Promise.withResolvers(), original = ctx.ui.custom;
	ctx.ui.custom = (...args) => { const result = original(...args); opened.resolve(); return result; };
	const pending = runner.getCommand("orchestraitor:agents").handler("", runner.createCommandContext());
	await Promise.race([opened.promise, pending.then(() => { throw new Error("Panel did not open"); })]);
	const panel = dialogs.at(-1), text = panel.component.render(100).join("\n");
	panel.done({ status: "closed" });
	await pending;
	ctx.ui.custom = original;
	return text;
}

async function checkNewInteractions(ui) {
	const { session, ctx, dialogs } = ui, runner = session.extensionRunner;
	assert.match(await agentsPanel(ui), /Inspect locally/);
	const original = ctx.ui.custom;
	ctx.ui.custom = (...args) => {
		const pending = original(...args);
		const card = dialogs.at(-1).component;
		for (const key of ["\r", "\x1b[B", "\x1b[B", "\r", "\x1b[B", "\r"]) card.handleInput(key);
		return pending;
	};
	const ask = runner.getAllRegisteredTools().find(({ definition }) => definition.name === "orchestraitor_ask").definition;
	assert.equal((await ask.execute("new-question", questionArgs, undefined, undefined, runner.createToolContext("new-question"))).details.status, "answered");
	ctx.ui.custom = original;
}

for (const action of ["tree-veto", "summary-abort", "switch-veto", "fork-veto"]) for (const hidden of [false, true]) {
	test(`shouldPreserveBranchAndUiWhenNavigationIs${action}AndHiddenIs${hidden}`, { timeout: 5000 }, async (t) => {
		const event = action === "tree-veto" ? "session_before_tree" : action === "switch-veto" ? "session_before_switch" : "session_before_fork";
		let vetoes = 0;
		const ui = await createUISession(t, "tui", { extensionFactories: action === "summary-abort" ? [] : [(api) => {
			api.on(event, () => { vetoes++; return { cancel: true }; });
		}] });
		const { session, ctx, statuses, errors } = ui, runner = session.extensionRunner;
		const target = await seed(ui);
		if (hidden) await runner.getCommand("orchestraitor:ui").handler("hide", runner.createCommandContext());
		const branch = session.sessionManager.getBranch(), leaf = session.sessionManager.getLeafId();
		const opened = Promise.withResolvers(), late = Promise.withResolvers();
		const originalCustom = ctx.ui.custom;
		ctx.ui.custom = (factory, options) => originalCustom((tui, theme, keys, done) => {
			const component = factory(tui, theme, keys, done);
			// Deliver a late old completion after native cancellation; it must not
			// close a replacement question or become an accepted answer.
			late.promise.then(() => done({ status: "answered", answers: [{ id: "q", values: ["a"] }] }));
			opened.resolve();
			return component;
		}, options);
		const ask = runner.getAllRegisteredTools().find(({ definition }) => definition.name === "orchestraitor_ask").definition;
		const oldQuestion = ask.execute("old-question", questionArgs, undefined, undefined, runner.createToolContext("old-question"));
		await opened.promise;
		ctx.ui.custom = originalCustom;
		let result;
		if (action === "summary-abort") {
			const { createAssistantMessageEventStream } = await importHost("node_modules/@earendil-works/pi-ai/dist/index.js");
			const summarizing = Promise.withResolvers();
			session.modelRuntime.registerProvider("navigation-fixture", {
				api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "fixture",
				models: [{ id: "model", name: "Local summary fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1024 }],
				streamSimple(model, _context, options) {
					const stream = createAssistantMessageEventStream();
					options.signal.addEventListener("abort", () => {
						const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: "aborted", content: [],
							usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
						stream.push({ type: "error", reason: "aborted", error: message }); stream.end(message);
					}, { once: true });
					summarizing.resolve(); return stream;
				},
			});
			await session.setModel((await session.modelRuntime.getAvailable()).find(({ provider }) => provider === "navigation-fixture"));
			// setModel appends its own entry; retain the effective branch for the cancellation check.
			const before = session.sessionManager.getBranch();
			const navigating = session.navigateTree(target, { summarize: true });
			await Promise.race([summarizing.promise, navigating.then(() => { throw new Error("Summary did not start"); })]);
			session.abortBranchSummary();
			result = await navigating;
			assert.deepEqual(session.sessionManager.getBranch(), before);
			assert.equal(result.aborted, true);
		} else if (action === "tree-veto") result = await session.navigateTree(target);
		else {
			const runtime = new pi.AgentSessionRuntime(session, { cwd: session.sessionManager.getCwd() }, () => { throw new Error("Veto must prevent session replacement"); });
			result = action === "switch-veto" ? await runtime.switchSession("unused-session.jsonl") : await runtime.fork(target);
		}
		assert.equal(result.cancelled, true);
		if (action !== "summary-abort") {
			assert.equal(vetoes, 1);
			assert.equal(session.sessionManager.getLeafId(), leaf);
			assert.deepEqual(session.sessionManager.getBranch(), branch);
		}
		assert.equal((await oldQuestion).details.status, "cancelled");
		late.resolve("1. A");
		assert.equal(statuses.get(statusKey), hidden ? undefined : "Agents · 1 active");
		await checkNewInteractions(ui);
		if (hidden) {
			assert.equal(statuses.has(statusKey), false);
			await runner.getCommand("orchestraitor:ui").handler("show", runner.createCommandContext());
		}
		assert.equal(statuses.get(statusKey), "Agents · 1 active");
		assert.deepEqual(errors, []);
	});
}

test("shouldReconstructEffectiveBranchAfterCompletedNativeTreeNavigation", async (t) => {
	const ui = await createUISession(t), { session, statuses, errors } = ui;
	const target = await seed(ui), leaf = session.sessionManager.getLeafId();
	assert.equal((await session.navigateTree(target)).cancelled, false);
	assert.equal(statuses.has(statusKey), false);
	assert.doesNotMatch(await agentsPanel(ui), /persisted-agent/);
	assert.equal((await session.navigateTree(leaf)).cancelled, false);
	assert.match(await agentsPanel(ui), /persisted-agent · review/);
	assert.deepEqual(errors, []);
});

for (const kind of ["native", "modal"]) {
	test(`shouldReleaseCancelled${kind}BeforeOldCompletionWithoutClosingNewQuestion`, async (t) => {
		const { createUIOwner } = await loadUiModule(t, "extensions/status-ui.ts");
		const { ctx, dialogs, statuses } = fakeUIContext();
		const owner = createUIOwner();
		owner.activate(ctx); owner.setStatus("Retained");
		const old = Promise.withResolvers();
		const first = kind === "native" ? owner.interaction(() => old.promise) : owner.modal("question", () => ({ render: () => [], invalidate() {} }));
		await Promise.resolve();
		const generation = owner.generation;
		owner.cancelInteractions();
		const next = owner.modal("question", () => ({ render: () => [], invalidate() {} }));
		assert.equal(owner.generation, generation + 1);
		assert.equal(owner.isCurrent(ctx), true);
		assert.deepEqual(await first, { status: "cancelled" });
		old.resolve({ status: "answered" });
		await Promise.resolve();
		assert.equal(owner.awaitingInput, true);
		assert.equal(statuses.get(statusKey), "Retained");
		dialogs.at(-1).done({ status: "answered" });
		assert.deepEqual(await next, { status: "answered" });
	});
}
