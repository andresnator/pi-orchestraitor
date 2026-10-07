import { getSupportedThinkingLevels, clampThinkingLevel } from "@earendil-works/pi-ai/compat";
import { paths, readConfiguration, resolveAssignment } from "./models/store.mjs";
import { profilesPanel } from "./models/panel.mjs";
import { selectProfileOption } from "./models/selector.ts";
import { BackgroundTasks, RECEIPT, recoverReceipts, collectedIds } from "./subagent/background.mjs";
import { publicModel } from "./subagent/bridge.mjs";
import { randomUUID } from "node:crypto";
import { realpath, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getAgentDir, getPackageDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { compactTool } from "./compact-tools.ts";
import { BatchController, mergeUsage } from "./subagent/controller.mjs";
import { REGISTRY_RESOLVE_EVENT } from "./skills/registry.mjs";
import type { SkillResolutionRequest } from "./skills/types.ts";
import { READ_TOOLS, WRITE_TOOLS, THINKING_LEVELS, selectModel, validateBatch, validatePath, within, concreteFile } from "./subagent/policy.mjs";

const CONTROLLER_KEY = Symbol.for("pi-orchestraitor.subagent-controller");
const PROGRESS_LABEL_LIMIT = 200;
const COLLECTION_REMINDER = "orchestraitor-subagent-reminder";
export const SUBAGENT_PROGRESS_EVENT = "orchestraitor:subagent-progress";

/** Read-only observation of the existing controller's retained safety lock. */
export function subagentLaunchesBlocked(): boolean {
	return (globalThis as any)[CONTROLLER_KEY]?.blocked === true || (globalThis as any)[Symbol.for("pi-orchestraitor.subagent-background")]?.blocked === true;
}

/** Fresh bounded children with durable accounting receipts and explicit result collection. */
export default function subagents(pi: ExtensionAPI) {
	// Keep a failed termination lock across extension reloads in this host process.
	const key = CONTROLLER_KEY;
	const shared = globalThis as typeof globalThis & { [key: symbol]: BatchController };
	const controller = shared[key] ??= new BatchController();
	const backgroundKey = Symbol.for("pi-orchestraitor.subagent-background");
	const background = (globalThis as any)[backgroundKey] ??= new BackgroundTasks();
	let recovered = new Map(), delivered = new Set(), reminded = new Set();
	const persist = (data) => pi.appendEntry(RECEIPT, data);
	const pack = (results, pending = []) => {
		const usage = mergeUsage(results.map(result => result.usage));
		return { content: [{ type: "text", text: JSON.stringify({ results: results.map(({ id, status, finalResponse, writes, diagnostic, terminated, usageComplete }) => ({ id, status, finalResponse, writes, diagnostic, terminated, usageComplete })), pending }) }],
			details: { results, pending, usageComplete: !pending.length && results.every(result => result.usageComplete === true) }, ...(usage ? { usage } : {}) };
	};
	let generation = 0;
	const teardownGenerations = new Set<number>();
	pi.registerCommand("models-profiles", { description: "Create, edit and apply model profiles", async handler(_args, ctx) {
		const current = generation;
		try { await profilesPanel(ctx, paths(getAgentDir(), ctx.cwd), getSupportedThinkingLevels,
			{ model: ctx.model && `${ctx.model.provider}/${ctx.model.id}`, reasoning: pi.getThinkingLevel(), mode: "sync" }, () => generation === current,
			(title, options, searchText) => selectProfileOption(ctx, title, options, searchText)); }
		catch (error) { ctx.ui.notify(String(error), "error"); }
	} });
	let captured: { cwd: string; skills: any[]; contextFiles: { path: string; content: string }[] } | undefined;
	pi.on("before_agent_start", (event) => {
		captured = structuredClone({ cwd: event.systemPromptOptions.cwd,
			skills: event.systemPromptOptions.skills, contextFiles: event.systemPromptOptions.contextFiles });
	});
	for (const event of ["session_before_switch", "session_before_fork", "session_before_tree", "session_shutdown"] as const) {
		pi.on(event, async () => {
			const stoppingGeneration = generation++;
			captured = undefined;
			teardownGenerations.add(stoppingGeneration);
			try { await Promise.all([controller.cancel(), background.cancel()]); }
			finally { teardownGenerations.delete(stoppingGeneration); }
		});
	}
	const reconcileCollected = (ctx) => {
		for (const id of collectedIds(ctx.sessionManager?.getEntries() ?? [])) { delivered.add(id); recovered.delete(id); }
	};
	const restoreReceipts = async (_event, ctx) => {
		generation++; captured = undefined;
		await Promise.all([controller.cancel(), background.cancel()]);
		background.jobs.clear();
		const entries = ctx.sessionManager?.getEntries() ?? [];
		delivered = collectedIds(entries);
		const branch = ctx.sessionManager?.getBranch?.() ?? entries;
		recovered = recoverReceipts(branch, delivered);
		reminded = new Set(entries.filter(entry => entry.type === "custom" && entry.customType === COLLECTION_REMINDER)
			.flatMap(entry => Array.isArray(entry.data?.ids) ? entry.data.ids.filter(id => typeof id === "string") : []));
		if (recovered.size) ctx.ui.notify(`${recovered.size} subagent receipts have pending consumption; use subagent_collect`, "warning");
	};
	pi.on("session_start", restoreReceipts);
	pi.on("session_tree", restoreReceipts);
	pi.on("tool_call", (event) => {
		if (event.toolName === "subagent_collect" && event.parentToolCallId && event.input?.action !== "status") {
			return { block: true, reason: "Call subagent_collect directly to preserve durable usage accounting; collection cannot run through codemode or ctx.executeTool()." };
		}
	});
	pi.registerTool(compactTool({ name: "subagent_collect", label: "Collect subagents",
		description: "Inspect status, wait, collect results and usage once, or cancel pending readers. Wait/collect/cancel require a direct model-issued call (not codemode). Parent verification is required before completing board tasks.",
		parameters: Type.Object({ action: Type.Union([Type.Literal("status"), Type.Literal("collect"), Type.Literal("wait"), Type.Literal("cancel")]), ids: Type.Optional(Type.Array(Type.String())) }),
		async execute(_id, args, signal, _update, ctx) {
			const current = generation;
			reconcileCollected(ctx);
			const ids = args.ids ?? [...new Set([...background.jobs.keys(), ...recovered.keys()])];
			const abort = () => { void background.cancel(ids); };
			signal?.addEventListener("abort", abort, { once: true });
			try {
				if (signal?.aborted) abort();
				if (args.action === "cancel") await background.cancel(ids);
				if (["wait", "cancel"].includes(args.action)) await background.wait(ids);
				if (current !== generation) throw new Error("Parent session changed during collection");
				if (args.action === "status") return { content: [{ type: "text", text: JSON.stringify({ live: background.status(), recovered: [...recovered.values()] }) }], details: {} };
				const results = background.collect(ids);
				for (const id of ids) if (!delivered.has(id) && !results.some(result => result.id === id) && recovered.get(id)?.result) results.push(recovered.get(id).result);
				const fresh = results.filter(result => !delivered.has(result.id));
				for (const result of fresh) { delivered.add(result.id); recovered.delete(result.id); }
				return pack(fresh, [...background.jobs.keys(), ...recovered.keys()]);
			} finally { signal?.removeEventListener("abort", abort); }
		},
	}));
	// An abort can also land between the boundary callback and its continuation.
	// Settlement is the final cancellation fallback after the boundary returns.
	pi.on("agent_settled", async () => { await background.cancel(); });
	pi.on("agent_before_settle", async (event) => {
		if (event.outcome !== "completed") { await background.cancel(); return; }
		if (!background.jobs.size) return;
		// Pi has cleared the low-level agent run at this boundary. Never await
		// children here: only a subsequent tool execution has a live abort signal.
		const pending = [...background.jobs.keys()];
		const firstReminder = pending.filter(id => !reminded.has(id));
		if (!firstReminder.length) return { continue: false, entries: [{ type: "custom_message", customType: "orchestraitor-subagents-uncollected", display: true,
			content: `Subagent results remain uncollected: ${pending.join(", ")}. The automatic collection reminder limit has been reached. Receipts and consumption remain pending; call subagent_collect directly to retrieve them. Parent verification is still required.` }] };
		for (const id of pending) reminded.add(id);
		return { continue: true, entries: [
			{ type: "custom", customType: COLLECTION_REMINDER, data: { ids: pending } },
			{ type: "custom_message", customType: "orchestraitor-subagents-ready", display: true,
				content: `Pending subagent results: ${pending.join(", ")}. Call subagent_collect directly with action wait before finishing; waiting and collection must happen in that cancellable tool call. This is the only automatic reminder for these tasks. Verify findings before marking board tasks completed.` },
		] };
	});

	pi.registerTool(compactTool({
		name: "subagent_run",
		label: "Subagents",
		description: "Run one or two bounded explore/review readers, or one exclusive implementer with exact editable files. Readers can run in background; collect pending results with subagent_collect. Children cannot run commands. Inspect their results and run verification in the parent.",
		parameters: Type.Object({ tasks: Type.Array(Type.Object({
			role: Type.Union([Type.Literal("explore"), Type.Literal("review"), Type.Literal("implement")]),
			instruction: Type.String({ minLength: 1 }), context: Type.Optional(Type.String()),
			skills: Type.Optional(Type.Array(Type.String())), files: Type.Optional(Type.Array(Type.String())),
			model: Type.Optional(Type.String({ description: "Exact available provider/model ID; defaults to the parent model" })),
			mode: Type.Optional(Type.Union([Type.Literal("sync"), Type.Literal("background")])),
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
			const projectTrusted = ctx.isProjectTrusted?.() === true;
			const configuration = await readConfiguration(paths(getAgentDir(), ctx.cwd), { projectTrusted });
			const manifests = [];
			const models = new Map();
			const resolvedBodies = new Map<string, string>();
			for (const task of args.tasks) {
				const resolved = resolveAssignment(task.role, task, configuration.project.data.assignments, configuration.personal.data.assignments,
					{ model: ctx.model && `${ctx.model.provider}/${ctx.model.id}`, reasoning: pi.getThinkingLevel(), mode: "sync" });
				const model = selectModel(resolved.values.model, ctx.model, ctx.modelRegistry.getAvailable());
				if (resolved.sources.reasoning !== "parent" && !getSupportedThinkingLevels(model).includes(resolved.values.reasoning)) throw new Error(`Unsupported effort: ${resolved.values.reasoning} (${model.provider}/${model.id})`);
				const reasoning = resolved.sources.reasoning === "parent" ? clampThinkingLevel(model, resolved.values.reasoning) : resolved.values.reasoning;
				if (ctx.scopedModels?.length && !ctx.scopedModels.some((entry) => entry.model.provider === model.provider && entry.model.id === model.id)) {
					throw new Error(`Model outside the parent's enabled model scope: ${model.provider}/${model.id}`);
				}
				const skills = [];
				const names = [...new Set(task.skills ?? [])];
				const request: SkillResolutionRequest = { context: { ...ctx, signal }, names };
				if (names.length) pi.events.emit(REGISTRY_RESOLVE_EVENT, request);
				// A live resolver rejection is authoritative; never fall back around it.
				const resolvedSkills = request.result ? await request.result : undefined;
				for (const name of names) {
					const selected = resolvedSkills ? resolvedSkills.filter(({ skill }) => skill.name === name).map(({ skill }) => skill)
						: snapshot.skills.filter((skill) => skill.name === name);
					if (selected.length !== 1) throw new Error(`Selected skill is missing or ambiguous: ${name}`);
					if (selected[0].disableModelInvocation) throw new Error(`Selected skill is manual-only: ${name}; use an explicit /skill command`);
					const filePath = await realpath(selected[0].filePath);
					const body = resolvedSkills?.find(({ skill }) => skill.name === name)?.body;
					if (body !== undefined) resolvedBodies.set(filePath, body);
					skills.push({ ...selected[0], filePath, baseDir: dirname(filePath) });
				}
				const manifest = { role: task.role, instruction: task.instruction, context: task.context ?? "", id: randomUUID(), cwd, files: (task.files ?? []).map((file) => concreteFile(file)), skills,
					contextFiles: snapshot.contextFiles.filter((file) => within(snapshot.cwd, resolve(snapshot.cwd, file.path))), model: `${model.provider}/${model.id}`,
					reasoning, mode: resolved.values.mode, ...(typeof ctx.modelRegistry.streamSimple === "function" ? { bridgeModel: publicModel(model) } : {}), tools: task.role === "implement" ? WRITE_TOOLS : READ_TOOLS };
				for (const file of manifest.files) await validatePath(manifest, file, true);
				manifests.push(manifest);
				models.set(manifest.id, model);
			}
			controller.options = { sdkRoot: getPackageDir(), credentialDir: getAgentDir(), registry: ctx.modelRegistry, modelFor: (manifest) => models.get(manifest.id) };
			const combinedSignal = signal && ctx.signal ? AbortSignal.any([signal, ctx.signal]) : signal ?? ctx.signal;
			let sequence = 0;
			let batchStarted = false;
			let detached = false;
			const sessionId = ctx.sessionManager?.getSessionId();
			const progress = manifests.map((manifest) => Object.freeze({ id: manifest.id, role: manifest.role,
				label: manifest.instruction.slice(0, PROGRESS_LABEL_LIMIT), requestedModel: manifest.model.slice(0, PROGRESS_LABEL_LIMIT), phase: "preparing" }));
			const publish = (observation?: any) => {
				if (generation !== startedGeneration && !teardownGenerations.has(startedGeneration)) return;
				if (observation) {
					const index = manifests.findIndex((manifest) => manifest.id === observation.id);
					if (index < 0) return;
					batchStarted = true;
					progress[index] = Object.freeze({ ...observation });
				}
				const snapshot = Object.freeze({ version: 1, generation: startedGeneration, toolCallId: _id,
					sessionId, batchStarted, sequence: ++sequence, tasks: Object.freeze(progress.map((task) => Object.freeze({ ...task }))),
					launchBlocked: controller.blocked === true || progress.some((task) => task.phase === "termination_failed") });
				try {
					if (detached) pi.events.emit(SUBAGENT_PROGRESS_EVENT, snapshot);
					else if (update) Promise.resolve(update({ content: [], details: { progress: snapshot } })).catch(() => {});
				}
				catch { /* Native progress presentation cannot change execution. */ }
			};
			publish();
			// Selected skill bodies are explicit context; unrelated catalogs never reach children.
			const prompts = new Map<string, string>();
			for (const manifest of manifests) {
				const bodies = await Promise.all(manifest.skills.map(async (skill) => {
					await validatePath(manifest, skill.filePath);
					return `Selected skill ${skill.name}:\n${resolvedBodies.get(skill.filePath) ?? await readFile(skill.filePath, "utf8")}`;
				}));
				const scope = manifest.role === "implement"
					? `Editable files (exact project-relative paths):\n${JSON.stringify(manifest.files, null, 2)}\nEdit only these files.`
					: "This task is read-only.";
				prompts.set(manifest.id, [`Role: ${manifest.role}`, scope, manifest.instruction, manifest.context ?? "", ...bodies,
					"Handoff: be concise; give the outcome with inspected/changed paths and relevant line ranges; distinguish observed findings from inference. Report blockers, remaining work and unperformed checks. If required evidence is inaccessible, say so. Do not run commands, delegate, or claim checks you did not perform."].join("\n\n"));
			}
			if (generation !== startedGeneration) throw new Error("Parent session changed during subagent preparation");
			if ((ctx.isProjectTrusted?.() === true) !== projectTrusted) throw new Error("Project trust changed during subagent preparation");
			if (background.blocked) throw new Error("Subagent launches blocked: child termination was not confirmed");
			if (manifests.some(manifest => manifest.role === "implement")) {
				reconcileCollected(ctx);
				if ([...recovered.values()].some(receipt => receipt.result)) throw new Error("Collect pending readers before implementation");
			}
			if (manifests.some(manifest => manifest.mode === "background") || background.jobs.size) {
				if (manifests.some(manifest => manifest.mode === "background") && !active.includes("subagent_collect")) throw new Error("Background readers require subagent_collect to be enabled");
				if (controller.active || controller.blocked) throw new Error("Subagent launches blocked");
				const batch = await background.run(manifests, manifest => prompts.get(manifest.id), combinedSignal, publish, controller.options, persist);
				detached = true;
				publish();
				return pack(batch.results, batch.pending);
			}
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
