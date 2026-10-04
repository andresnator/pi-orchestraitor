import assert from "node:assert/strict";
import { access, realpath, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { BatchController, RpcDecoder } from "../extensions/subagent/controller.mjs";
import { createWorkspace } from "./helpers/pi-host.mjs";

const childPath = fileURLToPath(new URL("./fixtures/subagent-child.mjs", import.meta.url));
const options = { childPath, startTimeout: 500, taskTimeout: 2000, stopGrace: 40 };
const task = (cwd, id, context = "normal") => ({ cwd, id, context, role: "explore", instruction: "inspect", model: "fixture/model", reasoning: "high", files: [], skills: [], tools: ["read", "search", "list"] });
const usage = (n) => ({ input: n, output: 2 * n, cacheRead: 3 * n, cacheWrite: 4 * n, totalTokens: 10 * n,
	cost: { input: n / 8, output: n / 4, cacheRead: 0, cacheWrite: 0, total: 3 * n / 8 } });

for (const duplicates of [false, true]) {
	test(`shouldCountEachResponseOnceWhenRepeatedRepresentationsAre${duplicates}`, async (t) => {
		// Given
		const cwd = await realpath(await createWorkspace(t));
		const manifest = { ...task(cwd, "usage", "usage"), duplicates, streamingUsage: usage(100),
			responses: [{ usage: { ...usage(1), reasoning: 1, cacheWrite1h: 2 }, stopReason: "toolUse" }, { usage: { ...usage(2), reasoning: 2 } }, { usage: { ...usage(2), reasoning: 2 } }] };
		// When
		const [result] = await new BatchController(options).run([manifest], () => "work");
		// Then
		assert.deepEqual({ status: result.status, usage: result.usage, complete: result.usageComplete },
			{ status: "completed", usage: { ...usage(5), reasoning: 5, cacheWrite1h: 2 }, complete: true }, result.diagnostic);
	});
}

for (const invalid of [null, { ...usage(1), input: -1 }, { ...usage(1), output: "2" }, { ...usage(1), cost: {} }, { ...usage(1), reasoning: null }, { ...usage(1), cacheWrite1h: -1 }]) {
	test(`shouldKeepPriorUsageWhenFinalUsageIs${JSON.stringify(invalid)}`, async (t) => {
		// Given
		const cwd = await realpath(await createWorkspace(t));
		const manifest = { ...task(cwd, "invalid", "usage"), responses: [{ usage: usage(1) }, { usage: invalid }] };
		// When
		const [result] = await new BatchController(options).run([manifest], () => "work");
		// Then
		assert.deepEqual({ status: result.status, usage: result.usage, complete: result.usageComplete }, { status: "completed", usage: usage(1), complete: false });
		assert.match(result.diagnostic, /usage.*invalid|invalid.*usage/i);
	});
}

for (const [mode, responses, expected, status] of [
	["usage", [{ usage: usage(0) }], usage(0), "completed"],
	["usage", [{ usage: null }], undefined, "completed"],
	["usage", [{ missingUsage: true }], undefined, "completed"],
	["usage", [{ usage: usage(1) }, { usage: usage(2), unpaired: true }], usage(1), "completed"],
	["usage", [{ usage: usage(1), stopReason: "error" }], usage(1), "failed"],
	["usage-unfinished", [{ usage: usage(1) }], usage(1), "completed"],
	["usage-protocol-error", [{ usage: usage(1) }], usage(1), "failed"],
	["usage-truncated", [{ usage: usage(1) }], usage(1), "completed"],
]) {
	test(`shouldExposeAccountingLimitsWhen${mode}Has${JSON.stringify(responses)}`, async (t) => {
		// Given
		const cwd = await realpath(await createWorkspace(t));
		// When
		const [result] = await new BatchController(options).run([{ ...task(cwd, "limits", mode), responses }], () => "work");
		// Then
		const complete = expected?.totalTokens === 0;
		assert.deepEqual({ status: result.status, usage: result.usage, complete: result.usageComplete }, { status, usage: expected, complete }, result.diagnostic);
		if (!complete) assert.match(result.diagnostic, /usage/i);
		if (!expected) assert.equal(Object.hasOwn(result, "usage"), false);
	});
}

for (const trigger of ["cancellation", "timeout"]) {
	test(`shouldRetainFinalizedUsageDuringTeardownWhen${trigger}StopsChild`, async (t) => {
		// Given
		const { spawn } = await import("node:child_process");
		const cwd = await realpath(await createWorkspace(t));
		const abort = new AbortController();
		const controller = new BatchController({ ...options, taskTimeout: 300, stopGrace: 100, spawnProcess: (...args) => {
			const child = spawn(...args);
			child.on("message", (message) => { if (trigger === "cancellation" && message.type === "usage_ready") abort.abort(); });
			return child;
		} });
		// When
		const [result] = await controller.run([{ ...task(cwd, "partial", "usage-hang"), responses: [{ usage: usage(1) }], abortUsage: usage(2) }], () => "work", abort.signal);
		// Then
		assert.deepEqual({ status: result.status, usage: result.usage, complete: result.usageComplete, terminated: result.terminated, response: result.finalResponse },
			{ status: trigger === "cancellation" ? "cancelled" : "timed_out", usage: usage(3), complete: false, terminated: true, response: "" }, result.diagnostic);
	});
}

for (const drainConfirmed of [true, false]) {
	test(`shouldDrainUsageBeyondIpcDisconnectWhenStdoutClosureIs${drainConfirmed}`, async (t) => {
		// Given
		const { EventEmitter } = await import("node:events");
		const { PassThrough } = await import("node:stream");
		const { createHash } = await import("node:crypto");
		const cwd = await realpath(await createWorkspace(t));
		const abort = new AbortController();
		const manifest = task(cwd, "stdout-drain");
		const child = new EventEmitter();
		Object.assign(child, { pid: 123, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {} });
		const emit = (event) => child.stdout.write(JSON.stringify(event) + "\n");
		const start = { type: "message_start", message: { role: "assistant" } };
		const end = (n) => ({ type: "message_end", message: { role: "assistant", stopReason: "stop", usage: usage(n), content: [{ type: "text", text: "done" }] } });
		const controller = new BatchController({ ...options, stopGrace: 80, spawnProcess: (_command, args) => {
			void readFile(args[1], "utf8").then((raw) => child.emit("message", { type: "guard_ready", id: manifest.id, digest: createHash("sha256").update(raw).digest("hex"), cwd, tools: manifest.tools, model: manifest.model, reasoning: manifest.reasoning }));
			return child;
		} });
		child.stdin.on("data", (chunk) => {
			const command = JSON.parse(chunk.toString());
			if (command.type === "get_state") emit({ type: "response", id: "startup", success: true, data: { model: { provider: "fixture", id: "model" }, thinkingLevel: "high" } });
			if (command.type === "prompt") { emit(start); emit(end(1)); emit(start); abort.abort(); }
			if (command.type === "abort") {
				child.emit("exit", 0, null);
				child.emit("disconnect");
				setTimeout(() => { emit(end(2)); if (drainConfirmed) child.emit("close", 0, null); }, 20);
			}
		});
		// When
		const [result] = await controller.run([manifest], () => "work", abort.signal);
		const returned = structuredClone(result);
		emit(start); emit(end(9));
		// Then
		assert.deepEqual(result, returned);
		assert.deepEqual({ status: result.status, usage: result.usage, complete: result.usageComplete }, { status: "cancelled", usage: usage(3), complete: false });
		if (!drainConfirmed) assert.match(result.diagnostic, /stdout.*drain/i);
	});
}

test("shouldReturnOrderedReadersAndRejectOverlappingWriterWhenBatchIsActive", async (t) => {
	// Given
	const cwd = await realpath(await createWorkspace(t));
	const controller = new BatchController(options);
	const paths = [join(cwd, "first.json"), join(cwd, "second.json")];
	// When
	const running = controller.run([{ ...task(cwd, "first"), delay: 200, timing: paths[0] }, { ...task(cwd, "second"), delay: 150, timing: paths[1] }], () => "work");
	await assert.rejects(controller.run([{ ...task(cwd, "writer"), role: "implement", files: ["a"] }], () => "work"), /already active/);
	const results = await running;
	// Then
	assert.deepEqual(results.map(({ id, status, terminated }) => ({ id, status, terminated })), ["first", "second"].map((id) => ({ id, status: "completed", terminated: true })));
	const times = await Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, "utf8"))));
	assert.ok(Math.max(...times.map(({ start }) => start)) < Math.min(...times.map(({ end }) => end)));
});

