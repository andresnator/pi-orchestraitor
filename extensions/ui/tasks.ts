import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ExtensionContext, KeybindingsManager, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { matchesKey, ScrollView, Text, truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { sanitizeDisplay } from "./display.ts";

export const TASK_TOOL_NAME = "orchestraitor_tasks";
export const TASK_SCHEMA_VERSION = 1;
export const TASK_LIMIT = 50;
export const TASK_TITLE_LIMIT = 200;
export const TASK_NOTE_LIMIT = 1000;
const ID_LIMIT = 80;
const HEADER_ROWS = 5;
const SHORT_TERMINAL_ROWS = 16;
const PANEL_RESERVED_ROWS = 8;
const TASK_STATUSES = ["pending", "in_progress", "blocked", "done"] as const;
const OPERATIONS = ["replace", "add", "update", "list", "clear"] as const;
export type TaskStatus = typeof TASK_STATUSES[number];
export type Task = { id: string; title: string; status: TaskStatus; evidence?: string; reason?: string; group?: string };
export type PlanBinding = { project: string; path: string; sha256: string; groups: string[] };
export type TaskState = { version: number; revision: number; tasks: Task[]; binding?: PlanBinding };
export type TaskOperation = { operation: typeof OPERATIONS[number]; expectedRevision?: number; tasks?: Task[];
	id?: string; changes?: Partial<Omit<Task, "id">>; binding?: PlanBinding };

const boundedText = (limit: number) => Type.String({ minLength: 1, maxLength: limit });
const statusSchema = Type.Union(TASK_STATUSES.map((status) => Type.Literal(status)));
const bindingSchema = Type.Object({ project: boundedText(TASK_NOTE_LIMIT), path: boundedText(TASK_NOTE_LIMIT),
	sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }), groups: Type.Array(boundedText(ID_LIMIT), { minItems: 1, maxItems: TASK_LIMIT }) }, { additionalProperties: false });
const taskFields = { title: boundedText(TASK_TITLE_LIMIT), status: statusSchema,
	evidence: Type.Optional(boundedText(TASK_NOTE_LIMIT)), reason: Type.Optional(boundedText(TASK_NOTE_LIMIT)), group: Type.Optional(boundedText(ID_LIMIT)) };
export const TaskParameters = Type.Object({ operation: Type.Union(OPERATIONS.map((operation) => Type.Literal(operation))),
	expectedRevision: Type.Optional(Type.Integer({ minimum: 0 })),
	tasks: Type.Optional(Type.Array(Type.Object({ id: boundedText(ID_LIMIT), ...taskFields }, { additionalProperties: false }), { maxItems: TASK_LIMIT })),
	id: Type.Optional(boundedText(ID_LIMIT)),
	changes: Type.Optional(Type.Object({ title: Type.Optional(taskFields.title), status: Type.Optional(statusSchema),
		evidence: taskFields.evidence, reason: taskFields.reason, group: taskFields.group }, { additionalProperties: false })),
	binding: Type.Optional(bindingSchema) }, { additionalProperties: false });

export function emptyTasks(): TaskState { return { version: TASK_SCHEMA_VERSION, revision: 0, tasks: [] }; }

function text(value: unknown, label: string, limit: number): asserts value is string {
	if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error(`Invalid ${label}: non-empty text up to ${limit} characters required`);
}

function validateBinding(binding: PlanBinding) {
	text(binding.project, "binding project", TASK_NOTE_LIMIT);
	text(binding.path, "binding path", TASK_NOTE_LIMIT);
	if (isAbsolute(binding.path) || binding.path.includes("\\") || binding.path.split("/").some((part) => !part || part === "." || part === "..") || /[\x00-\x1f]/u.test(binding.path)) throw new Error("Invalid repository-relative binding path");
	if (!/^[a-f0-9]{64}$/u.test(binding.sha256)) throw new Error("Invalid binding SHA-256");
	if (!Array.isArray(binding.groups) || !binding.groups.length || binding.groups.length > TASK_LIMIT || new Set(binding.groups).size !== binding.groups.length) throw new Error("Binding groups must be unique and bounded");
	for (const group of binding.groups) text(group, "binding group", ID_LIMIT);
}

function validateTask(task: Task, binding?: PlanBinding) {
	text(task.id, "task ID", ID_LIMIT);
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(task.id)) throw new Error("Invalid stable task ID");
	text(task.title, "task title", TASK_TITLE_LIMIT);
	if (!TASK_STATUSES.includes(task.status)) throw new Error("Invalid task status");
	for (const field of ["evidence", "reason", "group"] as const) if (task[field] !== undefined) text(task[field], field, field === "group" ? ID_LIMIT : TASK_NOTE_LIMIT);
	if (task.status === "done" && !task.evidence?.trim()) throw new Error("Done requires parent-reported evidence");
	if (binding && (!task.group || !binding.groups.includes(task.group))) throw new Error("Plan-bound tasks require a stable group reference from the binding");
}

