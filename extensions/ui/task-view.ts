import type { KeybindingsManager, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type TUI } from "@earendil-works/pi-tui";
import type { AgentRow } from "./agents.ts";
import { sanitizeDisplay } from "./display.ts";
import type { PlanBinding, Task, TaskActivity, TaskState, TaskStatus } from "./tasks.ts";

const SHORT_TERMINAL_ROWS = 16;
const PANEL_RESERVED_ROWS = 8;
const FOCUS_ROWS = 2;
const EXPANDED_MIN_ROWS = 5;
const EXPANDED_MAX_ROWS = 18;
const SPLIT_PANEL_WIDTH = 90;
const PANEL_AGENT_ROWS = 2;
const NOTE_INDENT = "       ";
const ORDER: TaskStatus[] = ["done", "in_progress", "blocked", "pending"];
const STATUS: Record<TaskStatus, { glyph: string; color: ThemeColor; label: string; tally: string }> = {
	done: { glyph: "✓", color: "success", label: "done", tally: "done" },
	in_progress: { glyph: "●", color: "warning", label: "in progress", tally: "active" },
	blocked: { glyph: "⊘", color: "error", label: "blocked", tally: "blocked" },
	pending: { glyph: "○", color: "muted", label: "pending", tally: "pending" },
};

export type TaskViewState = { state: TaskState; bindingCurrent: boolean; activity?: TaskActivity; agents?: AgentRow[] };

const clean = (text: string) => sanitizeDisplay(text).replace(/\s+/gu, " ").trim();
const fit = (text: string, width: number, pad = false) => truncateToWidth(text, Math.max(0, width), "…", pad);

