import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { mock } from "node:test";
import { createWorkspace, importHost, pi } from "./helpers/pi-host.mjs";
import { createPackageUISession, loadUiModule } from "./helpers/ui-harness.mjs";

const { createModels, InMemoryCredentialStore } = await importHost("node_modules/@earendil-works/pi-ai/dist/index.js");
const PROVIDER = "nan";
const MODEL = "glm5.3-flash";
const ENV_KEY = "fixture-nan-env-key";
const STORED_KEY = "fixture-nan-stored-key";
const EXPECTED_MODELS = [
	["deepseek-v4-flash", "DeepSeek V4 Flash", 1048576, 32768],
	["glm5.3-flash", "GLM 5.3 Flash", 1048576, 32768],
	["qwen3.8-flash", "Qwen 3.8 Flash", 1048576, 32768],
	["mimo-v2.6-flash", "Xiaomi MiMo V2.6 Flash", 1048576, 32768],
	["gemma4", "Gemma 4", 262144, 65536],
	["qwen3.6", "Qwen 3.6", 262144, 65536],
	["glm5.3", "GLM 5.3 (premium)", 1048576, 32768],
];

async function fixture(t, env = {}) {
	const subject = await loadUiModule(t, "extensions/nan.ts");
	const provider = subject.createNanProvider();
	const credentials = new InMemoryCredentialStore();
	const models = createModels({ credentials, authContext: {
		env: async (name) => env[name], fileExists: async () => false,
	} });
	models.setProvider(provider);
	return { subject, provider, credentials, models };
}

test("shouldRegisterOnlyTheNativeProviderWhenExtensionLoads", async (t) => {
	// Given
	const { subject } = await fixture(t);
	const registerProvider = mock.fn();
	// When
	subject.default({ registerProvider });
	// Then
	assert.deepEqual(registerProvider.mock.calls.map(({ arguments: [provider] }) => ({
		id: provider.id, name: provider.name, baseUrl: provider.baseUrl,
		apiKeyLogin: typeof provider.auth.apiKey.login, oauth: provider.auth.oauth,
		models: provider.getModels().length, refresh: provider.refreshModels,
	})), [{ id: "nan", name: "NaN", baseUrl: "https://api.nan.builders/v1",
		apiKeyLogin: "function", oauth: undefined, models: 7, refresh: undefined }]);
});

test("shouldMatchTheSevenOfficialChatDefinitionsWhenProviderIsCreated", async (t) => {
	// Given
	const { provider } = await fixture(t);
	// When
	const models = provider.getModels();
	// Then
	assert.deepEqual(models.map(({ id, name, contextWindow, maxTokens }) => [id, name, contextWindow, maxTokens]), EXPECTED_MODELS);
	assert.deepEqual(models.map(({ provider, baseUrl, api, reasoning, input, cost, compat }) => ({
		provider, baseUrl, api, reasoning, input, cost, compat,
	})), EXPECTED_MODELS.map(() => ({ provider: "nan", baseUrl: "https://api.nan.builders/v1",
		api: "openai-completions", reasoning: true, input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsDeveloperRole: true } })));
});

test("shouldKeepModelsUnavailableWhenNoCredentialIsConfigured", async (t) => {
	// Given
	const { models, credentials } = await fixture(t);
	// When
	const result = { available: await models.getAvailable(PROVIDER), auth: await models.getAuth(PROVIDER), credentials: await credentials.list() };
	// Then
	assert.deepEqual(result, { available: [], auth: undefined, credentials: [] });
});

test("shouldUseEnvironmentWithoutPersistingItWhenNanApiKeyIsSet", async (t) => {
	// Given
	const { models, credentials } = await fixture(t, { NAN_API_KEY: ENV_KEY });
	// When
	const auth = await models.getAuth(PROVIDER);
	const available = await models.getAvailable(PROVIDER);
	// Then
	assert.deepEqual({ auth, ids: available.map(({ id }) => id), credentials: await credentials.list() }, {
		auth: { auth: { apiKey: ENV_KEY }, source: "NAN_API_KEY" }, ids: EXPECTED_MODELS.map(([id]) => id), credentials: [],
	});
});

test("shouldPersistTheNativeSecretPromptAndPreferStoredKeyWhenUserLogsIn", async (t) => {
	// Given
	const { models, credentials } = await fixture(t, { NAN_API_KEY: ENV_KEY });
	const prompt = mock.fn(async () => STORED_KEY);
	// When
	await models.login(PROVIDER, "api_key", { prompt, notify() {} });
	const auth = await models.getAuth(PROVIDER);
	await models.logout(PROVIDER);
	const afterLogout = await models.getAuth(PROVIDER);
	// Then
	assert.deepEqual({ prompts: prompt.mock.calls.map(({ arguments: [prompt] }) => prompt), auth, afterLogout, stored: await credentials.read(PROVIDER) }, {
		prompts: [{ type: "secret", message: "Enter NaN API key" }],
		auth: { auth: { apiKey: STORED_KEY }, env: undefined, source: "stored credential" },
		afterLogout: { auth: { apiKey: ENV_KEY }, source: "NAN_API_KEY" }, stored: undefined,
	});
});

