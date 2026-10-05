import type { ExtensionAPI, ExtensionContext, ExtensionUIContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { classifyAgent, createAgentsPanel, createAgentsProjection } from "./ui/agents.ts";
import { workStatus } from "./ui/display.ts";
import { subagentLaunchesBlocked } from "./subagents.ts";
import { compactTool } from "./compact-tools.ts";
import { checkTaskBinding, createTaskPanel, createTaskTool, emptyTasks, replayTasks, taskHeader, TASK_TOOL_NAME } from "./ui/tasks.ts";
import { createQuestionTool, QUESTION_TOOL_NAME } from "./ui/questions.ts";
import { createWorkbenchPublisher, resolveWorkbenchSource } from "./ui/workbench-bridge.mjs";
import { mapWorkbenchTasks, mapWorkbenchAgents } from "./ui/workbench-contract.mjs";
import { projectSessionUsage, projectCurrentContext } from "./ui/workbench-usage.mjs";

export const WORK_WIDGET_KEY = "orchestraitor:work";
export const WORK_STATUS_KEY = "orchestraitor:status";
const WORKBENCH_OVERRIDES_KEY = Symbol.for("pi-orchestraitor.workbench-overrides");
export type ModalOutcome = { status: "cancelled" | "unavailable" | "busy" };
type ModalFactory<T> = (tui: TUI, theme: Theme, keys: KeybindingsManager,
	done: (result: T | ModalOutcome) => void) =>
	(Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>;

/** Sole owner of harness keys and foreground interactions, never of execution. */
export function createUIOwner(onChange: () => void = () => {}) {
	let ctx: ExtensionContext | undefined;
	let generation = 0;
	let widgetPresent = false;
	let statusPresent = false;
	let lastStatus: string | undefined;
	let active: { kind: "panel" | "question"; close: () => void; requestRender?: () => void } | undefined;
	const cancelInteractions = () => {
		generation++;
		const previous = active;
		active = undefined;
		previous?.close();
		onChange();
	};
	const dispose = () => {
		cancelInteractions();
		if (ctx?.mode === "tui") {
			if (widgetPresent) ctx.ui.setWidget(WORK_WIDGET_KEY, undefined);
			if (statusPresent) ctx.ui.setStatus(WORK_STATUS_KEY, undefined);
		}
		widgetPresent = statusPresent = false;
		lastStatus = undefined;
		ctx = undefined;
		onChange();
	};
	return {
		get generation() { return generation; },
		get awaitingInput() { return active?.kind === "question"; },
		isCurrent(candidate: ExtensionContext) {
			return !!ctx && candidate.cwd === ctx.cwd && candidate.sessionManager.getSessionId() === ctx.sessionManager.getSessionId();
		},
		activate(next: ExtensionContext) { dispose(); ctx = next; onChange(); },
		cancelInteractions,
		dispose,
		refresh() { active?.requestRender?.(); },
		setWidget(content: string[] | Parameters<ExtensionUIContext["setWidget"]>[1]) {
			if (ctx?.mode !== "tui") return;
			if (content === undefined && !widgetPresent) return;
			ctx.ui.setWidget(WORK_WIDGET_KEY, content);
			widgetPresent = content !== undefined;
		},
		setStatus(text: string | undefined) {
			if (ctx?.mode !== "tui") return;
			if (text === lastStatus) return;
			ctx.ui.setStatus(WORK_STATUS_KEY, text);
			statusPresent = text !== undefined;
			lastStatus = text;
		},
		async interaction<T>(run: (signal: AbortSignal, ui: ExtensionUIContext) => Promise<T>, signal?: AbortSignal): Promise<T | ModalOutcome> {
			if (ctx?.mode !== "tui" || !ctx.hasUI) return { status: "unavailable" };
			if (signal?.aborted) return { status: "cancelled" };
			if (active?.kind === "question") return { status: "busy" };
			active?.close();
			const ui = ctx.ui;
			const controller = new AbortController();
			let cancel!: (result: ModalOutcome) => void;
			const cancelled = new Promise<ModalOutcome>((resolve) => { cancel = resolve; });
			const slot: NonNullable<typeof active> = { kind: "question", close() {
				controller.abort(); cancel({ status: "cancelled" });
			} };
			active = slot;
			onChange();
			signal?.addEventListener("abort", slot.close, { once: true });
			try {
				return await Promise.race([Promise.resolve().then(() => controller.signal.aborted ? { status: "cancelled" } as ModalOutcome : run(controller.signal, ui)), cancelled]);
			} finally {
				signal?.removeEventListener("abort", slot.close);
				if (active === slot) { active = undefined; onChange(); }
			}
		},
		async modal<T>(kind: "panel" | "question", factory: ModalFactory<T>, signal?: AbortSignal): Promise<T | ModalOutcome> {
			if (ctx?.mode !== "tui" || !ctx.hasUI) return { status: "unavailable" };
			if (signal?.aborted) return { status: "cancelled" };
			if (active?.kind === "question") return { status: "busy" };
			active?.close();
			const currentGeneration = generation;
			let finish: ((result: T | ModalOutcome) => void) | undefined;
			let cancelled = false;
			const slot: NonNullable<typeof active> = { kind, close() {
				cancelled = true;
				finish?.({ status: "cancelled" });
			} };
			active = slot;
			onChange();
			signal?.addEventListener("abort", slot.close, { once: true });
			try {
				return await ctx.ui.custom<T | ModalOutcome>((tui, theme, keys, done) => {
					finish = done;
					slot.requestRender = () => tui.requestRender();
					if (cancelled || generation !== currentGeneration || signal?.aborted) {
						done({ status: "cancelled" });
						return { render: () => [], invalidate() {} };
					}
					return factory(tui, theme, keys, done);
				});
			} finally {
				signal?.removeEventListener("abort", slot.close);
				if (active === slot) { active = undefined; onChange(); }
			}
		},
	};
}

export default function statusUI(pi: ExtensionAPI, workbench = {
	createPublisher: createWorkbenchPublisher, resolveSource: resolveWorkbenchSource,
	isHerdrTerminal: () => process.env.HERDR_ENV === "1" && process.stdin.isTTY === true && process.stdout.isTTY === true,
}) {
	// Native reload replaces the factory but retains its SessionManager. Keep only
	// explicit choices in process memory, isolated from other SDK sessions.
	const shared = globalThis as typeof globalThis & { [key: symbol]: WeakMap<ExtensionContext["sessionManager"], boolean> };
	const workbenchOverrides = shared[WORKBENCH_OVERRIDES_KEY] ??= new WeakMap();
	const owner = createUIOwner(() => refreshStatus());
	const agents = createAgentsProjection();
	let tasks = emptyTasks();
	let bindingCurrent = true;
	let expanded = false;
	let visible = true;
	let context: ExtensionContext | undefined;
	let refreshRequest = 0;
	let workbenchRequested: boolean | undefined;
	let workbenchOverride: boolean | undefined;
	let publisher: ReturnType<typeof createWorkbenchPublisher> | undefined;
	let publisherEpoch = 0;
	let workbenchGeneration = 0;
	let publisherTransition = Promise.resolve();
	let usageCache: ReturnType<typeof projectSessionUsage> | undefined;
	let usageEntryCount: number | undefined;
	let usageLeaf: string | null | undefined;
	let lastWorkbenchWarning: string | undefined;
	function warnWorkbench(message: string) {
		if (context?.mode === "tui" && message !== lastWorkbenchWarning) {
			lastWorkbenchWarning = message;
			context.ui.notify(message, "warning");
		}
	}
	function publishWorkbench(ctx: ExtensionContext, refreshUsage = false) {
		if (!publisher?.enabled || !context || !owner.isCurrent(ctx)) return;
		try {
			// Native idle cache warming appends receipts without extension events.
			// Check the cheap entry count (or leaf on older hosts) before re-scanning.
			const manager = ctx.sessionManager as ExtensionContext["sessionManager"] & { getEntryCount?(): number };
			const count = manager.getEntryCount?.();
			const leaf = manager.getLeafId();
			if (refreshUsage || !usageCache || (count === undefined ? leaf !== usageLeaf : count !== usageEntryCount)) {
				usageCache = projectSessionUsage(manager.getEntries());
				usageEntryCount = count; usageLeaf = leaf;
			}
			publisher.update({ tasks: mapWorkbenchTasks(tasks, bindingCurrent), agents: mapWorkbenchAgents(agents.snapshot()),
				usage: { ...usageCache, context: projectCurrentContext(ctx.getContextUsage?.(), ctx.model) } }, workbenchGeneration);
		} catch {
			void publisher.stop();
			warnWorkbench("Workbench data is unavailable; native Pi execution is unchanged. Disable and re-enable to retry.");
		}
	}
	function restartWorkbench(ctx?: ExtensionContext) {
		const epoch = ++publisherEpoch;
		publisherTransition = publisherTransition.then(async () => {
			await publisher?.stop(); publisher = undefined; usageCache = undefined;
			if (!ctx || !workbenchRequested || epoch !== publisherEpoch || ctx.mode !== "tui" || !ctx.hasUI || !owner.isCurrent(ctx) || !workbench.isHerdrTerminal()) return;
			const source = await workbench.resolveSource(ctx);
			if (epoch !== publisherEpoch || !owner.isCurrent(ctx)) return;
			const next = workbench.createPublisher({
				beforePublish: () => { if (epoch === publisherEpoch && context) publishWorkbench(context); },
				onError: (message: string) => { if (epoch === publisherEpoch) warnWorkbench(message); },
			});
			await next.start({ ...source, generation: workbenchGeneration });
			if (epoch !== publisherEpoch || !owner.isCurrent(ctx)) { await next.stop(); return; }
			publisher = next; lastWorkbenchWarning = undefined;
			publishWorkbench(ctx, true);
			await next.flush();
		}).catch(() => warnWorkbench("Workbench could not verify its Herdr origin or private storage. Native Pi execution is unchanged."));
		return publisherTransition;
	}
	pi.registerFlag("orchestraitor-workbench", { description: "Publish read-only workbench data in eligible Herdr terminals (enabled by default)", type: "boolean", default: true });
	function refreshStatus() {
		const snapshot = agents.snapshot();
		owner.setStatus(context && visible ? workStatus({ launchBlocked: snapshot.launchBlocked || subagentLaunchesBlocked(),
			awaitingInput: owner.awaitingInput, activeAgents: snapshot.live.filter((row) => classifyAgent(row).active).length }) : undefined);
	}
	const refreshTasks = async (ctx: ExtensionContext) => {
		if (!context || !owner.isCurrent(ctx)) return;
		const activeContext = context;
		const generation = owner.generation;
		const request = ++refreshRequest;
		const state = replayTasks(ctx.sessionManager.getBranch());
		const current = await checkTaskBinding(state.binding, ctx.cwd);
		if (context !== activeContext || generation !== owner.generation || request !== refreshRequest || !owner.isCurrent(ctx)) return;
		tasks = state;
		bindingCurrent = current;
		owner.setWidget(visible && tasks.tasks.length ? (tui, _theme) => ({
			invalidate() {},
			render: (width: number) => taskHeader(tasks, expanded, width, tui.terminal.rows, ctx.ui.theme, bindingCurrent),
		}) : undefined);
		owner.refresh();
		publishWorkbench(ctx, true);
	};
	const reconstruct = async (ctx: ExtensionContext, restart = true) => {
		context = ctx;
		workbenchGeneration++;
		workbenchOverride ??= workbenchOverrides.get(ctx.sessionManager);
		workbenchRequested = workbenchOverride ?? pi.getFlag("orchestraitor-workbench") === true;
		if (workbenchOverride !== undefined) workbenchOverrides.set(ctx.sessionManager, workbenchOverride);
		expanded = false;
		visible = true;
		tasks = emptyTasks();
		agents.replay(ctx.sessionManager.getBranch(), ctx.sessionManager.getSessionId(), subagentLaunchesBlocked());
		owner.activate(ctx);
		await refreshTasks(ctx);
		if (restart) await restartWorkbench(ctx);
	};
	pi.registerTool(compactTool(createTaskTool(() => owner.generation)));
	pi.registerTool(compactTool(createQuestionTool(owner)));
	pi.on("tool_call", (event) => {
		if ([TASK_TOOL_NAME, QUESTION_TOOL_NAME].includes(event.toolName) && event.parentToolCallId) return { block: true, reason: "Task projection and questions require a direct model-issued tool call." };
	});
	pi.on("turn_end", (_event, ctx) => refreshTasks(ctx));
	pi.on("session_start", (_event, ctx) => reconstruct(ctx));
	pi.on("session_tree", (_event, ctx) => reconstruct(ctx, false));
	pi.on("agent_settled", (_event, ctx) => refreshTasks(ctx));
	pi.on("session_compact", (_event, ctx) => refreshTasks(ctx));
	pi.on("model_select", (_event, ctx) => publishWorkbench(ctx));
	for (const event of ["session_before_switch", "session_before_fork", "session_before_tree"] as const) {
		pi.on(event, () => owner.cancelInteractions());
	}
	pi.on("session_shutdown", async () => {
		context = undefined; owner.dispose(); agents.replay([]); tasks = emptyTasks(); bindingCurrent = true;
		await restartWorkbench();
	});
	pi.on("tool_execution_start", async (event, ctx) => {
		if (!context || !owner.isCurrent(ctx)) return;
		if (event.toolName === "subagent_run") agents.start(event.toolCallId, event.args?.tasks, event.parentToolCallId);
		refreshStatus(); owner.refresh();
		// Pi 1.0.2 persists the preceding result after message_end/tool_execution_end.
		// Await branch replay here so even a waiting next tool displays committed tasks.
		await refreshTasks(ctx);
	});
	pi.on("tool_execution_update", (event, ctx) => {
		if (!context || !owner.isCurrent(ctx)) return;
		if (event.toolName === "subagent_run") agents.update(event.toolCallId, event.partialResult?.details?.progress);
		refreshStatus(); owner.refresh(); publishWorkbench(ctx);
	});
	pi.on("tool_execution_end", (event, ctx) => {
		if (!context || !owner.isCurrent(ctx)) return;
		if (event.toolName === "subagent_run") agents.finish(event.toolCallId, event.result, event.isError);
		refreshStatus(); owner.refresh(); publishWorkbench(ctx);
	});
	pi.registerCommand("orchestraitor:workbench", {
		description: "Enable, disable or inspect the optional read-only Herdr publisher",
		async handler(args, ctx) {
			if (ctx.mode !== "tui" || !ctx.hasUI) { ctx.ui.notify("Workbench requires interactive terminal mode inside Herdr.", "warning"); return; }
			const action = args.trim() || "status";
			if (action === "status") { ctx.ui.notify(`Workbench publisher is ${publisher?.enabled ? "enabled" : "disabled"}. Use /orchestraitor:workbench [enable|disable|status].`, "info"); return; }
			if (action !== "enable" && action !== "disable") { ctx.ui.notify("Use /orchestraitor:workbench [enable|disable|status].", "warning"); return; }
			if (action === "enable" && !workbench.isHerdrTerminal()) { ctx.ui.notify("Workbench requires an interactive Pi terminal inside Herdr.", "warning"); return; }
			workbenchRequested = action === "enable";
			workbenchOverride = workbenchRequested;
			workbenchOverrides.set(ctx.sessionManager, workbenchOverride);
			if (workbenchRequested && publisher?.enabled) return;
			await restartWorkbench(workbenchRequested ? ctx : undefined);
		},
	});
	pi.registerCommand("orchestraitor:ui", {
		description: "Show or hide passive harness chrome without changing tasks or execution",
		async handler(args, ctx) {
			if (ctx.mode !== "tui") { ctx.ui.notify("Passive harness UI requires interactive terminal mode.", "warning"); return; }
			const action = args.trim();
			if (!action) { ctx.ui.notify(`Harness chrome is ${visible ? "visible" : "hidden"}. Use /orchestraitor:ui [show|hide].`, "info"); return; }
			if (action !== "show" && action !== "hide") { ctx.ui.notify("Use /orchestraitor:ui [show|hide].", "warning"); return; }
			visible = action === "show";
			await refreshTasks(ctx);
			refreshStatus();
		},
	});
	pi.registerCommand("orchestraitor:tasks", {
		description: "Inspect branch tasks, or expand/collapse their compact work header",
		async handler(args, ctx) {
			if (ctx.mode !== "tui") { ctx.ui.notify("Task panel requires interactive terminal mode; use the task tool for readback.", "warning"); return; }
			const action = args.trim();
			if (action && action !== "expand" && action !== "collapse") { ctx.ui.notify("Use /orchestraitor:tasks [expand|collapse].", "warning"); return; }
			if (action) expanded = action === "expand";
			await refreshTasks(ctx);
			if (!action) await owner.modal("panel", (tui, theme, keys, done) =>
				createTaskPanel(() => ({ state: tasks, bindingCurrent }), tui, theme, keys, done));
		},
	});
	pi.registerCommand("orchestraitor:agents", {
		description: "Inspect observed agents and active-branch runtime outcomes (read-only)",
		async handler(_args, ctx) {
			if (ctx.mode !== "tui") { ctx.ui.notify("Agents panel requires interactive terminal mode.", "warning"); return; }
			await owner.modal("panel", (tui, theme, keys, done) =>
				createAgentsPanel(() => agents.snapshot(), tui, theme, keys, done));
		},
	});
}
