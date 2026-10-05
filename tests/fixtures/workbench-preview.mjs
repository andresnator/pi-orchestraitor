// Group 1 only: fictional visual fixture, never a publisher or an execution surface.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findHostRoot } from "../../scripts/pi-host.mjs";

const requireHost = createRequire(join(await findHostRoot(), "package.json"));
const ui = await import(pathToFileURL(requireHost.resolve("@earendil-works/pi-tui")).href);
const { Box, Input, ProcessTerminal, ScrollView, Spacer, Text, TuiAltScreen, VStack,
	matchesKey, parseColor, styleText, truncateToWidth, visibleWidth, wrapTextWithAnsi } = ui;

export const MINIMUM = { chatColumns: 80, panelColumns: 48, chatRows: 12, panelRows: 10, separator: 3 };
export const TABS = ["Overview", "Tasks", "Agents", "Usage"];
export const SCENARIOS = ["populated", "unknown", "stale", "empty", "disconnected", "unsupported"];
// Independently composed preset using Nord color values; see G1 design.md for provenance.
export const PALETTES = {
	nord: { background: "#2e3440", text: "#eceff4", muted: "#b7c0ce", focus: "#40505d", accent: "#88c0d0", active: "#ebcb8b", blocked: "#bf616a", done: "#8fbcbb", idle: "#a3be8c" },
	light: { background: "#ffffff", text: "#202939", muted: "#526071", focus: "#dcebf4", accent: "#005b78", active: "#795100", blocked: "#a12636", done: "#006963", idle: "#346520" },
	mono: {},
};
const TASKS = [
	{ id: "T1", status: "blocked", title: "Confirm read-only boundary", group: "Contract", note: "Reason: waiting for explicit design approval. No execution is enabled by this preview." },
	{ id: "T2", status: "active", title: "Inspect Unicode layout · café 日本語", group: "Presentation", note: "Assignment: verify long labels and narrow layouts. Evidence has not been accepted." },
	{ id: "T3", status: "pending", title: "Reconcile recorded model totals", group: "Accounting", note: "All-entry native accounting; never add child totals twice." },
	{ id: "T4", status: "done", title: "Describe fixture scope", group: "Design", note: "Evidence: fictional example only; not a claim about this repository." },
	{ id: "T5", status: "done", title: "Record source boundaries", group: "Design", note: "Evidence: fictional example only. Stale plan binding: hash differs." },
];
const AGENTS = [
	{ id: "A1", status: "active", title: "explore · Inspect renderer", note: "Requested: openai-codex/gpt-5.4\nEffective: not yet observed\nPhase: running · exit not confirmed" },
	{ id: "A2", status: "done", title: "review · Check boundaries", note: "Requested: openai-codex/gpt-5.4\nEffective: openai-codex/gpt-5.4\nPhase: completed · exit confirmed (0)\nRuntime completion is NOT parent acceptance." },
	{ id: "A3", status: "blocked", title: "review · Inspect error case", note: "Requested: openai-codex/gpt-5.4\nEffective: unavailable\nPhase: failed · exit confirmed (1)\nDiagnostic: fictional host-resolution failure." },
	{ id: "A4", status: "idle", title: "explore · Idle observation", note: "Phase: idle · no completion evidence.\nIdle is not a completed task." },
];
const MARKS = { blocked: "!", active: "~", pending: "·", done: "✓", idle: "○" };
const LABELS = { blocked: "Blocked", active: "Active", pending: "Pending", done: "Completed", idle: "Idle" };
const QUESTION_OPTIONS = ["Keep the companion read-only", "Revisit the visual design"];
const QUESTION_MODES = ["single", "multiple", "text", "review"];

export function placement(columns, rows) {
	if (columns >= MINIMUM.chatColumns + MINIMUM.panelColumns + MINIMUM.separator && rows >= MINIMUM.chatRows) return "right";
	if (columns >= MINIMUM.chatColumns && rows >= MINIMUM.chatRows + MINIMUM.panelRows + MINIMUM.separator) return "down";
	return "unavailable";
}

