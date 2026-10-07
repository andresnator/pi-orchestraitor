import assert from "node:assert/strict";
import { mkdir, realpath, readFile, writeFile, symlink, link } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createWorkspace, pi, hostRoot, packageRoot, importHost } from "./helpers/pi-host.mjs";
import { createChildRuntime } from "../extensions/subagent/runtime.mjs";
import { BatchController } from "../extensions/subagent/controller.mjs";

async function fixture(t, role = "explore") {
	const cwd = await realpath(await createWorkspace(t));
	const temporary = join(cwd, "config");
	await mkdir(temporary);
	const modelRuntime = await pi.ModelRuntime.create({ authPath: join(temporary, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerProvider("fixture", { api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "fixture",
		models: [{ id: "model", name: "Fixture", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }] });
	const manifest = { id: "test", cwd, role, instruction: "inspect", files: role === "implement" ? ["target"] : [], skills: [], contextFiles: [{ path: "captured/AGENTS.md", content: "CAPTURED" }],
		model: "fixture/model", reasoning: "high", tools: role === "implement" ? ["read", "search", "list", "edit", "write"] : ["read", "search", "list"] };
	return { cwd, temporary, modelRuntime, manifest };
}

for (const scenario of ["complete", "partial", "parent-cancelled"]) {
	test(`shouldPersistNestedUsageOnceWhenNativeParentReceives${scenario}Results`, async (t) => {
		// Given
		const { cwd, temporary, modelRuntime } = await fixture(t);
		const { createAssistantMessageEventStream } = await importHost("node_modules/@earendil-works/pi-ai/dist/index.js");
		const childUsage = { input: 11, output: 7, cacheRead: 3, cacheWrite: 2, totalTokens: 23,
			cost: { input: 0.125, output: 0.25, cacheRead: 0, cacheWrite: 0, total: 0.375 } };
		const outcomes = ["explore", "review"].map((role, i) => ({ id: String(i), role, status: scenario === "complete" ? "completed" : "cancelled",
			finalResponse: "fixture result", usage: childUsage, usageComplete: scenario === "complete", terminated: true }));
		let requests = 0, session;
		modelRuntime.registerProvider("fixture", { api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "fixture",
			models: [{ id: "model", name: "Local parent", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }],
			streamSimple(model) {
				const stream = createAssistantMessageEventStream();
				const first = requests++ === 0;
				const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: first ? "toolUse" : "stop",
					usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 7, cost: { input: 0.125, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.125 } },
					content: first ? [{ type: "toolCall", id: "batch", name: "subagent_run", arguments: { tasks: ["explore", "review"].map((role) => ({ role, instruction: "inspect" })) } }]
						: [{ type: "text", text: "done" }] };
				stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message);
				return stream;
			},
		});
		const key = Symbol.for("pi-orchestraitor.subagent-controller");
		const previous = globalThis[key];
		globalThis[key] = { async cancel() {}, async run() {
			if (scenario === "parent-cancelled") { void session.abort(); await new Promise(setImmediate); }
			return outcomes;
		} };
		t.after(() => { globalThis[key] = previous; });
		const settingsManager = pi.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
		const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir: temporary, settingsManager, noExtensions: true,
			additionalExtensionPaths: [join(packageRoot, "extensions/subagents.ts")], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		await resourceLoader.reload();
		({ session } = await pi.createAgentSession({ cwd, agentDir: temporary, settingsManager, resourceLoader, modelRuntime,
			model: (await modelRuntime.getAvailable())[0], tools: ["read", "subagent_run"], sessionManager: pi.SessionManager.create(cwd, join(temporary, "sessions")) }));
		t.after(() => session.dispose());
		await session.bindExtensions({ onError: assert.fail });
		// When
		await session.prompt("Use the bounded fixture tool");
		const entries = (await readFile(session.sessionFile, "utf8")).trim().split("\n").map(JSON.parse);
		const results = entries.filter((entry) => entry.type === "message" && entry.message.role === "toolResult");
		const stats = session.getSessionStats();
		// Then
		assert.equal(results.length, 1);
		assert.deepEqual({ usage: results[0].message.usage, details: results[0].message.details, isError: results[0].message.isError },
			{ usage: { input: 22, output: 14, cacheRead: 6, cacheWrite: 4, totalTokens: 46, cost: { input: 0.25, output: 0.5, cacheRead: 0, cacheWrite: 0, total: 0.75 } },
				details: { results: outcomes, usageComplete: scenario === "complete" }, isError: false });
		const stopped = scenario === "parent-cancelled";
		assert.deepEqual({ tokens: stats.tokens, cost: stats.cost, assistants: stats.assistantMessages, tools: stats.toolResults },
			{ tokens: { input: stopped ? 27 : 32, output: stopped ? 16 : 18, cacheRead: 6, cacheWrite: 4, total: stopped ? 53 : 60 }, cost: stopped ? 0.875 : 1, assistants: 2, tools: 1 });
		if (stopped) {
			const final = entries.filter((entry) => entry.type === "message" && entry.message.role === "assistant").at(-1).message;
			assert.deepEqual({ reason: final.stopReason, tokens: final.usage.totalTokens, cost: final.usage.cost.total }, { reason: "error", tokens: 0, cost: 0 }, final.errorMessage);
			assert.match(final.errorMessage, /aborted/i);
		}
	});
}

