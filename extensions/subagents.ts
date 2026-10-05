import { randomUUID } from "node:crypto";
import { realpath, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getAgentDir, getPackageDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { compactTool } from "./compact-tools.ts";
import { BatchController, mergeUsage } from "./subagent/controller.mjs";
import { READ_TOOLS, WRITE_TOOLS, THINKING_LEVELS, selectModel, validateBatch, validatePath, within, concreteFile } from "./subagent/policy.mjs";

const CONTROLLER_KEY = Symbol.for("pi-orchestraitor.subagent-controller");
const PROGRESS_LABEL_LIMIT = 200;

/** Read-only observation of the existing controller's retained safety lock. */
export function subagentLaunchesBlocked(): boolean {
	return (globalThis as any)[CONTROLLER_KEY]?.blocked === true;
}

/** Fresh, bounded child sessions. No automatic delivery or durable orchestration state. */
export default function subagents(pi: ExtensionAPI) {
	// Keep a failed termination lock across extension reloads in this host process.
	const key = CONTROLLER_KEY;
	const shared = globalThis as typeof globalThis & { [key: symbol]: BatchController };
	const controller = shared[key] ??= new BatchController();
	let generation = 0;
	let captured: { cwd: string; skills: any[]; contextFiles: { path: string; content: string }[] } | undefined;
	pi.on("before_agent_start", (event) => {
		captured = structuredClone({ cwd: event.systemPromptOptions.cwd,
			skills: event.systemPromptOptions.skills, contextFiles: event.systemPromptOptions.contextFiles });
	});
	for (const event of ["session_before_switch", "session_before_fork", "session_before_tree", "session_shutdown"] as const) {
		pi.on(event, async () => { generation++; captured = undefined; await controller.cancel(); });
	}
	pi.on("session_start", async () => { generation++; captured = undefined; await controller.cancel(); });

	pi.registerTool(compactTool({
		name: "subagent_run",
		label: "Subagents",
		description: "Run one or two bounded explore/review readers, or one exclusive implementer with exact editable files. Children cannot run commands. Inspect their results and run verification in the parent.",
		parameters: Type.Object({ tasks: Type.Array(Type.Object({
			role: Type.Union([Type.Literal("explore"), Type.Literal("review"), Type.Literal("implement")]),
			instruction: Type.String({ minLength: 1 }), context: Type.Optional(Type.String()),
			skills: Type.Optional(Type.Array(Type.String())), files: Type.Optional(Type.Array(Type.String())),
			model: Type.Optional(Type.String({ description: "Exact available provider/model ID; defaults to the parent model" })),
			reasoning: Type.Optional(Type.Union(THINKING_LEVELS.map((level: string) => Type.Literal(level)))),
		}), { minItems: 1, maxItems: 2 }) }),
		async execute(_id, args, signal, update, ctx) {
			validateBatch(args.tasks);
			if (!captured || captured.cwd !== ctx.cwd) throw new Error("Parent project context has not been captured for this run");
			const snapshot = captured;
			const startedGeneration = generation;
			const active = pi.getActiveTools();
			if (!active.includes("read")) throw new Error("Subagents require the parent's read tool to be enabled");
			if (args.tasks.some((task) => task.role === "implement") && !["edit", "write"].every((name) => active.includes(name))) {
				throw new Error("Implementers require the parent's edit and write tools to be enabled");
			}
			const cwd = await realpath(ctx.cwd);
			const manifests = [];
			for (const task of args.tasks) {
				const model = selectModel(task.model, ctx.model, ctx.modelRegistry.getAvailable());
				if (ctx.scopedModels?.length && !ctx.scopedModels.some((entry) => entry.model.provider === model.provider && entry.model.id === model.id)) {
					throw new Error(`Model outside the parent's enabled model scope: ${model.provider}/${model.id}`);
				}
				const skills = [];
				for (const name of new Set(task.skills ?? [])) {
					const selected = snapshot.skills.filter((skill) => skill.name === name);
					if (selected.length !== 1) throw new Error(`Selected skill is missing or ambiguous: ${name}`);
					const filePath = await realpath(selected[0].filePath);
					skills.push({ ...selected[0], filePath, baseDir: dirname(filePath) });
				}
				const manifest = { role: task.role, instruction: task.instruction, context: task.context ?? "", id: randomUUID(), cwd, files: (task.files ?? []).map((file) => concreteFile(file)), skills,
					contextFiles: snapshot.contextFiles.filter((file) => within(snapshot.cwd, resolve(snapshot.cwd, file.path))), model: `${model.provider}/${model.id}`,
					reasoning: task.reasoning ?? pi.getThinkingLevel(), tools: task.role === "implement" ? WRITE_TOOLS : READ_TOOLS };
				for (const file of manifest.files) await validatePath(manifest, file, true);
				manifests.push(manifest);
			}
			controller.options = { sdkRoot: getPackageDir(), credentialDir: getAgentDir() };
			const combinedSignal = signal && ctx.signal ? AbortSignal.any([signal, ctx.signal]) : signal ?? ctx.signal;
			let sequence = 0;
			let batchStarted = false;
			const sessionId = ctx.sessionManager?.getSessionId();
			const progress = manifests.map((manifest) => Object.freeze({ id: manifest.id, role: manifest.role,
				label: manifest.instruction.slice(0, PROGRESS_LABEL_LIMIT), requestedModel: manifest.model.slice(0, PROGRESS_LABEL_LIMIT), phase: "preparing" }));
			const publish = (observation?: any) => {
				if (!update || generation !== startedGeneration) return;
				if (observation) {
					const index = manifests.findIndex((manifest) => manifest.id === observation.id);
					if (index < 0) return;
					batchStarted = true;
					progress[index] = Object.freeze({ ...observation });
				}
				const snapshot = Object.freeze({ version: 1, generation: startedGeneration, toolCallId: _id,
					sessionId, batchStarted, sequence: ++sequence, tasks: Object.freeze(progress.map((task) => Object.freeze({ ...task }))),
					launchBlocked: controller.blocked === true || progress.some((task) => task.phase === "termination_failed") });
				try { Promise.resolve(update({ content: [], details: { progress: snapshot } })).catch(() => {}); }
				catch { /* Native progress presentation cannot change execution. */ }
			};
			publish();
			// Selected skill bodies are explicit context; unrelated catalogs never reach children.
			const prompts = new Map<string, string>();
			for (const manifest of manifests) {
				const bodies = await Promise.all(manifest.skills.map(async (skill) => {
					await validatePath(manifest, skill.filePath);
					return `Selected skill ${skill.name}:\n${await readFile(skill.filePath, "utf8")}`;
				}));
				const scope = manifest.role === "implement"
					? `Editable files (exact project-relative paths):\n${JSON.stringify(manifest.files, null, 2)}\nEdit only these files.`
					: "This task is read-only.";
				prompts.set(manifest.id, [`Role: ${manifest.role}`, scope, manifest.instruction, manifest.context ?? "", ...bodies,
					"Handoff: be concise; give the outcome with inspected/changed paths and relevant line ranges; distinguish observed findings from inference. Report blockers, remaining work and unperformed checks. If required evidence is inaccessible, say so. Do not run commands, delegate, or claim checks you did not perform."].join("\n\n"));
			}
			if (generation !== startedGeneration) throw new Error("Parent session changed during subagent preparation");
			const results = await controller.run(manifests, (manifest) => prompts.get(manifest.id), combinedSignal, publish);
			publish();
			const usage = mergeUsage(results.map((result) => result.usage));
			const handoffs = results.map(({ id, status, finalResponse, writes, diagnostic, terminated, usageComplete }) =>
				({ id, status, finalResponse, writes, diagnostic, terminated, usageComplete }));
			return { content: [{ type: "text", text: JSON.stringify(handoffs) }],
				details: { results, usageComplete: results.length > 0 && results.every((result) => result.usageComplete === true) },
				...(usage ? { usage } : {}) };
		},
	}));
}
