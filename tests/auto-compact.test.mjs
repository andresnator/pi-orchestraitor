import assert from "node:assert/strict";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createWorkspace, importHost, packageRoot, pi } from "./helpers/pi-host.mjs";

const { shouldCompact } = await importHost("dist/core/compaction/index.js");
const { createAssistantMessageEventStream } = await importHost("node_modules/@earendil-works/pi-ai/dist/index.js");
const MODEL_KEY = "fixture/model";
const CONTEXT_WINDOW = 1_000_000;
const SECOND_MODEL = "fixture/other";
const UTF8_BOM = "\uFEFF";
// The retained user span must exceed Pi's 20k keepRecentTokens budget to leave older history to summarize.
const RECENT_REQUEST = "Recent request: " + "x".repeat(100000);
const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
const extensionPaths = manifest.pi.extensions.filter((path) => path.endsWith("/auto-compact.ts"))
	.map((path) => join(packageRoot, path));

function assistant(model, tokens = 1) {
	return { role: "assistant", api: model.api, provider: model.provider, model: model.id,
		content: [{ type: "text", text: "Fixture response" }], stopReason: "stop", timestamp: Date.now(),
		usage: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: tokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}

async function fixture(t, initial = {}, project, { projectTrusted = true } = {}) {
	const cwd = await createWorkspace(t);
	const agentDir = join(cwd, "agent");
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	t.after(() => { process.env.PI_CODING_AGENT_DIR = previousAgentDir; });
	await mkdir(agentDir);
	const path = join(agentDir, "settings.json");
	await writeFile(path, typeof initial === "string" ? initial : JSON.stringify(initial));
	if (project) {
		await mkdir(join(cwd, ".pi"));
		await writeFile(join(cwd, ".pi/settings.json"), typeof project === "string" ? project : JSON.stringify(project));
	}
	const notifications = [], reasons = [], errors = [], actions = [];
	const settingsManager = pi.SettingsManager.create(cwd, agentDir, { projectTrusted });
	const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir, settingsManager,
		noExtensions: true, additionalExtensionPaths: extensionPaths,
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		extensionFactories: [(api) => {
			api.registerProvider("fixture", { api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "fixture",
				models: ["model", "other"].map((id) => ({ id, name: id, reasoning: false, input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: CONTEXT_WINDOW, maxTokens: 16384 })),
				streamSimple(model) {
					const stream = createAssistantMessageEventStream();
					const message = assistant(model);
					stream.push({ type: "done", reason: "stop", message });
					stream.end(message);
					return stream;
				},
			});
			api.on("session_before_compact", (event) => {
				reasons.push(event.reason);
				return { compaction: { summary: "Fixture summary", firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore } };
			});
		}],
	});
	await resourceLoader.reload();
	assert.deepEqual(resourceLoader.getExtensions().errors, []);
	const { session } = await pi.createAgentSession({ cwd, agentDir, settingsManager, resourceLoader,
		sessionManager: pi.SessionManager.inMemory(cwd) });
	t.after(async () => { await session.extensionRunner.emit({ type: "session_shutdown" }); session.dispose(); });
	await session.bindExtensions({ onError: (error) => errors.push(error),
		uiContext: { notify: (message, type) => notifications.push({ message, type }) },
		commandContextActions: {
			waitForIdle: async () => { actions.push("idle"); await session.waitForIdle(); },
			reload: async () => { actions.push("reload"); await session.reload(); },
		},
	});
	await session.setModel((await session.modelRuntime.getAvailable()).find(({ provider, id }) => provider === "fixture" && id === "model"));
	assert.ok(session.extensionRunner.getCommand("auto-compact"), "Package must register /auto-compact");
	const run = (args, overrides = {}) => session.extensionRunner.getCommand("auto-compact")
		.handler(args, { ...session.extensionRunner.createCommandContext(), ...overrides });
	return { cwd, agentDir, session, settingsManager, path, run, notifications, reasons, errors, actions };
}

