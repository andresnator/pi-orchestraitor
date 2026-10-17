import assert from "node:assert/strict";
import test from "node:test";
import { importHost, pi } from "./helpers/pi-host.mjs";
import { providerRequestOptions } from "../extensions/provider-options.mjs";

const { mergeProviderAttributionHeaders } = await importHost("dist/core/provider-attribution.js");
const model = (provider, baseUrl) => ({ id: "fixture", provider, api: "openai-completions", baseUrl });
const ANTHROPIC = model("anthropic", "https://api.anthropic.com");
const settings = values => pi.SettingsManager.inMemory(values);
const { transformHeaders: _headers, ...configured } = providerRequestOptions(settings({ httpIdleTimeoutMs: 45000, websocketConnectTimeoutMs: 7000, transport: "sse",
	retry: { provider: { maxRetries: 4, maxRetryDelayMs: 9000 } }, thinkingBudgets: { low: 1024, high: 8192 } }), ANTHROPIC, "session");

test("request options follow Pi's provider timeout, retry, thinking budget and transport settings", () => {
	const timeout = values => providerRequestOptions(settings(values), ANTHROPIC, "session").timeoutMs;
	assert.deepEqual(configured, { timeoutMs: 45000, websocketConnectTimeoutMs: 7000, maxRetries: 4, maxRetryDelayMs: 9000, thinkingBudgets: { low: 1024, high: 8192 }, transport: "sse" });
	assert.deepEqual({ provider: timeout({ httpIdleTimeoutMs: 45000, retry: { provider: { timeoutMs: 30000 } } }), disabled: timeout({ httpIdleTimeoutMs: 0 }) },
		{ provider: 30000, disabled: 2147483647 });
	const { transformHeaders: _defaultHeaders, ...defaults } = providerRequestOptions(settings({}), ANTHROPIC, "session");
	assert.deepEqual(defaults, { timeoutMs: 300000, websocketConnectTimeoutMs: undefined, maxRetries: undefined, maxRetryDelayMs: 60000, thinkingBudgets: undefined, transport: "auto" });
});

test("request headers match Pi's provider attribution for every telemetry state", async t => {
	const telemetry = process.env.PI_TELEMETRY;
	t.after(() => { process.env.PI_TELEMETRY = telemetry; });
	const models = [model("openrouter", "https://example.invalid"), model("custom", "https://openrouter.ai/api/v1"), model("nvidia", "https://example.invalid"),
		model("custom", "https://integrate.api.nvidia.com/v1"), model("cloudflare-workers-ai", "https://example.invalid"), model("cloudflare-ai-gateway", "https://example.invalid"),
		model("custom", "https://api.cloudflare.com/client/v4"), model("custom", "https://gateway.ai.cloudflare.com/v1"), model("opencode", "https://example.invalid"),
		model("opencode-go", "https://example.invalid"), model("custom", "https://opencode.ai/zen/v1"), ANTHROPIC, model("custom", "not a url")];
	const cases = [];
	for (const env of [undefined, "1", "yes", "TRUE", "0", ""]) for (const enabled of [true, false]) for (const sessionId of ["session", undefined]) {
		for (const requested of [{}, { "x-request": "kept", "HTTP-Referer": "https://request.invalid" }]) for (const target of models) {
			if (env === undefined) delete process.env.PI_TELEMETRY; else process.env.PI_TELEMETRY = env;
			const host = settings({ enableInstallTelemetry: enabled });
			const actual = await providerRequestOptions(host, target, sessionId).transformHeaders({ ...requested });
			const expected = mergeProviderAttributionHeaders(target, host, sessionId, { ...requested }) ?? {};
			cases.push({ env, enabled, sessionId, target: `${target.provider} ${target.baseUrl}`, actual, expected });
		}
	}
	assert.deepEqual(cases.map(({ expected, ...rest }) => ({ ...rest, actual: expected })), cases.map(({ expected: _expected, ...rest }) => rest));
	assert.ok(cases.some(({ expected }) => expected["X-OpenRouter-Title"] === "pi") && cases.some(({ expected }) => expected["x-opencode-session"] === "session"));
});