export function createPreview({ palette = "nord", questions = false, scenario = "populated", getRows = () => 40 } = {}) {
	assert.ok(Object.hasOwn(PALETTES, palette), "Unknown preview palette");
	assert.ok(SCENARIOS.includes(scenario), "Unknown fictional scenario");
	const colors = Object.fromEntries(Object.entries(PALETTES[palette]).map(([key, value]) => [key, parseColor(value)]));
	const state = { tab: 0, selected: 0, completed: false, detail: false, focus: "list", help: false,
		scenario, questionMode: "single", answer: new Set(), questionFocus: 0, warning: false, editing: false, reviewed: false };
	const input = new Input();
	input.setValue("");
	const paint = (text, role = "text", focused = false, bold = false) => palette === "mono"
		? text : styleText(text, { fg: colors[role] ?? colors.text, bg: focused ? colors.focus : colors.background, bold }, "truecolor");
	const line = (text, width, role = "text", focus = false) => {
		const clipped = truncateToWidth(text, width, "…");
		return paint(clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped))), role, focus);
	};
	const status = (value) => paint(MARKS[value], value === "pending" ? "muted" : value) + paint(` ${LABELS[value]}`);
	const heading = (text) => paint(text, "accent", false, true);
	const card = (title, content, width, focused = false) => {
		const inner = Math.max(1, width - 4);
		const box = new Box(1, 0, text => paint(text));
		for (const text of content) box.addChild(text ? new Text(text, 0, 0) : new Spacer(1));
		const borderRole = focused ? "accent" : "muted";
		const label = truncateToWidth(` ${title} `, Math.max(1, width - 2), "…");
		return [paint(`╭${label}${"─".repeat(Math.max(0, width - 2 - visibleWidth(label)))}╮`, borderRole),
			...box.render(inner + 2).map(text => paint("│", borderRole) + text + paint("│", borderRole)),
			paint(`╰${"─".repeat(Math.max(0, width - 2))}╯`, borderRole)];
	};
	const rows = () => state.tab === 2 ? AGENTS : [
		...TASKS.filter(task => task.status !== "done"),
		{ id: "completed", title: `${state.completed ? "▾" : "▸"} Completed · 2`, status: "done" },
		...(state.completed ? TASKS.filter(task => task.status === "done") : []),
	];
	const selectedRow = () => rows()[Math.min(state.selected, rows().length - 1)];
	const wrapped = (text, width) => wrapTextWithAnsi(text, Math.max(1, width));

	function overview(width) {
		const context = state.scenario === "unknown" ? "Awaiting context reading"
			: state.scenario === "unsupported" ? "Active provider outside Codex scope"
			: state.scenario === "empty" ? "Awaiting context reading" : "70,000 / 200,000 · 35%";
		const total = state.scenario === "empty" ? "0 tokens · recorded zero" : "131,072 tokens · all entries";
		return [
			...card("CONTEXT · Estimated", [heading(context), paint("Latest reported reading; not a quota", "muted")], width),
			...card("RECORDED SESSION", [heading(total), paint("Codex subtotal: " + (state.scenario === "empty" ? "0" : "120,000")), paint("Unattributed and unsupported in Usage", "muted")], width),
			"", heading("WORK · active branch"),
			...(state.scenario === "empty" ? [paint("No tasks recorded", "muted")] : [status("blocked") + paint("  1   ") + status("active") + paint("  1"), paint("1 pending · 2 completed (collapsed)"), paint("! Confirm read-only boundary")]),
			"", heading("AGENTS · observations only"),
			...(state.scenario === "empty" ? [paint("No agent observations", "muted")] : [status("active") + paint("  explore · Inspect renderer"), paint("No inferred task ↔ agent linkage", "muted")]),
		];
	}

	function listContent(width) {
		if (state.scenario === "empty") return [heading(state.tab === 2 ? "No agent observations" : "No tasks recorded"), paint("Nothing to invent. Pi remains authoritative.", "muted")];
		if (state.detail) {
			const row = selectedRow();
			return card(`${state.focus === "detail" ? "◆" : "◇"} DETAILS · ${row.id}`, [heading(row.title), status(row.status),
				...(row.group ? [paint(`Group: ${row.group}`)] : []), "", ...wrapped(paint(row.note ?? "Expand this group from the list."), width - 4), "",
				paint("Read-only · no execution controls", "muted")], width, state.focus === "detail");
		}
		return [heading(state.tab === 2 ? "AGENTS · separate from task acceptance" : "TASKS · blocked → active → pending"), "",
			...rows().flatMap((row, index) => {
				const focused = state.selected === index;
				const label = row.id === "completed" ? paint(row.title, "done", focused)
					: paint(MARKS[row.status], row.status === "pending" ? "muted" : row.status, focused) + paint(` ${row.title}`, "text", focused);
				const styled = truncateToWidth(paint(`${focused ? "›" : " "} `, "text", focused) + label, width, "…");
				return [styled + paint(" ".repeat(Math.max(0, width - visibleWidth(styled))), "text", focused),
					...(row.id === "completed" ? [] : [paint(`    ${LABELS[row.status]}${row.group ? ` · ${row.group}` : " · Enter for observed phase"}`, "muted")])];
			}), "", paint("Highlight ≠ acceptance · Enter opens details", "muted")];
	}

	function usage(width) {
		if (state.scenario === "empty") return [heading("No recorded consumption"), paint("Native recorded total: 0"), paint("Context is unknown, not zero.", "muted")];
		return [heading("CODEX · all recorded session entries"), paint("Synthetic accounting, not billing or quota", "muted"), "",
			...card("openai-codex / gpt-5.4", ["Input          18,000", "Output          7,000", "Cache read     75,000", "Cache write         0", heading("Total         100,000")], width),
			...card("openai-codex / gpt-5.4-mini", ["Input           2,000", "Output          3,000", "Cache read     15,000", "Cache write         0", heading("Total          20,000")], width),
			heading("RECONCILIATION"), paint("Codex subtotal          120,000"), paint("Unattributed              2,048"), paint("Unsupported providers     9,024"), heading("Native recorded total   131,072"), "",
			...wrapped(paint("Codex attribution: parent 80,000 + delegated 40,000 = 120,000 (not extra tokens)."), width), "",
			...wrapped(paint("Observed partial totals: cancelled work can be incomplete. Summary attribution unknown. Reasoning/cache subsets are not added again.", "muted"), width)];
	}

	function question(width) {
		const review = state.questionMode === "review";
		const title = review ? "REVIEW · explicit submission" : `QUESTION · ${QUESTION_MODES.indexOf(state.questionMode) + 1} / 3`;
		if (review) return card(title, [heading("Review your fictional answers"), "", "1 · Keep the companion read-only", "2 · Nord palette, keyboard navigation", "3 · A separate pane; no question controls", "",
			paint("› [ Correct answers ]", "text", state.questionFocus === 0), paint("  [ Submit explicitly ]", "text", state.questionFocus === 1), paint("  [ Cancel ]", "text", state.questionFocus === 2), "",
			paint(state.reviewed ? "Demo submission only · nothing was sent" : "Not submitted · Enter on Submit is required", "muted")], width, true);
		const text = state.questionMode === "text";
		const content = [heading(text ? "What should remain inside Pi?" : "How should this fixture be presented?"), paint("Fictional question · no real answer receipt", "muted"), ""];
		if (!text) content.push(...QUESTION_OPTIONS.map((option, index) => {
			const mark = state.questionMode === "multiple" ? (state.answer.has(index) ? "[x]" : "[ ]") : (state.answer.has(index) ? "(●)" : "( )");
			return paint(`${state.questionFocus === index ? "›" : " "} ${mark} ${option}`, "text", state.questionFocus === index);
		}));
		content.push("", paint(text ? "TEXT ENTRY · Enter to finish editing" : "Optional text · Tab to edit", "accent"));
		content.push(...input.render(Math.max(1, width - 6)).map(value => paint("  ") + value));
		content.push("", paint("─".repeat(Math.max(1, width - 4)), "muted"));
		content.push(paint("[ Continue to review ]    [ Cancel ]"), paint(state.warning ? "! Choose or enter an answer before continuing" : "Space selects · highlighting does not approve", state.warning ? "active" : "muted"));
		return card(title, content, width, true);
	}

	const header = { invalidate() {}, render(width) { return [line(questions ? "PI QUESTION CARD · FICTIONAL PREVIEW" : "ORCHESTRAITOR · FICTIONAL PREVIEW", width, "accent"),
		line(questions ? `Native Pi design · ${state.questionMode}` : `demo-project / demo-session · ${state.scenario}`, width, "muted")]; } };
	const tabs = { invalidate() {}, render(width) { return [questions ? line("Separate design preview · not a companion tab", width, "muted")
		: truncateToWidth(TABS.map((tab, index) => paint(`${index + 1} ${tab}`, index === state.tab ? "accent" : "muted", index === state.tab, index === state.tab)).join("  "), width, "…")]; } };
	const body = { invalidate() {}, render(width) {
		if (width < MINIMUM.panelColumns || getRows() < MINIMUM.panelRows) return wrapped(paint("Too small · keep Pi usable. Use native Pi panels; this view needs 48 columns × 10 rows."), width);
		if (state.help) return card("LOCAL HELP", ["1–4  Overview / Tasks / Agents / Usage", "↑↓   Move list focus", "Enter  Details / expand completed", "Tab    List / detail focus", "PgUp / PgDn  Scroll", "Esc    Back / dismiss help", "?      Help     q  Close view", "", "Preview only: s scenario · m question style", "Questions are not part of the companion."], width);
		const warning = state.scenario === "stale" ? [paint("! STALE · last sample is not live", "active"), ""]
			: state.scenario === "disconnected" ? [paint("! DISCONNECTED · origin unavailable", "active"), paint("Retained sample; reopen deliberately", "muted"), ""] : [];
		const content = questions ? question(width) : state.tab === 0 ? overview(width) : state.tab === 3 ? usage(width) : listContent(width);
		return [...warning, ...content].flatMap(text => wrapped(text, width));
	} };
	const scroll = new ScrollView(body, { follow: "none", primary: true, scrollbar: "auto" });
	const footer = { invalidate() {}, render(width) {
		const hints = questions ? (state.editing ? "Text focus · Enter finish · Esc back" : "↑↓ focus · Space choose · Enter continue")
			: state.detail ? "Tab focus · PgUp/PgDn scroll · Esc back" : "1–4 tabs · ↑↓ rows · Enter details";
		return [line(hints, width, "accent"), line(questions ? "PgUp/PgDn scroll · m style · q close" : "? help · q close · s fixture scenario", width, "muted")];
	} };
	const root = new VStack([{ component: header, basis: 2, shrink: 0 }, { component: tabs, basis: 1, shrink: 0 },
		{ component: scroll, basis: 0, grow: 1, minSize: 1 }, { component: footer, basis: 2, shrink: 0 }]);

	function changeQuestionMode(mode) {
		state.questionMode = mode;
		if (mode === "single") state.answer = new Set([...state.answer].slice(0, 1));
		state.reviewed = false;
		state.questionFocus = 0;
		state.warning = false;
		state.editing = mode === "text";
		input.focused = state.editing;
		scroll.scrollToStart();
	}

	function handleInput(data) {
		if (matchesKey(data, "ctrl+c")) return "quit";
		if (questions && state.editing) {
			if (matchesKey(data, "enter") || matchesKey(data, "escape")) { state.editing = false; input.focused = false; }
			else input.handleInput(data);
			return;
		}
		if (data === "q") return "quit";
		if (data === "?") state.help = !state.help;
		else if (matchesKey(data, "escape")) { state.help = false; state.detail = false; state.focus = "list"; }
		else if (matchesKey(data, "pageDown")) { scroll.scrollBy(Math.max(1, scroll.viewportHeight - 1)); return; }
		else if (matchesKey(data, "pageUp")) { scroll.scrollBy(-Math.max(1, scroll.viewportHeight - 1)); return; }
		else if (questions) {
			if (data === "m") changeQuestionMode(QUESTION_MODES[(QUESTION_MODES.indexOf(state.questionMode) + 1) % QUESTION_MODES.length]);
			else if (matchesKey(data, "down") || matchesKey(data, "up")) state.questionFocus = (state.questionFocus + 1) % (state.questionMode === "review" ? 3 : 2);
			else if (matchesKey(data, "tab")) { state.editing = true; input.focused = true; }
			else if (matchesKey(data, "space") && state.questionMode !== "review") {
				if (state.questionMode === "single") state.answer = new Set([state.questionFocus]);
				else if (state.answer.has(state.questionFocus)) state.answer.delete(state.questionFocus);
				else state.answer.add(state.questionFocus);
				state.warning = false;
			} else if (matchesKey(data, "enter")) {
				if (state.questionMode === "review") {
					if (state.questionFocus === 0) changeQuestionMode("single");
					else if (state.questionFocus === 1) state.reviewed = true;
					else return "quit";
				} else if (!state.answer.size && !input.getValue().trim()) state.warning = true;
				else changeQuestionMode("review");
			}
		} else if (/^[1-4]$/.test(data)) { state.tab = Number(data) - 1; state.selected = 0; state.detail = false; state.focus = "list"; }
		else if (data === "s") state.scenario = SCENARIOS[(SCENARIOS.indexOf(state.scenario) + 1) % SCENARIOS.length];
		else if (matchesKey(data, "tab") && state.detail) state.focus = state.focus === "list" ? "detail" : "list";
		else if (matchesKey(data, "enter") && [1, 2].includes(state.tab) && state.scenario !== "empty") {
			if (selectedRow().id === "completed") state.completed = !state.completed;
			else { state.detail = true; state.focus = "detail"; }
		} else if (matchesKey(data, "down") || matchesKey(data, "up")) {
			if (state.detail) { scroll.scrollBy(matchesKey(data, "down") ? 1 : -1); return; }
			state.selected = Math.max(0, Math.min(rows().length - 1, state.selected + (matchesKey(data, "down") ? 1 : -1)));
		}
		scroll.scrollToStart();
	}

	return { state, root, scroll, input, handleInput, changeQuestionMode,
		renderDocument(width) { return [...header.render(width), ...tabs.render(width), ...body.render(width), ...footer.render(width)].map(text => truncateToWidth(text, width, "…")); } };
}