for (const [mode, expected] of [["normal", "completed"], ["duplicate", "completed"], ["empty", "failed"], ["provider-error", "failed"], ["premature", "failed"], ["early-end", "failed"], ["bad-guard", "failed"], ["no-guard", "timed_out"]]) {
	test(`shouldReturn${expected}WhenChildUses${mode}`, async (t) => {
		// Given
		const cwd = await realpath(await createWorkspace(t));
		const manifest = { ...task(cwd, mode, mode), marker: join(cwd, "prompted") };
		// When
		const [result] = await new BatchController(options).run([manifest], () => "work");
		// Then
		assert.equal(result.status, expected, result.diagnostic);
		assert.equal(result.terminated, true);
		if (["bad-guard", "no-guard"].includes(mode)) await assert.rejects(access(manifest.marker));
	});
}

for (const mode of ["startup-hang", "hang", "ignore-term"]) {
	test(`shouldConfirmTerminationWhenCancelledDuring${mode}`, async (t) => {
		// Given
		const cwd = await realpath(await createWorkspace(t));
		const controller = new BatchController(options);
		const abort = new AbortController();
		// When
		const pending = controller.run([task(cwd, mode, mode)], () => "work", abort.signal);
		setTimeout(() => abort.abort(), 120);
		const [result] = await pending;
		// Then
		assert.deepEqual({ status: result.status, terminated: result.terminated, active: controller.active }, { status: "cancelled", terminated: true, active: undefined });
	});
}

