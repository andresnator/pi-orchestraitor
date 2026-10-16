/**
 * Provider options Pi 1.3.0 adds to its own agent requests (core/sdk.js buildRequestOptions, plus the
 * agent's thinkingBudgets and transport), for requests an extension sends through the model registry itself.
 * `settings` is a SettingsManager over the host's effective settings: SettingsManager.inMemory(pi.getSettings()).
 * Not reproducible: before_provider_headers handlers, which only Pi's extension runner emits to its own requests.
 */
const MAX_TIMER_MS = 2147483647;

export function providerRequestOptions(settings, model, sessionId) {
	const retry = settings.getProviderRetrySettings();
	const idle = settings.getHttpIdleTimeoutMs();
	return {
		timeoutMs: retry.timeoutMs ?? (idle === 0 ? MAX_TIMER_MS : idle),
		websocketConnectTimeoutMs: settings.getWebSocketConnectTimeoutMs(),
		maxRetries: retry.maxRetries,
		maxRetryDelayMs: retry.maxRetryDelayMs,
		thinkingBudgets: settings.getThinkingBudgets(),
		transport: settings.getTransport(),
		// Request headers win, as in Pi's mergeProviderAttributionHeaders.
		transformHeaders: async (headers) => ({ ...attributionHeaders(model, settings, sessionId), ...headers }),
	};
}

// Pi's core/provider-attribution.js and telemetry.js are not exported, so these mirror them;
// tests/provider-options.test.mjs compares both with the host's implementation.
const isHost = (baseUrl, host) => { try { return new URL(baseUrl).hostname === host; } catch { return false; } };
function attributionHeaders(model, settings, sessionId) {
	const headers = {};
	if (sessionId && (model.provider === "opencode" || model.provider === "opencode-go" || isHost(model.baseUrl, "opencode.ai"))) {
		Object.assign(headers, { "x-opencode-session": sessionId, "x-opencode-client": "pi" });
	}
	const telemetry = process.env.PI_TELEMETRY;
	if (telemetry !== undefined ? !/^(1|true|yes)$/i.test(telemetry) : !settings.getEnableInstallTelemetry()) return headers;
	if (model.provider === "openrouter" || String(model.baseUrl ?? "").includes("openrouter.ai")) {
		return { ...headers, "HTTP-Referer": "https://pi.dev", "X-OpenRouter-Title": "pi", "X-OpenRouter-Categories": "cli-agent" };
	}
	if (model.provider === "nvidia" || isHost(model.baseUrl, "integrate.api.nvidia.com")) return { ...headers, "X-BILLING-INVOKE-ORIGIN": "Pi" };
	if (model.provider === "cloudflare-workers-ai" || model.provider === "cloudflare-ai-gateway" || isHost(model.baseUrl, "api.cloudflare.com") ||
		isHost(model.baseUrl, "gateway.ai.cloudflare.com")) return { ...headers, "User-Agent": "pi-coding-agent" };
	return headers;
}
