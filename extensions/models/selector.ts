import type { ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter, Input, ScrollView, SelectList, Text, truncateToWidth, type TUI } from "@earendil-works/pi-tui";

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
