import type { ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter, Input, ScrollView, SelectList, Text, truncateToWidth, visibleWidth, type TUI } from "@earendil-works/pi-tui";

/** RPC retains its native dialogs; terminal menus share Pi's native fuzzy search. */
export async function selectProfileOption(ctx: ExtensionContext, title: string, options: string[], searchText?: Record<string, string>) {
	if (ctx.mode !== "tui") return ctx.ui.select(title, options);
	return ctx.ui.custom<string | undefined>((tui, theme, keys, done) =>
		createSearchableSelector(title, options, tui, theme, keys, done, searchText));
}

export function createSearchableSelector(title: string, options: string[], tui: TUI, theme: Theme, keys: KeybindingsManager,
	done: (value: string | undefined) => void, searchText: Record<string, string> = {}) {
	const input = new Input();
	const heading = new Text(theme.bold(theme.fg("accent", title)), 0, 0);
	const headingScroll = new ScrollView(heading, { scrollbar: "hidden", follow: "none" });
	const items = options.map(value => ({ value, label: value }));
	let filtered = items;
	let list: SelectList;
	let maxVisible = 10;
	let focused = false;
	let finished = false;
	let disposed = false;
	const finish = (value: string | undefined) => {
		if (finished || disposed) return;
		finished = true;
		input.focused = false;
		done(value);
	};
	function buildList(selected?: string) {
		list = new SelectList(filtered, maxVisible, {
			selectedPrefix: value => theme.fg("accent", value), selectedText: value => theme.fg("accent", value),
			description: value => theme.fg("muted", value), scrollInfo: value => theme.fg("dim", value), noMatch: value => theme.fg("warning", value),
		});
		const index = filtered.findIndex(item => item.value === selected);
		if (index >= 0) list.setSelectedIndex(index);
		list.onSelect = item => finish(item.value);
		list.onCancel = () => finish(undefined);
	}
	const filter = () => {
		const query = input.getValue();
		filtered = query ? fuzzyFilter(items, query, item => searchText[item.value] ?? item.label) : items;
		buildList();
	};
	input.onSubmit = () => { const selected = list.getSelectedItem(); if (selected) finish(selected.value); };
	buildList();
	return {
		get focused() { return focused; },
		set focused(value: boolean) { focused = value; input.focused = value && !finished && !disposed; },
		dispose() { disposed = true; input.focused = false; },
		invalidate() { input.invalidate(); list.invalidate(); heading.invalidate(); headingScroll.invalidate(); },
		handleInput(data: string) {
			if (finished || disposed) return;
			if (keys.matches(data, "tui.select.cancel") || keys.matches(data, "app.interrupt")) finish(undefined);
			else if (keys.matches(data, "tui.select.confirm")) {
				const selected = list.getSelectedItem();
				if (selected) finish(selected.value);
			}
			else if (keys.matches(data, "tui.select.up") || keys.matches(data, "tui.select.down")) list.handleInput(data);
			else if (keys.matches(data, "tui.select.pageUp")) headingScroll.scrollBy(-Math.max(1, headingScroll.viewportHeight));
			else if (keys.matches(data, "tui.select.pageDown")) headingScroll.scrollBy(Math.max(1, headingScroll.viewportHeight));
			else {
				const previous = input.getValue();
				input.handleInput(data);
				if (input.getValue() !== previous) filter();
			}
			tui.requestRender();
		},
		render(width: number) {
			const budget = Math.max(5, tui.terminal.rows - 6);
			const compact = budget < 10;
			const titleLines = headingScroll.render(width);
			const titleHeight = Math.min(titleLines.length, Math.max(1, Math.min(3, Math.floor((budget - 3) / 3))));
			headingScroll.updateLayout(titleLines.length, titleHeight, () => tui.requestRender());
			const nextMax = Math.max(1, Math.min(10, budget - titleHeight - (compact ? 3 : 6)));
			if (nextMax !== maxVisible) { maxVisible = nextMax; buildList(list.getSelectedItem()?.value); }
			const hint = (action: Parameters<KeybindingsManager["getKeys"]>[0], fallback: string) => keys.getKeys(action).join("/") || fallback;
			const help = `Type to filter · ↑↓ navigate · ${hint("tui.select.confirm", "enter")} select · ${hint("tui.select.cancel", "esc")} back${titleLines.length > titleHeight ? " · PgUp/PgDn details" : ""}`;
			const spacer = compact ? [] : [""];
			const choices = filtered.length ? list.render(width) : [theme.fg("warning", "No matches")];
			return [...titleLines.slice(headingScroll.scrollTop, headingScroll.scrollTop + titleHeight), ...spacer,
				...input.render(width), ...spacer, ...choices, ...spacer, theme.fg("dim", help)].map(line => truncateToWidth(line, width));
		},
	};
}

type Timeout = number | "off";
export interface AssignmentValue { model: string | null; reasoning: string | null; mode?: string | null; timeout?: Timeout | null; parallel?: number | null }
export interface AssignmentRequest {
	role: string; current: AssignmentValue; inherited: { model?: string; reasoning?: string; mode?: string; timeout?: Timeout; parallel?: number };
	catalog: { provider: string; id: string; name?: string }[]; supported: (model: any) => string[]; modes: string[];
	/** Deadline and parallelism choices; empty or absent for the session, which has neither. */
	timeouts?: Timeout[]; limits?: number[];
}