function duration(ms: number) {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

function ago(ms: number) {
	const minutes = Math.floor(Math.max(0, ms) / 60_000);
	return minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

/** Elapsed time in the current status; done shows how long ago it finished. */
function timing(task: Task, activity: TaskActivity | undefined, now: number) {
	const since = activity?.get(task.id)?.since;
	if (since === undefined || task.status === "pending") return "";
	return task.status === "done" ? ago(now - since) : duration(now - since);
}

/** Right label stays only while the left keeps a readable width; otherwise the left wins. */
function row(left: string, right: string, width: number) {
	const room = width - visibleWidth(right) - 2;
	if (right && room >= Math.min(24, visibleWidth(left))) return fit(left, room, true) + "  " + right;
	return fit(left, width);
}

function counts(tasks: Task[]) {
	const result: Record<TaskStatus, number> = { done: 0, in_progress: 0, blocked: 0, pending: 0 };
	for (const task of tasks) result[task.status]++;
	return result;
}

/** Done, active, blocked and pending in that order; pending uses a thin rule so it reads without color. */
function progressBar(tasks: Task[], cells: number, theme: Theme) {
	const tally = counts(tasks);
	let seen = 0, filled = 0, bar = "";
	for (const status of ORDER) {
		seen += tally[status];
		const end = Math.round(seen / tasks.length * cells);
		if (end > filled) bar += status === "pending" ? theme.fg("dim", "─".repeat(end - filled)) : theme.fg(STATUS[status].color, "━".repeat(end - filled));
		filled = end;
	}
	return bar;
}

function tallies(tasks: Task[], theme: Theme, statuses: TaskStatus[], compact = false) {
	const tally = counts(tasks);
	return statuses.filter((status) => tally[status]).map((status) => theme.fg(STATUS[status].color,
		compact ? `${STATUS[status].glyph}${tally[status]}` : `${STATUS[status].glyph} ${tally[status]} ${STATUS[status].tally}`)).join(compact ? " " : "  ");
}

function summary(view: TaskViewState, width: number, theme: Theme, expanded: boolean) {
	const { state, bindingCurrent } = view, tally = counts(state.tasks), total = state.tasks.length;
	const allDone = tally.done === total;
	const cells = width >= 80 ? 20 : width >= 50 ? 10 : 0;
	let left = theme.bold("Tasks") + (cells ? " " + progressBar(state.tasks, cells, theme) : "")
		+ " " + theme.fg(allDone ? "success" : "text", `${tally.done}/${total} done${allDone ? " ✓" : ""}`);
	if (expanded) left += theme.fg("muted", ` · ${Math.floor(tally.done / total * 100)}%`);
	if (!bindingCurrent) left += theme.fg("muted", " · ") + theme.fg("error", "⚠ plan binding stale");
	const right = theme.fg("muted", [state.binding && bindingCurrent && !expanded ? "plan ✓" : "", `rev ${state.revision}`].filter(Boolean).join(" · "));
	if (allDone) return row(left, right, width);
	// Counts collapse to glyphs before anything is truncated, so narrow rows keep every status visible.
	const full = left + theme.fg("muted", " · ") + tallies(state.tasks, theme, ["in_progress", "blocked", "pending"]);
	if (visibleWidth(full) + visibleWidth(right) + 2 <= width) return row(full, right, width);
	return row(left + theme.fg("muted", " · ") + tallies(state.tasks, theme, ["in_progress", "blocked", "pending"], true), right, width);
}

function taskLine(task: Task, width: number, theme: Theme, view: TaskViewState, now: number, note?: string, caret = "") {
	const meta = STATUS[task.status];
	let left = caret + theme.fg(meta.color, ` ${meta.glyph} `) + theme.fg("muted", `${clean(task.id)}  `) + theme.fg("text", clean(task.title));
	if (note) left += theme.fg("muted", `  — ${clean(note)}`);
	const right = [meta.label, timing(task, view.activity, now)].filter(Boolean).join(" · ");
	return row(left, theme.fg(meta.color, right), width);
}

function planLine(binding: PlanBinding, current: boolean, width: number, theme: Theme, label = "plan  ") {
	return fit(theme.fg("muted", label) + theme.fg("text", clean(binding.path)) + theme.fg("muted", `  sha ${binding.sha256.slice(0, 6)}…${binding.sha256.slice(-4)}  `)
		+ (current ? theme.fg("success", "✓ matches the bound plan") : theme.fg("error", "⚠ plan changed or unavailable · list may be outdated")), width);
}

/** Plan groups in binding order, then first appearance; ungrouped lists render without a rule. */
function grouped(state: TaskState): [string | undefined, Task[]][] {
	if (!state.tasks.some((task) => task.group)) return [[undefined, state.tasks]];
	const names = [...new Set([...state.binding?.groups ?? [], ...state.tasks.map((task) => task.group ?? "other")])];
	return names.map((name): [string, Task[]] => [name, state.tasks.filter((task) => (task.group ?? "other") === name)]).filter(([, tasks]) => tasks.length);
}

function groupRule(name: string, tasks: Task[], width: number, theme: Theme) {
	const done = tasks.filter((task) => task.status === "done").length;
	const label = clean(name), count = `${done}/${tasks.length}`;
	const rule = Math.max(1, width - visibleWidth(label) - count.length - 3);
	return fit(theme.bold(label) + " " + theme.fg("dim", "─".repeat(rule)) + " " + theme.fg(done === tasks.length ? "success" : "muted", count), width);
}

function detailNote(task: Task) {
	if (task.status === "done" && task.evidence) return { label: "evidence", text: task.evidence };
	if (task.reason) return { label: "reason  ", text: task.reason };
	return undefined;
}

function latestDone(tasks: Task[], activity?: TaskActivity) {
	const done = tasks.filter((task) => task.status === "done");
	return done.reduce<Task | undefined>((latest, task) => !latest || (activity?.get(task.id)?.since ?? -1) >= (activity?.get(latest.id)?.since ?? -1) ? task : latest, undefined);
}

function shortRow(view: TaskViewState, width: number, theme: Theme) {
	const { state } = view, tally = counts(state.tasks);
	const focus = state.tasks.find((task) => task.status === "in_progress") ?? state.tasks.find((task) => task.status === "blocked");
	let line = theme.bold("Tasks") + (width >= 50 ? " " + progressBar(state.tasks, 8, theme) : "") + " " + `${tally.done}/${state.tasks.length}`;
	if (!view.bindingCurrent) line += " " + theme.fg("error", "⚠ plan binding stale");
	for (const status of ["in_progress", "blocked"] as const) if (tally[status]) line += " " + theme.fg(STATUS[status].color, `${STATUS[status].glyph}${tally[status]}`);
	if (focus) line += theme.fg("muted", " · ") + theme.fg(STATUS[focus.status].color, STATUS[focus.status].glyph) + " " + theme.fg("muted", clean(focus.id)) + " " + clean(focus.title);
	return fit(line, width);
}

function collapsedRows(view: TaskViewState, width: number, theme: Theme, now: number) {
	const { state, activity } = view;
	const rows = [summary(view, width, theme, false)];
	const focus = [...state.tasks.filter((task) => task.status === "in_progress"), ...state.tasks.filter((task) => task.status === "blocked")];
	for (const task of focus.slice(0, FOCUS_ROWS)) rows.push(taskLine(task, width, theme, view, now, task.status === "blocked" ? task.reason : undefined));
	const notes = [];
	if (focus.length > FOCUS_ROWS) notes.push(theme.fg("muted", `+${focus.length - FOCUS_ROWS} more active or blocked`));
	const last = latestDone(state.tasks, activity), next = state.tasks.find((task) => task.status === "pending");
	if (last) notes.push(theme.fg("muted", "last ") + theme.fg("success", `✓ ${clean(last.id)}`) + theme.fg("muted", [" ", timing(last, activity, now)].join("").trimEnd()));
	if (next) notes.push(theme.fg("muted", "next ") + theme.fg("text", `○ ${clean(next.id)} ${clean(next.title)}`));
	if (notes.length) rows.push(row("    " + notes.join(theme.fg("muted", "  ·  ")), theme.fg("muted", "/orchestraitor:tasks"), width));
	return rows;
}

function expandedRows(view: TaskViewState, width: number, height: number, theme: Theme, now: number) {
	const { state } = view;
	const budget = Math.min(EXPANDED_MAX_ROWS, Math.max(EXPANDED_MIN_ROWS, Math.floor(height / 2)));
	const head = [summary(view, width, theme, true)];
	if (state.binding) head.push(planLine(state.binding, view.bindingCurrent, width, theme));
	const build = (details: boolean) => grouped(state).flatMap(([name, tasks]) => [
		...name === undefined ? [] : [{ line: groupRule(name, tasks, width, theme), task: false }],
		...tasks.flatMap((task) => {
			const note = details ? detailNote(task) : undefined;
			return [{ line: taskLine(task, width, theme, view, now), task: true },
				...note ? [{ line: fit(theme.fg("muted", `${NOTE_INDENT}${note.label}  `) + theme.fg("text", clean(note.text)), width), task: false }] : []];
		}),
	]);
	const room = Math.max(1, budget - head.length);
	let body = build(true);
	if (body.length > room) body = build(false);
	if (body.length > room) {
		const kept = body.slice(0, room - 1);
		const hidden = state.tasks.length - kept.filter(({ task }) => task).length;
		body = [...kept, { line: fit(theme.fg("muted", `    … ${hidden} more · /orchestraitor:tasks opens the full panel`), width), task: false }];
	} else if (body.length < room) body.push({ line: fit(theme.fg("muted", "    /orchestraitor:tasks collapse · /orchestraitor:tasks opens the full panel"), width), task: false });
	return [...head, ...body.map(({ line }) => line)];
}

/** Bounded work header: four rows collapsed, at most EXPANDED_MAX_ROWS expanded, one row on short terminals. */
export function taskHeader(state: TaskState, expanded: boolean, width: number, height: number, theme: Theme, bindingCurrent: boolean,
	activity?: TaskActivity, now = Date.now()) {
	if (!state.tasks.length) return [];
	const view = { state, bindingCurrent, activity };
	if (height < SHORT_TERMINAL_ROWS) return [shortRow(view, width, theme)];
	return expanded ? expandedRows(view, width, height, theme, now) : collapsedRows(view, width, theme, now);
}

function wrap(text: string, width: number, color: (text: string) => string) {
	return wrapTextWithAnsi(sanitizeDisplay(text), Math.max(1, width)).map(color);
}

function detailRows(task: Task, view: TaskViewState, width: number, theme: Theme, now: number) {
	const meta = STATUS[task.status];
	const facts = [clean(task.id), task.group ? `group ${clean(task.group)}` : "", timing(task, view.activity, now)].filter(Boolean).join("  ·  ");
	const rows = [fit(theme.fg(meta.color, `${meta.glyph} ${meta.label}`) + theme.fg("muted", `  ·  ${facts}`), width),
		...wrap(task.title, width, (line) => theme.bold(line)), "", theme.fg("muted", "evidence")];
	if (task.evidence) rows.push(...wrap(task.evidence, width, (line) => theme.fg("text", line)), theme.fg("dim", "parent-reported, not runtime certification"));
	else rows.push(theme.fg("muted", "— none yet · required to mark done"));
	if (task.reason) rows.push("", theme.fg("muted", "reason"), ...wrap(task.reason, width, (line) => theme.fg(task.status === "blocked" ? "error" : "text", line)));
	const events = view.activity?.get(task.id)?.events ?? [];
	if (events.length) {
		rows.push("", theme.fg("muted", "history on this branch"));
		for (const event of [...events].reverse()) rows.push(fit(theme.fg("muted", `rev ${event.revision}  ${event.at === undefined ? "" : `${ago(now - event.at)}  `}`) + theme.fg("text", clean(event.change)), width));
	}
	return rows;
}

function agentRows(agents: AgentRow[] | undefined, width: number, theme: Theme) {
	if (!agents?.length) return [];
	const rows = agents.slice(0, PANEL_AGENT_ROWS).map((agent, index) => fit(theme.fg("muted", index ? "        " : "agents  ")
		+ theme.fg("text", `▸ ${clean(agent.role)}`) + theme.fg("muted", ` · ${clean(agent.phase)}${agent.effectiveModel ?? agent.requestedModel ? ` · ${clean(agent.effectiveModel ?? agent.requestedModel!)}` : ""} · `)
		+ theme.fg("text", clean(agent.label)), width));
	if (agents.length > PANEL_AGENT_ROWS) rows.push(fit(theme.fg("muted", `        +${agents.length - PANEL_AGENT_ROWS} more · /orchestraitor:agents`), width));
	return rows;
}

function windowed<T>(rows: T[], focus: number, height: number) {
	const top = Math.max(0, Math.min(focus - Math.floor(height / 2), rows.length - height));
	return rows.slice(top, top + height);
}

/** Read-only task inspector: grouped list with selection, detail and branch history for the selected task. */
export function createTaskPanel(getState: () => TaskViewState, tui: TUI, theme: Theme,
	keys: KeybindingsManager, done: (result: { status: "closed" }) => void) {
	let selectedId: string | undefined;
	let detailTop = 0;
	const ordered = () => grouped(getState().state).flatMap(([, tasks]) => tasks);
	const selected = () => {
		const tasks = ordered();
		return tasks.find((task) => task.id === selectedId) ?? tasks.find((task) => task.status === "in_progress")
			?? tasks.find((task) => task.status === "blocked") ?? tasks.find((task) => task.status === "pending") ?? tasks[0];
	};
	const move = (delta: number) => {
		const tasks = ordered(), current = selected();
		if (!current) return;
		selectedId = tasks[Math.max(0, Math.min(tasks.length - 1, tasks.indexOf(current) + delta))].id;
		detailTop = 0;
	};
	const bodyHeight = (headRows: number) => Math.max(3, tui.terminal.rows - PANEL_RESERVED_ROWS - headRows);
	return {
		invalidate() {},
		handleInput(data: string) {
			if (matchesKey(data, "escape") || keys.matches(data, "tui.select.cancel")) { done({ status: "closed" }); return; }
			const page = Math.max(1, bodyHeight(0) - 1);
			if (keys.matches(data, "tui.select.up")) move(-1);
			else if (keys.matches(data, "tui.select.down")) move(1);
			else if (keys.matches(data, "tui.select.pageUp")) detailTop = Math.max(0, detailTop - page);
			else if (keys.matches(data, "tui.select.pageDown")) detailTop += page;
			tui.requestRender();
		},
		render(width: number) {
			const view = getState(), { state } = view, now = Date.now();
			width = Math.max(1, width);
			const head = [row(theme.bold("Tasks") + theme.fg("muted", ` · ${state.binding ? "plan-bound" : "unbound"} · rev ${state.revision}`), theme.fg("muted", "esc close"), width)];
			if (state.binding) head.push(planLine(state.binding, view.bindingCurrent, width, theme, "plan    "));
			else if (!view.bindingCurrent) head.push(fit(theme.fg("error", "⚠ plan binding stale or unavailable; this projection is not current"), width));
			head.push(...agentRows(view.agents, width, theme));
			if (state.tasks.length) head.push(fit(theme.fg("muted", "status  ") + progressBar(state.tasks, Math.min(20, Math.max(4, width - 60)), theme)
				+ " " + theme.bold(`${Math.floor(counts(state.tasks).done / state.tasks.length * 100)}%`) + "   " + tallies(state.tasks, theme, ORDER), width));
			head.push(theme.fg("dim", "─".repeat(width)));
			const groups = grouped(state).filter(([name]) => name !== undefined).length;
			const footer = row(theme.fg("muted", "↑↓ select · pgup/pgdn scroll detail · esc close"),
				theme.fg("muted", `${state.tasks.length} tasks${groups ? ` · ${groups} groups` : ""}`), width);
			const current = selected();
			if (!current) return [...head, fit(theme.fg("muted", "No branch tasks."), width), footer];
			const height = bodyHeight(head.length);
			const split = width >= SPLIT_PANEL_WIDTH;
			const listWidth = split ? Math.min(48, Math.floor(width * 0.42)) : width;
			const list: string[] = [];
			let focus = 0;
			for (const [name, tasks] of grouped(state)) {
				if (name !== undefined) list.push(groupRule(name, tasks, listWidth - 1, theme));
				for (const task of tasks) {
					if (task === current) focus = list.length;
					const meta = STATUS[task.status];
					list.push(fit((task === current ? theme.fg("accent", "▶") : " ") + theme.fg(meta.color, `${meta.glyph} `)
						+ theme.fg("muted", `${clean(task.id)} `) + (task === current ? theme.bold(clean(task.title)) : theme.fg("text", clean(task.title))), listWidth - 1));
				}
			}
			const detailWidth = split ? width - listWidth - 3 : width;
			const detail = detailRows(current, view, detailWidth, theme, now);
			const listHeight = split ? height : Math.min(list.length, Math.max(3, Math.floor(height / 2)));
			const detailHeight = split ? height : Math.max(1, height - listHeight - 1);
			detailTop = Math.min(detailTop, Math.max(0, detail.length - detailHeight));
			const shownList = windowed(list, focus, listHeight), shownDetail = detail.slice(detailTop, detailTop + detailHeight);
			const body = split
				? Array.from({ length: Math.max(shownList.length, shownDetail.length) }, (_, index) =>
					fit(shownList[index] ?? "", listWidth, true) + theme.fg("dim", "│") + "  " + fit(shownDetail[index] ?? "", detailWidth))
				: [...shownList, theme.fg("dim", "─".repeat(width)), ...shownDetail];
			return [...head, ...body.map((line) => fit(line, width)), footer];
		},
	};
}
