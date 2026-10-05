import { stripVTControlCharacters } from "node:util";

export const WORKBENCH_VERSION = 1;
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
export const MAX_TASKS = 50;
export const MAX_AGENT_HISTORY = 20;
export const MAX_MODEL_ROWS = 100;
const MAX_TEXT = 1000;
const TASK_STATES = ["blocked", "in_progress", "pending", "done"];
const AGENT_PHASES = ["preparing", "starting", "running", "stopping", "completed", "failed", "cancelled", "timed_out", "termination_failed", "unavailable"];
const USAGE_KEYS = ["input", "output", "cacheRead", "cacheWrite", "total"];
const TOKEN_CONTROL = /[\x00-\x1f\x7f-\x9f]/u;
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = reason => { throw new Error(`Invalid workbench snapshot: ${reason}`); };
function object(value, keys) {
	if (!isObject(value) || Object.keys(value).some(key => !keys.includes(key))) fail("object fields");
}
function text(value, max = MAX_TEXT) {
	if (typeof value !== "string" || !value.trim() || value.length > max || TOKEN_CONTROL.test(value) || stripVTControlCharacters(value) !== value) fail("display text");
}
function optionalText(value, max = MAX_TEXT) { if (value !== undefined) text(value, max); }
function integer(value) { if (!Number.isSafeInteger(value) || value < 0) fail("nonnegative safe integer"); }
function flag(value) { if (typeof value !== "boolean") fail("boolean"); }
function list(value, max) { if (!Array.isArray(value) || value.length > max) fail("bounded array"); }
function usage(value) {
	object(value, USAGE_KEYS);
	for (const key of USAGE_KEYS) integer(value[key]);
	if (value.total !== value.input + value.output + value.cacheRead + value.cacheWrite) fail("usage total");
}
function binding(value) {
	object(value, ["project", "path", "sha256", "groups"]);
	text(value.project); text(value.path);
	if (!/^[a-f0-9]{64}$/u.test(value.sha256)) fail("binding hash");
	list(value.groups, MAX_TASKS);
	if (new Set(value.groups).size !== value.groups.length) fail("binding groups");
	for (const group of value.groups) text(group, 80);
}
function task(row) {
	object(row, ["id", "title", "status", "group", "evidence", "reason"]);
	text(row.id, 80); text(row.title, 200);
	if (!TASK_STATES.includes(row.status)) fail("task status");
	optionalText(row.group, 80); optionalText(row.evidence); optionalText(row.reason);
	if (row.status === "done" && !row.evidence) fail("done evidence");
}
function agent(row) {
	object(row, ["id", "role", "label", "requestedModel", "effectiveModel", "phase", "diagnostic", "terminated", "toolCallId"]);
	optionalText(row.id, 200); text(row.role, 20); text(row.label, 200);
	optionalText(row.requestedModel, 200); optionalText(row.effectiveModel, 200);
	if (!AGENT_PHASES.includes(row.phase)) fail("agent phase");
	optionalText(row.diagnostic); optionalText(row.toolCallId, 200);
	if (row.terminated !== undefined) flag(row.terminated);
}
function context(value) {
	object(value, ["status", "tokens", "capacity", "percent"]);
	if (!["unknown", "estimated", "unsupported"].includes(value.status)) fail("context status");
	if (value.status === "estimated") {
		integer(value.tokens); integer(value.capacity);
		if (!value.capacity || !Number.isFinite(value.percent) || value.percent < 0 || value.percent > Number.MAX_SAFE_INTEGER) fail("context reading");
	} else if (["tokens", "capacity", "percent"].some(key => key in value)) fail("context unavailable");
}
function publisherIdentity(publisher) {
	object(publisher, ["instance", "pid", "pane", "workspace", "socket", "project", "session", "generation", "sequence", "publishedAt", "columns", "rows"]);
	for (const key of ["instance", "pane", "workspace", "socket", "project", "session"]) text(publisher[key]);
	for (const key of ["pid", "generation", "sequence", "publishedAt"]) integer(publisher[key]);
	for (const key of ["columns", "rows"]) if (publisher[key] !== undefined) integer(publisher[key]);
	if (!publisher.pid || !publisher.sequence) fail("source identity");
}

/** A local display lease, never an authorization to close a pane without live revalidation. */
export function validateWorkbenchOwnership(record) {
	object(record, ["version", "source", "companion", "createdAt"]);
	if (record.version !== WORKBENCH_VERSION) fail("ownership version");
	publisherIdentity(record.source); integer(record.createdAt);
	const pane = record.companion;
	object(pane, ["pane", "workspace", "tab", "terminal", "pid", "plugin", "entrypoint", "token"]);
	for (const key of ["pane", "workspace", "tab", "terminal", "token"]) text(pane[key], 200);
	integer(pane.pid);
	if (!pane.pid || pane.plugin !== "pi.orchestraitor" || pane.entrypoint !== "workbench" || pane.pane === record.source.pane || pane.workspace !== record.source.workspace) fail("companion identity");
	return record;
}

