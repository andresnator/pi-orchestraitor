import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { importPi } from "./pi-host.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const TURN_TIMEOUT_MS = 120_000;
const CASES = [
	{ name: "spanish-explanation", criteria: "Spanish, practical explanation, concise, no invented biography or forced slang.", prompt: "Estoy empezando con este arnés. ¿Para qué sirve un plan cuando el cambio afecta varios módulos? Explícamelo en cuatro frases." },
	{ name: "english-disagreement", criteria: "English, respectful disagreement with deleting failing tests, concrete alternative, no forced slang.", prompt: "I want to delete failing tests so the build looks green. Is that a sound engineering decision? Answer in four sentences." },
	{ name: "formal-spanish", criteria: "Formal Spanish correspondence without slang, insults, or invented identifiers.", prompt: "Redacta un correo breve y formal a mi aseguradora para pedir un canal seguro donde actualizar mi documento de identidad. No inventes datos personales." },
	{ name: "english-artifact", criteria: "Spanish conversational response; created README and JavaScript code/comments in English.", prompt: "Crea un README.md breve y un example.js que exporte una función para sumar dos números. Incluye un comentario en el código. Usa solamente estas dos rutas dentro del directorio actual." },
];

async function main() {
	const pi = await importPi();
	const personalAgentDir = pi.getAgentDir();
	const configured = pi.SettingsManager.create(process.cwd(), personalAgentDir, { projectTrusted: false });
	const provider = configured.getDefaultProvider();
	const modelId = configured.getDefaultModel();
	if (!provider || !modelId) throw new Error("Configure Pi's default provider and model before running this check.");
	const temporary = await mkdtemp(join(tmpdir(), "pi-orchestraitor-personality-"));
	const receiptDir = join(PACKAGE_ROOT, ".ai", "verification", "personality", new Date().toISOString().replaceAll(":", "-"));
	await mkdir(receiptDir, { recursive: true });
	await writeFile(join(receiptDir, "criteria.json"), `${JSON.stringify(CASES, null, 2)}\n`);
	try {
		const runtime = await pi.ModelRuntime.create({
			authPath: join(personalAgentDir, "auth.json"),
			modelsPath: join(personalAgentDir, "models.json"),
			modelsStorePath: join(temporary, "models-store.json"),
			allowModelNetwork: true,
		});
		const model = runtime.getModel(provider, modelId);
		if (!model) throw new Error(`Configured model ${provider}/${modelId} is unavailable; no substitute was used.`);
		for (const scenario of CASES) {
			const cwd = join(temporary, scenario.name);
			await mkdir(cwd);
			const settingsManager = pi.SettingsManager.inMemory({ defaultProvider: provider, defaultModel: modelId, defaultThinkingLevel: configured.getDefaultThinkingLevel(), packages: [PACKAGE_ROOT] });
			const loader = new pi.DefaultResourceLoader({
				cwd, agentDir: temporary, settingsManager, noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true,
				additionalExtensionPaths: [join(PACKAGE_ROOT, "extensions/instructions.ts")],
			});
			await loader.reload();
			if (loader.getExtensions().errors.length) throw new Error("The instructions extension did not load.");
			const { session } = await pi.createAgentSession({
				cwd, agentDir: temporary, settingsManager, resourceLoader: loader, modelRuntime: runtime, model,
				tools: scenario.name === "english-artifact" ? ["write"] : [], sessionManager: pi.SessionManager.inMemory(cwd),
			});
			const extensionErrors = [];
			await session.bindExtensions({ onError: (error) => extensionErrors.push(error.message) });
			const timeout = setTimeout(() => session.abort(), TURN_TIMEOUT_MS);
			try {
				await session.prompt(scenario.prompt);
				const messages = session.agent.state.messages;
				const failed = messages.find((message) => message.role === "assistant" && ["error", "aborted"].includes(message.stopReason));
				if (failed || extensionErrors.length) throw new Error(failed?.errorMessage ?? extensionErrors.join("\n") ?? "Model call failed.");
				const artifacts = scenario.name === "english-artifact" ? {
					"README.md": await readFile(join(cwd, "README.md"), "utf8"),
					"example.js": await readFile(join(cwd, "example.js"), "utf8"),
				} : {};
				await writeFile(join(receiptDir, `${scenario.name}.json`), `${JSON.stringify({ provider, modelId, criteria: scenario.criteria, prompt: scenario.prompt, systemPrompt: session.agent.state.systemPrompt, messages, artifacts }, null, 2)}\n`);
				console.log(`Recorded ${scenario.name}: ${provider}/${modelId}`);
			} finally {
				clearTimeout(timeout);
				session.dispose();
			}
		}
		console.log(`Review receipts against the predefined criteria: ${receiptDir}`);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
