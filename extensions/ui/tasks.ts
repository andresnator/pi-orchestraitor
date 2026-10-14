import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Value } from "typebox/value";

export const TASK_TOOL_NAME = "orchestraitor_tasks";
export const TASK_SCHEMA_VERSION = 1;
export const TASK_LIMIT = 50;
export const TASK_TITLE_LIMIT = 200;
export const TASK_NOTE_LIMIT = 1000;
const ID_LIMIT = 80;
const ACTIVITY_LIMIT = 8;
const TASK_STATUSES = ["pending", "in_progress", "blocked", "done"] as const;
const OPERATIONS = ["replace", "add", "update", "list", "clear"] as const;
export type TaskStatus = typeof TASK_STATUSES[number];
export type Task = { id: string; title: string; status: TaskStatus; evidence?: string; reason?: string; group?: string };
export type TaskState = { version: number; revision: number; tasks: Task[] };
export type TaskEvent = { revision: number; at?: number; change: string };
/** Keyed by task ID; `since` is when the current status began. */
export type TaskActivity = Map<string, { since?: number; events: TaskEvent[] }>;
export type TaskReplay = { state: TaskState; activity: TaskActivity };
export type TaskOperation = { operation: typeof OPERATIONS[number]; expectedRevision?: number; tasks?: Task[];
	id?: string; changes?: Partial<Omit<Task, "id">> };

const boundedText = (limit: number) => Type.String({ minLength: 1, maxLength: limit });
const statusSchema = StringEnum(TASK_STATUSES);
const taskFields = { title: boundedText(TASK_TITLE_LIMIT), status: statusSchema,
	evidence: Type.Optional(boundedText(TASK_NOTE_LIMIT)), reason: Type.Optional(boundedText(TASK_NOTE_LIMIT)), group: Type.Optional(boundedText(ID_LIMIT)) };
export const TaskParameters = Type.Object({ operation: StringEnum(OPERATIONS),
	expectedRevision: Type.Optional(Type.Integer({ minimum: 0 })),
	tasks: Type.Optional(Type.Array(Type.Object({ id: boundedText(ID_LIMIT), ...taskFields }, { additionalProperties: false }), { maxItems: TASK_LIMIT })),
	id: Type.Optional(boundedText(ID_LIMIT)),
	changes: Type.Optional(Type.Object({ title: Type.Optional(taskFields.title), status: Type.Optional(statusSchema),
		evidence: taskFields.evidence, reason: taskFields.reason, group: taskFields.group }, { additionalProperties: false })) }, { additionalProperties: false });

export function emptyTasks(): TaskState { return { version: TASK_SCHEMA_VERSION, revision: 0, tasks: [] }; }

// Pi validates tool arguments with TypeBox, which counts maxLength in grapheme clusters; they never outnumber UTF-16 units.
function text(value: unknown, label: string, limit: number): asserts value is string {
	if (typeof value !== "string" || !value.trim() || (value.length > limit && !Value.Check(Type.String({ maxLength: limit }), value))) throw new Error(`Invalid ${label}: non-empty text up to ${limit} characters required`);
}

function validateTask(task: Task) {
	text(task.id, "task ID", ID_LIMIT);
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(task.id)) throw new Error("Invalid stable task ID");
	text(task.title, "task title", TASK_TITLE_LIMIT);
	if (!TASK_STATUSES.includes(task.status)) throw new Error("Invalid task status");
	for (const field of ["evidence", "reason", "group"] as const) if (task[field] !== undefined) text(task[field], field, field === "group" ? ID_LIMIT : TASK_NOTE_LIMIT);
	if (task.status === "done" && !task.evidence?.trim()) throw new Error("Done requires parent-reported evidence");
}

function validateState(state: TaskState) {
	if (!state || state.version !== TASK_SCHEMA_VERSION || !Number.isSafeInteger(state.revision) || state.revision < 0) throw new Error("Invalid task state version/revision");
	if (!Array.isArray(state.tasks) || state.tasks.length > TASK_LIMIT) throw new Error(`Task limit is ${TASK_LIMIT}`);
	if (new Set(state.tasks.map((task) => task?.id)).size !== state.tasks.length) throw new Error("Task IDs must be unique");
	for (const task of state.tasks) validateTask(task);
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
		case "clear": next.tasks = []; break;
	}
	validateState(next);
	return next;
}