export function validateWorkbenchSnapshot(snapshot) {
	if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_SNAPSHOT_BYTES) fail("byte ceiling");
	object(snapshot, ["version", "publisher", "tasks", "agents", "usage"]);
	if (snapshot.version !== WORKBENCH_VERSION) fail("protocol version");
	const { publisher, tasks, agents, usage: recorded } = snapshot;
	publisherIdentity(publisher);
	object(tasks, ["revision", "bindingCurrent", "binding", "rows"]);
	integer(tasks.revision); flag(tasks.bindingCurrent);
	if (tasks.binding !== undefined) binding(tasks.binding);
	list(tasks.rows, MAX_TASKS);
	for (const row of tasks.rows) task(row);
	if (new Set(tasks.rows.map(row => row.id)).size !== tasks.rows.length) fail("duplicate task IDs");
	object(agents, ["live", "recent", "historyLimited", "nestedHistoryUnavailable", "launchBlocked"]);
	list(agents.live, 2); list(agents.recent, MAX_AGENT_HISTORY);
	for (const row of [...agents.live, ...agents.recent]) agent(row);
	for (const key of ["historyLimited", "nestedHistoryUnavailable", "launchBlocked"]) flag(agents[key]);
	object(recorded, ["total", "codex", "codexTotal", "unattributed", "unsupported", "overflow", "complete", "context", "attribution"]);
	object(recorded.attribution, ["parent", "delegated", "unattributed"]);
	for (const amount of Object.values(recorded.attribution)) usage(amount);
	for (const key of ["total", "codexTotal", "unattributed", "unsupported"]) usage(recorded[key]);
	list(recorded.codex, MAX_MODEL_ROWS);
	for (const row of recorded.codex) { object(row, ["model", "usage"]); text(row.model, 200); usage(row.usage); }
	if (new Set(recorded.codex.map(row => row.model)).size !== recorded.codex.length) fail("duplicate models");
	object(recorded.overflow, ["count", "usage"]); integer(recorded.overflow.count); usage(recorded.overflow.usage);
	flag(recorded.complete); context(recorded.context);
	for (const key of USAGE_KEYS) {
		if (recorded.codexTotal[key] + recorded.unattributed[key] + recorded.unsupported[key] !== recorded.total[key] ||
			recorded.codex.reduce((sum, row) => sum + row.usage[key], recorded.overflow.usage[key]) !== recorded.codexTotal[key] ||
			["parent", "delegated", "unattributed"].reduce((sum, label) => sum + recorded.attribution[label]?.[key], 0) !== recorded.total[key]) fail("accounting reconciliation");
	}
	return snapshot;
}
// Visible one-cell whitespace markers preserve note structure without executable controls
// or expansion beyond the native field bounds. Never mutate the native receipts.
// Use the same Node sanitation primitives as display.ts: the standalone consumer
// cannot import TypeScript from an installed node_modules package without a loader.
export function workbenchText(value) {
	return stripVTControlCharacters(value.replace(/\r\n/g, "\n").replace(/\n/g, "↵").replace(/\t/g, "⇥")).replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}
function displayFields(value, fields) {
	return Object.fromEntries(fields.filter(key => value[key] !== undefined && value[key] !== "").map(key => [key,
		typeof value[key] === "string" ? workbenchText(value[key]) || "[Control-only text]" : value[key]]));
}
export function mapWorkbenchTasks(state, bindingCurrent) {
	const rows = state.tasks.map(task => displayFields(task, ["id", "title", "status", "group", "evidence", "reason"]));
	const binding = state.binding ? { ...displayFields(state.binding, ["project", "path", "sha256"]), groups: state.binding.groups.map(workbenchText) } : undefined;
	return { revision: state.revision, bindingCurrent, ...(binding ? { binding } : {}), rows: TASK_STATES.flatMap(status => rows.filter(row => row.status === status)) };
}
export function mapWorkbenchAgents(snapshot) {
	const fields = ["id", "role", "label", "requestedModel", "effectiveModel", "phase", "diagnostic", "terminated", "toolCallId"];
	const rows = items => items.map(row => displayFields(row, fields));
	return { live: rows(snapshot.live), recent: rows(snapshot.recent), historyLimited: snapshot.historyLimited, nestedHistoryUnavailable: snapshot.nestedHistoryUnavailable, launchBlocked: snapshot.launchBlocked };
}
