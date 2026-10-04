import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, ScrollView, Text, truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import { sanitizeDisplay } from "./display.ts";

export const AGENT_HISTORY_LIMIT = 20;
const LABEL_LIMIT = 200;
const DETAIL_LIMIT = 1000;
const PANEL_RESERVED_ROWS = 8;
const PENDING_CALL_LIMIT = 20;
type BatchObservation = { callId: string; parent?: string; sequence: number; generation?: number; rows: AgentRow[] };
const LIVE_PHASES = ["preparing", "starting", "running", "stopping"];
const FINAL_PHASES = ["completed", "failed", "cancelled", "timed_out", "termination_failed"];
const ROLES = ["explore", "review", "implement"];
export type AgentRow = {
	id?: string; role: string; label: string; requestedModel?: string; effectiveModel?: string;
	phase: string; diagnostic?: string; finalResponse?: string; terminated?: boolean; toolCallId?: string;
};
export type AgentsSnapshot = {
	live: AgentRow[]; recent: AgentRow[]; historyLimited: boolean; nestedHistoryUnavailable: boolean; launchBlocked: boolean;
};

/** Shared by the compact renderer and panel: live phases are never failures. */
export function classifyAgent(value: { phase?: string; status?: string; terminated?: boolean }) {
	const raw = value.phase ?? value.status;
	const phase = value.terminated === false && FINAL_PHASES.includes(raw ?? "") ? "termination_failed"
		: [...LIVE_PHASES, ...FINAL_PHASES].includes(raw ?? "") ? raw! : "unavailable";
	return { phase, active: LIVE_PHASES.includes(phase), failed: FINAL_PHASES.includes(phase) && phase !== "completed" };
}

function boundedRow(value: any, toolCallId: string, label?: string): AgentRow {
	const phase = classifyAgent(value).phase;
	return {
		id: typeof value.id === "string" ? value.id.slice(0, LABEL_LIMIT) : undefined,
		role: ROLES.includes(value.role) ? value.role : "unavailable",
		label: String(label ?? value.label ?? "Assignment unavailable").slice(0, LABEL_LIMIT),
		requestedModel: typeof (value.requestedModel ?? value.model) === "string" ? (value.requestedModel ?? value.model).slice(0, LABEL_LIMIT) : undefined,
		effectiveModel: typeof value.effectiveModel === "string" ? value.effectiveModel.slice(0, LABEL_LIMIT)
			: value.status === "completed" && value.terminated === true && typeof value.model === "string" ? value.model.slice(0, LABEL_LIMIT) : undefined,
		phase, toolCallId,
		diagnostic: typeof value.diagnostic === "string" ? value.diagnostic.slice(0, DETAIL_LIMIT) : undefined,
		finalResponse: typeof value.finalResponse === "string" ? value.finalResponse.slice(0, DETAIL_LIMIT) : undefined,
		terminated: typeof value.terminated === "boolean" ? value.terminated : undefined,
	};
}

