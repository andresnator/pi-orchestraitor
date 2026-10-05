import { createPaint } from "./palette.mjs";
export const TABS = ["Overview", "Tasks", "Agents", "Usage"];
export const MINIMUM = { chatColumns: 80, panelColumns: 48, chatRows: 12, panelRows: 10, separator: 3 };
export function placement(columns, rows) {
	if (columns >= MINIMUM.chatColumns + MINIMUM.panelColumns + MINIMUM.separator && rows >= MINIMUM.chatRows) return "right";
	if (columns >= MINIMUM.chatColumns && rows >= MINIMUM.chatRows + MINIMUM.panelRows + MINIMUM.separator) return "down";
	return "unavailable";
}

/** Native standalone components. Input data is already validated and projected by app. */
export function createWorkbenchView(ui, { palette, colorMode, getRows }) {
	const paint = createPaint(ui, palette, colorMode);
	let model = { tab: 0, subtitle: "Awaiting source", blocks: [], hints: "? help · q close" };
	let cached, cachedWidth, cachedHeight, pendingScroll, pendingSelection;
	const positions = new Map();
	const fit = (text, width, role = "text", focus = false) => {
		const clipped = ui.truncateToWidth(text, width, "…");
		return paint(clipped + " ".repeat(Math.max(0, width - ui.visibleWidth(clipped))), role, focus);
	};
	function card(block, width) {
		const box = new ui.Box(1, 0, value => paint(value));
		for (const row of block.lines) box.addChild(new ui.Text(paint(row.text, row.role, row.focused), 0, 0));
		const role = block.focused ? "accent" : "muted";
		const label = ui.truncateToWidth(` ${block.title} `, Math.max(1, width - 2), "…");
		return [paint(`╭${label}${"─".repeat(Math.max(0, width - 2 - ui.visibleWidth(label)))}╮`, role),
			...box.render(width - 2).map(row => paint("│", role) + row + paint("│", role)), paint(`╰${"─".repeat(Math.max(0, width - 2))}╯`, role)];
	}
	const blockText = block => block.segments ? block.segments.map(segment => paint(segment.text, segment.role, block.focused)).join("") : paint(block.text, block.role);
	const header = { invalidate() {}, render: width => [fit("ORCHESTRAITOR · READ-ONLY", width, "accent"), fit(model.subtitle, width, "muted")] };
	const tabs = { invalidate() {}, render: width => [ui.truncateToWidth(TABS.map((label, index) => paint(`${index + 1} ${label}`, index === model.tab ? "accent" : "muted", index === model.tab, index === model.tab)).join("  "), width, "…")] };
	const body = {
		invalidate() { cached = undefined; },
		render(width) {
			if (!cached || cachedWidth !== width || cachedHeight !== getRows()) {
				const tooSmall = width < MINIMUM.panelColumns - 1 || getRows() < MINIMUM.panelRows;
				const blocks = tooSmall ? [{ text: "Too small · keep Pi usable. Use native Pi panels; this view needs 48 columns × 10 rows.", role: "muted" }] : model.blocks;
				cached = []; positions.clear();
				for (const block of blocks) {
					const start = cached.length;
					const rendered = block.lines ? card(block, width) : block.focused ? [fit(blockText(block), width, block.role, true)] : ui.wrapTextWithAnsi(blockText(block), Math.max(1, width));
					cached.push(...rendered.map(row => ui.truncateToWidth(row, width, "…")));
					if (block.itemKey) positions.set(block.itemKey, { start: positions.get(block.itemKey)?.start ?? start, end: cached.length });
				}
				cachedWidth = width; cachedHeight = getRows();
			}
			if (pendingScroll !== undefined) {
				scroll.updateLayout(cached.length, Math.max(1, getRows() - 5), () => {});
				scroll.scrollTo(pendingScroll); pendingScroll = undefined;
			}
			if (pendingSelection !== undefined) {
				scroll.updateLayout(cached.length, Math.max(1, getRows() - 5), () => {});
				const position = positions.get(pendingSelection);
				if (position) {
					if (position.start < scroll.scrollTop || position.end - position.start > scroll.viewportHeight) scroll.scrollTo(position.start);
					else if (position.end > scroll.scrollTop + scroll.viewportHeight) scroll.scrollTo(position.end - scroll.viewportHeight);
				}
				pendingSelection = undefined;
			}
			return cached;
		},
	};
	// A persistent native scrollbar avoids background hide timers during teardown.
	const scroll = new ui.ScrollView(body, { follow: "none", primary: true, scrollbar: "always" });
	const footer = { invalidate() {}, render: width => [fit(model.hints, width, "accent"), fit("? help · q close · no execution controls", width, "muted")] };
	const root = new ui.VStack([{ component: header, basis: 2, shrink: 0 }, { component: tabs, basis: 1, shrink: 0 },
		{ component: scroll, basis: 0, grow: 1, minSize: 1 }, { component: footer, basis: 2, shrink: 0 }]);
	return { root, scroll,
		setModel(next) { model = next; body.invalidate(); },
		restoreScroll(offset) { pendingScroll = offset; pendingSelection = undefined; },
		// Resolve after wrapping at the actual content width, including the scrollbar.
		ensureVisible(key) { pendingSelection = key; pendingScroll = undefined; },
		renderDocument(width) { return [...header.render(width), ...tabs.render(width), ...body.render(width), ...footer.render(width)].map(row => ui.truncateToWidth(row, width, "…")); },
	};
}
