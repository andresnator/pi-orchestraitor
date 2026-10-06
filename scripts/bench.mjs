import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { findHostRoot } from "./pi-host.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MODES = ["native", "package", "package-native"];
const SKILL_TIMING_OPTIONS = { warmups: 1, samples: 5 };
const DEFAULT_SAMPLES = 7;
const MICRO_SAMPLES = 30;
const IDLE_MS = 100;
const runFile = promisify(execFile);
const size = text => ({ characters: text.length, bytes: Buffer.byteLength(text), estimatedTokens: Math.ceil(text.length / 4) });
const summarize = samples => {
	const sorted = [...samples].sort((a, b) => a - b);
	return { samples, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
};
async function timings(operation, options = { warmups: 5, samples: MICRO_SAMPLES }) {
	for (let index = 0; index < options.warmups; index++) await operation();
	const samples = [];
	for (let index = 0; index < options.samples; index++) { const start = performance.now(); await operation(); samples.push(performance.now() - start); }
	return summarize(samples);
}

async function worker(mode) {
	const started = performance.now();
	const temporary = await mkdtemp(join(tmpdir(), "pi-bench-"));
	process.env.PI_CODING_AGENT_DIR = temporary;
	process.env.PI_OFFLINE = "1";
	process.env.PI_TELEMETRY = "0";
	let session;
	try {
		const host = await findHostRoot();
		const sdk = await import(pathToFileURL(join(host, "dist/index.js")));
		const { buildSystemPrompt } = await import(pathToFileURL(join(host, "dist/core/system-prompt.js")));
		const { formatSkillsForPrompt } = await import(pathToFileURL(join(host, "dist/core/skills.js")));
		const disabledMcp = sdk.createMcpExtension({ loadConfig: () => ({ errors: [], servers: [
			{ name: "context7", config: { url: "https://example.invalid", enabled: false }, source: "benchmark" },
			{ name: "engram", config: { command: "engram", enabled: false }, source: "benchmark" },
		] }), createTransport: () => { throw new Error("Benchmark forbids MCP connections"); } });
		const settingsManager = sdk.SettingsManager.inMemory({ packages: mode === "native" ? [] : [ROOT] }, { projectTrusted: true });
		const loader = new sdk.DefaultResourceLoader({ cwd: temporary, agentDir: temporary, settingsManager,
			noSkills: true, additionalSkillPaths: mode === "native" ? [] : [join(ROOT, "skills")], noThemes: true, noContextFiles: true,
			extensionFactories: [disabledMcp] });
		await loader.reload();
		if (loader.getExtensions().errors.length) throw new Error(JSON.stringify(loader.getExtensions().errors));
		({ session } = await sdk.createAgentSession({ cwd: temporary, agentDir: temporary, settingsManager,
			resourceLoader: loader, sessionManager: sdk.SessionManager.inMemory(temporary) }));
		await session.bindExtensions({ mode: "print", onError: error => { throw error; } });
		await session.extensionRunner.emit({ type: "session_start", reason: "startup" });
		if (mode === "package-native") {
			const ctx = session.extensionRunner.createCommandContext();
			await session.extensionRunner.getCommand("orchestraitor:skills").handler("native", { ...ctx, ui: { ...ctx.ui, notify() {} } });
		}
		const startupMs = performance.now() - started;
		const promptOptions = session.extensionRunner.createCommandContext().getSystemPromptOptions();
		const promptStarted = performance.now();
		const prepared = await session.extensionRunner.emitBeforeAgentStart("Inspect a synthetic fixture", undefined, structuredClone(promptOptions));
		const promptPreparationMs = performance.now() - promptStarted;
		const prompt = buildSystemPrompt(prepared.systemPromptOptions);
		const active = new Set(prepared.systemPromptOptions.selectedTools);
		const schemas = session.getAllTools().filter(tool => active.has(tool.name)).map(({ name, description, parameters }) => ({ name, description, parameters }));
		const ownedInstructions = Object.entries(prepared.systemPromptOptions.sections ?? {}).filter(([key]) => key.startsWith("pi_orchestraitor_")).map(([, body]) => body).join("");
		const memory = process.memoryUsage();
		const idleStart = process.cpuUsage();
		await new Promise(resolve => setTimeout(resolve, IDLE_MS));
		const idleCpu = process.cpuUsage(idleStart);
		const result = { startupMs, promptPreparationMs, rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, idleCpuMicroseconds: idleCpu.user + idleCpu.system,
			prompt: size(prompt), activeToolDeclarations: size(JSON.stringify(schemas)), instructions: size(ownedInstructions),
			skillCatalog: size(formatSkillsForPrompt(loader.getSkills().skills)), skills: loader.getSkills().skills.length };
		if (mode === "native") return result;
		const skillCtx = session.extensionRunner.createContext();
		if (mode === "package") {
			const registryTool = session.getToolDefinition("skill_registry");
			const searchArgs = { operation: "search", query: "code conventions", limit: 5 };
			const loadArgs = { operation: "load", name: "code-conventions" };
			const lookup = await registryTool.execute("search", searchArgs, undefined, undefined, skillCtx);
			const loaded = await registryTool.execute("load", loadArgs, undefined, undefined, skillCtx);
			const matches = JSON.parse(lookup.content[0].text).matches;
			if (!matches.some(({ name }) => name === loadArgs.name)) throw new Error("Benchmark search missed code-conventions");
			result.skillWorkflow = { matched: loadArgs.name, search: size(lookup.content[0].text), load: size(loaded.content[0].text),
				calls: size(JSON.stringify([{ name: registryTool.name, arguments: searchArgs }, { name: registryTool.name, arguments: loadArgs }])),
				registrySnapshot: size(await readFile(join(temporary, ".ai/skills/registry.md"), "utf8")) };
			result.skillWorkflow.refreshMs = await timings(() => session.extensionRunner.emitBeforeAgentStart("Inspect a synthetic fixture", undefined, structuredClone(promptOptions)), SKILL_TIMING_OPTIONS);
			result.skillWorkflow.searchMs = await timings(() => registryTool.execute("search", searchArgs, undefined, undefined, skillCtx), SKILL_TIMING_OPTIONS);
			result.skillWorkflow.loadMs = await timings(() => registryTool.execute("load", loadArgs, undefined, undefined, skillCtx), SKILL_TIMING_OPTIONS);
		} else {
			const skill = loader.getSkills().skills.find(({ name }) => name === "code-conventions");
			const readArgs = { path: skill.filePath };
			const loaded = await session.getToolDefinition("read").execute("load", readArgs, undefined, undefined, skillCtx);
			result.skillWorkflow = { load: size(loaded.content.map(block => block.text ?? "").join("")),
				calls: size(JSON.stringify([{ name: "read", arguments: readArgs }])) };
		}
		const tool = session.getToolDefinition("orchestraitor_tasks");
		const ctx = session.extensionRunner.createContext();
		const tasks = Array.from({ length: 20 }, (_, index) => ({ id: `t${index}`, title: `Inspect synthetic module ${index}`, status: "pending" }));
		const first = await tool.execute("seed", { operation: "replace", expectedRevision: 0, tasks }, undefined, undefined, ctx);
		session.sessionManager.appendMessage({ role: "toolResult", toolName: tool.name, toolCallId: "seed", isError: false, timestamp: Date.now(), ...first });
		const params = { operation: "update", expectedRevision: 1, id: "t0", changes: { status: "done", evidence: "Synthetic check passed" } };
		const updated = await tool.execute("update", params, undefined, undefined, ctx);
		result.taskResponse = size(updated.content.map(block => block.text ?? "").join(""));
		result.taskUpdateMs = await timings(() => tool.execute("update", params, undefined, undefined, ctx));
		const controller = globalThis[Symbol.for("pi-orchestraitor.subagent-controller")];
		const originalRun = controller.run;
		try {
			controller.run = async manifests => manifests.map(manifest => ({ id: manifest.id, role: manifest.role, cwd: manifest.cwd,
				model: manifest.model, reasoning: manifest.reasoning, status: "completed", finalResponse: "Observed synthetic marker at fixture.txt:1; tests remain parent-owned.",
				writes: [], diagnostic: "", terminated: true, usageComplete: true,
				usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }));
			const model = { provider: "fixture", id: "benchmark" };
			const childResult = await session.getToolDefinition("subagent_run").execute("handoff", { tasks: [{ role: "review", instruction: "Inspect synthetic marker" }] },
				undefined, undefined, { ...ctx, model, modelRegistry: { getAvailable: () => [model] } });
			result.subagentResponse = { compact: size(childResult.content[0].text), fullReceipt: size(JSON.stringify(childResult.details.results, null, 2)) };
		} finally { controller.run = originalRun; }
		// Measure native UI projection hooks without terminal I/O.
		const probe = join(temporary, "probe.ts");
		await writeFile(probe, `import statusUI from ${JSON.stringify(join(ROOT, "extensions/status-ui.ts"))};\nexport default function(pi) { pi.registerTool({name:"bench_probe", label:"Probe", description:"Offline probe", parameters:{type:"object",properties:{}}, execute:async()=>({content:[],details:{statusUI}})}); }`);
		const { loadExtensions } = await import(pathToFileURL(join(host, "dist/core/extensions/loader.js")));
		const loaded = await loadExtensions([probe], temporary);
		if (loaded.errors.length) throw new Error(JSON.stringify(loaded.errors));
		const { statusUI } = (await loaded.extensions[0].tools.get("bench_probe").definition.execute("probe", {})).details;
		const handlers = new Map(); let branchReads = 0, usageReads = 0;
		const manager = sdk.SessionManager.inMemory(temporary);
		for (let index = 0; index < 10000; index++) manager.appendMessage({ role: "user", content: "fixture", timestamp: index });
		const branch = manager.getBranch.bind(manager), entries = manager.getEntries.bind(manager);
		manager.getBranch = () => { branchReads++; return branch(); }; manager.getEntries = () => { usageReads++; return entries(); };
		const fakeCtx = { cwd: temporary, mode: "tui", hasUI: true, sessionManager: manager,
			ui: { setWidget() {}, setStatus() {}, notify() {} } };
		statusUI({ on(name, handler) { handlers.set(name, handler); }, registerTool() {}, registerCommand() {} });
		await handlers.get("session_start")({}, fakeCtx);
		branchReads = usageReads = 0;
		result.unchangedHookMs = await timings(() => handlers.get("tool_execution_start")({ toolName: "read" }, fakeCtx));
		result.unchangedHookReads = { branch: branchReads, usage: usageReads, invocations: MICRO_SAMPLES + 5 };
		await handlers.get("session_shutdown")({}, fakeCtx);
		return result;
	} finally {
		if (session) { await session.extensionRunner.emit({ type: "session_shutdown" }); session.dispose(); }
		await rm(temporary, { recursive: true, force: true });
	}
}

async function main(args) {
	const options = { samples: DEFAULT_SAMPLES };
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index], value = args[index + 1];
		if (!["--samples", "--output", "--compare"].includes(key) || !value) throw new Error("Usage: npm run bench -- [--samples 7] [--output FILE] [--compare FILE]");
		options[key.slice(2)] = key === "--samples" ? Number(value) : value;
	}
	if (!Number.isInteger(options.samples) || options.samples < 1 || options.samples > 30) throw new Error("Samples must be between 1 and 30");
	const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean).sort();
	const fingerprint = createHash("sha256");
	for (const file of tracked) { fingerprint.update(file + "\0"); fingerprint.update(await readFile(join(ROOT, file)).catch(error => { if (error.code === "ENOENT") return "<deleted>"; throw error; })); }
	const host = await findHostRoot();
	const report = { version: 3, recordedAt: new Date().toISOString(), node: process.version, pi: JSON.parse(await readFile(join(host, "package.json"), "utf8")).version,
		platform: process.platform, revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(), treeSha256: fingerprint.digest("hex"),
		limitations: ["No model or MCP requests; estimatedTokens uses characters/4, not a tokenizer.", "Startup and idle samples use print mode; first prompt preparation is measured separately.", "Hook samples use a simulated native Pi UI without terminal I/O and with 10,000 entries.", "Subagent response sizes use a synthetic controller receipt; no child is started.", "Skill workflow uses one deterministic English search and code-conventions; protocol wrappers, missed searches, caching and task quality are not modeled."], modes: {} };
	for (const mode of MODES) report.modes[mode] = { samples: [] };
	for (let round = 0; round < options.samples; round++) for (const mode of MODES) {
		const { stdout } = await runFile(process.execPath, [fileURLToPath(import.meta.url), "--worker", mode], { cwd: ROOT, timeout: 30000, maxBuffer: 1024 * 1024 });
		report.modes[mode].samples.push(JSON.parse(stdout));
	}
	for (const mode of MODES) {
		const record = report.modes[mode];
		record.summary = Object.fromEntries(["startupMs", "promptPreparationMs", "rssBytes", "heapUsedBytes", "idleCpuMicroseconds"].map(key => [key, summarize(record.samples.map(sample => sample[key]))]));
	}
	const lazy = report.modes.package.samples[0], nativeHeaders = report.modes["package-native"].samples[0];
	const lazyInitial = lazy.prompt.characters + lazy.activeToolDeclarations.characters;
	const nativeInitial = nativeHeaders.prompt.characters + nativeHeaders.activeToolDeclarations.characters;
	const lazyWorkflow = lazyInitial + lazy.skillWorkflow.calls.characters + lazy.skillWorkflow.search.characters + lazy.skillWorkflow.load.characters;
	const nativeWorkflow = nativeInitial + nativeHeaders.skillWorkflow.calls.characters + nativeHeaders.skillWorkflow.load.characters;
	report.registryComparison = {
		initialCharacters: { nativeHeaders: nativeInitial, lazy: lazyInitial, reductionPercent: 100 * (1 - lazyInitial / nativeInitial) },
		oneSelectedSkillCharacters: { nativeHeaders: nativeWorkflow, lazy: lazyWorkflow, reductionPercent: 100 * (1 - lazyWorkflow / nativeWorkflow) },
		extraLazyLookupCharacters: (lazyWorkflow - lazyInitial) - (nativeWorkflow - nativeInitial),
	};
	if (options.compare) {
		const before = JSON.parse(await readFile(options.compare, "utf8"));
		report.comparison = { treeSha256: before.treeSha256, sameMethodology: before.version === report.version, compatibleEnvironment: before.node === report.node && before.pi === report.pi && before.platform === report.platform, modes: {} };
		for (const mode of MODES) {
			const current = report.modes[mode], previous = before.modes[mode];
			if (!previous) { report.comparison.modes[mode] = { unavailable: "Previous report has no matching configuration" }; continue; }
			report.comparison.modes[mode] = { startupMedianChangePercent: 100 * (current.summary.startupMs.median / previous.summary.startupMs.median - 1),
				promptCharacterReductionPercent: 100 * (1 - current.samples[0].prompt.characters / previous.samples[0].prompt.characters),
				...(mode !== "native" ? { taskResponseCharacterReductionPercent: 100 * (1 - current.samples[0].taskResponse.characters / previous.samples[0].taskResponse.characters) } : {}) };
		}
	}
	if (options.output) await writeFile(options.output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
	else console.log(JSON.stringify(report, null, 2));
	if (options.output) for (const mode of MODES) console.log(`${mode}: startup ${report.modes[mode].summary.startupMs.median.toFixed(1)} ms; prompt ${report.modes[mode].samples[0].prompt.characters} chars`);
}

try {
	if (process.argv[2] === "--worker" && MODES.includes(process.argv[3])) console.log(JSON.stringify(await worker(process.argv[3])));
	else await main(process.argv.slice(2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
