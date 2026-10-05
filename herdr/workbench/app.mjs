import { basename } from "node:path";
import { validateWorkbenchSnapshot } from "../../extensions/ui/workbench-contract.mjs";
import { createWorkbenchView } from "./view.mjs";
import { selectPalette } from "./palette.mjs";
const MAX_LOCAL_STATE_BYTES = 65536;
const marks = { blocked: "!", in_progress: "~", pending: "·", done: "✓", idle: "○" };
const statusRoles = { blocked: "blocked", in_progress: "active", pending: "muted", done: "done", idle: "idle" };
const labels = { blocked: "Blocked", in_progress: "Active", pending: "Pending", done: "Completed", idle: "Unavailable" };
const formatter = new Intl.NumberFormat("en-US");
const number = value => formatter.format(value);
const line = (text = "", role = "text", focused = false) => ({ text, role, focused });
const heading = text => line(text, "accent");
const card = (title, lines, focused = false) => ({ title, lines, focused });

function initialLocalState(value) {
	const defaults = { tab: 0, selected: [null, null, null, null], offsets: [0, 0, 0, 0], expanded: [], detail: false, focus: "list", help: false };
	if (!value) return defaults;
	if (Buffer.byteLength(JSON.stringify(value)) > MAX_LOCAL_STATE_BYTES || Object.keys(value).some(key => !Object.hasOwn(defaults, key)) ||
		!Number.isInteger(value.tab) || value.tab < 0 || value.tab > 3 || !Array.isArray(value.selected) || value.selected.length !== 4 ||
		value.selected.some(key => key !== null && (typeof key !== "string" || key.length > 1000)) ||
		!Array.isArray(value.offsets) || value.offsets.length !== 4 || value.offsets.some(offset => !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) ||
		!Array.isArray(value.expanded) || value.expanded.length > 50 || value.expanded.some(key => typeof key !== "string" || key.length > 200) ||
		![true, false].includes(value.detail) || !["list", "detail"].includes(value.focus) || ![true, false].includes(value.help)) throw new Error("Invalid local workbench view state");
	return structuredClone(value);
}

