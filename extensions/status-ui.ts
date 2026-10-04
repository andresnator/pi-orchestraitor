import type { ExtensionAPI, ExtensionContext, ExtensionUIContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { classifyAgent, createAgentsPanel, createAgentsProjection } from "./ui/agents.ts";
import { workStatus } from "./ui/display.ts";
import { subagentLaunchesBlocked } from "./subagents.ts";
import { compactTool } from "./compact-tools.ts";
import { checkTaskBinding, createTaskPanel, createTaskTool, emptyTasks, replayTasks, taskHeader, TASK_TOOL_NAME } from "./ui/tasks.ts";
import { createQuestionTool, QUESTION_TOOL_NAME } from "./ui/questions.ts";

export const WORK_WIDGET_KEY = "orchestraitor:work";
export const WORK_STATUS_KEY = "orchestraitor:status";
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

export default function statusUI(pi: ExtensionAPI) {
	const owner = createUIOwner(() => refreshStatus());
	const agents = createAgentsProjection();
	let tasks = emptyTasks();
	let bindingCurrent = true;
	let expanded = false;
	let visible = true;
	let context: ExtensionContext | undefined;
	let refreshRequest = 0;
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
	};
	const reconstruct = async (ctx: ExtensionContext) => {
		context = ctx;
		expanded = false;
		visible = true;
		tasks = emptyTasks();
		agents.replay(ctx.sessionManager.getBranch(), ctx.sessionManager.getSessionId(), subagentLaunchesBlocked());
		owner.activate(ctx);
		await refreshTasks(ctx);
	};
	pi.registerTool(compactTool(createTaskTool(() => owner.generation)));
	pi.registerTool(compactTool(createQuestionTool(owner)));
	pi.on("tool_call", (event) => {
		if ([TASK_TOOL_NAME, QUESTION_TOOL_NAME].includes(event.toolName) && event.parentToolCallId) return { block: true, reason: "Task projection and questions require a direct model-issued tool call." };
	});
	pi.on("turn_end", (_event, ctx) => refreshTasks(ctx));
	pi.on("session_start", (_event, ctx) => reconstruct(ctx));
	pi.on("session_tree", (_event, ctx) => reconstruct(ctx));
	for (const event of ["session_before_switch", "session_before_fork", "session_before_tree"] as const) {
		pi.on(event, () => owner.cancelInteractions());
	}
	pi.on("session_shutdown", () => { context = undefined; owner.dispose(); agents.replay([]); tasks = emptyTasks(); bindingCurrent = true; });
	pi.on("tool_execution_start", async (event, ctx) => {
		if (!context || !owner.isCurrent(ctx)) return;
		if (event.toolName === "subagent_run") agents.start(event.toolCallId, event.args?.tasks, event.parentToolCallId);
		refreshStatus(); owner.refresh();
		// Pi 1.0.2 persists the preceding result after message_end/tool_execution_end.
		// Await branch replay here so even a waiting next tool displays committed tasks.
		await refreshTasks(ctx);
	});
	pi.on("tool_execution_update", (event) => {
		if (event.toolName === "subagent_run") agents.update(event.toolCallId, event.partialResult?.details?.progress);
		refreshStatus(); owner.refresh();
	});
	pi.on("tool_execution_end", (event) => {
		if (event.toolName === "subagent_run") agents.finish(event.toolCallId, event.result, event.isError);
		refreshStatus(); owner.refresh();
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
