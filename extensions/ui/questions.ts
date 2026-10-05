import type { KeybindingsManager, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Box, Input, ScrollView, SelectList, Text, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type TUI } from "@earendil-works/pi-tui";
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
const CARD_FIXED_ROWS = 7;
const CARD_NATIVE_LAYOUT_ROWS = 6; // Native footer, widget/status and chat spacing.
const CARD_PADDING_COLUMNS = 4;
const CARD_COMPACT_ROWS = 13;
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

/** Native components own selection, editing and scrolling; this owns only form state. */
export function createQuestionnaire(questions: Question[], tui: TUI, getTheme: () => Theme, keys: KeybindingsManager, done: (result: Outcome) => void) {
	const drafts = questions.map((question): Answer => ({ id: question.id, values: [] }));
	let questionIndex = 0;
	let selectionIndex = 0;
	let editing = false;
	let focused = false;
	let disposed = false;
	let finished = false;
	let maxVisible = OPTION_LIMIT;
	let warning = "";
	let list: SelectList;
	const input = new Input({ placeholder: "Write an answer" });
	const prompt = new Text("", 0, 0);
	const scroll = new ScrollView(prompt, { scrollbar: "hidden", follow: "none" });
	const review = () => questionIndex >= questions.length;
	const redraw = () => { tui.requestRender(); };
	const finish = (result: Outcome) => {
		if (finished || disposed) return;
		finished = true;
		input.focused = false;
		done(result);
	};
	const syncControls = () => { buildList(); input.focused = focused && editing && !finished && !disposed; };
	const advance = () => { editing = false; questionIndex++; selectionIndex = 0; warning = ""; scroll.scrollToStart(); syncControls(); redraw(); };
	input.onEscape = () => { editing = false; syncControls(); redraw(); };
	input.onSubmit = (value) => {
		try { text(value, ANSWER_TEXT_LIMIT, "answer text"); }
		catch (error) { warning = String((error as Error).message); redraw(); return; }
		drafts[questionIndex] = { id: questions[questionIndex].id, values: [], text: value };
		advance();
	};
	function items() {
		if (review()) return [...questions.map((question, index) => ({ value: `review:${index}`, label: `${index + 1}. ${label(question.prompt)}: ${summary(index)}` })), { value: "submit", label: "Submit answers" }];
		const question = questions[questionIndex], draft = drafts[questionIndex];
		return [...question.options.map((option, index) => ({ value: `option:${index}`, label: `${question.selection === "single" ? draft.values.includes(option.value) ? "(●)" : "( )" : draft.values.includes(option.value) ? "[x]" : "[ ]"} ${index + 1}. ${label(option.label)}` })),
			...(question.allowText ? [{ value: "text", label: "Write text" }] : []), { value: "continue", label: "Continue / review" }, { value: "clear", label: "Clear answer" }];
	}
	function summary(index: number) {
		const draft = drafts[index], question = questions[index];
		return draft.text !== undefined ? label(draft.text) : draft.values.length ? draft.values.map((value) => label(question.options.find((option) => option.value === value)!.label)).join(", ") : "Unanswered";
	}
	function select(value: string) {
		warning = "";
		if (value === "submit") {
			try { finish({ status: "answered", answers: validateAnswers(questions, drafts) }); }
			catch (error) { warning = String((error as Error).message); }
		} else if (value.startsWith("review:")) {
			questionIndex = Number(value.slice("review:".length)); selectionIndex = 0; scroll.scrollToStart();
		} else if (value === "continue") advance();
		else if (value === "text") { editing = true; input.setValue(drafts[questionIndex].text ?? ""); }
		else if (value === "clear") drafts[questionIndex] = { id: questions[questionIndex].id, values: [] };
		else if (value.startsWith("option:")) {
			const question = questions[questionIndex], option = question.options[Number(value.slice("option:".length))];
			const values = drafts[questionIndex].values;
			drafts[questionIndex] = { id: question.id, values: question.selection === "single" ? [option.value] : values.includes(option.value) ? values.filter((item) => item !== option.value) : [...values, option.value] };
		}
		syncControls();
		redraw();
	}
	function buildList() {
		const theme = getTheme();
		const current = items();
		list = new SelectList(current, maxVisible, {
			selectedPrefix: (value) => theme.fg("accent", value), selectedText: (value) => theme.fg("accent", value),
			description: (value) => theme.fg("muted", value), scrollInfo: (value) => theme.fg("dim", value), noMatch: (value) => theme.fg("warning", value),
		});
		list.setSelectedIndex(selectionIndex);
		list.onSelectionChange = (item) => { selectionIndex = current.findIndex((entry) => entry.value === item.value); };
		list.onSelect = (item) => select(item.value);
		list.onCancel = () => finish({ status: "cancelled" });
	}
	syncControls();
	return {
		get focused() { return focused; },
		set focused(value: boolean) { focused = value; input.focused = value && editing && !finished && !disposed; },
		dispose() { disposed = true; input.focused = false; },
		invalidate() { input.invalidate(); list.invalidate(); prompt.invalidate(); scroll.invalidate(); },
		handleInput(data: string) {
			if (disposed || finished) return;
			// Pi's default Escape matches both actions; text-entry Back owns it first.
			if (editing && keys.matches(data, "tui.select.cancel")) { input.onEscape(); return; }
			if (keys.matches(data, "app.interrupt")) { finish({ status: "cancelled" }); return; }
			if (editing) {
				const previous = input.getValue();
				input.handleInput(data);
				if (sanitizeDisplay(input.getValue()) !== input.getValue() || input.getValue().length > ANSWER_TEXT_LIMIT) {
					input.setValue(previous); warning = "Text must be bounded and contain no terminal controls";
				}
			} else if (keys.matches(data, "tui.select.cancel")) finish({ status: "cancelled" });
			else if (keys.matches(data, "tui.select.pageUp")) scroll.scrollBy(-Math.max(1, scroll.viewportHeight));
			else if (keys.matches(data, "tui.select.pageDown")) scroll.scrollBy(Math.max(1, scroll.viewportHeight));
			else if (matchesKey(data, "space") && !review() && selectionIndex < questions[questionIndex].options.length) select(`option:${selectionIndex}`);
			else list.handleInput(data);
			redraw();
		},
		render(width: number) {
			const theme = getTheme();
			const bordered = width >= CARD_PADDING_COLUMNS + 2;
			const inner = Math.max(1, width - (bordered ? CARD_PADDING_COLUMNS : 0));
			const budget = Math.max(1, tui.terminal.rows - CARD_NATIVE_LAYOUT_ROWS - (bordered ? 2 : 0));
			const compact = tui.terminal.rows <= CARD_COMPACT_ROWS;
			prompt.setText(wrapTextWithAnsi(label(review() ? "Review all answers; select a row to correct it" : questions[questionIndex].prompt), inner).join("\n"));
			const promptLines = scroll.render(inner);
			const promptHeight = Math.min(Math.max(1, budget - CARD_FIXED_ROWS), Math.max(1, Math.min(3, promptLines.length)));
			scroll.updateLayout(promptLines.length, promptHeight, redraw);
			maxVisible = Math.max(1, budget - promptHeight - CARD_FIXED_ROWS);
			syncControls();
			const controls = editing ? input.render(inner) : list.render(inner);
			if (!editing && !compact) {
				const current = items();
				const start = Math.max(0, Math.min(selectionIndex - Math.floor(maxVisible / 2), current.length - maxVisible));
				const actionStart = review() ? questions.length : questions[questionIndex].options.length;
				if (actionStart >= start && actionStart < start + maxVisible) controls.splice(actionStart - start, 0, theme.fg("muted", `─ ACTIONS ${"─".repeat(Math.max(0, inner - 10))}`));
			}
			const hint = (action: Parameters<KeybindingsManager["getKeys"]>[0], fallback: string) => keys.getKeys?.(action)?.join("/") || fallback;
			const hints = editing ? `${hint("tui.select.confirm", "enter")} save text · ${hint("tui.select.cancel", "esc")} back` :
				`${hint("tui.select.confirm", "enter")} choose · ${hint("tui.select.pageDown", "pgdn")} scroll · ${hint("tui.select.cancel", "esc")} cancel`;
			const content = [...promptLines.slice(scroll.scrollTop, scroll.scrollTop + promptHeight),
				...(!compact ? [theme.fg("accent", editing ? "TEXT ENTRY" : review() ? "ANSWERS · correct or submit explicitly" : `CHOICES · ${questions[questionIndex].selection === "single" ? "Single choice" : "Multiple choices"}`)] : []),
				...controls, theme.fg(warning ? "warning" : "muted", warning || (review() ? "Not submitted · choose Submit answers explicitly" : editing ? "Text is a draft until saved and submitted" : "Highlight is not approval · Space selects")), theme.fg("dim", hints)];
			const bounded = content.length > budget ? [...content.slice(0, Math.max(0, budget - 2)), ...content.slice(-2)] : content;
			if (!bordered) return bounded.map(line => truncateToWidth(line, width));
			const box = new Box(1, 0, value => theme.bg("userMessageBg", value));
			for (const line of bounded) box.addChild(new Text(truncateToWidth(line, inner), 0, 0));
			const title = truncateToWidth(` ${review() ? "REVIEW · explicit submission" : `QUESTION · ${questionIndex + 1} / ${questions.length}`} `, width - 2);
			return [theme.fg("accent", `╭${title}${"─".repeat(Math.max(0, width - 2 - visibleWidth(title)))}╮`),
				...box.render(width - 2).map(line => theme.fg("accent", "│") + line + theme.fg("accent", "│")),
				theme.fg("accent", `╰${"─".repeat(width - 2)}╯`)].map(line => truncateToWidth(line, width));
		},
	};
}
