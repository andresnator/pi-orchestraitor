import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NATIVE_CONFIG, nativeSettings } from "../../scripts/subagents-config.mjs";
import { PI_VERSION, SUBAGENTS_VERSION } from "../../scripts/subagents-validation.mjs";
import { hostRoot, isolatedAgentDir, packageRoot, pi } from "../helpers/pi-host.mjs";

const pluginRoot = process.env.PI_SUBAGENTS_PACKAGE_DIR;
assert.ok(pluginRoot, "Run pnpm run test:subagents to provision the isolated pinned plugin");
assert.equal(JSON.parse(await readFile(join(hostRoot, "package.json"))).version, PI_VERSION);
assert.equal(JSON.parse(await readFile(join(pluginRoot, "package.json"))).version, SUBAGENTS_VERSION);

test("native Pi 1.2.0: readers before worker, provider loading, context, artifacts and lifecycle", { timeout: 150000 }, async t => {
	const cwd = await realpath(await mkdtemp(join(tmpdir(), "pi-native-subagents-"))), requests = [];
	let session;
	t.after(async () => {
		if (session) { await session.extensionRunner.emit({ type: "session_shutdown" }); session.dispose(); }
		const listing = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
		for (const line of listing.split("\n").filter(line => line.startsWith("worktree "))) {
			const path = line.slice(9);
			if (path !== cwd) execFileSync("git", ["worktree", "remove", "--force", path], { cwd });
		}
		await rm(cwd, { recursive: true, force: true });
	});
	execFileSync("git", ["init", "-q", cwd]);
	execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd });
	execFileSync("git", ["config", "user.name", "Fixture"], { cwd });
	await writeFile(join(cwd, "marker.txt"), "NATIVE_MARKER_7319\n");
	await writeFile(join(cwd, ".gitignore"), ".ai/\n.pi/subagents/\n");
	execFileSync("git", ["add", "marker.txt", ".gitignore"], { cwd });
	execFileSync("git", ["commit", "-qm", "fixture baseline"], { cwd });
	const server = createServer((request, response) => {
		let data = "";
		request.on("data", chunk => { data += chunk; });
		request.on("end", () => {
			const body = JSON.parse(data);
			requests.push(body);
			const task = JSON.stringify(body.messages.filter(message => message.role === "user").at(-1));
			if (task.includes("HOLD_NATIVE")) return; // Run deadline/abort closes this connection.
			const afterTool = body.messages.at(-1)?.role === "tool";
			const selectedSkill = JSON.stringify(body.messages).includes("Read the explicitly selected skill");
			const skillLoaded = JSON.stringify(body.messages).includes("EXPLICIT_SKILL_9021");
			const readMarkerAfterSkill = afterTool && body.messages.at(-1)?.content?.includes("EXPLICIT_SKILL_9021");
			const isFinal = afterTool && !readMarkerAfterSkill;
			const delta = isFinal ? { content: "Native fixture observed marker.txt; parent verification required. " + "FULL_ARTIFACT_".repeat(800) }
				: { role: "assistant", tool_calls: [{ index: 0, id: "file-call", type: "function", function: {
					name: task.includes("WRITE_NATIVE") ? "write" : "read", arguments: JSON.stringify(task.includes("WRITE_NATIVE")
						? { path: "marker.txt", content: "REVIEW_THIS_PATCH\n" } : { path: selectedSkill && !skillLoaded ? join(skills, "SKILL.md") : "marker.txt" }),
				} }] };
			response.writeHead(200, { "Content-Type": "text/event-stream" });
			response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "model", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
			response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "model", choices: [{ index: 0, delta: {}, finish_reason: isFinal ? "stop" : "tool_calls" }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } })}\n\n`);
			response.end("data: [DONE]\n\n");
		});
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => { server.closeAllConnections(); server.close(); });
	await writeFile(join(isolatedAgentDir, "models.json"), JSON.stringify({ providers: { "native-fixture": {
		api: "openai-completions", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: "fixture",
		models: [{ id: "model", name: "Deterministic native fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 16000 }],
	} } }));
	const configPath = join(isolatedAgentDir, "extensions/subagent/config.json");
	await mkdir(join(configPath, ".."), { recursive: true });
	await writeFile(configPath, JSON.stringify(NATIVE_CONFIG));
	const bridge = join(process.env.PI_CLAUDE_BRIDGE_PACKAGE_DIR, "src/index.ts");
	const pretty = join(process.env.PI_PRETTY_PACKAGE_DIR, "src/index.ts");
	await writeFile(join(process.env.PRETTY_CONFIG_DIR, "pi-pretty.json"), '{"disableTools":["bash"]}');
	execFileSync("git", ["config", "core.hooksPath", "/dev/null"], { cwd });
	const settings = nativeSettings(packageRoot, isolatedAgentDir);
	settings.subagents.defaultExtensions = [join(packageRoot, "extensions/nan.ts"), bridge];
	const settingsManager = pi.SettingsManager.inMemory({ packages: [packageRoot, pluginRoot], ...settings });
	await writeFile(join(isolatedAgentDir, "settings.json"), JSON.stringify({ packages: [packageRoot, pluginRoot], ...settings }));
	const skills = join(cwd, ".pi/skills/fixture-dir");
	await mkdir(skills, { recursive: true });
	await writeFile(join(skills, "SKILL.md"), "---\nname: native-name\ndescription: Native fixture selected skill.\n---\nEXPLICIT_SKILL_9021\n");
	// The plugin's directory-name resolver would select this other file.
	await mkdir(join(cwd, ".pi/skills/native-name"));
	await writeFile(join(cwd, ".pi/skills/native-name/SKILL.md"), "---\nname: other-skill\ndescription: Must stay unselected.\n---\nWRONG_SKILL_9021\n");
	execFileSync("git", ["add", ".pi/skills"], { cwd });
	execFileSync("git", ["commit", "-qm", "selected skill fixture"], { cwd });
	const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir: isolatedAgentDir, settingsManager,
		additionalExtensionPaths: [pretty, bridge], noThemes: true, noContextFiles: true,
		extensionFactories: [pi.createMcpExtension({ loadConfig: () => ({ errors: [], servers: [] }) })],
	});
	await resourceLoader.reload();
	assert.deepEqual(resourceLoader.getExtensions().errors, []);
	const sessionManager = pi.SessionManager.create(cwd, join(isolatedAgentDir, "sessions"));
	({ session } = await pi.createAgentSession({ cwd, agentDir: isolatedAgentDir, settingsManager, resourceLoader, sessionManager }));
	const errors = [];
	await session.bindExtensions({ onError: error => errors.push(error) });
	await session.setModel((await session.modelRuntime.getAvailable()).find(model => model.provider === "native-fixture"));
	sessionManager.appendMessage({ role: "user", content: "PARENT_CONTEXT_5413", timestamp: Date.now() });
	assert.ok(session.modelRuntime.getProvider("nan"));
	assert.ok(session.modelRuntime.getProvider("claude-bridge"));
	for (const retired of ["subagent_run", "subagent_collect"]) assert.equal(session.getToolDefinition(retired), undefined);
	for (const command of ["subagents-fleet", "subagent-cost", "btw", "orchestraitor:tasks"]) assert.ok(session.extensionRunner.getCommand(command));
	assert.equal(session.extensionRunner.getCommand("models-profiles"), undefined);
	const execute = (name, args, signal) => session.getToolDefinition(name).execute("native-check", args, signal, undefined, session.extensionRunner.createToolContext("native-check", signal));
	const selectSkill = async () => {
		await session.extensionRunner.emitBeforeAgentStart({ messageType: "user", prompt: "Select a skill" }, session.extensionRunner.createCommandContext().getSystemPromptOptions());
		const loaded = await execute("skill_registry", { operation: "load", name: "native-name" });
		assert.equal(loaded.details.filePath, join(skills, "SKILL.md"));
		return loaded.details.delegation;
	};
	const delegation = await selectSkill();
	const firstRequest = () => requests.findLast(body => body.messages.at(-1)?.role !== "tool");
	// Stage one: verify the actual model-facing capabilities before granting a writer.
	for (const agent of ["scout", "reviewer", "oracle"]) {
		requests.length = 0;
		const result = await execute("subagent", { agent, task: delegation.taskPrefix + "Inspect marker.txt", async: false, options: { ...delegation.options, acceptance: { level: "none", reason: "deterministic fixture" } } });
		assert.notEqual(result.isError, true, JSON.stringify(result));
		const row = result.details.results[0], request = firstRequest();
		assert.equal(row.exitCode, 0);
		assert.equal(row.context, agent === "oracle" ? "fork" : "fresh");
		const tools = request.tools.map(tool => tool.function.name);
		for (const forbidden of ["bash", "edit", "write", "subagent", "AskClaude", "codemode"]) assert.ok(!tools.includes(forbidden), `${agent}: ${forbidden}`);
		for (const allowed of ["read", "grep", "find", "ls"]) assert.ok(tools.includes(allowed));
		if (agent === "reviewer") assert.ok(tools.includes("watchdog_diff"));
		assert.equal(JSON.stringify(request.messages).includes("PARENT_CONTEXT_5413"), agent === "oracle");
		assert.ok(JSON.stringify(request.messages).includes("native-name"));
		assert.ok(JSON.stringify(request.messages).includes(join(skills, "SKILL.md")));
		assert.ok(!JSON.stringify(requests).includes("WRONG_SKILL_9021"));
		assert.ok(requests.some(body => JSON.stringify(body.messages).includes("EXPLICIT_SKILL_9021")), "Selected skill must remain readable in the child");
		assert.ok(row.usage.input > 0);
		// The native complete transcript is JSONL; the optional raw event JSONL
		// path is advertised but disabled by this plugin version's default.
		for (const key of ["inputPath", "outputPath", "transcriptPath", "metadataPath"]) assert.ok((await readFile(row.artifactPaths[key])).length > 0);
		assert.match(await readFile(row.artifactPaths.outputPath, "utf8"), /FULL_ARTIFACT_/);
	}
	// Stage two: a native writer isolates its changes; the parent reviews before applying.
	assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }), "");
	const before = await readFile(join(cwd, "marker.txt"), "utf8");
	const worker = await execute("subagent", { agent: "worker", task: "WRITE_NATIVE marker.txt", worktree: true, async: false,
		options: { acceptance: { level: "none", reason: "parent reviews fixture patch" } } });
	assert.notEqual(worker.isError, true, JSON.stringify(worker));
	assert.equal(await readFile(join(cwd, "marker.txt"), "utf8"), before);
	assert.equal(worker.details.results[0].exitCode, 0);
	// Native cleanup may remove the captured worktree; the durable handoff and
	// patch remain the authoritative material for parent review/integration.
	const handoff = JSON.parse(await readFile(worker.details.parallelHandoff.path, "utf8"));
	assert.equal(handoff.groups[0].repoRoot, cwd);
	assert.equal(handoff.groups[0].children[0].patch.changed, true);
	assert.equal(handoff.groups[0].children[0].patch.filesChanged, 1);
	assert.equal(handoff.groups[0].cleanup.tasks[0].provider, "native");
	assert.notEqual(handoff.groups[0].cleanup.tasks[0].path, cwd);
	const patch = await readFile(handoff.groups[0].children[0].patch.path, "utf8");
	assert.match(patch, /REVIEW_THIS_PATCH/);
	assert.doesNotMatch(patch, /diff --git .*other/);
	execFileSync("git", ["apply", "--check", "-"], { cwd, input: patch });
	execFileSync("git", ["apply", "-"], { cwd, input: patch });
	assert.equal(await readFile(join(cwd, "marker.txt"), "utf8"), "REVIEW_THIS_PATCH\n");
	const dirty = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
	await assert.rejects(execute("subagent", { agent: "worker", task: "WRITE_NATIVE marker.txt", worktree: true, async: false }), /clean git working tree/);
	assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }), dirty);
	// Native timeout, cancellation and reload must permit a later reader.
	await assert.rejects(execute("subagent", { agent: "scout", task: "HOLD_NATIVE", async: false, options: { timeoutMs: 150 } }), /timed.?out|deadline/i);
	const controller = new AbortController();
	const cancelled = execute("subagent", { agent: "scout", task: "HOLD_NATIVE", async: false }, controller.signal);
	setTimeout(() => controller.abort(), 150);
	await cancelled.catch(error => { assert.match(error.message, /abort|cancel|stop/i); });
	await session.reload();
	assert.ok(session.getActiveToolNames().includes("bg_wait"));
	assert.ok(session.getActiveToolNames().includes("orchestraitor_tasks"));
	const reloadedDelegation = await selectSkill();
	requests.length = 0;
	const launched = await execute("subagent", { agent: "scout", task: reloadedDelegation.taskPrefix + "Inspect marker.txt asynchronously", options: reloadedDelegation.options, async: true });
	assert.notEqual(launched.isError, true, JSON.stringify(launched));
	const id = launched.details.runId ?? launched.details.id;
	assert.ok(id, JSON.stringify(launched.details));
	const waited = await execute("bg_wait", { id, timeoutMs: 30000 });
	assert.notEqual(waited.isError, true, JSON.stringify(waited));
	assert.equal(waited.details.completions[0].state, "complete");
	assert.equal(waited.details.completions[0].success, true);
	assert.ok(waited.usage.totalTokens > 0);
	assert.ok(JSON.stringify(requests).includes("EXPLICIT_SKILL_9021"));
	assert.ok(!JSON.stringify(requests).includes("WRONG_SKILL_9021"));
	assert.deepEqual(errors, []);
});
