import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as contract from "../extensions/ui/workbench-contract.mjs";
import { mapWorkbenchTasks, mapWorkbenchAgents, validateWorkbenchSnapshot, MAX_SNAPSHOT_BYTES } from "../extensions/ui/workbench-contract.mjs";

const identity = { version: 1, publisher: { instance: "source-1", pid: 123, pane: "w1:p1", workspace: "w1", socket: "/tmp/herdr.sock", project: "/tmp/project", session: "session-1", generation: 0, sequence: 1, publishedAt: 1234 },
	tasks: { revision: 1, bindingCurrent: true, rows: [] }, agents: { live: [], recent: [], historyLimited: false, nestedHistoryUnavailable: false, launchBlocked: false },
	usage: { attribution: { parent: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, delegated: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, unattributed: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, total: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, codex: [], codexTotal: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, unattributed: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, unsupported: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, overflow: { count: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, complete: true, context: { status: "unknown" } } };

test("shouldLoadStandaloneContractFromInstalledNodeModulesWithoutTypeScriptLoader", async (t) => {
	// Given
	const root = await mkdtemp(join(tmpdir(), "workbench-installed-")); t.after(() => rm(root, { recursive: true, force: true }));
	const target = join(root, "node_modules", "workbench", "ui"); await mkdir(target, { recursive: true });
	for (const file of ["workbench-contract.mjs", "display.ts"]) await copyFile(new URL(`../extensions/ui/${file}`, import.meta.url), join(target, file));
	// When
	const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `const m=await import(${JSON.stringify(pathToFileURL(join(target, "workbench-contract.mjs")).href)}); console.log(m.workbenchText('safe'));`]);
	// Then
	assert.equal(stdout.trim(), "safe");
});

test("shouldRejectCommandsAndTerminalControlsWhenValidatingDisplaySnapshot", () => {
	// Given
	const command = structuredClone(identity); command.answer = { value: "yes" };
	const control = structuredClone(identity); control.tasks.rows = [{ id: "task-1", title: "bad\x1b[2J", status: "pending" }];
	// When / Then
	assert.throws(() => validateWorkbenchSnapshot(command));
	assert.throws(() => validateWorkbenchSnapshot(control));
	assert.throws(() => validateWorkbenchSnapshot({ ...identity, version: 2 }));
	assert.deepEqual(validateWorkbenchSnapshot(identity), identity);
});

test("shouldPreserveTaskOrderingAndAgentEvidenceWhenMappingBranchState", () => {
	// Given
	const tasks = { version: 1, revision: 3, binding: { project: "/tmp/project", path: "plan.md", sha256: "a".repeat(64), groups: ["1"] }, tasks: [
		{ id: "t1", status: "pending", title: "First", group: "1" }, { id: "t2", status: "blocked", title: "Second", reason: "Wait", group: "1" }, { id: "t3", status: "done", title: "Third", evidence: "Approved", group: "1" },
		{ id: "t4", status: "in_progress", title: "Fourth", group: "1" }, { id: "t5", status: "blocked", title: "Fifth", group: "1" }] };
	const agents = { live: [{ id: "a1", role: "review", label: "Inspect", requestedModel: "openai-codex/a", phase: "running" }], recent: [{ id: "a2", role: "explore", label: "Report", effectiveModel: "openai-codex/b", phase: "completed", terminated: true, finalResponse: "secret response", diagnostic: "Observed" }], historyLimited: false, nestedHistoryUnavailable: true, launchBlocked: false };
	// When
	const mapped = mapWorkbenchTasks(tasks, false);
	const observed = mapWorkbenchAgents(agents);
	// Then
	assert.deepEqual(mapped.rows.map(row => row.id), ["t2", "t5", "t4", "t1", "t3"]);
	assert.equal(mapped.bindingCurrent, false);
	assert.deepEqual(observed.recent[0], { id: "a2", role: "explore", label: "Report", effectiveModel: "openai-codex/b", phase: "completed", terminated: true, diagnostic: "Observed" });
	assert.ok(!JSON.stringify(observed).includes("secret response"));
	assert.ok(!JSON.stringify(observed).includes("taskId"));
});

