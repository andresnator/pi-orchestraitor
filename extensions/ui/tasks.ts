import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

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
export type PlanBinding = { project: string; path: string; sha256: string; groups: string[] };
export type TaskState = { version: number; revision: number; tasks: Task[]; binding?: PlanBinding };
export type TaskEvent = { revision: number; at?: number; change: string };
/** Keyed by task ID; `since` is when the current status began. */
export type TaskActivity = Map<string, { since?: number; events: TaskEvent[] }>;
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
export function replayTaskActivity(branch: any[]): { state: TaskState; activity: TaskActivity } {
	let state = emptyTasks();
	let activity: TaskActivity = new Map();
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
			state = structuredClone(details.state);
			activity = next;
		} catch { /* Invalid receipts never reset or advance the active projection. */ }
	}
	return { state, activity };
}

export function replayTasks(branch: any[]): TaskState { return replayTaskActivity(branch).state; }

/** The repository root, or the cwd realpath outside git; list reports it as the binding project identity. */
async function repositoryRoot(cwd: string) {
	const original = await realpath(cwd);
	let candidate = original;
	while (true) {
		try { await lstat(join(candidate, ".git")); return candidate; }
		catch (error: any) { if (error.code !== "ENOENT") throw error; }
		const parent = dirname(candidate);
		if (parent === candidate) return original;
		candidate = parent;
	}
}

/** Names what did not match, or undefined when the bound plan is current. */
async function bindingMismatch(binding: PlanBinding, cwd: string): Promise<string | undefined> {
	try {
		validateBinding(binding);
		const root = await repositoryRoot(cwd);
		if (binding.project !== root) return `project ${binding.project} is not the project identity ${root}`;
		const target = await realpath(resolve(root, binding.path));
		const path = relative(root, target);
		if (isAbsolute(path) || path === ".." || path.startsWith("../")) return `${binding.path} resolves outside the project`;
		if (createHash("sha256").update(await readFile(target)).digest("hex") !== binding.sha256) return `${binding.path} changed since its SHA-256 was recorded`;
	} catch (error: any) { return `${binding.path} could not be verified (${error.code ?? error.message})`; }
}

/** Called before mutations or display refreshes, never from a render callback. */
export async function checkTaskBinding(binding: PlanBinding | undefined, cwd: string): Promise<boolean> {
	return !binding || !await bindingMismatch(binding, cwd);
}

export function createTaskTool(getGeneration: () => number): ToolDefinition {
	return {
		name: TASK_TOOL_NAME, label: "Work tasks", exposure: "model-only", executionMode: "sequential",
		annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
		description: "Track authorized branch work: replace/add/update/list/clear. Mutations require expectedRevision; done needs parent evidence, reopening a reason. Reuse returned revisions; list retrieves the complete board and project identity. Pi runs its whole message sequentially: pair updates with at most one slow call. Plan binding verifies the plan, not execution recovery.",
		parameters: TaskParameters,
		async execute(_id, params: TaskOperation, signal, _onUpdate, ctx: ExtensionContext) {
			const combined = signal && ctx.signal ? AbortSignal.any([signal, ctx.signal]) : signal ?? ctx.signal;
			const generation = getGeneration();
			const leaf = ctx.sessionManager.getLeafId();
			const before = replayTasks(ctx.sessionManager.getBranch());
			if (combined?.aborted) throw new Error("Task update cancelled");
			const state = applyTaskOperation(before, params);
			// Clear drops the binding and a supplied binding replaces it, so only the resulting binding is checked.
			const mismatch = state.binding && await bindingMismatch(state.binding, ctx.cwd);
			const bindingCurrent = !mismatch;
			if (mismatch && params.operation !== "list") throw new Error(params.binding ? `Supplied plan binding does not match: ${mismatch}. Use the projectIdentity from list and the current plan SHA-256.`
				: `Plan binding is stale: ${mismatch}. Recover with replace and a fresh binding (projectIdentity from list, current SHA-256), or clear to drop the binding.`);
			const projectIdentity = await repositoryRoot(ctx.cwd);
			if (combined?.aborted) throw new Error("Task update cancelled");
			if (generation !== getGeneration() || leaf !== ctx.sessionManager.getLeafId() || JSON.stringify(before) !== JSON.stringify(replayTasks(ctx.sessionManager.getBranch()))) throw new Error("Session changed during task operation; retry from current branch state");
			// Mutations fail on a stale binding, so only bound boards report it; list returns the project identity.
			const response = params.operation === "list" ? { state, bindingCurrent, projectIdentity } : {
				operation: params.operation, revision: state.revision, ...(state.binding ? { bindingCurrent } : {}),
				tasks: params.operation === "clear" ? [] : params.operation === "update" ? state.tasks.filter(task => task.id === params.id)
					: state.tasks.filter(task => params.tasks?.some(changed => changed.id === task.id)),
				...(params.binding ? { binding: state.binding } : {}),
			};
			return { content: [{ type: "text", text: JSON.stringify(response) }],
				details: { version: TASK_SCHEMA_VERSION, operation: params.operation, state, bindingCurrent, projectIdentity } };
		},
	};
}