test("shouldLoadOnlyGuardAndCapturedContextWhenProjectAndGlobalResourcesExist", async (t) => {
	// Given
	const { cwd, temporary, modelRuntime, manifest } = await fixture(t);
	for (const root of [cwd, temporary]) {
		await writeFile(join(root, "SYSTEM.md"), "LEAK_SYSTEM");
		await writeFile(join(root, "APPEND_SYSTEM.md"), "LEAK_APPEND");
		await writeFile(join(root, "AGENTS.md"), "LEAK_AGENTS");
		await mkdir(join(root, ".pi/extensions"), { recursive: true });
		await writeFile(join(root, ".pi/extensions/leak.ts"), "throw new Error('LEAK_EXTENSION');");
	}
	const reports = [];
	// When
	const runtime = await createChildRuntime(pi, manifest, "digest", (message) => reports.push(message), temporary, modelRuntime);
	t.after(() => runtime.dispose());
	const errors = [];
	await runtime.session.bindExtensions({ onError: (error) => errors.push(error) });
	const loader = runtime.services.resourceLoader;
	// Then
	assert.deepEqual({ tools: runtime.session.getActiveToolNames().sort(), errors, skills: loader.getSkills().skills, prompts: loader.getPrompts().prompts,
		context: loader.getAgentsFiles().agentsFiles, append: loader.getAppendSystemPrompt(), ready: reports[0] },
	{ tools: [...manifest.tools].sort(), errors: [], skills: [], prompts: [], context: manifest.contextFiles, append: [],
		ready: { type: "guard_ready", id: "test", digest: "digest", cwd, tools: [...manifest.tools].sort(), model: "fixture/model", reasoning: "high" } });
	assert.doesNotMatch(loader.getSystemPrompt(), /LEAK/);
});