for (const [argument, threshold] of [["400k", 400000], ["150K", 150000], ["0.5m", 500000], ["0.145m", 145000], ["300000", 300000], [" 250.5k ", 250500]]) {
	test(`shouldPersistVariableThresholdForCurrentModelWhenArgumentIs${argument.trim()}`, async (t) => {
		// Given
		const initial = { theme: "light", compaction: { enabled: false, reserveTokens: 12345, keepRecentTokens: 30000,
			modelOverrides: { [MODEL_KEY]: { keepRecentTokens: 25000 }, [SECOND_MODEL]: { reserveTokens: 54321 } } } };
		const { cwd, agentDir, session, settingsManager, path, run, notifications, actions, errors } = await fixture(t, initial);
		// When
		await run(argument);
		// Then
		assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { ...initial, compaction: { ...initial.compaction,
			enabled: true, modelOverrides: { ...initial.compaction.modelOverrides,
				[MODEL_KEY]: { keepRecentTokens: 25000, reserveTokens: CONTEXT_WINDOW - threshold } } } });
		assert.deepEqual({ settings: settingsManager.getCompactionSettings(session.model), actions, errors }, {
			settings: { enabled: true, reserveTokens: CONTEXT_WINDOW - threshold, keepRecentTokens: 25000 },
			actions: ["idle", "reload"], errors: [],
		});
		assert.match(notifications.at(-1).message, new RegExp(`${threshold} tokens`));
		const reloaded = pi.SettingsManager.create(cwd, agentDir);
		assert.equal(reloaded.getCompactionReserveTokens(session.model), CONTEXT_WINDOW - threshold);
		assert.equal(reloaded.getCompactionReserveTokens({ provider: "fixture", id: "other" }), 54321);
	});
}

test("shouldUseNativeStrictThresholdWhenConfigurationHasBeenApplied", async (t) => {
	// Given
	const { session, settingsManager, run, reasons, errors } = await fixture(t);
	// When
	await run("400k");
	const settings = settingsManager.getCompactionSettings(session.model);
	const boundaries = [399999, 400000, 400001].map((tokens) => shouldCompact(tokens, CONTEXT_WINDOW, settings));
	session.sessionManager.appendMessage({ role: "user", content: "Old request", timestamp: Date.now() });
	session.sessionManager.appendMessage(assistant(session.model));
	session.sessionManager.appendMessage({ role: "user", content: RECENT_REQUEST, timestamp: Date.now() });
	session.sessionManager.appendMessage(assistant(session.model, 450000));
	session.agent.state.messages.splice(0, session.agent.state.messages.length, ...session.sessionManager.buildSessionContext().messages);
	await session.prompt("Continue the fixture.");
	// Then
	assert.deepEqual({ boundaries, reasons, errors }, { boundaries: [false, false, true], reasons: ["threshold"], errors: [] });
	assert.ok(session.sessionManager.getBranch().some((entry) => entry.type === "compaction"));
});

test("shouldReportCurrentNativeThresholdWithoutWritingWhenArgumentIsEmpty", async (t) => {
	// Given
	const initial = { compaction: { enabled: false, modelOverrides: { [MODEL_KEY]: { reserveTokens: 600000 } } } };
	const { path, run, notifications, actions } = await fixture(t, initial);
	const before = await readFile(path, "utf8");
	// When
	await run("");
	// Then
	assert.deepEqual({ text: await readFile(path, "utf8"), actions }, { text: before, actions: [] });
	assert.match(notifications.at(-1).message, /fixture\/model.*disabled.*400000 tokens/);
});

for (const argument of ["0", "-1", "400kk", "400k extra", "abc", "NaN", "Infinity", "1.5", "0.0001k", "9007199254740992", "1m", "2m", "20k"]) {
	test(`shouldLeaveSettingsUntouchedWhenThresholdIsInvalid${argument}`, async (t) => {
		// Given
		const { path, run, notifications, actions } = await fixture(t, { theme: "light" });
		const before = await readFile(path, "utf8");
		// When
		await run(argument);
		// Then
		assert.deepEqual({ text: await readFile(path, "utf8"), reloads: actions.filter((action) => action === "reload"),
			type: notifications.at(-1).type }, { text: before, reloads: [], type: "error" });
	});
}

test("shouldRejectThresholdWithoutWritingWhenNoModelIsSelected", async (t) => {
	// Given
	const { path, run, notifications, actions } = await fixture(t);
	const before = await readFile(path, "utf8");
	// When
	await run("400k", { model: undefined });
	// Then
	assert.deepEqual({ text: await readFile(path, "utf8"), actions }, { text: before, actions: ["idle"] });
	assert.match(notifications.at(-1).message, /Select a model/);
});

