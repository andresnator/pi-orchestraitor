import { createProvider, envApiKeyAuth, type Model, type Provider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const NAN_PROVIDER_ID = "nan";
export const NAN_PROVIDER_NAME = "NaN";
export const NAN_BASE_URL = "https://api.nan.builders/v1";
export const NAN_API_KEY_ENV = "NAN_API_KEY";
const NAN_AUTH_NAME = "NaN API key";
const NAN_API = "openai-completions";
const FRONTIER_CONTEXT = 1048576;
const FRONTIER_OUTPUT = 32768;
const CLUSTER_CONTEXT = 262144;
const CLUSTER_OUTPUT = 65536;
// Flat membership fees and quota are not represented by Pi's per-token cost display.
const MEMBERSHIP_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

// Snapshot of https://nan.builders/docs/pi. No automatic catalog or account requests.
const MODEL_DEFINITIONS = [
	{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", contextWindow: FRONTIER_CONTEXT, maxTokens: FRONTIER_OUTPUT },
	{ id: "glm5.3-flash", name: "GLM 5.3 Flash", contextWindow: FRONTIER_CONTEXT, maxTokens: FRONTIER_OUTPUT },
	{ id: "qwen3.8-flash", name: "Qwen 3.8 Flash", contextWindow: FRONTIER_CONTEXT, maxTokens: FRONTIER_OUTPUT },
	{ id: "mimo-v2.6-flash", name: "Xiaomi MiMo V2.6 Flash", contextWindow: FRONTIER_CONTEXT, maxTokens: FRONTIER_OUTPUT },
	{ id: "gemma4", name: "Gemma 4", contextWindow: CLUSTER_CONTEXT, maxTokens: CLUSTER_OUTPUT },
	{ id: "qwen3.6", name: "Qwen 3.6", contextWindow: CLUSTER_CONTEXT, maxTokens: CLUSTER_OUTPUT },
	{ id: "glm5.3", name: "GLM 5.3 (premium)", contextWindow: FRONTIER_CONTEXT, maxTokens: FRONTIER_OUTPUT },
];

export default function nan(pi: ExtensionAPI): void {
	pi.registerProvider(createNanProvider());
}

export function createNanProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: NAN_PROVIDER_ID,
		name: NAN_PROVIDER_NAME,
		baseUrl: NAN_BASE_URL,
		auth: { apiKey: envApiKeyAuth(NAN_AUTH_NAME, [NAN_API_KEY_ENV]) },
		models: MODEL_DEFINITIONS.map((definition): Model<"openai-completions"> => ({
			...definition,
			provider: NAN_PROVIDER_ID,
			baseUrl: NAN_BASE_URL,
			api: NAN_API,
			reasoning: true,
			input: ["text", "image"],
			cost: { ...MEMBERSHIP_COST },
			compat: { supportsDeveloperRole: true },
		})),
		api: openAICompletionsApi(),
	});
}