test("shouldSanitizeNativeMultilineNotesAndOmitEmptyOptionalDiagnostics", () => {
	// Given
	const input = { revision: 1, tasks: [{ id: "t", title: "Safe\x1b[2J", status: "pending", evidence: "Line one\n\tLine two" }] };
	const candidate = structuredClone(identity);
	// When
	candidate.tasks = mapWorkbenchTasks(input, true);
	candidate.agents = mapWorkbenchAgents({ ...candidate.agents, recent: [{ role: "review", label: "Reader", phase: "completed", diagnostic: "" }] });
	// Then
	assert.doesNotThrow(() => validateWorkbenchSnapshot(candidate));
	assert.match(candidate.tasks.rows[0].evidence, /Line one.*Line two/);
	assert.equal(input.tasks[0].evidence, "Line one\n\tLine two");
});

test("shouldRejectPerCategoryMismatchesEvenWhenGrandTotalsAgree", () => {
	// Given
	const candidate = structuredClone(identity);
	candidate.usage.total.input = candidate.usage.total.total = 10;
	candidate.usage.codexTotal.output = candidate.usage.codexTotal.total = 10;
	candidate.usage.codex = [{ model: "a", usage: { ...candidate.usage.codexTotal } }];
	candidate.usage.attribution.parent = { ...candidate.usage.total };
	// When / Then
	assert.throws(() => validateWorkbenchSnapshot(candidate), /reconciliation/);
});

test("shouldBoundOwnershipRecordsAndRejectActionFields", () => {
	// Given
	const value = { version: 1, source: { ...identity.publisher }, companion: { pane: "w1:p2", workspace: "w1", tab: "w1:t1", terminal: "terminal-1", pid: 100, plugin: "pi.orchestraitor", entrypoint: "workbench", token: "launch-token" }, createdAt: 1234 };
	// When / Then
	assert.equal(typeof contract.validateWorkbenchOwnership, "function");
	assert.deepEqual(contract.validateWorkbenchOwnership(value), value);
	assert.throws(() => contract.validateWorkbenchOwnership({ ...value, command: "exec" }));
	assert.throws(() => contract.validateWorkbenchOwnership({ ...value, version: 2 }));
});

test("shouldFitMaximumUnicodeSnapshotWithoutDroppingNativeTaskDetails", () => {
	// Given
	const large = structuredClone(identity);
	// An unpaired surrogate costs six JSON bytes per UTF-16 unit: worse than CJK,
	// quotes, backslashes or supplementary-plane characters at these native limits.
	const max = (length, prefix = "") => prefix + "\ud800".repeat(length - prefix.length);
	for (const key of ["instance", "pane", "workspace", "socket", "project", "session"]) large.publisher[key] = max(1000);
	large.publisher.columns = large.publisher.rows = Number.MAX_SAFE_INTEGER;
	const groups = Array.from({ length: 50 }, (_, i) => max(80, String(i)));
	large.tasks.binding = { project: max(1000), path: max(1000), sha256: "a".repeat(64), groups };
	large.tasks.rows = Array.from({ length: 50 }, (_, i) => ({ id: String(i).padEnd(80, "t"), title: max(200), status: "blocked", group: groups[i], evidence: max(1000), reason: max(1000) }));
	const agent = (_, i) => ({ id: max(200, String(i)), role: "review", label: max(200), diagnostic: max(1000), requestedModel: max(200), effectiveModel: max(200), toolCallId: max(200), phase: "failed", terminated: true });
	large.agents.recent = Array.from({ length: 20 }, agent);
	large.agents.live = Array.from({ length: 2 }, agent);
	large.usage.codex = Array.from({ length: 100 }, (_, i) => ({ model: max(200, String(i)), usage: { input: i, output: 0, cacheRead: 0, cacheWrite: 0, total: i } }));
	large.usage.total.input = large.usage.total.total = 4950;
	large.usage.codexTotal.input = large.usage.codexTotal.total = 4950;
	large.usage.attribution.parent.input = large.usage.attribution.parent.total = 4950;
	// When
	const checked = validateWorkbenchSnapshot(large);
	// Then
	assert.equal(checked.tasks.rows.length, 50);
	assert.equal(checked.usage.codex.length, 100);
	assert.ok(Buffer.byteLength(JSON.stringify(checked)) < MAX_SNAPSHOT_BYTES);
	assert.deepEqual(checked, large);
	assert.equal(MAX_SNAPSHOT_BYTES, 2097152);
});
