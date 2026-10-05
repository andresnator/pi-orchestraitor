// Unshipped public-SDK launcher: never start an ordinary personal-profile CLI.
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { importPi } from "../../scripts/pi-host.mjs";
import { projectSessionUsage, projectCurrentContext } from "../../extensions/ui/workbench-usage.mjs";
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const MAX_LIVE_MS = 180000;
export function parseOptions(args) {
	const options = { mode: "fullscreen", live: false, publish: false, validate: false, check: false, authorized: false };
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (["--live", "--publish", "--validate-only", "--synthetic-check", "--authorize-usage"].includes(arg)) {
			options[({ "--live": "live", "--publish": "publish", "--validate-only": "validate", "--synthetic-check": "check", "--authorize-usage": "authorized" })[arg]] = true;
		} else if (["--root", "--mode", "--model", "--credential-dir"].includes(arg) && typeof args[index + 1] === "string" && !args[index + 1].startsWith("--")) options[arg.slice(2)] = args[++index];
		else throw new Error("Invalid SDK workbench launcher options");
	}
	if (!options.root || !["regular", "fullscreen"].includes(options.mode)) throw new Error("A fresh isolated --root and regular|fullscreen --mode are required");
	if (options.live && (!options.authorized || !options.model || !options["credential-dir"])) throw new Error("Live checking requires explicit --authorize-usage, --model and --credential-dir authorization");
	if (options.live && (options.check || options.validate)) throw new Error("Synthetic validation never authorizes live model usage");
	return options;
}

export async function createWorkbenchRuntime(options) {
	const root = await realpath(options.root);
	const workspace = join(root, "workspace"), profile = join(root, "profile"), receipts = join(root, "receipts");
	// The caller owns a fresh empty root; no arbitrary existing artifacts are replaced.
	await mkdir(workspace); await mkdir(profile); await mkdir(receipts);
	process.env.PI_OFFLINE = "1"; process.env.PI_TELEMETRY = "0";
	process.env.PI_CODING_AGENT_DIR = options.live ? await realpath(options["credential-dir"]) : profile;
	if (!options.live) Object.assign(process.env, { WORKBENCH_SMOKE_ENABLED: "1", UI_SMOKE_ENABLED: "1", UI_SMOKE_ROOT: root });
	const pi = await importPi();
	const modelRuntime = await pi.ModelRuntime.create({ authPath: join(process.env.PI_CODING_AGENT_DIR, "auth.json"),
		modelsPath: join(process.env.PI_CODING_AGENT_DIR, "models.json"), modelsStorePath: join(profile, "model-cache.json"), allowModelNetwork: false });
	const provider = options.live ? options.model.slice(0, options.model.indexOf("/")) : "ui-smoke";
	const modelId = options.live ? options.model.slice(options.model.indexOf("/") + 1) : "model";
	if (options.live && (provider !== "openai-codex" || !modelId)) throw new Error("Live workbench acceptance requires the exact configured Codex model; no substitution");
	const settings = pi.SettingsManager.inMemory({ quietStartup: true, theme: "dark", defaultProvider: provider, defaultModel: modelId,
		defaultThinkingLevel: options.live ? "low" : "off", retry: { enabled: false }, compaction: { enabled: false } });
	const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }) => {
		const services = await pi.createAgentSessionServices({ cwd, agentDir: profile, settingsManager: settings, modelRuntime,
			extensionFlagValues: new Map([["orchestraitor-workbench", options.publish]]),
			resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
				additionalExtensionPaths: [packageRoot, ...(!options.live ? [join(packageRoot, "tests/fixtures/workbench-smoke.ts")] : [])],
				extensionFactories: options.live ? [pi.createCodemodeExtension({ mode: "on" }), pi.createToolSearchExtension(), pi.createMcpExtension()] : [pi.createMcpExtension({
					loadConfig: () => ({ errors: [], servers: [{ name: "context7", config: { url: "https://example.invalid", enabled: false }, source: "fixture" }, { name: "engram", config: { command: "engram", enabled: false }, source: "fixture" }] }),
					createTransport: () => { throw new Error("Synthetic workbench cannot contact external services"); },
				})] },
		});
		const result = await pi.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, thinkingLevel: options.live ? "low" : "off",
			...(options.live ? { tools: ["read", "subagent_run", "orchestraitor_tasks", "orchestraitor_ask"] } : {}) });
		const model = (await modelRuntime.getAvailable(provider)).find(model => model.id === modelId);
		if (!model) { result.session.dispose(); throw new Error("Requested model is unavailable; no fallback or login is attempted"); }
		await result.session.setModel(model);
		return { ...result, services, diagnostics: services.diagnostics };
	};
	const runtime = await pi.createAgentSessionRuntime(createRuntime, { cwd: workspace, agentDir: profile, sessionManager: pi.SessionManager.create(workspace, receipts) });
	return { runtime, pi, root, workspace, profile, receipts };
}