test("shouldRestrictNativeWritesAndRecursiveSearchWhenGuardToolsExecute", async (t) => {
	// Given
	const { cwd, temporary, modelRuntime, manifest } = await fixture(t, "implement");
	const outside = await realpath(await createWorkspace(t));
	await writeFile(join(outside, "secret"), "needle SECRET");
	await writeFile(join(cwd, "target"), "needle safe");
	await symlink(outside, join(cwd, "escape"));
	const reports = [];
	const runtime = await createChildRuntime(pi, manifest, "digest", (message) => reports.push(message), temporary, modelRuntime);
	t.after(() => runtime.dispose());
	await runtime.session.bindExtensions({ onError: assert.fail });
	const registered = runtime.session.extensionRunner.getAllRegisteredTools();
	const tools = new Map(registered.map(({ definition }) => [definition.name, definition]));
	const ctx = runtime.session.extensionRunner.createContext();
	// When
	const search = await tools.get("search").execute("search", { text: "needle" }, undefined, undefined, ctx);
	const fileSearch = await tools.get("search").execute("files", { text: "needle", mode: "files", limit: 1 }, undefined, undefined, ctx);
	assert.match(fileSearch.content[0].text, /target/);
	assert.doesNotMatch(fileSearch.content[0].text, /:1:/);
	assert.match(fileSearch.content[0].text, /truncated/);
	await assert.rejects(tools.get("search").execute("bad", { text: "needle", limit: 0 }, undefined, undefined, ctx), /limit/);
	await tools.get("write").execute("write", { path: "target", content: "new" }, undefined, undefined, ctx);
	// Then
	assert.match(search.content[0].text, /target:1: needle safe/);
	assert.doesNotMatch(search.content[0].text, /SECRET/);
	assert.deepEqual(reports.slice(1), [{ type: "write", path: "target", phase: "attempted" }, { type: "write", path: "target", phase: "completed" }]);
	for (const path of ["other", "escape/secret", "../outside", ".pi/settings.json"]) await assert.rejects(tools.get("write").execute("bad", { path, content: "bad" }, undefined, undefined, ctx));
	await link(join(cwd, "target"), join(cwd, "alias"));
	await assert.rejects(tools.get("write").execute("bad", { path: "target", content: "bad" }, undefined, undefined, ctx), /Hard-linked/);
	assert.deepEqual([...tools.keys()].sort(), [...manifest.tools].sort());
});

test("shouldFailWithoutModelCallsWhenRealChildCannotResolveRequestedModel", async (t) => {
	// Given
	const { cwd, temporary, manifest } = await fixture(t);
	const controller = new BatchController({ sdkRoot: hostRoot, credentialDir: temporary });
	// When
	const [result] = await controller.run([manifest], () => "Must not reach any model");
	// Then
	assert.equal(result.status, "failed");
	assert.equal(result.terminated, true);
	assert.match(result.diagnostic, /Model unavailable/);
});

for (const selection of [[], ["read"], ["read", "subagent_run"], ["read", "bash", "edit", "write", "subagent_run"]]) {
	test(`shouldPreserveUserToolSelectionWhenLauncherLoadsWith${selection.length}Tools`, async (t) => {
		// Given
		const cwd = await createWorkspace(t);
		const settingsManager = pi.SettingsManager.inMemory();
		const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager,
			noExtensions: true, additionalExtensionPaths: [join(packageRoot, "extensions/subagents.ts")], noSkills: true, noThemes: true, noContextFiles: true });
		await resourceLoader.reload();
		// When
		const { session } = await pi.createAgentSession({ cwd, agentDir: cwd, settingsManager, resourceLoader, tools: selection, sessionManager: pi.SessionManager.inMemory(cwd) });
		t.after(() => session.dispose());
		const errors = [];
		await session.bindExtensions({ onError: (error) => errors.push(error) });
		// Then
		assert.deepEqual({ errors, loadErrors: resourceLoader.getExtensions().errors, active: session.getActiveToolNames() }, { errors: [], loadErrors: [], active: selection });
	});
}

test("shouldRejectForbiddenToolsBeforeBindingChildGuard", async (t) => {
	// Given
	const { temporary, modelRuntime, manifest } = await fixture(t);
	// When / Then
	for (const name of ["bash", "subagent_run", "mcp", "codemode", "git"]) {
		await assert.rejects(createChildRuntime(pi, { ...manifest, tools: [...manifest.tools, name] }, "digest", () => {}, temporary, modelRuntime), /Forbidden/);
	}
});

