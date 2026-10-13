import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
	createWorkspace, importHost, isolatedAgentDir, loadExtensions, loadPackage,
	mcpStatus, packageRoot, pi, startSession,
} from "./helpers/pi-host.mjs";

const { loadMcpConfig } = await importHost("dist/extensions/mcp/config.js");
const CONTEXT7 = { name: "context7", config: {
	url: "https://mcp.context7.com/mcp", exposure: "codemode",
	description: "Current documentation for libraries, frameworks, SDKs, APIs and CLI tools.",
} };
const ENGRAM = { name: "engram", config: {
	command: "engram", args: ["mcp", "--tools=agent"], cwd: ".", exposure: "codemode",
	description: "Persistent project-scoped memory: search prior decisions and save verified findings.",
} };

/** Load the extension alone; Pi binds the tool listing when the session starts. */
async function loadMcp(t, tools) {
	const cwd = await createWorkspace(t);
	const loaded = await loadExtensions([join(packageRoot, "extensions/mcp.ts")], cwd);
	loaded.runtime.getAllTools = () => tools.map((name) => ({ name }));
	const servers = () => loaded.runtime.mcpServers.list().map(({ name, config }) => ({ name, config }));
	const startSession = async () => {
		for (const handler of loaded.extensions[0].handlers.get("session_start") ?? []) await handler({ type: "session_start", reason: "startup" }, { cwd });
	};
	return { loaded, servers, startSession };
}

test("shouldRegisterOnlyContext7WithoutStartingServersWhenExtensionLoads", async (t) => {
	// Given / When
	const { loaded, servers } = await loadMcp(t, []);
	// Then
	assert.deepEqual({ errors: loaded.errors, servers: servers(), handlers: [...loaded.extensions[0].handlers.keys()] },
		{ errors: [], servers: [CONTEXT7], handlers: ["session_start"] });
});

test("shouldRegisterEngramOnceWhenSessionsStartWithoutAnotherMemoryRoute", async (t) => {
	// Given
	const { loaded, servers, startSession } = await loadMcp(t, ["read", "mcp__engram__mem_search"]);
	// When
	await startSession();
	const registered = loaded.runtime.mcpServers.get("engram");
	await startSession();
	// Then
	assert.deepEqual(servers(), [CONTEXT7, ENGRAM]);
	// The same registration object: Pi reconnects a server only when its registration is replaced.
	assert.equal(loaded.runtime.mcpServers.get("engram"), registered);
});

test("shouldLeaveMemoryToAnotherExtensionWhenItProvidesEngramTools", async (t) => {
	// Given
	const { servers, startSession } = await loadMcp(t, ["read", "mem_save", "mem_search"]);
	// When
	await startSession();
	// Then
	assert.deepEqual(servers(), [CONTEXT7]);
});

test("shouldHonorFileOverridesWithoutRewritingThemWhenNativeMcpStarts", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const agentDir = join(cwd, "agent");
	await mkdir(agentDir);
	await mkdir(join(cwd, ".pi"));
	const globalPath = join(agentDir, "mcp.json");
	const projectPath = join(cwd, ".pi/mcp.json");
	const globalConfig = JSON.stringify({ mcpServers: {
		context7: { url: "https://example.invalid/global", enabled: false },
		engram: { command: "global-engram", enabled: false },
	} });
	const projectConfig = JSON.stringify({ mcpServers: {
		engram: { command: "project-engram", enabled: false },
	} });
	await writeFile(globalPath, globalConfig);
	await writeFile(projectPath, projectConfig);
	const attempted = [];
	const resources = await loadPackage(cwd, {
		extensionFactories: [pi.createMcpExtension({
			loadConfig: () => loadMcpConfig({ agentDir, cwd, projectTrusted: true }),
			createTransport: (entry) => { attempted.push(entry); throw new Error("Must remain disabled"); },
			logPath: join(cwd, "mcp.log"),
		})],
	});
	// When
	const { session, errors } = await startSession(t, cwd, resources);
	const status = await mcpStatus(session);
	// Then
	assert.deepEqual({ attempted, errors, global: await readFile(globalPath, "utf8"), project: await readFile(projectPath, "utf8") },
		{ attempted: [], errors: [], global: globalConfig, project: projectConfig });
	assert.match(status, /context7[\s\S]*disabled/);
	assert.match(status, /engram[\s\S]*disabled/);
	assert.ok(status.includes(`"engram" in ${projectPath}`));
	assert.equal(loadMcpConfig({ agentDir, cwd, projectTrusted: true }).servers.find(({ name }) => name === "engram").config.command, "project-engram");
});