for (const overrides of [{ keepRecentTokens: 25000 }, {}]) {
	test(`shouldRemoveOnlyCurrentModelThresholdWhenDefaultIsRequested${Object.keys(overrides).length}`, async (t) => {
		// Given
		const initial = { compaction: { enabled: true, reserveTokens: 24000,
			modelOverrides: { [MODEL_KEY]: { ...overrides, reserveTokens: 600000 }, [SECOND_MODEL]: { reserveTokens: 500000 } } } };
		const { session, settingsManager, path, run } = await fixture(t, initial);
		// When
		await run("default");
		// Then
		assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { compaction: { ...initial.compaction,
			modelOverrides: { ...(Object.keys(overrides).length ? { [MODEL_KEY]: overrides } : {}), [SECOND_MODEL]: { reserveTokens: 500000 } } } });
		assert.equal(settingsManager.getCompactionReserveTokens(session.model), 24000);
	});
}

for (const project of [{ compaction: { modelOverrides: { [MODEL_KEY]: { reserveTokens: 100000 } } } }, { compaction: { enabled: false } }]) {
	test(`shouldRejectShadowedPersonalConfigurationWhenProjectOverrides${project.compaction.enabled === false ? "Enabled" : "Threshold"}`, async (t) => {
		// Given
		const { path, run, notifications, actions } = await fixture(t, {}, project);
		const before = await readFile(path, "utf8");
		// When
		await run("400k");
		// Then
		assert.deepEqual({ text: await readFile(path, "utf8"), actions }, { text: before, actions: ["idle"] });
		assert.match(notifications.at(-1).message, /\.pi\/settings\.json/);
		assert.equal(notifications.at(-1).type, "error");
	});
}

for (const [name, project] of [
	["Disabled", { compaction: { enabled: false } }],
	["ReserveOverride", { compaction: { modelOverrides: { [MODEL_KEY]: { reserveTokens: 100000, keepRecentTokens: 900000 } } } }],
	["MalformedJson", '{ "compaction":'],
]) {
	test(`shouldIgnoreProjectSettingsWhenProjectIsUntrustedAndSettingsAre${name}`, async (t) => {
		// Given
		const { cwd, session, settingsManager, path, run, actions, errors } = await fixture(t, { theme: "light" }, project, { projectTrusted: false });
		const projectPath = join(cwd, ".pi/settings.json");
		const before = await readFile(projectPath, "utf8");
		assert.equal(session.extensionRunner.createCommandContext().isProjectTrusted(), false);
		assert.deepEqual(settingsManager.getProjectSettings(), {});
		// When
		await run("400k");
		// Then
		assert.deepEqual({ personal: JSON.parse(await readFile(path, "utf8")), project: await readFile(projectPath, "utf8"), actions, errors }, {
			personal: { theme: "light", compaction: { enabled: true, modelOverrides: { [MODEL_KEY]: { reserveTokens: 600000 } } } },
			project: before, actions: ["idle", "reload"], errors: [],
		});
		assert.deepEqual(settingsManager.getCompactionSettings(session.model), { enabled: true, reserveTokens: 600000, keepRecentTokens: 20000 });
	});
}

test("shouldSkipProjectStorageWhenAnUntrustedProjectSettingsFileIsLocked", async (t) => {
	// Given
	const { cwd, path, run, actions } = await fixture(t, {}, { compaction: { enabled: false } }, { projectTrusted: false });
	await mkdir(join(cwd, ".pi/settings.json.lock"));
	// When
	await run("400k");
	// Then
	assert.deepEqual({ personal: JSON.parse(await readFile(path, "utf8")), actions }, {
		personal: { compaction: { enabled: true, modelOverrides: { [MODEL_KEY]: { reserveTokens: 600000 } } } },
		actions: ["idle", "reload"],
	});
});