test("shouldExposeSelectedSkillResourcesWithoutDiscoveringOtherSkills", async (t) => {
	// Given
	const { cwd, temporary, modelRuntime, manifest } = await fixture(t);
	const skillsRoot = await realpath(await createWorkspace(t));
	await mkdir(join(skillsRoot, "chosen"));
	const filePath = join(skillsRoot, "chosen/SKILL.md");
	await writeFile(filePath, "Chosen skill");
	await writeFile(join(skillsRoot, "unselected.md"), "Must stay outside");
	manifest.skills = [{ name: "chosen", description: "Selected", filePath, baseDir: join(skillsRoot, "chosen"), disableModelInvocation: false }];
	const runtime = await createChildRuntime(pi, manifest, "digest", () => {}, temporary, modelRuntime);
	t.after(() => runtime.dispose());
	await runtime.session.bindExtensions({ onError: assert.fail });
	const read = runtime.session.extensionRunner.getAllRegisteredTools().find(({ definition }) => definition.name === "read").definition;
	// When
	const result = await read.execute("selected", { path: filePath }, undefined, undefined, { cwd });
	// Then
	assert.match(result.content[0].text, /Chosen skill/);
	await assert.rejects(read.execute("unselected", { path: join(skillsRoot, "unselected.md") }, undefined, undefined, { cwd }), /outside/);
	assert.deepEqual(runtime.services.resourceLoader.getSkills().skills.map(({ sourceInfo, ...skill }) => skill), manifest.skills);
});

test("shouldConfirmGuardAndNativeRpcStateWithoutSendingAnyModelPrompt", async (t) => {
	// Given
	const { spawn } = await import("node:child_process");
	const { createHash } = await import("node:crypto");
	const { fileURLToPath } = await import("node:url");
	const { RpcDecoder } = await import("../extensions/subagent/controller.mjs");
	const { cwd, temporary, manifest } = await fixture(t);
	const credentials = join(cwd, "credentials");
	await mkdir(credentials);
	await writeFile(join(credentials, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "fixture",
		models: [{ id: "model", name: "Fixture", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }] } } }));
	const raw = JSON.stringify(manifest);
	const manifestPath = join(temporary, "task.json");
	await writeFile(manifestPath, raw);
	// When
	const child = spawn(process.execPath, [fileURLToPath(new URL("../extensions/subagent/child.mjs", import.meta.url)), manifestPath, hostRoot, credentials], { cwd, stdio: ["pipe", "pipe", "pipe", "ipc"] });
	t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
	let diagnostics = "", guard, state;
	child.stderr.on("data", (chunk) => { diagnostics += chunk; });
	const outcome = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`Native RPC startup timed out: ${diagnostics}`)); }, 5000);
		child.on("message", (message) => {
			if (message.type === "startup_error") diagnostics += message.message;
			if (message.type === "guard_ready") { guard = message; child.stdin.write('{"id":"check","type":"get_state"}\n'); }
		});
		const decoder = new RpcDecoder();
		child.stdout.on("data", (chunk) => decoder.push(chunk, (event) => {
			if (event.id === "check") { state = event; child.stdin.end(); }
		}));
		child.on("error", reject);
		child.on("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
	});
	// Then
	assert.deepEqual(outcome, { code: 0, signal: null }, diagnostics);
	assert.deepEqual(guard, { type: "guard_ready", id: manifest.id, digest: createHash("sha256").update(raw).digest("hex"), cwd, tools: [...manifest.tools].sort(), model: "fixture/model", reasoning: "high" });
	assert.equal(state.success, true);
	assert.equal(state.data.model.id, "model");
});

for (const name of ["read", "write", "edit"]) {
	test(`shouldRejectNormalizedSymlinkTargetWhenNative${name}ResolvesUnicodeSpaces`, async (t) => {
		// Given
		const { cwd, temporary, modelRuntime, manifest } = await fixture(t, "implement");
		const outside = await realpath(await createWorkspace(t));
		const assigned = "alias\u00a0dir/secret.txt";
		manifest.files = [assigned];
		await mkdir(join(cwd, "alias\u00a0dir"));
		await writeFile(join(cwd, assigned), "inside");
		await writeFile(join(outside, "secret.txt"), "outside");
		await symlink(outside, join(cwd, "alias dir"));
		const reports = [];
		const runtime = await createChildRuntime(pi, manifest, "digest", (message) => reports.push(message), temporary, modelRuntime);
		t.after(() => runtime.dispose());
		await runtime.session.bindExtensions({ onError: assert.fail });
		const tool = runtime.session.extensionRunner.getAllRegisteredTools().find(({ definition }) => definition.name === name).definition;
		const args = name === "read" ? { path: assigned } : name === "write" ? { path: assigned, content: "overwritten" }
			: { path: assigned, edits: [{ oldText: "outside", newText: "overwritten" }] };
		// When / Then
		await assert.rejects(tool.execute("unsafe", args, undefined, undefined, { cwd }), /Symbolic|assigned/);
		assert.deepEqual({ outside: await readFile(join(outside, "secret.txt"), "utf8"), assigned: await readFile(join(cwd, assigned), "utf8"), writes: reports.filter(({ type }) => type === "write") },
			{ outside: "outside", assigned: "inside", writes: [] });
	});
}

