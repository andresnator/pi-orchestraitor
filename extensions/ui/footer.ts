import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { sanitizeDisplay } from "./display.ts";

const BAR_CELLS = 8;
const GAP = "  ";
const WARNING_PERCENT = 70;
const ERROR_PERCENT = 90;
// Narrow terminals drop detail in this order before the line is truncated.
const DROP_ORDER = ["tokens", "provider", "bar", "effort"] as const;

type Detail = typeof DROP_ORDER[number];
type ThinkingLevel = Parameters<Theme["getThinkingBorderColor"]>[0];
export type TokenTotals = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
export type FooterView = {
	cwd: string;
	branch?: string | null;
	sessionName?: string;
	tokens: TokenTotals;
	cacheHitRate?: number;
	context: { percent: number | null; window: number; autoCompact: boolean };
	model?: { provider: string; name: string; reasoning: boolean };
	thinkingLevel: ThinkingLevel;
	statuses: ReadonlyMap<string, string>;
};
export type FooterTheme = Pick<Theme, "fg" | "bold"> & Partial<Pick<Theme, "getThinkingBorderColor">>;

/** Project on top; context bar, compact totals and provider/model/effort below; extension statuses last. */
export function renderFooter(view: FooterView, width: number, theme: FooterTheme): string[] {
	const lines = [fit(projectLine(view, theme), width, theme), metricsLine(view, width, theme)];
	if (view.statuses.size) {
		const statuses = [...view.statuses].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => clean(text));
		lines.push(fit(statuses.join(" "), width, theme));
	}
	return lines;
}

export function formatTokens(count: number): string {
	if (count < 1000) return `${count}`;
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

function projectLine(view: FooterView, theme: FooterTheme): string {
	const cwd = clean(view.cwd);
	const split = cwd.lastIndexOf("/") + 1;
	let line = theme.fg("dim", cwd.slice(0, split)) + theme.bold(theme.fg("accent", cwd.slice(split)));
	if (view.branch) line += theme.fg("muted", ` (${clean(view.branch)})`);
	if (view.sessionName) line += theme.fg("dim", ` • ${clean(view.sessionName)}`);
	return line;
}

function metricsLine(view: FooterView, width: number, theme: FooterTheme): string {
	let line = "";
	for (let dropped = 0; dropped <= DROP_ORDER.length; dropped++) {
		const hidden = new Set<Detail>(DROP_ORDER.slice(0, dropped));
		const left = leftSegments(view, hidden, theme).join(GAP);
		const right = rightSegments(view, hidden, theme).join(GAP);
		line = left + GAP + right;
		const padding = width - visibleWidth(left) - visibleWidth(right);
		if (padding >= GAP.length) return left + " ".repeat(padding) + right;
	}
	return fit(line, width, theme);
}

function leftSegments(view: FooterView, hidden: Set<Detail>, theme: FooterTheme): string[] {
	const context = contextSegment(view, theme);
	const segments = [hidden.has("bar") ? context : `${bar(view.context.percent ?? 0, theme)} ${context}`];
	if (!hidden.has("tokens")) segments.push(tokenSegment(view, theme));
	return segments.filter(Boolean);
}

function contextSegment(view: FooterView, theme: FooterTheme): string {
	const { percent, window, autoCompact } = view.context;
	const value = `${percent === null ? "?" : `${percent.toFixed(1)}%`}/${formatTokens(window)}`;
	const color = percent !== null && percent > WARNING_PERCENT ? level(percent) : "muted";
	return theme.fg("dim", "ctx ") + theme.fg(color, value) + (autoCompact ? theme.fg("dim", " (auto)") : "");
}

function tokenSegment(view: FooterView, theme: FooterTheme): string {
	const { input, output, cacheRead, cacheWrite, cost } = view.tokens;
	const parts: string[] = [];
	if (input) parts.push(`↑${formatTokens(input)}`);
	if (output) parts.push(`↓${formatTokens(output)}`);
	if ((cacheRead || cacheWrite) && view.cacheHitRate !== undefined) parts.push(`CH${view.cacheHitRate.toFixed(0)}%`);
	if (cost > 0) parts.push(`$${cost.toFixed(3)}`);
	return parts.length ? theme.fg("dim", parts.join(" ")) : "";
}

function rightSegments(view: FooterView, hidden: Set<Detail>, theme: FooterTheme): string[] {
	if (!view.model) return [theme.fg("dim", "no model")];
	const name = theme.fg("accent", clean(view.model.name));
	const segments = [hidden.has("provider") ? name : theme.fg("muted", `${clean(view.model.provider)} · `) + name];
	if (view.model.reasoning && !hidden.has("effort")) segments.push(effort(view.thinkingLevel, theme));
	return segments;
}

function effort(level: ThinkingLevel, theme: FooterTheme): string {
	const text = `effort:${level}`;
	// Pi colors the editor border by thinking level; plain themes lack that mapping.
	return theme.getThinkingBorderColor ? theme.getThinkingBorderColor(level)(text) : theme.fg("warning", text);
}

function bar(percent: number, theme: FooterTheme): string {
	const filled = Math.round(Math.min(100, Math.max(0, percent)) / 100 * BAR_CELLS);
	return theme.fg(level(percent), "━".repeat(filled)) + theme.fg("dim", "─".repeat(BAR_CELLS - filled));
}

function level(percent: number): ThemeColor {
	if (percent > ERROR_PERCENT) return "error";
	if (percent > WARNING_PERCENT) return "warning";
	return "success";
}

const clean = (text: string) => sanitizeDisplay(text).replace(/\s+/gu, " ").trim();
const fit = (text: string, width: number, theme: FooterTheme) => truncateToWidth(text, Math.max(0, width), theme.fg("dim", "…"));