export function checkPreview() {
	// Given
	const widths = [1, 20, 40, 48, 80, 120];
	let frames = 0;
	// When
	for (const palette of Object.keys(PALETTES)) for (const scenario of SCENARIOS) for (const width of widths) {
		const preview = createPreview({ palette, scenario });
		for (let tab = 0; tab < TABS.length; tab++) {
			preview.handleInput(String(tab + 1));
			const lines = preview.renderDocument(width);
			// Then
			assert.ok(lines.every(line => visibleWidth(line) <= width));
			assert.ok(lines.join("\n").includes("FICTIONAL") || width < 40);
			frames++;
		}
	}
	// Given
	const preview = createPreview();
	// When
	preview.handleInput("2");
	preview.handleInput("\r");
	// Then
	assert.equal(preview.state.detail, true);
	assert.equal(preview.state.focus, "detail");
	preview.handleInput("\t");
	assert.equal(preview.state.focus, "list");
	preview.handleInput("\x1b");
	assert.equal(preview.state.detail, false);
	for (let i = 0; i < 3; i++) preview.handleInput("\x1b[B");
	preview.handleInput("\r");
	assert.equal(preview.state.completed, true);
	assert.equal(preview.handleInput("q"), "quit");
	assert.deepEqual([[131, 24], [130, 25], [80, 25], [79, 25], [80, 24]].map(([w, h]) => placement(w, h)), ["right", "down", "down", "unavailable", "unavailable"]);
	preview.scroll.updateLayout(100, 10, () => {});
	preview.handleInput("\x1b[6~");
	assert.equal(preview.scroll.scrollTop, 9);
	preview.handleInput("\x1b[5~");
	assert.equal(preview.scroll.scrollTop, 0);
	for (const height of [8, 10, 13, 24, 40]) {
		const short = createPreview({ getRows: () => height });
		assert.equal(short.renderDocument(48).join("\n").includes("Too small"), height < 10);
	}
	const questions = createPreview({ questions: true });
	questions.handleInput("\r");
	assert.equal(questions.state.warning, true);
	questions.handleInput(" ");
	questions.handleInput("\r");
	assert.equal(questions.state.questionMode, "review");
	assert.equal(questions.state.reviewed, false);
	questions.handleInput("\r");
	assert.equal(questions.state.questionMode, "single");
	questions.changeQuestionMode("multiple");
	questions.state.answer = new Set([0, 1]);
	questions.changeQuestionMode("single");
	assert.deepEqual([...questions.state.answer], [0]);
	for (const mode of QUESTION_MODES) {
		questions.changeQuestionMode(mode);
		for (const width of widths) assert.ok(questions.renderDocument(width).every(line => visibleWidth(line) <= width));
	}
	return { frames, widths, heights: [8, 10, 13, 24, 40], keyboard: "passed", fixtureOnly: true };
}

async function main() {
	const args = process.argv.slice(2);
	if (args.includes("--check")) { console.log(JSON.stringify(checkPreview())); return; }
	if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run the fictional preview only in an owned terminal; use --check for deterministic checks.");
	const palette = args.find(arg => arg.startsWith("--palette="))?.split("=")[1] ?? "nord";
	const terminal = new ProcessTerminal();
	const preview = createPreview({ palette, questions: args.includes("--questions"), getRows: () => terminal.rows });
	const tui = new TuiAltScreen(terminal, false, undefined, { copyOnSelect: false });
	tui.setLayoutRoot(preview.root);
	let stopped = false;
	const stop = () => { if (stopped) return; stopped = true; tui.stop(); process.exitCode = 0; process.stdin.pause(); };
	tui.setFocus({ focused: true, render: () => [], invalidate() {}, handleInput(data) {
		if (preview.handleInput(data) === "quit") stop();
		else tui.requestRender();
	} });
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	try { tui.start(); } catch (error) { stop(); throw error; }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