test("shouldRejectOversizedAndMalformedRecordsWhenDecodingRpc", () => {
	// Given
	const decoder = new RpcDecoder();
	// When / Then
	assert.throws(() => decoder.push("x".repeat(1024 * 1024 + 1), () => {}), /limit/);
	assert.throws(() => new RpcDecoder().push("{broken}\n", () => {}));
});

test("shouldTimeOutRunningTaskAndRetainObservedWritesWhenStopping", async (t) => {
	// Given
	const cwd = await realpath(await createWorkspace(t));
	const controller = new BatchController({ ...options, taskTimeout: 180 });
	// When
	const [result] = await controller.run([task(cwd, "timeout", "hang")], () => "work");
	const [writer] = await controller.run([{ ...task(cwd, "writer", "write"), role: "implement", files: ["target"], tools: ["read", "search", "list", "edit", "write"] }], () => "work");
	// Then
	assert.deepEqual({ status: result.status, terminated: result.terminated, writerStatus: writer.status, writes: writer.writes },
		{ status: "timed_out", terminated: true, writerStatus: "completed", writes: [{ path: "target", phase: "completed" }] });
});

test("shouldAbortEveryReaderWhenParentLifecycleCancelsBatch", async (t) => {
	// Given
	const cwd = await realpath(await createWorkspace(t));
	const controller = new BatchController(options);
	// When
	const pending = controller.run([task(cwd, "one", "hang"), task(cwd, "two", "hang")], () => "work");
	await new Promise((resolve) => setTimeout(resolve, 80));
	await controller.cancel();
	const results = await pending;
	// Then
	assert.deepEqual(results.map(({ status, terminated }) => ({ status, terminated })), [1, 2].map(() => ({ status: "cancelled", terminated: true })));
});

test("shouldBlockFurtherLaunchesWhenExitCannotBeConfirmed", async (t) => {
	// Given
	const { EventEmitter } = await import("node:events");
	const { PassThrough } = await import("node:stream");
	const cwd = await realpath(await createWorkspace(t));
	const signals = [];
	const child = new EventEmitter();
	Object.assign(child, { pid: 123, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: (signal) => signals.push(signal) });
	const controller = new BatchController({ ...options, spawnProcess: (_command, args) => { t.after(() => rm(dirname(args[1]), { recursive: true, force: true })); return child; }, startTimeout: 10, stopGrace: 5 });
	// When
	const observations = [];
	const [result] = await controller.run([task(cwd, "unconfirmed")], () => "work", undefined, (event) => observations.push(event));
	assert.equal(observations.at(-1).phase, "termination_failed");
	assert.equal(observations.at(-1).terminated, false);
	// Then
	assert.deepEqual({ status: result.status, terminated: result.terminated, blocked: controller.blocked, retained: controller.orphans.has(child), signals },
		{ status: "termination_failed", terminated: false, blocked: true, retained: true, signals: ["SIGTERM", "SIGKILL"] });
	await assert.rejects(controller.run([task(cwd, "next")], () => "work"), /blocked/);
});