test("shouldRejectFallbackSymlinkWhenNativeReadResolvesScreenshotVariant", async (t) => {
	// Given
	const { cwd, temporary, modelRuntime, manifest } = await fixture(t);
	const outside = await realpath(await createWorkspace(t));
	const original = "capture\u00a0AM.txt";
	await writeFile(join(cwd, original), "inside");
	await writeFile(join(outside, "secret.txt"), "outside");
	await symlink(join(outside, "secret.txt"), join(cwd, "capture\u202fAM.txt"));
	const runtime = await createChildRuntime(pi, manifest, "digest", () => {}, temporary, modelRuntime);
	t.after(() => runtime.dispose());
	await runtime.session.bindExtensions({ onError: assert.fail });
	const read = runtime.session.extensionRunner.getAllRegisteredTools().find(({ definition }) => definition.name === "read").definition;
	// When / Then
	await assert.rejects(read.execute("unsafe", { path: original }, undefined, undefined, { cwd }), /Symbolic/);
});

for (const name of ["write", "edit"]) {
	test(`shouldRejectUnassignedNormalizedFileWhenNative${name}StaysInsideProject`, async (t) => {
		// Given
		const { cwd, temporary, modelRuntime, manifest } = await fixture(t, "implement");
		const assigned = "selected\u202ffile.txt";
		const other = "selected file.txt";
		manifest.files = [assigned];
		await writeFile(join(cwd, assigned), "assigned");
		await writeFile(join(cwd, other), "unassigned");
		const runtime = await createChildRuntime(pi, manifest, "digest", () => {}, temporary, modelRuntime);
		t.after(() => runtime.dispose());
		await runtime.session.bindExtensions({ onError: assert.fail });
		const tool = runtime.session.extensionRunner.getAllRegisteredTools().find(({ definition }) => definition.name === name).definition;
		const args = name === "write" ? { path: assigned, content: "overwritten" } : { path: assigned, edits: [{ oldText: "unassigned", newText: "overwritten" }] };
		// When / Then
		await assert.rejects(tool.execute("unsafe", args, undefined, undefined, { cwd }), /assigned/);
		assert.deepEqual({ assigned: await readFile(join(cwd, assigned), "utf8"), other: await readFile(join(cwd, other), "utf8") }, { assigned: "assigned", other: "unassigned" });
	});
}

test("shouldPreserveNativeImageResultsWhenGuardedReadUsesOperationOverrides", async (t) => {
	// Given
	const { cwd, temporary, modelRuntime, manifest } = await fixture(t);
	const image = "pixel.png";
	await writeFile(join(cwd, image), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
	const runtime = await createChildRuntime(pi, manifest, "digest", () => {}, temporary, modelRuntime);
	t.after(() => runtime.dispose());
	await runtime.session.bindExtensions({ onError: assert.fail });
	const guarded = runtime.session.extensionRunner.getAllRegisteredTools().find(({ definition }) => definition.name === "read").definition;
	// When
	const expected = await pi.createReadToolDefinition(cwd).execute("native", { path: image }, undefined, undefined, { cwd });
	const actual = await guarded.execute("guarded", { path: image }, undefined, undefined, { cwd });
	// Then
	assert.deepEqual(actual, expected);
	assert.ok(actual.content.some(({ type }) => type === "image"));
});