function numericEvidence(session, synthetic) {
	const usage = projectSessionUsage(session.sessionManager.getEntries());
	return { synthetic, model: session.model ? `${session.model.provider}/${session.model.id}` : null, context: projectCurrentContext(session.getContextUsage(), session.model),
		usage, native: session.getSessionStats(), children: session.messages.filter(message => message.role === "toolResult" && message.toolName === "subagent_run").flatMap(message =>
			(message.details?.results ?? []).map(child => ({ id: child.id, role: child.role, model: child.model, status: child.status, terminated: child.terminated, writes: child.writes,
				usageComplete: child.usageComplete, ...(child.usage ? { usage: child.usage } : {}), finalResponse: child.finalResponse?.slice(0, 1000) }))) };
}

export async function main(args = process.argv.slice(2)) {
	if (args.length === 1 && args[0] === "--help") { console.log("Unshipped isolated SDK launcher: --root EMPTY_DIRECTORY [--mode regular|fullscreen] [--publish] [--synthetic-check|--validate-only]. Live additionally requires --live --authorize-usage --model openai-codex/EXACT_ID --credential-dir EXISTING_PROFILE. Never copies credentials or personal settings."); return; }
	const options = parseOptions(args);
	if (options.validate) { console.log(JSON.stringify({ valid: true, synthetic: true, mode: options.mode, personalWrites: false, modelCalls: false })); return; }
	if (!options.check && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error("Interactive SDK checks require an owned terminal");
	const { runtime, pi, root } = await createWorkbenchRuntime(options);
	let timer;
	try {
		if (options.check) {
			await runtime.session.bindExtensions({});
			await runtime.session.prompt("ui-smoke:tasks-create");
			await runtime.session.prompt("ui-smoke:two");
			const tasks = runtime.session.messages.filter(message => message.role === "toolResult" && message.toolName === "orchestraitor_tasks");
			const observed = numericEvidence(runtime.session, true);
			console.log(JSON.stringify({ synthetic: true, taskCount: tasks.at(-1)?.details?.state?.tasks?.length, activeTools: runtime.session.getActiveToolNames(), usage: observed.usage.total, children: observed.children }));
			return;
		}
		const mode = new pi.InteractiveMode(runtime, { tuiMode: options.mode, initialThemeSetting: "dark" });
		const writeEvidence = () => writeFile(join(root, "numeric-evidence.json"), JSON.stringify(numericEvidence(runtime.session, !options.live)), { mode: 0o600 });
		let evidenceQueue = Promise.resolve();
		runtime.session.subscribe(event => { if (event.type === "agent_settled") evidenceQueue = evidenceQueue.then(writeEvidence); });
		if (options.live) { timer = setTimeout(() => { void runtime.session.abort(); }, MAX_LIVE_MS); timer.unref?.(); }
		await mode.run();
		await evidenceQueue; await writeEvidence();
	} finally {
		clearTimeout(timer);
		await runtime.session.extensionRunner?.emit({ type: "session_shutdown" }).catch(() => {});
		await runtime.dispose();
	}
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : "SDK workbench launch failed"); process.exitCode = 1; }
}
