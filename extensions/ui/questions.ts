import type { KeybindingsManager, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Input, getKeybindings, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { createUIOwner } from "../status-ui.ts";
import { sanitizeDisplay } from "./display.ts";

export const QUESTION_TOOL_NAME = "orchestraitor_ask";
export const QUESTION_LIMIT = 6;
export const OPTION_LIMIT = 8;
export const QUESTION_TEXT_LIMIT = 1000;
export const QUESTION_LABEL_LIMIT = 200;
export const ANSWER_TEXT_LIMIT = 1000;
const ID_LIMIT = 80;
const CARD_NATIVE_LAYOUT_ROWS = 6; // Native footer, widget/status and chat spacing.
const CARD_MIN_BORDERED_WIDTH = 10;
const LABEL_MAX_LINES = 2;
type Question = { id: string; prompt: string; selection: "single" | "multiple"; options: { label: string; value: string }[]; required?: boolean; allowText?: boolean };
type Answer = { id: string; values: string[]; text?: string };
type Answered = { status: "answered"; answers: Answer[] };
type Outcome = Answered | { status: "cancelled" | "unavailable" | "busy" };
const bounded = (limit: number) => Type.String({ minLength: 1, maxLength: limit });
export const QuestionParameters = Type.Object({ questions: Type.Array(Type.Object({
	id: bounded(ID_LIMIT), prompt: bounded(QUESTION_TEXT_LIMIT), selection: Type.Union([Type.Literal("single"), Type.Literal("multiple")]),
	options: Type.Array(Type.Object({ label: bounded(QUESTION_LABEL_LIMIT), value: bounded(ANSWER_TEXT_LIMIT) }, { additionalProperties: false }), { minItems: 2, maxItems: OPTION_LIMIT }),
	required: Type.Optional(Type.Boolean()), allowText: Type.Optional(Type.Boolean()),
}, { additionalProperties: false }), { minItems: 1, maxItems: QUESTION_LIMIT }) }, { additionalProperties: false });

function object(value: unknown, fields: string[], label: string) {
	if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key))) throw new Error(`Invalid ${label} object`);
}
function text(value: unknown, limit: number, label: string) {
	if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error(`Invalid ${label}: non-empty text up to ${limit} characters required`);
}

/** Validate once before claiming focus. Payload values are never sanitized or normalized. */
export function validateQuestions(params: { questions: Question[] }): Question[] {
	object(params, ["questions"], "questions");
	if (!Array.isArray(params.questions) || !params.questions.length || params.questions.length > QUESTION_LIMIT) throw new Error(`Provide one to ${QUESTION_LIMIT} questions`);
	const ids = new Set<string>();
	for (const question of params.questions) {
		object(question, ["id", "prompt", "selection", "options", "required", "allowText"], "question");
		text(question.id, ID_LIMIT, "question ID"); text(question.prompt, QUESTION_TEXT_LIMIT, "question prompt");
		if (ids.has(question.id)) throw new Error("Question IDs must be unique");
		ids.add(question.id);
		if (question.selection !== "single" && question.selection !== "multiple") throw new Error("Invalid question selection");
		for (const flag of ["required", "allowText"] as const) if (question[flag] !== undefined && typeof question[flag] !== "boolean") throw new Error(`Invalid ${flag}`);
		if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > OPTION_LIMIT) throw new Error(`Provide two to ${OPTION_LIMIT} options`);
		const values = new Set<string>();
		for (const option of question.options) {
			object(option, ["label", "value"], "option");
			text(option.label, QUESTION_LABEL_LIMIT, "option label"); text(option.value, ANSWER_TEXT_LIMIT, "option value");
			if (values.has(option.value)) throw new Error("Option values must be unique");
			values.add(option.value);
		}
	}
	return structuredClone(params.questions);
}