function describeChange(previous: Task | undefined, task: Task) {
	const label = (status: TaskStatus) => status.replace("_", " ");
	if (!previous) return `added as ${label(task.status)}`;
	const changes = [];
	if (previous.status !== task.status) changes.push(`${label(previous.status)} → ${label(task.status)}`);
	if (previous.title !== task.title) changes.push("title edited");
	if (previous.group !== task.group) changes.push(task.group ? `moved to ${task.group}` : "group removed");
	for (const note of ["evidence", "reason"] as const) {
		if (previous[note] !== task[note]) changes.push(`${note} ${!task[note] ? "removed" : previous[note] ? "updated" : "added"}`);
	}
	return changes.join(" · ") || undefined;
}

function receiptTime(entry: any, message: any) {
	if (Number.isFinite(message.timestamp) && message.timestamp > 0) return message.timestamp as number;
	const parsed = Date.parse(entry.timestamp);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** Only successful, schema-valid mutation receipts on the active branch are authoritative.
 * Activity is display-only history derived from those same receipts; it never enters task state. */
export function replayTaskActivity(branch: any[], start: TaskReplay = { state: emptyTasks(), activity: new Map() }): TaskReplay {
	let { state, activity } = start;
	for (const entry of branch) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "toolResult" || message.toolName !== TASK_TOOL_NAME || message.isError) continue;
		const details = message.details;
		if (details?.version !== TASK_SCHEMA_VERSION || !OPERATIONS.includes(details.operation) || details.operation === "list" || details.state?.revision !== state.revision + 1) continue;
		try {
			validateState(details.state);
			for (const task of details.state.tasks) validateTransition(state.tasks.find(({ id }) => id === task.id), task, task);
			const at = receiptTime(entry, message);
			const next: TaskActivity = new Map();
			for (const task of details.state.tasks as Task[]) {
				const previous = state.tasks.find(({ id }) => id === task.id);
				const record = previous && activity.get(task.id) || { events: [] };
				const change = describeChange(previous, task);
				next.set(task.id, { since: !previous || previous.status !== task.status ? at : record.since,
					events: change ? [...record.events, { revision: details.state.revision, at, change }].slice(-ACTIVITY_LIMIT) : record.events });
			}
			// Receipts written before plan binding was removed may carry a binding; the board drops it.
			state = { version: details.state.version, revision: details.state.revision, tasks: structuredClone(details.state.tasks) };
			activity = next;
		} catch { /* Invalid receipts never reset or advance the active projection. */ }
	}
	return { state, activity };
}

export function replayTasks(branch: any[]): TaskState { return replayTaskActivity(branch).state; }

/** Entries after `ancestor` on the branch ending at `leaf`, or undefined when `ancestor` is not on it. */
function appendedSince(manager: ExtensionContext["sessionManager"], leaf: string | null, ancestor: string | null) {
	const entries = [];
	for (let id = leaf; id !== ancestor;) {
		const entry = id === null ? undefined : manager.getEntry(id);
		if (!entry) return undefined;
		entries.push(entry); id = entry.parentId;
	}
	return entries.reverse();
}

/** Entries are immutable, so a session's replay extends with the entries appended since its last leaf;
 * a leaf that does not descend from it (branch switch, /tree) replays the whole branch. */
export function createTaskReplay() {
	const last = new WeakMap<object, { leaf: string | null; replay: TaskReplay }>();
	return (manager: ExtensionContext["sessionManager"]) => {
		const leaf = manager.getLeafId(), previous = last.get(manager);
		const appended = previous && appendedSince(manager, leaf, previous.leaf);
		const replay = appended ? replayTaskActivity(appended, previous.replay) : replayTaskActivity(manager.getBranch());
		last.set(manager, { leaf, replay });
		return replay;
	};
}

export function createTaskTool(): ToolDefinition {
	const replay = createTaskReplay();
	return {
		name: TASK_TOOL_NAME, label: "Work tasks", exposure: "model-only", executionMode: "sequential",
		annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
		description: "Track authorized branch work. Mutations require expectedRevision (reuse returned revisions); done needs parent evidence, reopening a reason. list returns the complete board. Pi runs the whole message sequentially: pair updates with at most one slow call.",
		parameters: TaskParameters,
		async execute(_id, params: TaskOperation, signal, _onUpdate, ctx: ExtensionContext) {
			if (signal?.aborted || ctx.signal?.aborted) throw new Error("Task update cancelled");
			const state = applyTaskOperation(replay(ctx.sessionManager).state, params);
			const response = params.operation === "list" ? { state } : {
				operation: params.operation, revision: state.revision,
				tasks: params.operation === "clear" ? [] : params.operation === "update" ? state.tasks.filter(task => task.id === params.id)
					: state.tasks.filter(task => params.tasks?.some(changed => changed.id === task.id)),
			};
			return { content: [{ type: "text", text: JSON.stringify(response) }],
				details: { version: TASK_SCHEMA_VERSION, operation: params.operation, state } };
		},
	};
}