for (const argument of ["150k", "default"]) {
	test(`shouldSaveNativeCompatibleSettingsWhenPersonalJsonStartsWithBomAndArgumentIs${argument}`, async (t) => {
		// Given
		const initial = { theme: "light", compaction: { enabled: true, reserveTokens: 16000,
			modelOverrides: { [MODEL_KEY]: { reserveTokens: 600000, keepRecentTokens: 25000 }, [SECOND_MODEL]: { reserveTokens: 500000 } } } };
		const { session, settingsManager, path, run, actions, errors } = await fixture(t, UTF8_BOM + JSON.stringify(initial));
		assert.deepEqual(settingsManager.drainErrors(), []);
		assert.deepEqual(settingsManager.getGlobalSettings(), initial);
		// When
		await run(argument);
		// Then
		assert.deepEqual({ personal: JSON.parse(await readFile(path, "utf8")), actions, errors }, {
			personal: { ...initial, compaction: { ...initial.compaction, modelOverrides: {
				...initial.compaction.modelOverrides,
				[MODEL_KEY]: { keepRecentTokens: 25000, ...(argument === "default" ? {} : { reserveTokens: 850000 }) },
			} } }, actions: ["idle", "reload"], errors: [],
		});
		assert.equal(settingsManager.getCompactionReserveTokens(session.model), argument === "default" ? 16000 : 850000);
	});
}

test("shouldReportTrustedProjectConflictWhenProjectJsonStartsWithBom", async (t) => {
	// Given
	const project = UTF8_BOM + JSON.stringify({ compaction: { modelOverrides: { [MODEL_KEY]: { reserveTokens: 100000 } } } });
	const { path, run, settingsManager, notifications, actions } = await fixture(t, { theme: "light" }, project);
	const before = await readFile(path, "utf8");
	assert.deepEqual(settingsManager.drainErrors(), []);
	// When
	await run("400k");
	// Then
	assert.deepEqual({ personal: await readFile(path, "utf8"), actions }, { personal: before, actions: ["idle"] });
	assert.match(notifications.at(-1).message, /\.pi\/settings\.json overrides auto-compaction/);
});

test("shouldCreatePersonalSettingsWhenTheFileDoesNotExist", async (t) => {
	// Given
	const { path, run } = await fixture(t);
	await unlink(path);
	// When
	await run("400k");
	// Then
	assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
		compaction: { enabled: true, modelOverrides: { [MODEL_KEY]: { reserveTokens: 600000 } } },
	});
});

test("shouldAvoidReloadWhenDefaultHasNoPersonalOverrideToRemove", async (t) => {
	// Given
	const { path, run, actions } = await fixture(t, { theme: "light" });
	const before = await readFile(path, "utf8");
	// When
	await run("default");
	// Then
	assert.deepEqual({ text: await readFile(path, "utf8"), actions }, { text: before, actions: ["idle"] });
});

test("shouldLeaveSettingsUntouchedWhenAnotherWriterHoldsTheNativeLock", async (t) => {
	// Given
	const { path, run, notifications, actions } = await fixture(t);
	const before = await readFile(path, "utf8");
	await mkdir(`${path}.lock`);
	// When
	await run("400k");
	// Then
	assert.deepEqual({ text: await readFile(path, "utf8"), actions, type: notifications.at(-1).type },
		{ text: before, actions: ["idle"], type: "error" });
});

for (const [name, malformed] of [
	["Root", []], ["Compaction", { compaction: [] }],
	["Overrides", { compaction: { modelOverrides: [] } }],
	["ModelOverride", { compaction: { modelOverrides: { [MODEL_KEY]: [] } } }],
]) {
	test(`shouldPreserveInvalidObjectShapeWhenPersonal${name}IsNotAnObject`, async (t) => {
		// Given
		const { path, run, notifications, actions } = await fixture(t);
		const before = JSON.stringify(malformed);
		await writeFile(path, before);
		// When
		await run("400k");
		// Then
		assert.deepEqual({ text: await readFile(path, "utf8"), actions, type: notifications.at(-1).type },
			{ text: before, actions: ["idle"], type: "error" });
	});
}

test("shouldPreserveMalformedSettingsWhenSavingWouldLoseExistingConfiguration", async (t) => {
	// Given
	const { path, run, notifications, actions } = await fixture(t);
	const malformed = '{ "theme": "light",';
	await writeFile(path, malformed);
	// When
	await run("400k");
	// Then
	assert.deepEqual({ text: await readFile(path, "utf8"), actions, type: notifications.at(-1).type },
		{ text: malformed, actions: ["idle"], type: "error" });
});