test("shouldKeepWriterExclusiveUntilExitWhenOtherBatchesAreRequested", async (t) => {
	// Given
	const cwd = await realpath(await createWorkspace(t));
	const controller = new BatchController(options);
	const writer = { ...task(cwd, "writer", "hang"), role: "implement", files: ["target"] };
	// When
	const pending = controller.run([writer], () => "work");
	// Then
	await assert.rejects(controller.run([task(cwd, "reader")], () => "work"), /already active/);
	await assert.rejects(controller.run([writer], () => "work"), /already active/);
	await controller.cancel();
	assert.equal((await pending)[0].terminated, true);
	assert.equal((await controller.run([task(cwd, "after")], () => "work"))[0].status, "completed");
});

test("shouldReportBoundedDiagnosticsWhenChildWritesExcessiveLogs", async (t) => {
	// Given
	const cwd = await realpath(await createWorkspace(t));
	// When
	const [result] = await new BatchController(options).run([task(cwd, "noisy", "noisy")], () => "work");
	// Then
	assert.equal(result.status, "completed");
	assert.ok(result.diagnostic.length < 8300);
	assert.match(result.diagnostic, /Diagnostics truncated/);
});

test("shouldBoundModelObservationsWithoutChangingExecutionIdentityWhenModelIdIsLong", async (t) => {
	// Given
	const cwd = await realpath(await createWorkspace(t));
	const model = "fixture/" + "model".repeat(1000);
	const observations = [];
	// When
	const [result] = await new BatchController(options).run([{ ...task(cwd, "long-model"), model }],
		() => "work", undefined, (event) => observations.push(event));
	// Then
	assert.equal(result.model, model);
	assert.equal(result.status, "completed");
	assert.ok(observations.every(({ requestedModel, effectiveModel }) =>
		requestedModel.length <= 200 && (effectiveModel === undefined || effectiveModel.length <= 200)));
});

test("shouldObserveImmutablePhasesWithoutChangingOrderedResultsWhenReadersRun", async (t) => {
	// Given
	const cwd = await realpath(await createWorkspace(t));
	const observations = [];
	const controller = new BatchController(options);
	const manifests = [{ ...task(cwd, "first"), delay: 100 }, task(cwd, "second")];
	// When
	const results = await controller.run(manifests, () => "work", undefined, (event) => {
		observations.push(event);
	});
	// Then
	assert.deepEqual(results.map(({ id, status }) => ({ id, status })),
		[{ id: "first", status: "completed" }, { id: "second", status: "completed" }]);
	assert.ok(observations.every(Object.isFrozen));
	assert.deepEqual(observations.filter(({ phase }) => phase === "preparing").map(({ id }) => id), ["first", "second"]);
	for (const id of ["first", "second"]) {
		const phases = observations.filter((event) => event.id === id);
		assert.deepEqual(phases.map(({ phase }) => phase), ["preparing", "starting", "running", "stopping", "completed"]);
		assert.equal(phases[1].effectiveModel, undefined);
		assert.equal(phases[2].effectiveModel, "fixture/model");
		assert.equal(phases.at(-1).terminated, true);
		assert.ok(phases.every((event) => !Object.hasOwn(event, "usage")));
	}
});

for (const observer of [() => { throw new Error("Observer failed"); }, async () => { throw new Error("Observer rejected"); }]) {
	test("shouldPreserveExecutionAndUsageWhenObserverThrowsOrRejects", async (t) => {
		// Given
		const cwd = await realpath(await createWorkspace(t));
		const manifest = { ...task(cwd, "observer", "usage"), responses: [{ usage: usage(1) }] };
		// When
		const [result] = await new BatchController(options).run([manifest], () => "work", undefined, observer);
		// Then
		assert.deepEqual({ status: result.status, terminated: result.terminated, usage: result.usage, complete: result.usageComplete },
			{ status: "completed", terminated: true, usage: usage(1), complete: true });
	});
}

for (const [mode, expected] of [["bad-guard", "failed"], ["no-guard", "timed_out"], ["hang", "cancelled"]]) {
	test(`shouldObserveActualFinalPhaseWhenChildEndsFor${mode}`, async (t) => {
		// Given
		const cwd = await realpath(await createWorkspace(t));
		const abort = new AbortController();
		const observations = [];
		const controller = new BatchController({ ...options, startTimeout: 150 });
		const pending = controller.run([task(cwd, "child", mode)], () => "work", abort.signal, (event) => observations.push(event));
		if (mode === "hang") setTimeout(() => abort.abort(), 120);
		// When
		const [result] = await pending;
		// Then
		assert.equal(result.status, expected);
		assert.equal(observations.at(-1)?.phase, expected);
		assert.equal(observations.at(-1)?.terminated, true);
		assert.ok(observations.find(({ phase }) => phase === "stopping"));
		assert.equal(observations.some(({ phase }) => phase === "completed"), false);
	});
}