/** Owns only local navigation. No task API, model API, question handler or writer exists here. */
export function createWorkbenchApp(ui, { palette = "nord", colorMode, getRows = () => 40, initialState } = {}) {
	const chosen = selectPalette(palette);
	const view = createWorkbenchView(ui, { palette: chosen.name, colorMode: colorMode ?? chosen.mode, getRows });
	const state = initialLocalState(initialState);
	let snapshot, connection = "disconnected", rows = [], blocks = [];
	function taskRows() {
		const result = snapshot.tasks.rows.filter(task => task.status !== "done").map(task => ({ ...task, key: `task:${task.id}` }));
		const groups = new Map();
		for (const task of snapshot.tasks.rows.filter(task => task.status === "done")) {
			const group = task.group ?? "Ungrouped";
			if (!groups.has(group)) groups.set(group, []);
			groups.get(group).push(task);
		}
		for (const [group, tasks] of groups) {
			const key = `group:${group}`, expanded = state.expanded.includes(key);
			result.push({ key, group: true, title: `${expanded ? "▾" : "▸"} Completed · ${group} · ${tasks.length}`, status: "done" });
			if (expanded) result.push(...tasks.map(task => ({ ...task, key: `task:${task.id}` })));
		}
		return result;
	}
	function agentRows() {
		const counts = new Map();
		return [...snapshot.agents.live, ...snapshot.agents.recent].map(agent => {
			const base = `agent:${agent.toolCallId ?? ""}:${agent.id ?? agent.label}`;
			const duplicate = counts.get(base) ?? 0; counts.set(base, duplicate + 1);
			const status = agent.phase === "completed" && agent.terminated === true ? "done" :
				["preparing", "starting", "running", "stopping"].includes(agent.phase) ? "in_progress" : agent.phase === "unavailable" ? "idle" : "blocked";
			return { ...agent, key: `${base}:${duplicate}`, title: `${agent.role} · ${agent.label}`, status };
		});
	}
	function overview() {
		const context = snapshot.usage.context;
		const contextText = context.status === "estimated" ? `${number(context.tokens)} / ${number(context.capacity)} · ${number(context.percent)}%` :
			context.status === "unsupported" ? "Active provider outside Codex scope" : "Awaiting context reading";
		const counts = snapshot.tasks.rows.reduce((acc, task) => ({ ...acc, [task.status]: (acc[task.status] ?? 0) + 1 }), {});
		return [card(`CONTEXT · ${context.status === "estimated" ? "Estimated" : "Latest reported"}`, [heading(contextText), line("Current context; not quota or cumulative use", "muted")]),
			card("RECORDED SESSION", [heading(`${number(snapshot.usage.total.total)} tokens · ${snapshot.usage.complete ? "all entries" : "INCOMPLETE"}`), line(`Codex subtotal: ${number(snapshot.usage.codexTotal.total)}`), line("Unattributed and unsupported in Usage", "muted")]),
			line(), heading("WORK · active branch"), line(snapshot.tasks.rows.length ? `! Blocked ${counts.blocked ?? 0}   ~ Active ${counts.in_progress ?? 0}` : "No tasks recorded"),
			line(`${counts.pending ?? 0} pending · ${counts.done ?? 0} completed (grouped)`),
			...snapshot.tasks.rows.filter(task => task.status !== "done").slice(0, 2).map(task => line(`${marks[task.status]} ${task.title}`)),
			line(), heading("AGENTS · observations only"), ...snapshot.agents.live.map(agent => line(`${agent.role} · ${agent.label} · ${agent.phase}`)),
			...(snapshot.agents.live.length ? [] : [line("No live agent observations", "muted")]), line("No inferred task ↔ agent linkage", "muted")];
	}
	function listContent() {
		const selected = rows.find(row => row.key === state.selected[state.tab]);
		if (state.detail && state.focus === "detail" && selected && selected.group !== true) {
			const details = state.tab === 1 ? [line(`ID: ${selected.id}`), line(`Group: ${typeof selected.group === "string" ? selected.group : "Ungrouped"}`),
				...(selected.evidence ? [line(`Evidence: ${selected.evidence}`)] : []), ...(selected.reason ? [line(`Reason: ${selected.reason}`)] : [])] :
				[line(`Requested: ${selected.requestedModel ?? "unavailable"}`), line(`Effective: ${selected.effectiveModel ?? "not observed"}`),
					line(`Phase: ${selected.phase} · exit ${selected.terminated === true ? "confirmed" : "not confirmed"}`),
					...(selected.diagnostic ? [line(`Diagnostic: ${selected.diagnostic}`)] : []), line("Runtime completion is NOT parent acceptance.", "muted")];
			return [card(`DETAILS · ${selected.id ?? selected.role}`, [heading(selected.title), line(labels[selected.status]), ...details, line(), line("Read-only · no execution controls", "muted")], state.focus === "detail")];
		}
		return [heading(state.tab === 1 ? "TASKS · blocked → active → pending" : "AGENTS · separate from task acceptance"), line(),
			...(rows.length ? rows.flatMap(row => [{ ...line("", "text", row.key === state.selected[state.tab]), itemKey: row.key, segments: [line(`${row.key === state.selected[state.tab] ? "›" : " "} `), ...(row.group === true ? [line(row.title, "done")] : [line(marks[row.status], statusRoles[row.status]), line(` ${row.title}`)])] },
				...(row.group === true ? [] : [{ ...line(state.tab === 2 ? `    ${row.phase} · exit ${row.terminated === true ? "confirmed" : "not confirmed"}` : `    ${labels[row.status]}${typeof row.group === "string" ? ` · ${row.group}` : " · Enter for details"}`, "muted"), itemKey: row.key }])]) : [line(state.tab === 1 ? "No tasks recorded" : "No agent observations", "muted")]),
			line(), line("Highlight ≠ acceptance · Enter opens details", "muted")];
	}
	function usage() {
		const totals = snapshot.usage;
		const categories = amount => [["Input", amount.input], ["Output", amount.output], ["Cache read", amount.cacheRead], ["Cache write", amount.cacheWrite], ["Total", amount.total]].map(([label, count]) => line(`${label.padEnd(14)} ${number(count)}`));
		return [heading("CODEX · all recorded session entries"), line("Recorded tokens, not billing or quota", "muted"), line(),
			...totals.codex.map(row => card(`openai-codex / ${row.model}`, categories(row.usage))),
			...(totals.codex.length ? [] : [line("No attributed Codex consumption", "muted")]),
			...(totals.overflow.count ? [card(`Other Codex models · ${totals.overflow.count}`, categories(totals.overflow.usage))] : []),
			heading("RECONCILIATION"), line(`Codex subtotal          ${number(totals.codexTotal.total)}`), line(`Unattributed            ${number(totals.unattributed.total)}`),
			line(`Unsupported providers   ${number(totals.unsupported.total)}`), heading(`Native recorded total   ${number(totals.total.total)}`), line(),
			...categories(totals.total), line(), heading("ATTRIBUTION · all providers, not extra tokens"),
			line(`Parent ${number(totals.attribution.parent.total)} · delegated ${number(totals.attribution.delegated.total)} · unattributed ${number(totals.attribution.unattributed.total)}`),
			line(totals.complete ? "Observed accounting is complete." : "! INCOMPLETE · observed amounts may understate consumption.", totals.complete ? "muted" : "active"),
			line("Child details attribute the native aggregate; they are not added again. Reasoning/cache subsets are not extra totals.", "muted")];
	}
	function rebuild() {
		if (snapshot) state.expanded = state.expanded.filter(key => snapshot.tasks.rows.some(task => task.status === "done" && `group:${task.group ?? "Ungrouped"}` === key));
		const previousIndex = Math.max(0, rows.findIndex(row => row.key === state.selected[state.tab]));
		rows = snapshot ? state.tab === 1 ? taskRows() : state.tab === 2 ? agentRows() : [] : [];
		if (rows.length && !rows.some(row => row.key === state.selected[state.tab])) {
			if (state.selected[state.tab] !== null) state.detail = false;
			state.selected[state.tab] = rows[Math.min(previousIndex, rows.length - 1)].key;
		}
		if (snapshot && (!state.detail || !rows.some(row => row.key === state.selected[state.tab] && row.group !== true))) {
			state.detail = false; state.focus = "list";
		}
		const warnings = connection !== "live" ? [line(`! ${connection.toUpperCase()} · ${connection === "stale" ? "last sample is not live" : "source unavailable; reopen deliberately"}`, "active"), line()] : [];
		if (snapshot && !snapshot.tasks.bindingCurrent) warnings.push(line("! Plan binding is stale or unavailable", "active"));
		if (snapshot?.agents.launchBlocked) warnings.push(line("! Unconfirmed child exit · new launches blocked", "active"));
		if (snapshot?.agents.historyLimited || snapshot?.agents.nestedHistoryUnavailable) warnings.push(line("Agent history is limited; nested detail may be unavailable", "muted"));
		blocks = state.help ? [card("LOCAL HELP", ["1–4  Overview / Tasks / Agents / Usage", "↑↓   Move list focus", "Enter  Details / expand completed group", "Tab    List / detail focus", "PgUp / PgDn  Scroll", "Esc    Back / dismiss help", "?      Help     q  Close view", "Pi remains authoritative. No questions or execution controls."].map(text => line(text)))] :
			[...warnings, ...(snapshot ? state.tab === 0 ? overview() : state.tab === 3 ? usage() : listContent() : [line("No source sample available", "muted")])];
		view.setModel({ tab: state.tab, subtitle: snapshot ? `${basename(snapshot.publisher.project)} / ${snapshot.publisher.session.slice(0, 12)} · ${connection}` : `Awaiting source · ${connection}`,
			blocks, hints: state.detail && state.focus === "detail" ? "Tab list · PgUp/PgDn scroll · Esc back" : state.detail ? "↑↓ rows · Tab details · Enter details" : "1–4 tabs · ↑↓ rows · Enter details" });
	}
	function handleInput(data) {
		if (data === "q" || ui.matchesKey(data, "ctrl+c")) return "quit";
		if (ui.matchesKey(data, "pageDown") || ui.matchesKey(data, "pageUp")) {
			view.scroll.scrollBy((ui.matchesKey(data, "pageDown") ? 1 : -1) * Math.max(1, view.scroll.viewportHeight - 1)); return;
		}
		if (data === "?") state.help = !state.help;
		else if (ui.matchesKey(data, "escape")) { state.help = state.detail = false; state.focus = "list"; view.scroll.scrollToStart(); }
		else if (/^[1-4]$/.test(data)) {
			state.offsets[state.tab] = view.scroll.scrollTop; state.tab = Number(data) - 1; state.detail = false; state.focus = "list"; state.help = false;
			view.restoreScroll(state.offsets[state.tab]);
		} else if (ui.matchesKey(data, "tab") && state.detail) {
			state.focus = state.focus === "list" ? "detail" : "list";
			if (state.focus === "list") view.ensureVisible(state.selected[state.tab]);
			else view.restoreScroll(0);
		} else if (ui.matchesKey(data, "enter") && rows.length) {
			const selected = rows.find(row => row.key === state.selected[state.tab]);
			if (selected?.group === true) state.expanded = state.expanded.includes(selected.key) ? state.expanded.filter(key => key !== selected.key) : [...state.expanded, selected.key];
			else { state.detail = true; state.focus = "detail"; }
			view.restoreScroll(0);
		} else if (ui.matchesKey(data, "down") || ui.matchesKey(data, "up")) {
			const direction = ui.matchesKey(data, "down") ? 1 : -1;
			if (state.help || (state.detail && state.focus === "detail") || !rows.length) { view.scroll.scrollBy(direction); return; }
			const index = Math.max(0, Math.min(rows.length - 1, rows.findIndex(row => row.key === state.selected[state.tab]) + direction));
			state.selected[state.tab] = rows[index].key;
			view.ensureVisible(rows[index].key);
		}
		rebuild();
	}
	rebuild(); view.restoreScroll(state.offsets[state.tab]);
	return { state, root: view.root, scroll: view.scroll, renderDocument: view.renderDocument, handleInput,
		exportState() { state.offsets[state.tab] = view.scroll.scrollTop; return initialLocalState(state); },
		update(result) {
			try {
				if (!["live", "stale", "disconnected", "error"].includes(result.status)) throw new Error("Invalid transport state");
				connection = result.status;
				if (result.snapshot) {
					const next = validateWorkbenchSnapshot(result.snapshot);
					if (snapshot && (snapshot.publisher.instance !== next.publisher.instance || snapshot.publisher.session !== next.publisher.session)) connection = "disconnected";
					else if (snapshot && (snapshot.publisher.sequence > next.publisher.sequence || snapshot.publisher.generation > next.publisher.generation)) connection = "error";
					else snapshot = structuredClone(next);
				}
			} catch { connection = "error"; }
			rebuild();
		},
	};
}
