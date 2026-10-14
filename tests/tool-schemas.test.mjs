import assert from "node:assert/strict";
import test from "node:test";
import { THINKING_LEVELS } from "../extensions/subagent/policy.mjs";
import { createWorkspace, importHost, loadPackage, startSession } from "./helpers/pi-host.mjs";
import { loadUiModule } from "./helpers/ui-harness.mjs";

const { validateToolArguments } = await importHost("node_modules/@earendil-works/pi-ai/dist/index.js");
const TASK_STATUSES = ["pending", "in_progress", "blocked", "done"];
// Each enum field: its schema path, its values, and the smallest valid call that carries one value.
const ENUMS = [
	{ tool: "subagent_collect", path: ["action"], values: ["status", "collect", "wait", "cancel"], call: action => ({ action }) },
	{ tool: "subagent_run", path: ["tasks", "items", "role"], values: ["explore", "review", "implement"], call: role => ({ tasks: [{ role, instruction: "inspect" }] }) },
	{ tool: "subagent_run", path: ["tasks", "items", "mode"], values: ["sync", "background"], call: mode => ({ tasks: [{ role: "explore", instruction: "inspect", mode }] }) },
	{ tool: "subagent_run", path: ["tasks", "items", "reasoning"], values: THINKING_LEVELS, call: reasoning => ({ tasks: [{ role: "explore", instruction: "inspect", reasoning }] }) },
	{ tool: "skill_registry", path: ["operation"], values: ["search", "load"], call: operation => ({ operation }) },
	{ tool: "orchestraitor_ask", path: ["questions", "items", "selection"], values: ["single", "multiple"],
		call: selection => ({ questions: [{ id: "q", prompt: "Pick", selection, options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] }] }) },
	{ tool: "orchestraitor_tasks", path: ["operation"], values: ["replace", "add", "update", "list", "clear"], call: operation => ({ operation }) },
	{ tool: "orchestraitor_tasks", path: ["tasks", "items", "status"], values: TASK_STATUSES, call: status => ({ operation: "replace", tasks: [{ id: "t", title: "Task", status }] }) },
	{ tool: "orchestraitor_tasks", path: ["changes", "status"], values: TASK_STATUSES, call: status => ({ operation: "update", id: "t", changes: { status } }) },
];
const field = (schema, path) => path.reduce((node, key) => key === "items" ? node.items : node.properties[key], schema);

test("shouldDeclareEveryStringEnumAsPlainEnumAndKeepPiValidationWhenToolsAreRegistered", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const { session } = await startSession(t, cwd, await loadPackage(cwd));
	const tools = new Map(session.getAllTools().map(tool => [tool.name, tool]));
	for (const { tool: name, path, values, call } of ENUMS) {
		const tool = tools.get(name), label = `${name}.${path.filter(key => key !== "items").join(".")}`;
		// When
		const declared = JSON.parse(JSON.stringify(field(tool.parameters, path)));
		// Then
		assert.deepEqual(declared, { type: "string", enum: values }, label);
		for (const value of values) assert.doesNotThrow(() => validateToolArguments(tool, { type: "toolCall", id: "call", name, arguments: call(value) }), `${label} accepts ${value}`);
		for (const value of ["bogus", values[0].toUpperCase(), ""]) assert.throws(() => validateToolArguments(tool, { type: "toolCall", id: "call", name, arguments: call(value) }), /Validation failed/, `${label} rejects ${JSON.stringify(value)}`);
	}
	for (const name of new Set(ENUMS.map(({ tool }) => tool))) assert.doesNotMatch(JSON.stringify(tools.get(name).parameters), /"anyOf"|"const"/, `${name} declares no literal unions`);
});

test("shouldDeclareFilesAsImplementOnlyWhenSubagentRunIsRegistered", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const { session } = await startSession(t, cwd, await loadPackage(cwd));
	const tool = session.getAllTools().find(({ name }) => name === "subagent_run");
	// When
	const { description } = field(tool.parameters, ["tasks", "items", "files"]);
	// Then
	assert.match(description ?? "", /implement only/i);
	assert.match(description ?? "", /instruction or context/);
});

test("shouldAcceptExactlyTheTextLengthsPiValidatorAcceptsWhenTasksAndQuestionsCheckAtRuntime", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const { session } = await startSession(t, cwd, await loadPackage(cwd));
	const tools = new Map(session.getAllTools().map(tool => [tool.name, tool]));
	const { applyTaskOperation, emptyTasks, TASK_TITLE_LIMIT } = await loadUiModule(t, "extensions/ui/tasks.ts");
	const { validateQuestions, QUESTION_TEXT_LIMIT } = await loadUiModule(t, "extensions/ui/questions.ts");
	// Emoji take two UTF-16 units and a combining accent one more; Pi's validator counts each as one character.
	const samples = limit => ({ ascii: "a".repeat(limit), asciiOver: "a".repeat(limit + 1), emoji: "\u{1F44D}".repeat(limit), emojiOver: "\u{1F44D}".repeat(limit + 1), accented: "e\u0301".repeat(limit) });
	const fields = [
		{ tool: "orchestraitor_tasks", limit: TASK_TITLE_LIMIT, call: title => ({ operation: "add", expectedRevision: 0, tasks: [{ id: "t", title, status: "pending" }] }), run: params => applyTaskOperation(emptyTasks(), params) },
		{ tool: "orchestraitor_ask", limit: QUESTION_TEXT_LIMIT, call: prompt => ({ questions: [{ id: "q", prompt, selection: "single", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] }] }), run: validateQuestions },
	];
	const accepts = fn => { try { fn(); return true; } catch { return false; } };
	for (const { tool, limit, call, run } of fields) {
		for (const [name, value] of Object.entries(samples(limit))) {
			// When
			const schema = accepts(() => validateToolArguments(tools.get(tool), { type: "toolCall", id: "call", name: tool, arguments: call(value) }));
			const runtime = accepts(() => run(call(value)));
			// Then
			assert.deepEqual({ runtime }, { runtime: schema }, `${tool} ${name}`);
			assert.equal(schema, !name.endsWith("Over"), `${tool} ${name} schema`);
		}
	}
});