function validateState(state: TaskState) {
	if (!state || state.version !== TASK_SCHEMA_VERSION || !Number.isSafeInteger(state.revision) || state.revision < 0) throw new Error("Invalid task state version/revision");
	if (!Array.isArray(state.tasks) || state.tasks.length > TASK_LIMIT) throw new Error(`Task limit is ${TASK_LIMIT}`);
	if (state.binding) validateBinding(state.binding);
	if (new Set(state.tasks.map((task) => task?.id)).size !== state.tasks.length) throw new Error("Task IDs must be unique");
	for (const task of state.tasks) validateTask(task, state.binding);
}

function validateTransition(previous: Task | undefined, next: Task, supplied: Partial<Task>) {
	if (next.status === "done" && previous?.status !== "done" && !supplied.evidence?.trim()) throw new Error("Marking done requires evidence in this update");
	if (previous?.status === "done" && next.status !== "done" && !supplied.reason?.trim()) throw new Error("Reopening a done task requires a reason in this update");
}

/** Pure candidate generation: no UI or authoritative state changes before native persistence. */
export function applyTaskOperation(current: TaskState, params: TaskOperation): TaskState {
	validateState(current);
	if (!OPERATIONS.includes(params.operation)) throw new Error("Unknown task operation");
	if (params.operation === "list") return structuredClone(current);
	if (!Number.isSafeInteger(params.expectedRevision) || params.expectedRevision !== current.revision) throw new Error(`Stale or missing expected revision: current revision is ${current.revision}`);
	if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error("Task revision limit reached");
	const next = structuredClone(current);
	next.revision++;
	if (params.binding) { validateBinding(params.binding); next.binding = structuredClone(params.binding); }
	switch (params.operation) {
		case "replace":
			if (!Array.isArray(params.tasks)) throw new Error("replace requires tasks");
			if (current.tasks.some((task) => !params.tasks!.some(({ id }) => id === task.id))) throw new Error("Replacement must preserve stable IDs; clear explicitly to discard the list");
			next.tasks = structuredClone(params.tasks);
			for (const task of next.tasks) validateTransition(current.tasks.find(({ id }) => id === task.id), task, task);
			break;
		case "add":
			if (!Array.isArray(params.tasks) || !params.tasks.length) throw new Error("add requires tasks");
			next.tasks.push(...structuredClone(params.tasks));
			for (const task of params.tasks) validateTransition(undefined, task, task);
			break;
		case "update": {
			const index = current.tasks.findIndex(({ id }) => id === params.id);
			if (index < 0) throw new Error(`Unknown task ID: ${params.id}`);
			if (!params.changes || !Object.keys(params.changes).length || Object.keys(params.changes).some((key) => !["title", "status", "evidence", "reason", "group"].includes(key))) throw new Error("update requires valid task changes");
			next.tasks[index] = { ...next.tasks[index], ...structuredClone(params.changes) };
			validateTransition(current.tasks[index], next.tasks[index], params.changes);
			break;
		}
		case "clear": next.tasks = []; delete next.binding; break;
	}
	validateState(next);
	return next;
}

/** Only successful, schema-valid mutation receipts on the active branch are authoritative. */
export function replayTasks(branch: any[]): TaskState {
	let state = emptyTasks();
	for (const entry of branch) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "toolResult" || message.toolName !== TASK_TOOL_NAME || message.isError) continue;
		const details = message.details;
		if (details?.version !== TASK_SCHEMA_VERSION || !OPERATIONS.includes(details.operation) || details.operation === "list" || details.state?.revision !== state.revision + 1) continue;
		try {
			validateState(details.state);
			for (const task of details.state.tasks) validateTransition(state.tasks.find(({ id }) => id === task.id), task, task);
			state = structuredClone(details.state);
		} catch { /* Invalid receipts never reset or advance the active projection. */ }
	}
	return state;
}

async function repositoryRoot(cwd: string, required = false) {
	const original = await realpath(cwd);
	let candidate = original;
	while (true) {
		try { await lstat(join(candidate, ".git")); return candidate; }
		catch (error: any) { if (error.code !== "ENOENT") throw error; }
		const parent = dirname(candidate);
		if (parent === candidate) {
			if (required) throw new Error("Plan binding requires a repository root");
			return original;
		}
		candidate = parent;
	}
}

/** Called before mutations or display refreshes, never from a render callback. */
export async function checkTaskBinding(binding: PlanBinding | undefined, cwd: string): Promise<boolean> {
	if (!binding) return true;
	try {
		validateBinding(binding);
		const root = await repositoryRoot(cwd, true);
		if (binding.project !== root) return false;
		const target = await realpath(resolve(root, binding.path));
		const path = relative(root, target);
		if (isAbsolute(path) || path === ".." || path.startsWith("../")) return false;
		return createHash("sha256").update(await readFile(target)).digest("hex") === binding.sha256;
	} catch { return false; }
}