export function validateAnswers(questions: Question[], answers: Answer[]): Answer[] {
	if (!Array.isArray(answers) || answers.length > questions.length) throw new Error("Invalid answers");
	const ids = new Set<string>();
	for (const answer of answers) {
		object(answer, ["id", "values", "text"], "answer");
		const question = questions.find((item) => item.id === answer.id);
		if (!question) throw new Error("Unknown answer ID");
		if (ids.has(answer.id)) throw new Error("Answer IDs must be unique");
		ids.add(answer.id);
		if (!Array.isArray(answer.values) || new Set(answer.values).size !== answer.values.length) throw new Error("Answer values must be unique");
		if (answer.values.some((value) => !question.options.some((option) => option.value === value))) throw new Error("Unknown option value");
		if (question.selection === "single" && answer.values.length > 1) throw new Error("Single choice accepts one value");
		if (answer.text !== undefined) {
			if (!question.allowText || answer.values.length) throw new Error("Free text must be explicitly allowed and cannot accompany selected values");
			text(answer.text, ANSWER_TEXT_LIMIT, "answer text");
		}
	}
	for (const question of questions) {
		const answer = answers.find((item) => item.id === question.id);
		if (question.required !== false && (!answer || (!answer.values.length && !answer.text?.trim()))) throw new Error("Required answers are missing");
	}
	return structuredClone(answers);
}

const label = (value: string) => sanitizeDisplay(value).replace(/\s+/gu, " ");
export function createQuestionTool(owner: ReturnType<typeof createUIOwner>): ToolDefinition<typeof QuestionParameters> {
	return {
		name: QUESTION_TOOL_NAME, label: "Ask", exposure: "model-only", executionMode: "sequential",
		description: "Collect requirements/preferences with one to six single/multiple choices. Exact IDs/values are returned only after explicit submission. Free text needs allowText:true. Cancelled/unavailable/busy are not approval; clarify textually if unavailable. Never use this as a security or destructive-action permission grant.",
		parameters: QuestionParameters,
		async execute(_id, params, signal, _update, ctx) {
			const questions = validateQuestions(params);
			const generation = owner.generation;
			const abort = signal ?? ctx.signal;
			let outcome: Outcome;
			if (ctx.mode !== "tui" || !ctx.hasUI) outcome = { status: "unavailable" };
			else if (!owner.isCurrent(ctx)) outcome = { status: "cancelled" };
			else {
				outcome = await owner.modal<Answered>("question", (tui, _theme, keys, done) =>
					createQuestionnaire(questions, tui, () => ctx.ui.theme, keys, done), abort);
			}
			if (abort?.aborted || generation !== owner.generation) outcome = { status: "cancelled" };
			const details = { version: 1, ...outcome };
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		},
	};
}

