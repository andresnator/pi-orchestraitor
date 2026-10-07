import assert from "node:assert/strict";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, realpath } from "node:fs/promises";
import test from "node:test";
import { createPackageUISession, createWorkspace, packageRoot } from "./helpers/ui-harness.mjs";

const EXTENSIONS = ["compact-tools.ts", "index.ts", "instructions.ts", "mcp.ts", "nan.ts", "skill-registry.ts", "status-ui.ts", "subagents.ts"];
const ACTIVE = ["read", "bash", "edit", "write", "subagent_run", "orchestraitor_tasks", "orchestraitor_ask", "skill_registry"];
const run = promisify(execFile);

for (const mode of ["tui", "rpc", "json", "print"]) {
	test(`shouldLoadUniqueCompletePackageWithoutUiOrServiceSideEffectsWhenModeIs${mode}`, async (t) => {
		// Given
		const { session, resources, errors, calls, close } = await createPackageUISession(t, mode);
		const extensions = resources.loader.getExtensions().extensions;
		const commands = extensions.flatMap((extension) => [...extension.commands.keys()]);
		const tools = session.extensionRunner.getAllRegisteredTools().map(({ definition }) => definition.name);
		// When
		const ctx = session.extensionRunner.createToolContext("nested", undefined);
		const rejected = await Promise.all(["orchestraitor_tasks", "orchestraitor_ask"].map((name) => ctx.executeTool(name, name.endsWith("tasks") ? { operation: "list" } : { questions: [] })));
		const callableNames = ctx.tools.map(({ name }) => name);
		await close();
		// Then
		assert.deepEqual({ paths: extensions.filter(({ path }) => path.startsWith(packageRoot)).map(({ path }) => basename(path)).sort(), active: session.getActiveToolNames(), errors, calls },
			{ paths: EXTENSIONS, active: ACTIVE, errors: [], calls: [] });
		assert.equal(new Set(commands).size, commands.length);
		assert.equal(new Set(tools).size, tools.length);
		assert.ok(rejected.every((result) => result.isError));
		assert.ok(!callableNames.some((name) => name.startsWith("orchestraitor_")));
	});
}

for (const mode of ["tui", "rpc", "json", "print"]) for (const selection of [
	{ tools: ["read"] }, { tools: ["read", "bash", "edit", "write", "subagent_run"] },
	{ excludeTools: ["orchestraitor_tasks", "orchestraitor_ask"] },
]) {
	test(`shouldPreserveExactPersistentSelectionAcrossReloadWhenModeIs${mode}AndSelectionIs${JSON.stringify(selection)}`, async (t) => {
		// Given
		const { session, resources, widgets, statuses, errors } = await createPackageUISession(t, mode, { selection });
		const selected = selection.tools ?? ["read", "bash", "edit", "write", "subagent_run", "skill_registry"];
		const before = session.getActiveToolNames();
		// When
		await session.reload();
		// Then
		assert.deepEqual({ before, after: session.getActiveToolNames(), errors }, { before: selected, after: selected, errors: [] });
		assert.deepEqual({ widgets: [...widgets], statuses: [...statuses] }, { widgets: [["foreign-widget", ["Foreign widget"]]], statuses: [["foreign-status", "Foreign status"]] });
		assert.equal(resources.loader.getExtensions().extensions.filter(({ path }) => basename(path) === "status-ui.ts").length, 1);
	});
}

test("shouldDisableUiWithoutChangingLauncherOrInstructionsWhenUiEntrypointIsExcluded", async (t) => {
	// Given
	const { session, resources, errors, calls } = await createPackageUISession(t, "print", { settings: { packages: [{ source: packageRoot, extensions: ["!extensions/status-ui.ts"], skills: [], prompts: [] }] } });
	// When
	const result = await session.extensionRunner.emitBeforeAgentStart("inspect", undefined, { cwd: session.sessionManager.getCwd(), selectedTools: session.getActiveToolNames(), skills: [], contextFiles: [], sections: { foreign: "Keep this" } });
	// Then
	assert.deepEqual({ active: session.getActiveToolNames(), ui: resources.loader.getExtensions().extensions.some(({ path }) => basename(path) === "status-ui.ts"), errors, calls },
		{ active: ["read", "bash", "edit", "write", "subagent_run", "skill_registry"], ui: false, errors: [], calls: [] });
	assert.equal(result.systemPromptOptions.sections.foreign, "Keep this");
	assert.equal(result.systemPromptOptions.sections.pi_orchestraitor_execution, await readFile(join(packageRoot, "instructions/orchestraitor.md"), "utf8"));
});

test("shouldDriveActualNativeToolsWithLocalProviderAndKeepFixtureOutOfPackageWhenSmokeRunsInJsonMode", { timeout: 30000 }, async (t) => {
	// Given
	const root = await realpath(await createWorkspace(t));
	const cwd = join(root, "workspace"), profile = join(root, "profile"), receipts = join(root, "receipts");
	await Promise.all([mkdir(cwd), mkdir(profile), mkdir(receipts)]);
	const fixture = join(packageRoot, "tests/fixtures/ui-smoke.ts");
	await readFile(fixture, "utf8");
	const args = ["--mode", "json", "--offline", "--no-approve", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
		"-e", join(packageRoot, "extensions/instructions.ts"), "-e", join(packageRoot, "extensions/compact-tools.ts"), "-e", join(packageRoot, "extensions/subagents.ts"), "-e", join(packageRoot, "extensions/status-ui.ts"), "-e", fixture,
		"--model", "ui-smoke/model", "--thinking", "off", "--session-dir", receipts, "ui-smoke:tasks-create", "ui-smoke:two", "ui-smoke:single"];
	// When
	const pending = run("pi", args, { cwd, env: { ...process.env, PI_CODING_AGENT_DIR: profile, PI_OFFLINE: "1", PI_TELEMETRY: "0", UI_SMOKE_ENABLED: "1", UI_SMOKE_ROOT: root }, maxBuffer: 8 * 1024 * 1024, timeout: 25000 });
	pending.child.stdin.end(); // Pi consumes piped stdin before initial JSON-mode prompts.
	const { stdout, stderr } = await pending;
	const events = stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
	const results = events.filter((event) => event.type === "message_end" && event.message?.role === "toolResult").map(({ message }) => message);
	// Then
	assert.equal(stderr, "");
	assert.deepEqual(results.map(({ toolName }) => toolName), ["orchestraitor_tasks", "subagent_run", "orchestraitor_ask"]);
	assert.equal(results[0].details.state.tasks.length, 2);
	assert.deepEqual(results[1].details.results.map(({ status, terminated, writes, usageComplete }) => ({ status, terminated, writes, usageComplete })), [
		{ status: "completed", terminated: true, writes: [], usageComplete: true }, { status: "completed", terminated: true, writes: [], usageComplete: true },
	]);
	assert.ok(results[1].details.results.every(({ finalResponse }) => /marker\.txt/.test(finalResponse)));
	assert.deepEqual(results[2].details, { version: 1, status: "unavailable" });
	const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
	assert.ok(!manifest.files.some((path) => path.startsWith("tests")));
});
