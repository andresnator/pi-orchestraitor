import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createWorkspace, importHost, isolatedAgentDir, loadExtensions, packageRoot, pi } from "./helpers/pi-host.mjs";

const { createAssistantMessageEventStream } = await importHost("node_modules/@earendil-works/pi-ai/dist/index.js");
const EXTENSION = join(packageRoot, "extensions/context-budget.ts");
const FLAG = "orchestraitor-codemode-max-output";
const CAP = '// @options: {"max_output_tokens": 8000}';
const CALL_ID = "budget-live";
// 9,000 estimated tokens: inside Pi's 10,000 default, above the harness default of 8,000.
const LARGE_OUTPUT = 'text("x".repeat(36000));';

async function loadHandlers(t, flag) {
	const cwd = await createWorkspace(t);
	const loaded = await loadExtensions([EXTENSION], cwd);
	assert.deepEqual(loaded.errors, []);
	if (flag !== undefined) loaded.runtime.flagValues.set(FLAG, flag);
	const emit = async (type, fields) => {
		const results = [];
		for (const handler of loaded.extensions[0].handlers.get(type) ?? []) results.push(await handler({ type, ...fields }, { cwd }));
		return results;
	};
	await emit("session_start", { reason: "startup" });
	return emit;
}

/** Run one model-issued codemode call through Pi's agent loop, sandbox and extension hooks. */
async function runScript(t, code, flag) {
	const cwd = await createWorkspace(t);
	// tool_result carries the arguments that ran, after every tool_call mutation.
	const executed = [];
	const probe = (api) => api.on("tool_result", (event) => { if (event.toolCallId === CALL_ID) executed.push(event.input.code); });
	const settingsManager = pi.SettingsManager.inMemory({ codemode: { mode: "only", inlineBudget: 0 } });
	const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir: isolatedAgentDir, settingsManager,
		noExtensions: true, additionalExtensionPaths: [EXTENSION],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		extensionFactories: [pi.createCodemodeExtension(), probe],
	});
	await resourceLoader.reload();
	const { session } = await pi.createAgentSession({ cwd, agentDir: isolatedAgentDir, settingsManager, resourceLoader,
		sessionManager: pi.SessionManager.inMemory(cwd), tools: ["read", "codemode"] });
	t.after(async () => { await session.extensionRunner.emit({ type: "session_shutdown" }); session.dispose(); });
	if (flag !== undefined) session.extensionRunner.setFlagValue(FLAG, flag);
	const errors = [];
	await session.bindExtensions({ onError: (error) => errors.push(error) });
	let requests = 0;
	session.modelRuntime.registerProvider("fixture", {
		api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "fixture",
		models: [{ id: "model", name: "Local fixture", reasoning: false, input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1024 }],
		streamSimple(model) {
			const stream = createAssistantMessageEventStream();
			const first = requests++ === 0;
			const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
				timestamp: Date.now(), stopReason: first ? "toolUse" : "stop",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				content: first ? [{ type: "toolCall", id: CALL_ID, name: "codemode", arguments: { code } }]
					: [{ type: "text", text: "done" }] };
			stream.push({ type: "done", reason: message.stopReason, message });
			stream.end(message);
			return stream;
		},
	});
	await session.setModel((await session.modelRuntime.getAvailable()).find(({ provider }) => provider === "fixture"));
	await session.prompt("Run the fixture script.");
	const call = session.messages.flatMap((message) => message.role === "assistant" ? message.content : [])
		.find((block) => block.type === "toolCall" && block.id === CALL_ID);
	const result = session.messages.find((message) => message.role === "toolResult" && message.toolCallId === CALL_ID);
	const text = result.content.filter(({ type }) => type === "text").map((item) => item.text).join("");
	// Truncated output spills to a temporary file outside the workspace.
	const spill = /\[Full output: (.+) \(read with offset\/limit\)\]/.exec(text)?.[1];
	if (spill) t.after(() => rm(spill, { force: true }));
	return { errors, executed, call, result, text };
}

test("shouldCapOutputAndKeepTheTranscriptScriptWhenAModelIssuedScriptSetsNoOptions", async (t) => {
	// Given
	const code = LARGE_OUTPUT;
	// When
	const { errors, executed, call, result, text } = await runScript(t, code);
	// Then
	assert.deepEqual({ errors, executed }, { errors: [], executed: [`${CAP}\n${code}`] });
	assert.equal(result.isError, false);
	assert.match(text, /Warning: truncated output \(original token count: 9\d{3}\)/);
	assert.match(text, /\[Full output: .+ \(read with offset\/limit\)\]/);
	assert.deepEqual(call.arguments, { code });
});

for (const [name, flag] of [["TheFlagIsZero", "0"], ["TheFlagIsInvalid", "8k"]]) {
	test(`shouldKeepPiDefaultOutputWhen${name}`, async (t) => {
		// Given
		const code = LARGE_OUTPUT;
		// When
		const { errors, executed, result, text } = await runScript(t, code, flag);
		// Then
		assert.deepEqual({ errors: errors.map(({ event, error }) => ({ event, error })), executed }, {
			errors: flag === "0" ? [] : [{ event: "session_start", error: `--${FLAG} must be a non-negative integer` }],
			executed: [code],
		});
		assert.equal(result.isError, false);
		assert.doesNotMatch(text, /truncated output/);
		assert.ok(text.includes("x".repeat(36000)));
	});
}