/** Model, effort, mode, deadline and parallelism chosen together, so a role takes one step instead of one menu per field. */
export function pickProfileAssignment(ctx: ExtensionContext, request: AssignmentRequest) {
	return ctx.ui.custom<AssignmentValue | undefined>((tui, theme, keys, done) => createAssignmentPicker(request, tui, theme, keys, done));
}

type Column = "model" | "effort" | "mode" | "timeout" | "max";
type Choice = string | number | null;
const FIELD = { model: "model", effort: "reasoning", mode: "mode", timeout: "timeout", max: "parallel" } as const;
/** Deadlines read as minutes or "no limit"; parallelism as a count. */
const formatChoice = (column: Column, value: Choice) => column === "timeout" ? (value === "off" ? "no limit" : `${value}m`) : column === "max" ? `max ${value}` : String(value);
export function createAssignmentPicker(request: AssignmentRequest, tui: TUI, theme: Theme, keys: KeybindingsManager,
	done: (value: AssignmentValue | undefined) => void) {
	const { role, current, inherited, catalog, supported, modes, timeouts = [], limits = [] } = request;
	const keep = role === "session" ? "keep current" : "inherit";
	const id = (model: { provider: string; id: string }) => `${model.provider}/${model.id}`;
	const providers = ["all", ...new Set(catalog.map(model => model.provider))];
	const columns: Column[] = ["model", "effort", ...(modes.length > 1 ? ["mode" as const] : []), ...(timeouts.length ? ["timeout" as const] : []), ...(limits.length ? ["max" as const] : [])];
	const input = new Input();
	const selected: AssignmentValue = { model: current.model ?? null, reasoning: current.reasoning ?? null, mode: current.mode ?? null, timeout: current.timeout ?? null, parallel: current.parallel ?? null };
	const value = (column: Column): Choice => selected[FIELD[column]] ?? null;
	let focus = 0, provider = 0, focused = false, finished = false;
	const offsets: number[] = [];
	const finish = (value: AssignmentValue | undefined) => {
		if (finished) return;
		finished = true; input.focused = false;
		done(value);
	};
	const modelItems = () => {
		const query = input.getValue();
		const shown = catalog.filter(model => provider === 0 || model.provider === providers[provider]);
		const matched = query ? fuzzyFilter(shown, query, model => `${model.provider} ${id(model)} ${model.id} ${model.name ?? ""}`) : shown;
		return [...(query ? [] : [null]), ...matched.map(id)];
	};
	const effortItems = () => {
		const model = catalog.find(item => id(item) === (selected.model ?? inherited.model));
		return [null, ...(model ? supported(model) : [])];
	};
	const items = (column: Column): Choice[] => column === "model" ? modelItems() : column === "effort" ? effortItems() : column === "mode" ? [null, ...modes]
		: column === "timeout" ? [null, ...timeouts] : [null, ...limits];
	// An effort the newly chosen model lacks moves to its nearest supported level instead of failing at apply.
	const fitEffort = () => {
		const levels = effortItems().filter((level): level is string => level !== null);
		if (selected.reasoning === null || levels.includes(selected.reasoning)) return;
		const order = ["off", "minimal", "low", "medium", "high", "xhigh", "max"], wanted = order.indexOf(selected.reasoning);
		selected.reasoning = levels.reduce<string | null>((best, level) => best === null || Math.abs(order.indexOf(level) - wanted) < Math.abs(order.indexOf(best) - wanted) ? level : best, null);
	};
	const move = (delta: number) => {
		const column = columns[focus], list = items(column);
		if (!list.length) return;
		const index = list.indexOf(value(column));
		const next = list[((index < 0 ? 0 : index + delta) % list.length + list.length) % list.length];
		(selected as Record<string, Choice>)[FIELD[column]] = next;
		if (column === "model") fitEffort();
	};
	const filter = () => {
		const list = modelItems();
		// A search with no matches keeps the previous choice, so clearing it cannot silently become inherit.
		if (list.length && !list.includes(selected.model)) { selected.model = list[0]; fitEffort(); }
	};
	const label = (column: Column, choice: Choice) => {
		if (choice !== null) return formatChoice(column, choice);
		const fallback = inherited[FIELD[column]];
		return `${keep}${fallback !== undefined && fallback !== null ? ` (${column === "max" ? fallback : formatChoice(column, fallback)})` : ""}`;
	};
	const summary = () => [label("model", selected.model), label("effort", selected.reasoning), ...(modes.length > 1 ? [label("mode", selected.mode ?? null)] : modes.length ? [`mode ${modes[0]} (required)`] : []),
		...(timeouts.length ? [label("timeout", value("timeout"))] : []), ...(limits.length ? [label("max", value("max"))] : [])];
	return {
		get focused() { return focused; },
		set focused(value: boolean) { focused = value; input.focused = value && !finished && columns[focus] === "model"; },
		dispose() { finished = true; input.focused = false; },
		invalidate() { input.invalidate(); },
		handleInput(data: string) {
			if (finished) return;
			if (keys.matches(data, "tui.select.cancel") || keys.matches(data, "app.interrupt")) finish(undefined);
			else if (keys.matches(data, "tui.select.confirm")) {
				if (modelItems().length) finish({ model: selected.model, reasoning: selected.reasoning, ...(modes.length > 1 ? { mode: selected.mode } : {}),
					...(timeouts.length ? { timeout: selected.timeout } : {}), ...(limits.length ? { parallel: selected.parallel } : {}) });
			}
			else if (keys.matches(data, "tui.select.up")) move(-1);
			else if (keys.matches(data, "tui.select.down")) move(1);
			else if (keys.matches(data, "tui.editor.cursorLeft")) focus = Math.max(0, focus - 1);
			else if (keys.matches(data, "tui.editor.cursorRight")) focus = Math.min(columns.length - 1, focus + 1);
			else if (keys.matches(data, "tui.input.tab")) { provider = (provider + 1) % providers.length; filter(); }
			else {
				// Typing anywhere searches models, as in Pi's /model selector.
				focus = 0;
				const previous = input.getValue();
				input.handleInput(data);
				if (input.getValue() !== previous) filter();
			}
			input.focused = focused && !finished && columns[focus] === "model";
			tui.requestRender();
		},
		render(width: number) {
			const budget = Math.max(8, tui.terminal.rows - 6);
			const title = theme.bold(theme.fg("accent", `${role === "session" ? "★ session" : role} · ${columns.join(" + ")}`));
			const chips = providers.map((name, i) => i === provider ? theme.fg("accent", `[${name}]`) : theme.fg("muted", name)).join(" ");
			const head = (column: Column, i: number) => i === focus ? theme.bold(theme.fg("accent", `${i + 1} ${column.toUpperCase()}`)) : theme.fg("dim", `${i + 1} ${column.toUpperCase()}`);
			const row = (column: Column, choice: Choice, i: number) => {
				const on = choice === value(column);
				const text = `${on ? (i === focus ? "› " : "● ") : "  "}${label(column, choice)}`;
				return on && i === focus ? theme.fg("accent", text) : on ? text : theme.fg(choice === null ? "dim" : "muted", text);
			};
			const compact = budget < 14;
			// The result wraps onto a second line rather than hiding the last choices on narrow terminals.
			const [first, ...rest] = summary(), result = [`result ${first}`];
			for (const part of rest) {
				if (result.length === 2 || visibleWidth(`${result.at(-1)} · ${part}`) <= width) result[result.length - 1] += ` · ${part}`;
				else result.push(`       ${part}`);
			}
			const listHeight = Math.max(1, budget - (compact ? 6 : 8) - (result.length - 1));
			// Deadline and parallelism columns are narrow; with them, effort and mode give up some width to the model list.
			const extended = columns.length > 3;
			const sideWidth = Math.min(26, Math.floor(width / 4));
			const widthOf = (column: Column) => column === "timeout" ? 16 : column === "max" ? 13 : extended ? Math.min(sideWidth, column === "mode" ? 22 : 18) : sideWidth;
			const modelWidth = width - columns.slice(1).reduce((total, column) => total + widthOf(column) + 2, 0);
			const side = width >= 72 && modelWidth >= 20;
			const pad = (text: string, size: number) => { const cut = truncateToWidth(text, size); return cut + " ".repeat(Math.max(0, size - visibleWidth(cut))); };
			// Each column scrolls on its own so its selected value stays visible.
			const visible = (column: Column, i: number) => {
				const list = items(column), cursor = Math.max(0, list.indexOf(value(column)));
				offsets[i] = Math.min(Math.max(offsets[i] ?? 0, cursor - listHeight + 1), cursor, Math.max(0, list.length - listHeight));
				const lines = list.slice(offsets[i], offsets[i] + listHeight).map(value => row(column, value, i));
				return column === "model" && !list.length ? [theme.fg("warning", "No matches")] : lines;
			};
			const body: string[] = [];
			if (side) {
				const blocks = columns.map((column, i) => [head(column, i), ...visible(column, i)]);
				const height = Math.max(...blocks.map(lines => lines.length));
				for (let line = 0; line < height; line++) body.push(blocks.map((lines, i) => pad(lines[line] ?? "", i === 0 ? modelWidth : widthOf(columns[i]))).join("  "));
			} else body.push(columns.map(head).join("  "), ...visible(columns[focus], focus));
			const spacer = compact ? [] : [""];
			const help = `type search · ↑↓ option · ←→ column · tab provider · ${keys.getKeys("tui.select.confirm").join("/") || "enter"} confirm · ${keys.getKeys("tui.select.cancel").join("/") || "esc"} cancel`;
			return [title, theme.fg("muted", "provider ") + chips, ...input.render(width), ...spacer, ...body, ...spacer,
				theme.fg("muted", "result ") + result[0].slice("result ".length), ...result.slice(1), theme.fg("dim", help)].map(line => truncateToWidth(line, width));
		},
	};
}
