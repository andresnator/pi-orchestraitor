import { createGuard } from "./guard.mjs";
import { selectModel, validateManifest } from "./policy.mjs";

const CHILD_SYSTEM_PROMPT = "You are a bounded child worker. Follow the assigned task and return a final response before stopping. The parent runs all commands, tests and builds. Never claim independent or blind verification.";

/** Build isolated SDK services, shared by production bootstrap and no-model tests. */
export async function createChildRuntime(sdk, manifest, digest, report, temporary, modelRuntime) {
	validateManifest(manifest);
	const model = selectModel(manifest.model, undefined, await modelRuntime.getAvailable());
	const settingsManager = sdk.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
	return sdk.createAgentSessionRuntime(async () => {
		const services = await sdk.createAgentSessionServices({ cwd: manifest.cwd, agentDir: temporary, settingsManager, modelRuntime,
			resourceLoaderOptions: {
				noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
				extensionFactories: [createGuard(sdk, manifest, digest, report)],
				systemPrompt: CHILD_SYSTEM_PROMPT,
				appendSystemPrompt: [], systemPromptOverride: () => CHILD_SYSTEM_PROMPT,
				appendSystemPromptOverride: () => [],
				agentsFilesOverride: () => ({ agentsFiles: manifest.contextFiles }),
				skillsOverride: () => ({ skills: manifest.skills, diagnostics: [] }),
				promptsOverride: () => ({ prompts: [], diagnostics: [] }), themesOverride: () => ({ themes: [], diagnostics: [] }),
			},
		});
		const result = await sdk.createAgentSessionFromServices({ services,
			sessionManager: sdk.SessionManager.inMemory(manifest.cwd), model, thinkingLevel: manifest.reasoning, tools: manifest.tools,
		});
		if (result.modelFallbackMessage) throw new Error("Child model fallback rejected");
		return { ...result, services, diagnostics: services.diagnostics };
	}, { cwd: manifest.cwd, agentDir: temporary, sessionManager: sdk.SessionManager.inMemory(manifest.cwd) });
}