const FRAMES = {
	RuntimeError: { code: 'const value = 1;\nthrow new Error("second line");', frame: /\(codemode\.js:2:\d+\)/ },
	SyntaxError: { code: "const value = 1;\nconst = 2;", frame: /at codemode\.js:2:\d+/ },
};
for (const [name, { code, frame }] of Object.entries(FRAMES)) {
	test(`shouldReportScriptLineNumbersWhenTheCapAddsAFirstLineAndA${name}Fails`, async (t) => {
		// Given / When
		const { errors, executed, result, text } = await runScript(t, code);
		// Then
		assert.deepEqual({ errors, executed }, { errors: [], executed: [`${CAP}\n${code}`] });
		assert.equal(result.isError, true);
		assert.match(text, /Script error:\n/);
		assert.match(text, frame);
		assert.doesNotMatch(text, /codemode\.js:3:/);
	});
}

test("shouldLeaveScriptOutputUnchangedWhenOnlyTheErrorBlockCarriesShiftedFrames", async (t) => {
	// Given
	const code = 'text("printed (codemode.js:9:1)");\nthrow new Error("second line");';
	// When
	const { executed, result, text } = await runScript(t, code);
	// Then
	assert.deepEqual(executed, [`${CAP}\n${code}`]);
	assert.equal(result.isError, true);
	assert.match(text, /printed \(codemode\.js:9:1\)[\s\S]*Script error:\n[\s\S]*\(codemode\.js:2:\d+\)/);
});

test("shouldDecideWhereTheCapGoesWhenModelIssuedScriptsArrive", async (t) => {
	// Given
	const emit = await loadHandlers(t);
	const cases = [
		{ code: "text(1);", expected: `${CAP}\ntext(1);` },
		{ code: "const a = 1;\ntext(a);", expected: `${CAP}\nconst a = 1;\ntext(a);` },
		{ code: "\ntext(1);", expected: `${CAP}\ntext(1);` },
		{ code: "  // inspect\r\ntext(1);", expected: `${CAP}\ntext(1);` },
		{ code: "// only a comment\n  ", expected: `${CAP}\n// only a comment\n  ` },
		{ code: '// @options: {"timeout_ms": 1000}\ntext(1);', expected: '// @options: {"timeout_ms": 1000}\ntext(1);' },
		{ code: '  // @options: {"max_output_tokens": 20000}\ntext(1);', expected: '  // @options: {"max_output_tokens": 20000}\ntext(1);' },
		{ code: 'text(1);\n// @options: {"max_output_tokens": 1}', expected: 'text(1);\n// @options: {"max_output_tokens": 1}' },
		{ code: "  \n ", expected: "  \n " },
	];
	// When
	const seen = [];
	for (const [index, { code }] of cases.entries()) {
		const event = { toolName: "codemode", toolCallId: `call-${index}`, input: { code } };
		seen.push({ results: await emit("tool_call", event), code: event.input.code });
	}
	// Then
	assert.deepEqual(seen, cases.map(({ expected }) => ({ results: [undefined], code: expected })));
});

test("shouldLeaveCallsUntouchedWhenTheyAreNestedForeignMalformedOrFrozen", async (t) => {
	// Given
	const emit = await loadHandlers(t);
	const events = [
		{ toolName: "codemode", toolCallId: "root/1", parentToolCallId: "root", input: { code: "text(1);" } },
		{ toolName: "read", toolCallId: "read-1", input: { path: "text(1);" } },
		{ toolName: "codemode", toolCallId: "missing", input: {} },
		{ toolName: "codemode", toolCallId: "frozen", input: Object.freeze({ code: "text(1);" }) },
	];
	const before = structuredClone(events);
	// When
	const results = [];
	for (const event of events) results.push(...await emit("tool_call", event));
	// Then
	assert.deepEqual({ events, results }, { events: before, results: [undefined, undefined, undefined, undefined] });
});

test("shouldOnlyRewriteFramesOfShiftedFailedScriptsWhenResultsArrive", async (t) => {
	// Given
	const emit = await loadHandlers(t);
	const failure = "Script error:\nError: boom\n    at check (codemode.js:1:5)\n    at <anonymous> (codemode.js:3:1)\n\nNo tool calls were made.";
	for (const toolCallId of ["shifted-failed", "shifted-ok", "shifted-blocked"]) {
		await emit("tool_call", { toolName: "codemode", toolCallId, input: { code: "text(1);" } });
	}
	await emit("tool_call", { toolName: "codemode", toolCallId: "reused", input: { code: "// note\ntext(1);" } });
	const image = { type: "image", data: "AAAA", mimeType: "image/png" };
	const result = (toolCallId, isError) => emit("tool_result", { toolName: "codemode", toolCallId, isError,
		input: {}, details: {}, content: [{ type: "text", text: "Script failed\n" }, image, { type: "text", text: failure }] });
	// When
	await emit("tool_execution_end", { toolName: "codemode", toolCallId: "shifted-blocked", isError: true, result: {} });
	const outcomes = {
		failed: await result("shifted-failed", true),
		repeated: await result("shifted-failed", true),
		succeeded: await result("shifted-ok", false),
		blocked: await result("shifted-blocked", true),
		reused: await result("reused", true),
	};
	// Then
	assert.deepEqual(outcomes, {
		failed: [{ content: [{ type: "text", text: "Script failed\n" }, image, { type: "text", text: failure.replace("codemode.js:3:1", "codemode.js:2:1") }] }],
		repeated: [undefined], succeeded: [undefined], blocked: [undefined], reused: [undefined],
	});
});