/** In-memory view of native observations and only the active branch's receipts. */
export function createAgentsProjection() {
	// Pending metadata tracks native foreground calls, not controller ownership.
	const calls = new Map<string, BatchObservation>();
	let activeCall: string | undefined;
	let recent: AgentRow[] = [];
	let historyLimited = false;
	let nestedHistoryUnavailable = false;
	let launchBlocked = false;
	let sessionId: string | undefined;
	const retain = (rows: AgentRow[]) => {
		recent.push(...rows);
		if (recent.length > AGENT_HISTORY_LIMIT) {
			historyLimited = true;
			recent = recent.slice(-AGENT_HISTORY_LIMIT);
		}
	};
	return {
		start(callId: string, tasks: any[], parent?: string) {
			if (calls.has(callId) || !Array.isArray(tasks) || tasks.length < 1 || tasks.length > 2) return;
			if (calls.size >= PENDING_CALL_LIMIT) { historyLimited = true; return; }
			calls.set(callId, { callId, parent, sequence: 0, rows: tasks.map((task) =>
				boundedRow({ role: task.role, phase: "preparing", requestedModel: task.model }, callId, task.instruction)) });
			activeCall ??= callId;
		},
		update(callId: string, progress: any) {
			const call = calls.get(callId);
			if (!call || progress?.version !== 1 || progress.toolCallId !== callId ||
				!Number.isSafeInteger(progress.sequence) || progress.sequence <= call.sequence ||
				!Number.isSafeInteger(progress.generation) || progress.generation < 0 ||
				(sessionId !== undefined && progress.sessionId !== sessionId) ||
				(call.generation !== undefined && call.generation !== progress.generation) ||
				!Array.isArray(progress.tasks) || progress.tasks.length !== call.rows.length ||
				progress.tasks.some((row: any, index: number) => !row || typeof row.id !== "string" ||
					row.id.length > LABEL_LIMIT || !ROLES.includes(row.role) || row.role !== call.rows[index].role ||
					![...LIVE_PHASES, ...FINAL_PHASES].includes(row.phase) ||
					(call.sequence > 0 && row.id !== call.rows[index].id)) ||
				new Set(progress.tasks.map((row: any) => row.id)).size !== progress.tasks.length) return false;
			call.generation = progress.generation;
			call.sequence = progress.sequence;
			call.rows = progress.tasks.map((row: any) => boundedRow(row, callId));
			if (progress.batchStarted === true) activeCall = callId;
			launchBlocked ||= progress.launchBlocked === true || call.rows.some((row) => row.phase === "termination_failed");
			return true;
		},
		finish(callId: string, result: any, isError = false) {
			const call = calls.get(callId);
			if (!call) return;
			const results = result?.details?.results;
			if (Array.isArray(results) && results.length <= 2) {
				retain(results.map((row, index) => boundedRow({
					...row, effectiveModel: call.rows[index]?.effectiveModel,
				}, callId, call.rows[index]?.label)));
			} else {
				const diagnostic = result?.content?.filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n") ?? "Outcome unavailable";
				retain(call.rows.map((row) => boundedRow({ ...row, phase: isError ? "failed" : "unavailable", diagnostic }, callId)));
				launchBlocked ||= /launches blocked.*termination/i.test(diagnostic);
			}
			if (call.parent) nestedHistoryUnavailable = true;
			calls.delete(callId);
			if (activeCall === callId) activeCall = calls.keys().next().value;
		},
		replay(branch: any[], identity?: string, knownBlocked = false) {
			calls.clear();
			activeCall = undefined;
			recent = [];
			historyLimited = false;
			// Historical failed exits do not prove a current host's safety lock is retained.
			nestedHistoryUnavailable = true;
			launchBlocked = knownBlocked;
			sessionId = identity;
			const assignments = new Map<string, any[]>();
			for (const entry of branch) {
				if (entry.type !== "message") continue;
				const message = entry.message;
				if (message.role === "assistant") {
					for (const call of message.content ?? []) if (call.type === "toolCall" && call.name === "subagent_run") assignments.set(call.id, call.arguments?.tasks ?? []);
				}
				if (message.role !== "toolResult" || message.toolName !== "subagent_run") continue;
				if (!message.isError && Array.isArray(message.details?.results) && message.details.results.length <= 2) {
					retain(message.details.results.filter((row: any) => row && ROLES.includes(row.role) && FINAL_PHASES.includes(row.status))
						.map((row: any, index: number) => boundedRow(row, message.toolCallId, assignments.get(message.toolCallId)?.[index]?.instruction)));
				} else if (message.isError) {
					const diagnostic = message.content?.filter((block: any) => block.type === "text")
						.map((block: any) => block.text).join("\n") ?? "Launch failed; diagnostic unavailable";
					const tasks = assignments.get(message.toolCallId)?.slice(0, 2) ?? [{ role: "unavailable" }];
					retain(tasks.map((task) => boundedRow({ role: task.role, phase: "failed", diagnostic },
						message.toolCallId, task.instruction)));
				}
			}
		},
		snapshot(): AgentsSnapshot {
			return structuredClone({ live: activeCall ? calls.get(activeCall)?.rows ?? [] : [],
				recent, historyLimited, nestedHistoryUnavailable, launchBlocked });
		},
	};
}

export function createAgentsPanel(getSnapshot: () => AgentsSnapshot, tui: TUI, theme: Theme,
	keys: KeybindingsManager, done: (value: { status: "closed" }) => void) {
	const content = {
		invalidate() {},
		render(width: number) {
			const snapshot = getSnapshot();
			const lines = ["Agents — runtime outcomes, not accepted work"];
			if (snapshot.launchBlocked) lines.push("Launches blocked: child exit was not confirmed.");
			for (const [label, rows] of [["Active batch", snapshot.live], ["Recent branch outcomes", snapshot.recent]] as const) {
				lines.push(label);
				if (!rows.length) lines.push("  No observations available.");
				for (const row of rows) {
					lines.push(`${row.id ?? "ID unavailable"} · ${row.role} · ${row.phase}`, `  ${row.label}`,
						`  requested: ${row.requestedModel ?? "unavailable"} · observed: ${row.effectiveModel ?? "unavailable"}`);
					if (row.terminated !== undefined) lines.push(`  exit confirmed: ${row.terminated ? "yes" : "no"}`);
					if (row.diagnostic) lines.push(`  ${row.diagnostic}`);
					if (row.finalResponse) lines.push(`  ${row.finalResponse}`);
				}
			}
			if (snapshot.historyLimited) lines.push(`History limited to ${AGENT_HISTORY_LIMIT} outcomes.`);
			if (snapshot.nestedHistoryUnavailable) lines.push("Nested history after reload is unavailable; only native branch receipts are replayed.");
			return new Text(theme.fg("text", sanitizeDisplay(lines.join("\n"))), 0, 0).render(Math.max(1, width));
		},
	};
	// Use native scrolling state; no renderer, listeners, timers or alternate terminal engine.
	const scroll = new ScrollView(content, { scrollbar: "hidden" });
	return {
		invalidate() { content.invalidate(); },
		handleInput(data: string) {
			if (matchesKey(data, "escape") || keys.matches(data, "tui.select.cancel")) { done({ status: "closed" }); return; }
			const page = Math.max(1, scroll.viewportHeight - 1);
			if (keys.matches(data, "tui.select.up")) scroll.scrollBy(-1);
			else if (keys.matches(data, "tui.select.down")) scroll.scrollBy(1);
			else if (keys.matches(data, "tui.select.pageUp")) scroll.scrollBy(-page);
			else if (keys.matches(data, "tui.select.pageDown")) scroll.scrollBy(page);
			tui.requestRender();
		},
		render(width: number) {
			const lines = scroll.render(width);
			const height = Math.max(1, tui.terminal.rows - PANEL_RESERVED_ROWS);
			scroll.updateLayout(lines.length, height, () => tui.requestRender());
			return [...lines.slice(scroll.scrollTop, scroll.scrollTop + height),
				truncateToWidth(theme.fg("muted", "Scroll with selection keys · Escape closes"), width)];
		},
	};
}