type Row = { kind: "option" | "review"; index: number } | { kind: "text" | "submit" };
type SelectAction = "tui.select.up" | "tui.select.down" | "tui.select.confirm" | "tui.select.cancel" | "tui.select.pageUp" | "tui.select.pageDown";
type Color = Parameters<Theme["fg"]>[0];
type Hint = { key: string; text: string; priority: number };
const KEY_NAMES: Record<string, string> = { escape: "esc", up: "↑", down: "↓", left: "←", right: "→", pageUp: "pgup", pageDown: "pgdn" };
const SGR = /\x1b\[[0-9;]*m/gu;
const MOVES = new Set<SelectAction>(["tui.select.up", "tui.select.down", "tui.select.confirm"]);
/** Fit sanitized plain text before styling, so truncation resets never end a row highlight early. */
const clip = (value: string, max: number) => max <= 0 ? "" : visibleWidth(value) <= max ? value : truncateToWidth(value, max, "…").replace(SGR, "");
const fit = (value: string, max: number) => { const clipped = clip(value, max); return clipped + " ".repeat(Math.max(0, max - visibleWidth(clipped))); };
const paragraphs = (value: string) => sanitizeDisplay(value).split("\n").map((part) => part.replace(/\s+/gu, " ").trim()).filter((part, index, all) => part || all[index - 1]);

/** Rows are drawn here so long labels wrap; native Input owns text editing and native keybindings own navigation. */
export function createQuestionnaire(questions: Question[], tui: TUI, getTheme: () => Theme, keys: KeybindingsManager, done: (result: Outcome) => void) {
	const drafts = questions.map((question): Answer => ({ id: question.id, values: [] }));
	let questionIndex = 0;
	let cursor = 0;
	let promptTop = 0;
	let promptPage = 1;
	let promptMax = 0;
	let returnToReview = false;
	let editing = false;
	let focused = false;
	let disposed = false;
	let finished = false;
	let warning = "";
	const input = new Input({ prompt: "", placeholder: "Type your answer", placeholderStyle: (value) => getTheme().fg("dim", value) });
	const review = () => questionIndex >= questions.length;
	const answered = (index: number) => drafts[index].values.length > 0 || drafts[index].text !== undefined;
	const missing = () => questions.filter((question, index) => question.required !== false && !answered(index));
	const rows = (): Row[] => review() ? [...questions.map((_, index) => ({ kind: "review" as const, index })), { kind: "submit" as const }]
		: [...questions[questionIndex].options.map((_, index) => ({ kind: "option" as const, index })), ...(questions[questionIndex].allowText ? [{ kind: "text" as const }] : [])];
	// Cancel and paging follow the configured manager; movement and confirm also read Pi's global bindings, as native SelectList did.
	const is = (data: string, action: SelectAction) => keys.matches(data, action) || (MOVES.has(action) && getKeybindings().matches(data, action));
	const keyName = (action: SelectAction | "tui.input.submit", fallback: string) => {
		const key = (keys.getKeys?.(action) ?? getKeybindings().getKeys(action))?.[0] ?? fallback;
		return KEY_NAMES[key] ?? key;
	};
	const redraw = () => { tui.requestRender(); };
	const syncFocus = () => { input.focused = focused && editing && !finished && !disposed; };
	const finish = (result: Outcome) => {
		if (finished || disposed) return;
		finished = true;
		syncFocus();
		done(result);
	};
	const go = (index: number) => {
		editing = false; warning = ""; questionIndex = index; promptTop = 0; syncFocus();
		if (review()) { cursor = questions.length; return; }
		const draft = drafts[index], options = questions[index].options;
		cursor = draft.text !== undefined ? options.length : Math.max(0, options.findIndex((option) => option.value === draft.values[0]));
	};
	const next = () => { const target = returnToReview ? questions.length : questionIndex + 1; returnToReview = false; go(target); };
	const back = () => { editing = false; warning = ""; syncFocus(); redraw(); };
	input.onEscape = back;
	input.onSubmit = (value) => {
		try { if (!value.trim()) throw new Error("Type an answer first, or go back to the options"); text(value, ANSWER_TEXT_LIMIT, "answer text"); }
		catch (error) { warning = String((error as Error).message); redraw(); return; }
		drafts[questionIndex] = { id: questions[questionIndex].id, values: [], text: value };
		next();
		redraw();
	};
	function edit() {
		editing = true;
		input.setValue("");
		const draft = drafts[questionIndex].text;
		if (draft) input.handleInput(`\x1b[200~${draft}\x1b[201~`); // A paste leaves the native cursor after the saved draft.
		syncFocus();
	}
	function toggle(index: number) {
		const question = questions[questionIndex], value = question.options[index].value, values = drafts[questionIndex].values;
		drafts[questionIndex] = { id: question.id, values: question.selection === "single" ? [value] : values.includes(value) ? values.filter((item) => item !== value) : [...values, value] };
	}
	function confirm(row: Row) {
		if (row.kind === "submit") {
			const absent = missing();
			if (absent.length) { warning = `Required: answer ${absent.map((question) => label(question.id)).join(", ")} first`; return; }
			try { finish({ status: "answered", answers: validateAnswers(questions, drafts) }); }
			catch (error) { warning = String((error as Error).message); }
		} else if (row.kind === "review") { returnToReview = true; go(row.index); }
		else if (row.kind === "text") edit();
		else if (questions[questionIndex].selection === "single") { toggle(row.index); next(); }
		else if (questions[questionIndex].required !== false && !answered(questionIndex)) warning = "Required: pick at least one (space)";
		else next();
	}
	function handleKey(data: string) {
		warning = "";
		const list = rows(), row = list[cursor];
		if (is(data, "tui.select.cancel")) finish({ status: "cancelled" });
		else if (is(data, "tui.select.pageUp")) promptTop = Math.max(0, promptTop - promptPage);
		else if (is(data, "tui.select.pageDown")) promptTop = Math.min(promptMax, promptTop + promptPage);
		else if (is(data, "tui.select.up")) cursor = (cursor + list.length - 1) % list.length;
		else if (is(data, "tui.select.down")) cursor = (cursor + 1) % list.length;
		else if (is(data, "tui.select.confirm")) confirm(row);
		else if (matchesKey(data, "left") && questionIndex > 0) { returnToReview = false; go(questionIndex - 1); }
		else if (matchesKey(data, "right") && !review()) { returnToReview = false; go(questionIndex + 1); }
		else if (review()) return;
		else if (matchesKey(data, "space")) { if (row.kind === "option") toggle(row.index); else edit(); }
		else if (/^[1-9]$/u.test(data) && Number(data) <= list.length) cursor = Number(data) - 1;
		else if (matchesKey(data, "backspace")) drafts[questionIndex] = { id: questions[questionIndex].id, values: [] };
	}
	function render(width: number): string[] {
		const theme = getTheme();
		const italic = (value: string) => theme.italic?.(value) ?? value;
		const border = (value: string) => theme.fg("borderMuted", value);
		const bordered = width >= CARD_MIN_BORDERED_WIDTH;
		const inner = bordered ? width - 2 : Math.max(1, width);
		const pad = !bordered ? 0 : inner >= 40 ? 2 : 1;
		const content = Math.max(1, inner - pad * 2);
		const pointerWidth = content >= 3 ? 2 : 0;
		const markWidth = content >= 8 ? 3 : content >= 5 ? 2 : 0;
		const labelWidth = Math.max(1, content - pointerWidth - markWidth);
		const line = (value: string, fill?: (value: string) => string, indent = pad) => {
			const body = " ".repeat(indent) + value;
			const padded = body + " ".repeat(Math.max(0, inner - visibleWidth(body)));
			return fill ? fill(padded) : padded;
		};
		const wrap = (value: string, max: number) => {
			const lines = wrapTextWithAnsi(value, labelWidth);
			return lines.length <= max ? lines : [...lines.slice(0, max - 1), clip(lines.slice(max - 1).join(" "), labelWidth)];
		};
		const list = rows();
		cursor = Math.min(cursor, list.length - 1);
		const question = review() ? undefined : questions[questionIndex];
		const draft = review() ? undefined : drafts[questionIndex];
		const selected = question?.selection === "multiple" ? draft!.values.length : 0;
		const glyph = (chosen: boolean) => question?.selection === "multiple" ? chosen ? "■" : "□" : chosen ? "●" : "○";
		const typed = () => `“${label(draft!.text ?? "")}”`;
		const rowLines = (row: Row) => row.kind === "option" ? Math.min(LABEL_MAX_LINES, wrapTextWithAnsi(label(question!.options[row.index].label), labelWidth).length)
			: row.kind === "text" && !editing && draft!.text !== undefined ? Math.min(LABEL_MAX_LINES, wrapTextWithAnsi(typed(), labelWidth).length) : 1;

		const renderRow = (row: Row, index: number, height: number): string[] => {
			const lit = index === cursor;
			const fill = lit && row.kind !== "submit" ? (value: string) => theme.bg("selectedBg", value) : undefined;
			const pointer = pointerWidth ? `${lit ? theme.fg("accent", theme.bold("❯")) : " "} ` : "";
			const strong = (value: string) => lit ? theme.bold(value) : value;
			const mark = (value: string, color: Color) => markWidth ? theme.fg(color, value) + " ".repeat(markWidth - 1) : "";
			if (row.kind === "text" && editing) {
				const suffix = labelWidth >= 32 && input.getValue() ? " your answer" : "";
				return [line(pointer + mark("›", "accent") + input.render(labelWidth - suffix.length) + (suffix && theme.fg("muted", italic(suffix))), fill)];
			}
			if (row.kind === "option" || row.kind === "text") {
				const chosen = row.kind === "option" ? draft!.values.includes(question!.options[row.index].value) : draft!.text !== undefined;
				const marker = mark(glyph(chosen), chosen ? "accent" : lit ? "muted" : "dim");
				if (row.kind === "text" && !chosen) return [line(pointer + marker + theme.fg("muted", clip("Type your own answer…", labelWidth)), fill)];
				return wrap(row.kind === "option" ? label(question!.options[row.index].label) : typed(), height)
					.map((value, at) => line((at ? " ".repeat(pointerWidth + markWidth) : pointer + marker) + strong(value), fill));
			}
			const room = content - pointerWidth;
			if (row.kind === "review") {
				const item = questions[row.index], answer = drafts[row.index];
				const keyWidth = room >= 24 ? Math.min(Math.max(...questions.map((entry) => visibleWidth(label(entry.id)))) + 2, 16, Math.floor(room / 3)) : 0;
				const valueWidth = room - keyWidth;
				let value: string;
				if (answer.text !== undefined) {
					const note = valueWidth >= 20 ? " typed" : "";
					value = theme.fg("muted", "“") + strong(clip(label(answer.text), valueWidth - 2 - note.length)) + theme.fg("muted", "”") + (note && theme.fg("muted", italic(note)));
				} else if (answer.values.length) {
					const chosen = answer.values.map((entry) => label(item.options.find((option) => option.value === entry)!.label)).join(" · ");
					value = clip(chosen, valueWidth).split(" · ").map(strong).join(theme.fg("dim", " · "));
				} else value = item.required !== false ? theme.fg("warning", clip("not answered", valueWidth)) : theme.fg("muted", clip("skipped", valueWidth));
				return [line(pointer + (keyWidth ? theme.fg("muted", fit(label(item.id), keyWidth - 2)) + "  " : "") + value, fill)];
			}
			const absent = missing(), count = drafts.filter((_, at) => answered(at)).length;
			const button = clip(` ${absent.length || !count ? "Submit" : `Submit ${count} answer${count === 1 ? "" : "s"}`} `, room);
			const focusedButton = theme.fg("accent", theme.bold(button));
			const styled = absent.length ? theme.fg("dim", button) : lit ? theme.inverse?.(focusedButton) ?? focusedButton : theme.fg("accent", button);
			const note = absent.length ? clip(`  answer ${absent.map((entry) => label(entry.id)).join(", ")} first`, room - visibleWidth(button)) : "";
			return [line(pointer + styled + (note && theme.fg("muted", note)))];
		};

		const stripIndent = Math.max(0, pad - 1), stripWidth = inner - pad - stripIndent; // The current tab's padding sits in the left gutter.
		const strip = () => {
			if (questions.length < 2) return undefined;
			for (const nameWidth of [14, 8, 0]) {
				const parts = questions.map((entry, at) => {
					const name = nameWidth ? ` ${clip(label(entry.id), nameWidth)}` : "";
					if (at === questionIndex) return { width: visibleWidth(name) + 3, text: theme.bg("selectedBg", ` ${theme.fg("accent", "●")}${theme.bold(name)} `) };
					const plain = `${answered(at) ? "✓" : "○"}${name}`;
					return { width: visibleWidth(plain) + 2, text: ` ${theme.fg(answered(at) ? "success" : "muted", plain)} ` };
				});
				parts.push({ width: 1, text: theme.fg("dim", "│") }, { width: 8, text: review() ? theme.bg("selectedBg", ` ${theme.bold("review")} `) : ` ${theme.fg("muted", "review")} ` });
				const used = parts.reduce((sum, part) => sum + part.width, 0) + parts.length - 1;
				if (used > stripWidth) continue;
				const count = selected ? `${selected} selected` : "", gap = stripWidth - used - visibleWidth(count);
				return parts.map((part) => part.text).join(" ") + (count && gap >= 2 ? " ".repeat(gap) + theme.fg("muted", count) : "");
			}
			return undefined;
		};
		const stripLine = strip();
		const promptAll = (review() ? ["Check your answers. Pick a row to change it."] : paragraphs(question!.prompt)).flatMap((part) => part ? wrapTextWithAnsi(part, content) : [""]);
		while (promptAll.length > 1 && !promptAll.at(-1)) promptAll.pop();
		if (!promptAll.length) promptAll.push("");

		// Spend the rows that remain after native layout: answers and the prompt first, breathing room last.
		let left = Math.max(1, Math.max(3, tui.terminal.rows - CARD_NATIVE_LAYOUT_ROWS) - (bordered ? 2 : 0));
		const take = (want: number) => { const got = Math.max(0, Math.min(want, left)); left -= got; return got; };
		let shownRows = take(1);
		let promptShown = take(1);
		const warningShown = take(warning ? 1 : 0);
		shownRows += take(list.length - 1);
		promptShown += take(promptAll.length - promptShown);
		let more = 0;
		if (promptShown < promptAll.length) { more = take(1); if (!more && promptShown > 1) { promptShown--; more = 1; } }
		const stripShown = stripLine === undefined ? 0 : take(1);
		const heights = list.map(() => 1);
		if (shownRows === list.length) for (const at of [cursor, ...list.keys()]) heights[at] += take(rowLines(list[at]) - heights[at]);
		const submitGap = review() && shownRows === list.length ? take(1) : 0;
		const promptGap = take(1), stripGap = stripShown ? take(1) : 0, endGap = take(1), topGap = stripShown ? 0 : take(1);
		promptPage = Math.max(1, promptShown);
		promptMax = Math.max(0, promptAll.length - promptShown);
		promptTop = Math.min(promptTop, promptMax);
		const below = promptAll.length - promptTop - promptShown;
		const indicator = below > 0 ? `↓ ${below} more line${below === 1 ? "" : "s"} · ${keyName("tui.select.pageDown", "pgdn")}`
			: `↑ ${promptTop} line${promptTop === 1 ? "" : "s"} above · ${keyName("tui.select.pageUp", "pgup")}`;
		const start = Math.max(0, Math.min(cursor - Math.floor(shownRows / 2), list.length - shownRows));
		const blank = line("");
		const body = [
			...(topGap ? [blank] : []),
			...(stripShown ? [line(stripLine!, undefined, stripIndent)] : []),
			...(stripGap ? [blank] : []),
			...promptAll.slice(promptTop, promptTop + promptShown).map((value) => line(review() ? theme.fg("muted", value) : value)),
			...(more ? [line(theme.fg("muted", clip(indicator, content)))] : []),
			...(promptGap ? [blank] : []),
			...list.slice(start, start + shownRows).flatMap((row, at) => [...(row.kind === "submit" && submitGap ? [blank] : []), ...renderRow(row, start + at, heights[start + at])]),
			...(endGap ? [blank] : []),
			...(warningShown ? [line(theme.fg("warning", clip(`!  ${warning}`, content)))] : []),
		];
		if (!bordered) return body.map((value) => truncateToWidth(value, width, ""));

		const title = review() ? "Review" : questions.length > 1 ? `Question ${questionIndex + 1} of ${questions.length}` : "Question";
		const short = review() || questions.length < 2 ? title : `${questionIndex + 1} of ${questions.length}`;
		const tag = review() ? "nothing sent yet"
			: `pick ${question!.selection === "single" ? "one" : "any"}${question!.allowText ? " or type" : ""}${stripLine === undefined && selected ? ` · ${selected} selected` : ""}`;
		const top = () => {
			for (const [name, note] of [[title, tag], [short, tag], [title, ""], [short, ""]]) {
				const rule = width - 2 - (visibleWidth(name) + 3) - (note ? visibleWidth(note) + 3 : 0);
				if (rule >= 1) return border("╭─ ") + theme.fg("accent", theme.bold(name)) + " " + border("─".repeat(rule)) + (note && ` ${theme.fg("muted", note)} ${border("─")}`) + border("╮");
			}
			return border(`╭${"─".repeat(width - 2)}╮`);
		};
		const confirmKey = keyName("tui.select.confirm", "enter"), cancelKey = keyName("tui.select.cancel", "esc");
		const up = keyName("tui.select.up", "up"), down = keyName("tui.select.down", "down");
		const move = { key: up === "↑" && down === "↓" ? "↑↓" : `${up}/${down}`, text: "move", priority: 5 };
		const cancel = { key: cancelKey, text: "cancel", priority: 8 };
		const current = list[cursor];
		const hints: Hint[] = editing ? [{ key: keyName("tui.input.submit", "enter"), text: "save", priority: 9 }, { key: cancelKey, text: "back to options", priority: 8 }]
			: review() ? [move, { key: confirmKey, text: current.kind === "submit" ? "submit" : "change", priority: 9 }, { key: "←", text: "back", priority: 4 }, cancel]
			: [move, ...(question!.selection === "multiple" ? [{ key: "space", text: "toggle", priority: 7 }] : []),
				{ key: confirmKey, text: current.kind === "text" ? "type" : question!.selection === "single" ? "choose" : "next", priority: 9 },
				{ key: `1–${list.length}`, text: "jump", priority: 2 }, ...(questions.length > 1 ? [{ key: "←→", text: "question", priority: 3 }] : []),
				...(answered(questionIndex) ? [{ key: "⌫", text: "clear", priority: 1 }] : []), cancel];
		const bottom = () => {
			while (hints.length) {
				const rule = width - 5 - visibleWidth(hints.map((hint) => `${hint.key} ${hint.text}`).join(" · "));
				if (rule >= 1) return border("╰─ ") + hints.map((hint) => `${hint.key} ${theme.fg("muted", hint.text)}`).join(theme.fg("dim", " · ")) + " " + border(`${"─".repeat(rule)}╯`);
				hints.splice(hints.indexOf(hints.reduce((low, hint) => hint.priority < low.priority ? hint : low)), 1);
			}
			return border(`╰${"─".repeat(width - 2)}╯`);
		};
		return [top(), ...body.map((value) => border("│") + value + border("│")), bottom()].map((value) => truncateToWidth(value, width, ""));
	}
	return {
		get focused() { return focused; },
		set focused(value: boolean) { focused = value; syncFocus(); },
		dispose() { disposed = true; syncFocus(); },
		invalidate() { input.invalidate(); },
		handleInput(data: string) {
			if (disposed || finished) return;
			// Pi's default Escape matches both actions; text-entry Back owns it first.
			if (editing && is(data, "tui.select.cancel")) back();
			else if (keys.matches(data, "app.interrupt")) finish({ status: "cancelled" });
			else if (editing) {
				warning = "";
				const previous = input.getValue();
				input.handleInput(data);
				if (sanitizeDisplay(input.getValue()) !== input.getValue() || input.getValue().length > ANSWER_TEXT_LIMIT) {
					input.setValue(previous); warning = "Text must be bounded and contain no terminal controls";
				}
			} else handleKey(data);
			redraw();
		},
		render,
	};
}