for (const stage of ["beforePrompt", "duringPrompt"]) {
	test(`shouldPreserveCredentialsWhenLoginIsCancelled${stage}`, async (t) => {
		// Given
		const { models, credentials } = await fixture(t);
		await credentials.modify(PROVIDER, async () => ({ type: "api_key", key: STORED_KEY }));
		const abort = new AbortController();
		const prompt = mock.fn(async () => { abort.abort(); return ENV_KEY; });
		if (stage === "beforePrompt") abort.abort();
		// When / Then
		await assert.rejects(models.login(PROVIDER, "api_key", { signal: abort.signal, prompt, notify() {} }), { name: "AbortError" });
		assert.deepEqual({ credential: await credentials.read(PROVIDER), prompts: prompt.mock.calls.length },
			{ credential: { type: "api_key", key: STORED_KEY }, prompts: stage === "beforePrompt" ? 0 : 1 });
	});
}

function sseResponse(delta, finishReason) {
	const chunk = (choices, usage) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: MODEL, choices, ...(usage ? { usage } : {}) })}\n\n`;
	return new Response(chunk([{ index: 0, delta, finish_reason: null }]) +
		chunk([{ index: 0, delta: {}, finish_reason: finishReason }], { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }) +
		"data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
}

for (const kind of ["text", "tool"]) {
	test(`shouldUseNativeStreamingAndRequestAuthWhenResponseIs${kind}`, async (t) => {
		// Given
		const { models } = await fixture(t, { NAN_API_KEY: ENV_KEY });
		const fetch = mock.fn(async () => sseResponse(kind === "text" ? { content: "Synthetic answer 原" } : {
			tool_calls: [{ index: 0, id: "fixture-call", type: "function", function: { name: "inspect", arguments: '{"path":"example.txt"}' } }],
		}, kind === "text" ? "stop" : "tool_calls"));
		const payloads = [];
		const context = { systemPrompt: "Synthetic instructions", tools: [{ name: "inspect", description: "Synthetic tool",
			parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
			messages: [{ role: "user", content: "Synthetic question", timestamp: 1 }] };
		// When
		const stream = models.streamSimple(models.getModel(PROVIDER, MODEL), context, { fetch, reasoning: "low",
			onPayload: (payload) => { payloads.push(payload); } });
		const events = [];
		for await (const event of stream) events.push(event);
		const message = await stream.result();
		// Then
		assert.equal(fetch.mock.calls.length, 1);
		const [url, request] = fetch.mock.calls[0].arguments;
		const payload = JSON.parse(request.body);
		assert.deepEqual({ url: String(url), authorization: new Headers(request.headers).get("Authorization"),
			model: payload.model, instruction: payload.messages[0], tools: payload.tools.map(({ function: tool }) => tool.name),
			reasoning: payload.reasoning_effort, hooks: payloads.length, first: events[0].type, last: events.at(-1).type }, {
			url: "https://api.nan.builders/v1/chat/completions", authorization: `Bearer ${ENV_KEY}`, model: MODEL,
			instruction: { role: "developer", content: "Synthetic instructions" }, tools: ["inspect"],
			reasoning: "low", hooks: 1, first: "start", last: "done",
		});
		assert.deepEqual({ content: message.content, stopReason: message.stopReason, provider: message.provider,
			api: message.api, tokens: message.usage.totalTokens, cost: message.usage.cost.total }, {
			content: kind === "text" ? [{ type: "text", text: "Synthetic answer 原" }] :
				[{ type: "toolCall", id: "fixture-call", name: "inspect", arguments: { path: "example.txt" } }],
			stopReason: kind === "text" ? "stop" : "toolUse", provider: "nan", api: "openai-completions", tokens: 14, cost: 0,
		});
	});
}

test("shouldPreserveModelDefaultsAndOneProviderWhenPackageReloads", async (t) => {
	// Given
	const settings = { defaultProvider: "openai", defaultModel: "gpt-5-mini" };
	const { session, resources, errors } = await createPackageUISession(t, "print", { settings });
	const beforeModel = session.model;
	const beforeSettings = resources.settingsManager.getGlobalSettings();
	// When
	await session.reload();
	// Then
	assert.deepEqual({ providers: session.modelRuntime.getProviders().filter(({ id }) => id === PROVIDER).map(({ id }) => id),
		models: session.modelRuntime.getModels(PROVIDER).map(({ id }) => id),
		model: session.model, settings: resources.settingsManager.getGlobalSettings(), errors }, {
		providers: [PROVIDER], models: EXPECTED_MODELS.map(([id]) => id), model: beforeModel, settings: beforeSettings, errors: [],
	});
});

test("shouldApplyPersonalModelOverridesWhenBundledNanProviderLoads", async (t) => {
	// Given
	const { models } = await fixture(t);
	const path = join(await createWorkspace(t), "models.json");
	await writeFile(path, JSON.stringify({ providers: { nan: { modelOverrides: { [MODEL]: { maxTokens: 8192 } } } } }));
	const runtime = await pi.ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: path, refreshOnCreate: false });
	const { provider } = await fixture(t);
	// When
	runtime.registerNativeProvider(provider);
	// Then
	assert.deepEqual({ maxTokens: runtime.getModel(PROVIDER, MODEL).maxTokens, count: runtime.getModels(PROVIDER).length,
		original: models.getModel(PROVIDER, MODEL).maxTokens }, { maxTokens: 8192, count: 7, original: 32768 });
	assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { providers: { nan: { modelOverrides: { [MODEL]: { maxTokens: 8192 } } } } });
});