test("shouldCancelOtherReaderWhenStartupDeadlineExpires", async (t) => {
	// Given
	const cwd = await realpath(await createWorkspace(t));
	const controller = new BatchController({ ...options, startTimeout: 150 });
	// When
	const results = await controller.run([task(cwd, "missing", "no-guard"), task(cwd, "running", "hang")], () => "work");
	// Then
	assert.deepEqual(results.map(({ status, terminated }) => ({ status, terminated })), [{ status: "timed_out", terminated: true }, { status: "cancelled", terminated: true }]);
});


test("shouldRetainObservedUsageWhenTemporaryCleanupFails", async (t) => {
	// Given
	const fs = await import("node:fs/promises");
	const { syncBuiltinESMExports } = await import("node:module");
	const cwd = await realpath(await createWorkspace(t));
	const original = fs.default.rm;
	let leftover;
	const mock = t.mock.method(fs.default, "rm", async (path, options) => {
		if (String(path).includes("/pi-subagent-")) { leftover = path; throw new Error("Fixture cleanup failed"); }
		return original(path, options);
	});
	syncBuiltinESMExports();
	t.after(async () => { mock.mock.restore(); syncBuiltinESMExports(); if (leftover) await original(leftover, { recursive: true, force: true }); });
	// When
	const [result] = await new BatchController(options).run([{ ...task(cwd, "cleanup", "usage"), responses: [{ usage: usage(1) }] }], () => "work");
	// Then
	assert.deepEqual({ status: result.status, usage: result.usage, complete: result.usageComplete, terminated: result.terminated },
		{ status: "failed", usage: usage(1), complete: false, terminated: true });
	assert.match(result.diagnostic, /Fixture cleanup failed/);
});