export function createTaskTool(getGeneration: () => number): ToolDefinition {
	return {
		name: TASK_TOOL_NAME, label: "Work tasks", exposure: "model-only", executionMode: "sequential",
		annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
		description: "Project authorized multi-step work into this session branch. Operations: replace/add/update/list/clear. Mutations require expectedRevision; done requires parent evidence and reopening requires a reason. Use list for revision and canonical repository project identity. Plan binding is read-only verification, not execution recovery.",
		parameters: TaskParameters,
		async execute(_id, params: TaskOperation, signal, _onUpdate, ctx: ExtensionContext) {
			const combined = signal && ctx.signal ? AbortSignal.any([signal, ctx.signal]) : signal ?? ctx.signal;
			const generation = getGeneration();
			const leaf = ctx.sessionManager.getLeafId();
			const before = replayTasks(ctx.sessionManager.getBranch());
			if (combined?.aborted) throw new Error("Task update cancelled");
			const state = applyTaskOperation(before, params);
			const binding = params.binding ?? before.binding;
			const bindingCurrent = await checkTaskBinding(binding, ctx.cwd);
			if (params.operation !== "list" && !bindingCurrent) throw new Error("Plan binding is stale: project/path/hash did not match");
			const projectIdentity = await repositoryRoot(ctx.cwd);
			if (combined?.aborted) throw new Error("Task update cancelled");
			if (generation !== getGeneration() || leaf !== ctx.sessionManager.getLeafId() || JSON.stringify(before) !== JSON.stringify(replayTasks(ctx.sessionManager.getBranch()))) throw new Error("Session changed during task operation; retry from current branch state");
			return { content: [{ type: "text", text: JSON.stringify({ state, bindingCurrent, projectIdentity }) }],
				details: { version: TASK_SCHEMA_VERSION, operation: params.operation, state, bindingCurrent, projectIdentity } };
		},
	};
}

export function taskHeader(state: TaskState, expanded: boolean, width: number, height: number, theme: Theme, bindingCurrent: boolean) {
	if (!state.tasks.length) return [];
	const done = state.tasks.filter(({ status }) => status === "done").length;
	const summary = `Tasks · ${done}/${state.tasks.length} done${bindingCurrent ? "" : " · plan binding stale"}`;
	const rows = [summary];
	if (expanded && height >= SHORT_TERMINAL_ROWS) {
		for (const task of state.tasks.slice(0, HEADER_ROWS - 1)) rows.push(`${task.id} · ${task.status} · ${task.title}`);
	}
	return rows.map((row) => truncateToWidth(theme.fg("muted", sanitizeDisplay(row).replace(/\s+/gu, " ")), width));
}

export function createTaskPanel(getState: () => { state: TaskState; bindingCurrent: boolean }, tui: TUI, theme: Theme,
	keys: KeybindingsManager, done: (result: { status: "closed" }) => void) {
	const scroll = new ScrollView({ invalidate() {}, render(width) {
		const { state, bindingCurrent } = getState();
		const rows = [`Tasks · revision ${state.revision} · parent-reported evidence, not runtime certification`];
		if (!bindingCurrent) rows.push("Plan binding stale or unavailable; old projection is not current.");
		if (state.binding) rows.push(`Plan: ${state.binding.path} · SHA-256 ${state.binding.sha256}`);
		if (!state.tasks.length) rows.push("No branch tasks.");
		for (const task of state.tasks) {
			rows.push(`${task.id} · ${task.status} · ${task.title}`);
			if (task.group) rows.push(`  group: ${task.group}`);
			if (task.evidence) rows.push(`  evidence: ${task.evidence}`);
			if (task.reason) rows.push(`  reason: ${task.reason}`);
		}
		return new Text(theme.fg("text", sanitizeDisplay(rows.join("\n"))), 0, 0).render(Math.max(1, width));
	} }, { scrollbar: "hidden" });
	return {
		invalidate() { scroll.invalidate(); },
		handleInput(data: string) {
			if (matchesKey(data, "escape") || keys.matches(data, "tui.select.cancel")) { done({ status: "closed" }); return; }
			if (keys.matches(data, "tui.select.up")) scroll.scrollBy(-1);
			else if (keys.matches(data, "tui.select.down")) scroll.scrollBy(1);
			else if (keys.matches(data, "tui.select.pageUp")) scroll.scrollBy(-Math.max(1, scroll.viewportHeight - 1));
			else if (keys.matches(data, "tui.select.pageDown")) scroll.scrollBy(Math.max(1, scroll.viewportHeight - 1));
			tui.requestRender();
		},
		render(width: number) {
			const rows = scroll.render(width);
			const height = Math.max(1, tui.terminal.rows - PANEL_RESERVED_ROWS);
			scroll.updateLayout(rows.length, height, () => tui.requestRender());
			return [...rows.slice(scroll.scrollTop, scroll.scrollTop + height), truncateToWidth("Selection keys scroll · Escape closes", width)];
		},
	};
}