test("shouldReportMissingEngramWithoutBreakingOtherToolsWhenNativeConnectionFails", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const resources = await loadPackage(cwd, {
		extensionFactories: [pi.createMcpExtension({
			loadConfig: () => ({ errors: [], servers: [
				{ name: "context7", config: { url: "https://example.invalid", enabled: false }, source: "fixture", scope: "global" },
			] }),
			createTransport: () => { throw Object.assign(new Error("spawn engram ENOENT"), { code: "ENOENT" }); },
			logPath: join(cwd, "mcp.log"),
		})],
	});
	// When
	const { session, errors } = await startSession(t, cwd, resources);
	const status = await mcpStatus(session);
	// Then
	assert.match(status, /engram: failed[\s\S]*ENOENT/);
	assert.deepEqual({ active: session.getActiveToolNames(), errors },
		{ active: ["read", "bash", "edit", "write", "subagent_collect", "subagent_run", "orchestraitor_tasks", "orchestraitor_ask", "skill_registry"], errors: [] });
});

test("shouldNotStartEngramWhenAnotherPackageRegistersMemoryTools", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const attempted = [];
	const memory = (api) => api.registerTool({ name: "mem_search", label: "Memory fixture", description: "Search memory",
		parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "none" }] }) });
	const resources = await loadPackage(cwd, {
		extensionFactories: [pi.createMcpExtension({
			loadConfig: () => ({ errors: [], servers: [
				{ name: "context7", config: { url: "https://example.invalid", enabled: false }, source: "fixture", scope: "global" },
			] }),
			createTransport: (entry) => { attempted.push(entry.name); throw new Error("Test transport: no process launched"); },
			logPath: join(cwd, "mcp.log"),
		}), memory],
	});
	// When
	const { session, errors } = await startSession(t, cwd, resources);
	const status = await mcpStatus(session);
	// Then
	assert.deepEqual({ attempted, errors, servers: session.extensionRunner.runtime.mcpServers.list().map(({ name }) => name) },
		{ attempted: [], errors: [], servers: ["context7"] });
	assert.doesNotMatch(status, /engram/);
});

test("shouldUseEachSessionWorkspaceWhenEngramHasNoFixedProject", async (t) => {
	// Given
	const directories = [await createWorkspace(t), await createWorkspace(t)];
	const observed = [];
	// When
	for (const cwd of directories) {
		const resources = await loadPackage(cwd, {
			extensionFactories: [pi.createMcpExtension({
				loadConfig: () => ({ errors: [], servers: [
					{ name: "context7", config: { url: "https://example.invalid", enabled: false }, source: "fixture" },
				] }),
				createTransport: (entry, sessionCwd) => {
					observed.push({ cwd: sessionCwd, serverCwd: entry.config.cwd, args: entry.config.args, env: entry.config.env });
					throw new Error("Test transport: no process launched");
				},
				logPath: join(isolatedAgentDir, "mcp.log"),
			})],
		});
		const { session } = await startSession(t, cwd, resources);
		await mcpStatus(session);
	}
	// Then
	assert.deepEqual(observed, directories.map((cwd) => ({ cwd, serverCwd: ".", args: ["mcp", "--tools=agent"], env: undefined })));
});