test("shouldAllowRetryWhenTemporaryDirectoryFailsBeforeSpawn", async (t) => {
	// Given
	const cwd = await realpath(await createWorkspace(t));
	const controller = new BatchController(options);
	const previousTmpdir = process.env.TMPDIR;
	let first;
	// When
	try {
		process.env.TMPDIR = join(cwd, "missing-parent");
		[first] = await controller.run([task(cwd, "failed-start")], () => "work");
	} finally {
		if (previousTmpdir === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = previousTmpdir;
	}
	const [retry] = await controller.run([task(cwd, "retry")], () => "work");
	// Then
	assert.deepEqual({ first: { status: first.status, terminated: first.terminated }, retry: { status: retry.status, terminated: retry.terminated }, blocked: controller.blocked, orphans: controller.orphans.size, active: controller.active },
		{ first: { status: "failed", terminated: true }, retry: { status: "completed", terminated: true }, blocked: false, orphans: 0, active: undefined });
	assert.match(first.diagnostic, /ENOENT/);
});

for (const stage of ["prompt", "spawn"]) {
	test(`shouldAllowRetryWhen${stage}ThrowsBeforeCreatingChild`, async (t) => {
		// Given
		const cwd = await realpath(await createWorkspace(t));
		const controller = new BatchController(stage === "spawn" ? { ...options, spawnProcess: () => { throw new Error("Fixture spawn failed"); } } : options);
		// When
		const [first] = await controller.run([task(cwd, "failed-start")], () => {
			if (stage === "prompt") throw new Error("Fixture prompt failed");
			return "work";
		});
		controller.options = options;
		const [retry] = await controller.run([task(cwd, "retry")], () => "work");
		// Then
		assert.deepEqual({ first: { status: first.status, terminated: first.terminated }, retry: retry.status, blocked: controller.blocked, orphans: controller.orphans.size },
			{ first: { status: "failed", terminated: true }, retry: "completed", blocked: false, orphans: 0 });
		assert.match(first.diagnostic, new RegExp(`Fixture ${stage} failed`));
		assert.deepEqual({ usage: first.usage, complete: first.usageComplete }, { usage: undefined, complete: false });
	});
}


for (const trigger of ["cancellation", "timeout"]) {
	test(`shouldDrainWriteNotificationsWhen${trigger}StopsChild`, async (t) => {
		// Given
		const { spawn } = await import("node:child_process");
		const cwd = await realpath(await createWorkspace(t));
		const abort = new AbortController();
		const manifest = { ...task(cwd, "delayed-writes", "cancel-write"), role: "implement", files: ["target"], tools: ["read", "search", "list", "edit", "write"] };
		const controller = new BatchController({ ...options, taskTimeout: 400,
			spawnProcess: (...args) => {
				const child = spawn(...args);
				child.on("message", (message) => { if (trigger === "cancellation" && message.type === "file_changed") abort.abort(); });
				return child;
			},
		});
		// When
		const [result] = await controller.run([manifest], () => "work", abort.signal);
		// Then
		assert.deepEqual({ file: await readFile(join(cwd, "target"), "utf8"), status: result.status, terminated: result.terminated, finalResponse: result.finalResponse, writes: result.writes },
			{ file: "changed before cancellation", status: trigger === "cancellation" ? "cancelled" : "timed_out", terminated: true, finalResponse: "", writes: [{ path: "target", phase: "completed" }] });
	});
}

test("shouldDrainQueuedWritesAfterExitBeforeReturningCancelledResult", async (t) => {
	// Given
	const { EventEmitter } = await import("node:events");
	const { PassThrough } = await import("node:stream");
	const { createHash } = await import("node:crypto");
	const cwd = await realpath(await createWorkspace(t));
	const abort = new AbortController();
	const manifest = { ...task(cwd, "ipc-drain"), role: "implement", files: ["target"] };
	const child = new EventEmitter();
	Object.assign(child, { pid: 123, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {} });
	const controller = new BatchController({ ...options, stopGrace: 80, spawnProcess: (_command, args) => {
		void readFile(args[1], "utf8").then((raw) => child.emit("message", { type: "guard_ready", id: manifest.id, digest: createHash("sha256").update(raw).digest("hex"), cwd, tools: manifest.tools, model: manifest.model, reasoning: manifest.reasoning }));
		return child;
	} });
	child.stdin.on("data", (chunk) => {
		const command = JSON.parse(chunk.toString());
		if (command.type === "get_state") child.stdout.write(JSON.stringify({ type: "response", id: "startup", success: true, data: { model: { provider: "fixture", id: "model" }, thinkingLevel: "high" } }) + "\n");
		if (command.type === "prompt") abort.abort();
		if (command.type === "abort") {
			child.emit("exit", 0, null);
			setTimeout(() => {
				child.emit("message", { type: "write", path: "target", phase: "completed" });
				child.emit("disconnect");
				child.emit("close", 0, null);
				setTimeout(() => child.emit("message", { type: "write", path: "target", phase: "attempted" }), 5);
			}, 20);
		}
	});
	// When
	const [result] = await controller.run([manifest], () => "work", abort.signal);
	await new Promise((resolve) => setTimeout(resolve, 30));
	// Then
	assert.deepEqual({ status: result.status, terminated: result.terminated, writes: result.writes }, { status: "cancelled", terminated: true, writes: [{ path: "target", phase: "completed" }] });
});

for (const trigger of ["cancellation", "timeout"]) {
	test(`shouldReturnRealGuardWritesWhenNativeRpcChildStopsFor${trigger}`, async (t) => {
		// Given
		const { spawn } = await import("node:child_process");
		const { hostRoot } = await import("./helpers/pi-host.mjs");
		const cwd = await realpath(await createWorkspace(t));
		const abort = new AbortController();
		const manifest = { ...task(cwd, "native-write"), role: "implement", files: ["target"], contextFiles: [], tools: ["read", "search", "list", "edit", "write"], fixtureUsage: [usage(1), usage(2)] };
		const controller = new BatchController({ childPath: fileURLToPath(new URL("./fixtures/subagent-native-child.mjs", import.meta.url)), sdkRoot: hostRoot, taskTimeout: 1500, stopGrace: 100,
			spawnProcess: (...args) => {
				const child = spawn(...args);
				child.on("message", (message) => { if (trigger === "cancellation" && message.type === "model_waiting") abort.abort(); });
				return child;
			},
		});
		// When
		const [result] = await controller.run([manifest], () => "Fixture mock writes one file", abort.signal);
		// Then
		assert.deepEqual({ file: await readFile(join(cwd, "target"), "utf8"), status: result.status, terminated: result.terminated, writes: result.writes },
			{ file: "native write before cancellation", status: trigger === "cancellation" ? "cancelled" : "timed_out", terminated: true, writes: [{ path: "target", phase: "completed" }] }, result.diagnostic);
		assert.deepEqual({ usage: result.usage, complete: result.usageComplete }, { usage: usage(3), complete: false }, result.diagnostic);
	});
}
