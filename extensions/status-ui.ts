import type { ExtensionAPI, ExtensionContext, ExtensionUIContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { classifyAgent, createAgentsPanel, createAgentsProjection } from "./ui/agents.ts";
import { registerCacheNotice } from "./ui/cache-notice.ts";
import { workStatus } from "./ui/display.ts";
import { subagentLaunchesBlocked, SUBAGENT_PROGRESS_EVENT } from "./subagents.ts";
import { compactTool } from "./compact-tools.ts";
import { createQuestionTool, QUESTION_TOOL_NAME } from "./ui/questions.ts";

export const WORK_STATUS_KEY = "orchestraitor:status";
export type ModalOutcome = { status: "cancelled" | "unavailable" | "busy" };
type ModalFactory<T> = (tui: TUI, theme: Theme, keys: KeybindingsManager,
	done: (result: T | ModalOutcome) => void) =>
	(Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>;

/** Sole owner of harness keys and foreground interactions, never of execution. */
export function createUIOwner(onChange: () => void = () => {}) {
	let ctx: ExtensionContext | undefined;
	let generation = 0;
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
		if (ctx?.mode === "tui" && statusPresent) ctx.ui.setStatus(WORK_STATUS_KEY, undefined);
		statusPresent = false;
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
	let visible = true;
	let context: ExtensionContext | undefined;
	function refreshStatus() {
		const snapshot = agents.snapshot();
		owner.setStatus(context && visible ? workStatus({ launchBlocked: snapshot.launchBlocked || subagentLaunchesBlocked(),
			awaitingInput: owner.awaitingInput, activeAgents: snapshot.live.filter((row) => classifyAgent(row).active).length }) : undefined);
	}
	const reconstruct = (ctx: ExtensionContext) => {
		context = ctx;
		visible = true;
		// Agent history is display-only: a replay failure must not leave questions without a UI owner.
		let replayError: unknown;
		try { agents.replay(ctx.sessionManager.getBranch(), ctx.sessionManager.getSessionId(), subagentLaunchesBlocked()); }
		catch (error) { replayError = error; }
		owner.activate(ctx);
		if (replayError !== undefined) throw replayError;
	};
	pi.registerTool(compactTool(createQuestionTool(owner)));
	pi.on("tool_call", (event) => {
		if (event.toolName === QUESTION_TOOL_NAME && event.parentToolCallId) return { block: true, reason: "Questions require a direct model-issued tool call." };
	});
	pi.on("session_start", (_event, ctx) => reconstruct(ctx));
	pi.on("session_tree", (_event, ctx) => reconstruct(ctx));
	registerCacheNotice(pi);
	for (const event of ["session_before_switch", "session_before_fork", "session_before_tree"] as const) {
		pi.on(event, () => owner.cancelInteractions());
	}
	pi.on("session_shutdown", () => {
		context = undefined; owner.dispose(); agents.replay([]);
	});
	pi.on("tool_execution_start", (event, ctx) => {
		if (!context || !owner.isCurrent(ctx)) return;
		if (event.toolName === "subagent_run") agents.start(event.toolCallId, event.args?.tasks, event.parentToolCallId);
		refreshStatus(); owner.refresh();
	});
	pi.on("tool_execution_update", (event, ctx) => {
		if (!context || !owner.isCurrent(ctx)) return;
		if (event.toolName === "subagent_run") agents.update(event.toolCallId, event.partialResult?.details?.progress);
		refreshStatus(); owner.refresh();
	});
	pi.events.on(SUBAGENT_PROGRESS_EVENT, (progress: any) => {
		if (!context || progress?.sessionId !== context.sessionManager.getSessionId()) return;
		if (!agents.update(progress.toolCallId, progress)) return;
		refreshStatus(); owner.refresh();
	});
	pi.on("tool_execution_end", (event, ctx) => {
		if (!context || !owner.isCurrent(ctx)) return;
		if (event.toolName === "subagent_run") agents.finish(event.toolCallId, event.result, event.isError, subagentLaunchesBlocked());
		if (event.toolName === "subagent_collect") agents.collect(event.toolCallId, event.result);
		refreshStatus(); owner.refresh();
	});
	pi.registerCommand("orchestraitor:ui", {
		description: "Show or hide passive harness chrome without changing execution",
		async handler(args, ctx) {
			if (ctx.mode !== "tui") { ctx.ui.notify("Passive harness UI requires interactive terminal mode.", "warning"); return; }
			const action = args.trim();
			if (!action) { ctx.ui.notify(`Harness chrome is ${visible ? "visible" : "hidden"}. Use /orchestraitor:ui [show|hide].`, "info"); return; }
			if (action !== "show" && action !== "hide") { ctx.ui.notify("Use /orchestraitor:ui [show|hide].", "warning"); return; }
			visible = action === "show";
			refreshStatus();
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
