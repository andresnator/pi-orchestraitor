import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
	createWorkspace, importHost, loadPackage, mcpStatus, pi, startSession,
} from "../helpers/pi-host.mjs";

const { createDefaultTransport } = await importHost("dist/extensions/mcp/runtime.js");
const LIVE_TIMEOUT_MS = 60_000;
const MEMORY_MARKER = "pi-orchestraitor-isolated-fixture-7391";

test("shouldConnectBothServersAndSeparateMemoriesWhenProjectsUseOneTemporaryDatabase", { timeout: LIVE_TIMEOUT_MS }, async (t) => {
	// Given
	const root = await createWorkspace(t);
	const dataDir = join(root, "engram-data");
	const workspaces = [join(root, "project-alpha"), join(root, "project-beta")];
	for (const cwd of workspaces) await mkdir(cwd);
	const closers = [];
	const nestedCalls = [];
	try {
		const sessions = [];
		for (const cwd of workspaces) {
			const resources = await loadPackage(cwd, {
				extensionFactories: [(api) => api.on("tool_call", (event) => { nestedCalls.push({ name: event.toolName, parent: event.parentToolCallId }); }), pi.createCodemodeExtension({ mode: "on" }), pi.createMcpExtension({
					loadConfig: () => ({ servers: [], errors: [] }),
					logPath: join(root, "mcp.log"),
					createTransport: (entry, sessionCwd, auth) => createDefaultTransport(entry.name === "engram" ? {
						...entry,
						config: { ...entry.config, env: {
							ENGRAM_DATA_DIR: dataDir,
							ENGRAM_PROJECT: "",
							ENGRAM_CLOUD_AUTOSYNC: "0",
							ENGRAM_CLOUD_SERVER: "",
							ENGRAM_CLOUD_TOKEN: "",
						} },
					} : entry, sessionCwd, auth),
				})],
			});
			const { session, errors, close } = await startSession(t, cwd, resources);
			closers.push(close);
			const status = await mcpStatus(session);
			assert.match(status, /context7: connected/);
			assert.match(status, /engram: connected/);
			assert.deepEqual(errors, []);
			sessions.push(session);
		}
		// Execute the bound codemode tool without a model. Nested calls use the
		// native validation and extension-hook pipeline.
		const call = async (session, name, args) => {
			const code = `const name = ${JSON.stringify(name)}; const result = await tools[name.replace(/[^a-zA-Z0-9_$]/g, "_")](${JSON.stringify(args)}); text("MCP_RESULT=" + JSON.stringify(result));`;
			// The host requires an issuing assistant message for nested calls. This
			// deterministic fixture does not call a model or imply model behavior.
			session.agent.state.messages = [...session.agent.state.messages, { role: "assistant", content: [{ type: "toolCall", id: "integration-codemode", name: "codemode", arguments: { code } }],
				api: "openai-responses", provider: "fixture", model: "fixture", stopReason: "toolUse", timestamp: Date.now(),
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			}];
			const tool = session.agent.state.tools.find(({ name }) => name === "codemode");
			assert.ok(tool, "Native codemode must be active");
			const output = await tool.execute("integration-codemode", { code }, t.signal);
			const text = output.content.filter(({ type }) => type === "text").map(({ text }) => text).join("\n");
			assert.match(text, /Script completed/);
			return JSON.parse(text.match(/MCP_RESULT=(.*)/)[1]);
		};
		// When
		const context7 = await call(sessions[0], "mcp__context7__query-docs", {
			libraryId: "/earendil-works/pi", query: "How does a Pi package declare bundled skills in package.json?",
		});
		const saved = await call(sessions[0], "mcp__engram__mem_save", {
			title: MEMORY_MARKER,
			type: "discovery",
			content: "Temporary synthetic fixture; not a real project decision.",
		});
		const own = await call(sessions[0], "mcp__engram__mem_search", { query: MEMORY_MARKER });
		const other = await call(sessions[1], "mcp__engram__mem_search", { query: MEMORY_MARKER });
		// Then
		assert.notEqual(context7.isError, true, JSON.stringify(context7.content));
		assert.ok(context7.content.some(({ type, text }) => type === "text" && text.length > 0));
		assert.notEqual(saved.isError, true, JSON.stringify(saved.content));
		assert.notEqual(own.isError, true, JSON.stringify(own.content));
		assert.notEqual(other.isError, true, JSON.stringify(other.content));
		const ownResponse = JSON.parse(own.content.find(({ type }) => type === "text").text);
		const otherResponse = JSON.parse(other.content.find(({ type }) => type === "text").text);
		assert.deepEqual({
			ownProject: ownResponse.project,
			ownContainsSavedContent: ownResponse.result.includes("Temporary synthetic fixture; not a real project decision."),
			otherProject: otherResponse.project,
			otherResult: otherResponse.result,
		}, {
			ownProject: "project-alpha", ownContainsSavedContent: true,
			otherProject: "project-beta", otherResult: `No memories found for: "${MEMORY_MARKER}"`,
		});
		assert.equal(nestedCalls.filter(({ name, parent }) => name.startsWith("mcp__") && parent === "integration-codemode").length, 4);
	} finally {
		await Promise.all(closers.map((close) => close()));
	}
});
