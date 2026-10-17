import { parentBridge } from "./bridge.mjs";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { START_TIMEOUT_MS, TASK_TIMEOUT_MS, validateBatch, concreteFile } from "./policy.mjs";

const MAX_RECORD = 1024 * 1024;
const RECORD_HEAD = 128;
// Pi serializes `type`, then `message.role`, first. Oversized records the controller
// never reads, such as transcripts and tool payloads, may be skipped; any other
// oversized record, including every assistant message, fails closed.
const SKIPPABLE_RECORD = /^\{"type":"(agent_end|turn_end|message_update|tool_execution_(?:start|update|end)|message_(?:start|end)(?=","message":\{"role":"(?:user|toolResult)"))"/;
const MAX_DIAGNOSTIC = 8192;
const DIAGNOSTIC_MARK = "[Diagnostics truncated]\n";
// Handoffs delivered together, as serialized for the model, share 48 KiB so they fit the 50 KB
// Pi allows its own tool output (DEFAULT_MAX_BYTES); Pi does not cap extension tool results itself.
// One or two children keep 24 KiB each; larger batches split the budget.
const MAX_HANDOFF = 24 * 1024;
const HANDOFF_BUDGET = 48 * 1024;
export const handoffCap = (children) => Math.min(MAX_HANDOFF, Math.floor(HANDOFF_BUDGET / Math.max(1, children)));
const PARTIAL_PREFIX = "[Partial: task timed out]";
const PROGRESS_LABEL_LIMIT = 200;
const PROGRESS_DETAIL_LIMIT = 1000;
const STOP_GRACE_MS = 1000;
const CHILD_PATH = fileURLToPath(new URL("./child.mjs", import.meta.url));
const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"];
const OPTIONAL_TOKEN_FIELDS = ["reasoning", "cacheWrite1h"];
const COST_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "total"];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The model-facing part of a result; full receipts stay in tool details. */
export const handoff = ({ id, status, finalResponse, writes, diagnostic, terminated, usageComplete }) =>
	({ id, status, finalResponse, writes, diagnostic, terminated, usageComplete });
const serializedBytes = (value) => Buffer.byteLength(JSON.stringify(value));

/** Merge observed native usage without estimating prices or adding subset counters to totals. */
export function mergeUsage(values) {
	const observed = values.filter((value) => value !== undefined);
	if (!observed.length) return undefined;
	const sum = (records, fields) => Object.fromEntries(fields.map((field) => [field, records.reduce((total, record) => total + (record[field] ?? 0), 0)]));
	const optional = OPTIONAL_TOKEN_FIELDS.filter((field) => observed.some((value) => value[field] !== undefined));
	return { ...sum(observed, [...TOKEN_FIELDS, ...optional]), cost: sum(observed.map((value) => value.cost), COST_FIELDS) };
}

function validUsage(usage) {
	const numeric = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
	return usage && TOKEN_FIELDS.every((field) => numeric(usage[field])) &&
		OPTIONAL_TOKEN_FIELDS.every((field) => usage[field] === undefined || numeric(usage[field])) &&
		usage.cost && COST_FIELDS.every((field) => numeric(usage.cost[field]));
}

/** Optional presentation observations never own lifecycle or accounting. */
function observeProgress(observer, manifest, phase, evidence = {}) {
	if (typeof observer !== "function") return;
	const event = Object.freeze({ id: manifest.id, role: manifest.role,
		label: String(manifest.instruction ?? "").slice(0, PROGRESS_LABEL_LIMIT),
		requestedModel: String(manifest.model).slice(0, PROGRESS_LABEL_LIMIT), phase, ...evidence,
		...(typeof evidence.effectiveModel === "string" ? { effectiveModel: evidence.effectiveModel.slice(0, PROGRESS_LABEL_LIMIT) } : {}) });
	try {
		// Never await arbitrary observer work, including during teardown.
		Promise.resolve(observer(event)).catch(() => {});
	} catch { /* Presentation errors cannot change child execution. */ }
}

/** One manager per parent session; poison survives lifecycle cancellation.
 * Launch options belong to each run; constructor options are only defaults. */
export class BatchController {
	active;
	blocked = false;
	orphans = new Set();
	constructor(options = {}) { this.options = options; }
	async run(manifests, promptFor, signal, observer, options) {
		validateBatch(manifests);
		if (this.blocked) throw new Error("Subagent launches blocked: child termination was not confirmed");
		if (this.active) throw new Error("A subagent batch is already active");
		const abort = new AbortController();
		const cancel = () => abort.abort();
		signal?.addEventListener("abort", cancel, { once: true });
		if (signal?.aborted) cancel();
		const batch = { abort, done: undefined };
		this.active = batch;
		for (const manifest of manifests) observeProgress(observer, manifest, "preparing");
		// Siblings share the batch's handoff budget; a deadline stops only its own child.
		const maxHandoff = options?.maxHandoff ?? this.options.maxHandoff ?? handoffCap(manifests.length);
		batch.done = Promise.all(manifests.map(async (manifest) => {
			let child, exited = false;
			try {
				return await runTask(manifest, promptFor(manifest), { ...this.options, ...options, maxHandoff, signal: abort.signal,
					onSpawn: (process) => { child = process; }, onExit: () => { exited = true; },
					onUnterminated: (process) => this.orphans.add(process), observer });
			} catch (error) {
				// Preparation and cleanup failures cannot orphan a process that never started
				// or whose exit was already observed. Retain the lock only for a live unknown child.
				const terminated = !child || exited;
				if (!terminated) this.orphans.add(child);
				observeProgress(observer, manifest, terminated ? "failed" : "termination_failed", {
					terminated, diagnostic: String(error).slice(0, PROGRESS_DETAIL_LIMIT),
				});
				return { id: manifest.id, role: manifest.role, cwd: manifest.cwd, model: manifest.model, reasoning: manifest.reasoning,
					status: "failed", finalResponse: "", writes: [], diagnostic: String(error), terminated, usageComplete: false };
			}
		}));
		try {
			const results = await batch.done;
			this.blocked ||= results.some((result) => !result.terminated);
			return results;
		} finally {
			signal?.removeEventListener("abort", cancel);
			if (!this.blocked) this.active = undefined;
		}
	}
	async cancel() {
		this.active?.abort.abort();
		await this.active?.done;
	}
}

const oversized = () => { throw new Error("RPC record exceeded limit; truncated"); };
/** Bounded JSONL decoder. Malformed records fail closed. An oversized record is
 * passed by its leading characters to `skip`, which throws to fail closed or
 * returns to discard the record through its newline. */
export class RpcDecoder {
	buffer = "";
	decoder = new StringDecoder("utf8");
	skipping = false;
	push(chunk, receive, skip = oversized) {
		this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
		let newline;
		while ((newline = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, newline);
			this.buffer = this.buffer.slice(newline + 1);
			if (this.skipping) this.skipping = false;
			else if (line.length > MAX_RECORD) skip(line.slice(0, RECORD_HEAD));
			else if (line.trim()) receive(JSON.parse(line));
		}
		if (!this.skipping && this.buffer.length > MAX_RECORD) { skip(this.buffer.slice(0, RECORD_HEAD)); this.skipping = true; }
		if (this.skipping) this.buffer = "";
	}
}

export async function runTask(manifest, prompt, options = {}) {
	const { signal, sdkRoot, credentialDir, childPath = CHILD_PATH, spawnProcess = spawn,
		startTimeout = START_TIMEOUT_MS, stopGrace = STOP_GRACE_MS, maxHandoff = MAX_HANDOFF } = options;
	const taskTimeout = options.taskTimeoutFor?.(manifest) ?? options.taskTimeout ?? TASK_TIMEOUT_MS;
	const result = { id: manifest.id, role: manifest.role, cwd: manifest.cwd, model: manifest.model, reasoning: manifest.reasoning,
		status: "failed", finalResponse: "", writes: [], diagnostic: "", terminated: false, usageComplete: false };
	let effectiveModel, disposeBridge, response;
	const observe = (phase, evidence = {}) => observeProgress(options.observer, manifest, phase,
		{ ...(effectiveModel ? { effectiveModel } : {}), ...evidence });
	if (signal?.aborted) {
		observe("cancelled", { diagnostic: "Cancelled before startup", terminated: true });
		return { ...result, status: "cancelled", diagnostic: "Cancelled before startup", terminated: true };
	}
	observe("starting");
	let directory;
	let timedOut = false;
	let child, exited = false, closed = false, ipcClosed = false, exitCode, exitSignal, failure, settled = false, accepting = true, acceptingWrites = true, guardReady = false, prompted = false;
	let finalMessage, streaming, resolveReady, rejectReady, resolveSettled, rejectSettled;
	let acceptingUsage = true, usageReliable = true, responseOpen = false, lastEnd, stdoutEnded = false, stderrEnded = false, acceptingStderr = true;
	const decoder = new RpcDecoder();
	const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
	const completion = new Promise((resolve, reject) => { resolveSettled = resolve; rejectSettled = reject; });
	// Cancellation may reject completion before startup has finished.
	ready.catch(() => {}); completion.catch(() => {});
	const diagnose = (text) => { result.diagnostic = appendDiagnostic(result.diagnostic, text); };
	const incompleteUsage = (reason) => { usageReliable = false; diagnose(`Usage incomplete: ${reason}.\n`); };
	const observeUsage = (event) => {
		if (!prompted || event.message?.role !== "assistant") return;
		if (event.type === "message_start") {
			if (responseOpen) incompleteUsage("assistant response did not finish before the next start");
			responseOpen = true;
			lastEnd = undefined;
		} else if (event.type === "message_end") {
			const fingerprint = JSON.stringify(event.message);
			if (!responseOpen) {
				if (fingerprint !== lastEnd) incompleteUsage("unpaired assistant message_end");
				return;
			}
			responseOpen = false;
			lastEnd = fingerprint;
			if (!validUsage(event.message.usage)) { incompleteUsage("missing or invalid finalized usage"); return; }
			const combined = mergeUsage([result.usage, event.message.usage]);
			if (validUsage(combined)) result.usage = combined;
			else incompleteUsage("numeric overflow in finalized usage");
			if (!["stop", "length", "toolUse"].includes(event.message.stopReason)) incompleteUsage("assistant response was not successful");
		}
	};
	// Only the harness deadlines below time out; a child error that mentions a timeout is an ordinary failure.
	const fail = (error, deadline = false) => {
		if (!accepting || failure) return;
		failure = error instanceof Error ? error : new Error(String(error));
		rejectReady(failure); rejectSettled(failure);
		if (deadline) timedOut = true;
	};
	const send = (command) => {
		if (!child?.stdin.writable || exited) return;
		child.stdin.write(`${JSON.stringify(command)}\n`, (error) => { if (error) fail(error); });
	};
	const cancel = () => fail(new Error("Task cancelled"));
	signal?.addEventListener("abort", cancel, { once: true });
	const startTimer = setTimeout(() => fail(new Error("Guard/RPC startup timeout"), true), startTimeout);
	// A profile can turn the task deadline off; the parent can still cancel.
	const taskTimer = Number.isFinite(taskTimeout) ? setTimeout(() => fail(new Error("Task timeout"), true), taskTimeout) : undefined;
	try {
		directory = await mkdtemp(join(tmpdir(), "pi-subagent-"));
		const raw = JSON.stringify(manifest);
		const digest = createHash("sha256").update(raw).digest("hex");
		const manifestPath = join(directory, "task.json");
		await writeFile(manifestPath, raw, { mode: 0o600 });
		if (signal?.aborted) throw new Error("Task cancelled");
		// No shell, no inherited stdin, no CLI startup switches or preload flags.
		// Built before spawn: a failure here must not leave a child whose exit nobody observes.
		const bridged = Boolean(options.registry && options.modelFor);
		const session = bridged ? options.providerSessionFor?.(manifest) : undefined;
		const requestOptions = bridged ? options.requestOptionsFor?.(manifest, session?.id) : undefined;
		const env = manifest.bridgeModel ? Object.fromEntries(["PATH", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "PI_OFFLINE"].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])) : { ...process.env };
		delete env.NODE_OPTIONS; delete env.NODE_PATH;
		child = spawnProcess(process.execPath, [childPath, manifestPath, sdkRoot ?? "", credentialDir ?? ""], {
			cwd: manifest.cwd, env, stdio: ["pipe", "pipe", "pipe", "ipc"],
		});
		options.onSpawn?.(child);
		if (bridged) disposeBridge = parentBridge(child, options.registry, options.modelFor(manifest), signal, fail, session, requestOptions);
		child.once("close", () => { closed = true; });
		child.once("disconnect", () => { ipcClosed = true; });
		child.once("exit", (code, sig) => {
			exited = true; exitCode = code; exitSignal = sig;
			options.onExit?.();
			if (!settled) fail(new Error("Child exited before agent_settled"));
		});
		child.once("error", (error) => {
			if (!child.pid) { exited = true; options.onExit?.(); }
			fail(error);
		});
		child.stdin.on("error", fail);
		// The pipes drain independently, so stderr written before settling can arrive after stdout's
		// agent_settled. A completed task keeps reading it until the pipe ends; a failed one stops at
		// the failure, so shutdown noise cannot push its error out of the diagnostic.
		child.stderr.once("end", () => { stderrEnded = true; });
		child.stderr.on("data", (chunk) => { if (accepting || (acceptingStderr && result.status === "completed")) diagnose(chunk.toString()); });
		child.on("message", (message) => {
			if (!message || typeof message !== "object") return;
			// Cancellation stops control events, but queued write observations must drain
			// through process exit and IPC closure before the result can be returned.
			if (message.type === "write") {
				if (!acceptingWrites || !guardReady || !prompted || manifest.role !== "implement" || !["attempted", "completed"].includes(message.phase)) return;
				let path;
				try { path = concreteFile(message.path); } catch { return; }
				if (!manifest.files.some((file) => concreteFile(file) === path)) return;
				const existing = result.writes.find((entry) => entry.path === path);
				if (existing) { if (message.phase === "completed") existing.phase = "completed"; }
				else result.writes.push({ path, phase: message.phase });
				return;
			}
			if (!accepting || failure) return;
			if (message.type === "startup_error") return fail(new Error(`Child startup failed: ${message.message}`));
			if (message.type !== "guard_ready" || guardReady) return;
			if (message.id !== manifest.id || message.digest !== digest || message.cwd !== manifest.cwd || message.model !== manifest.model ||
				!Array.isArray(message.tools) || JSON.stringify([...message.tools].sort()) !== JSON.stringify([...manifest.tools].sort()) ||
				typeof message.reasoning !== "string") return fail(new Error("Invalid guard confirmation"));
			guardReady = true;
			result.reasoning = message.reasoning;
			send({ id: "startup", type: "get_state" });
		});
		child.stdout.once("end", () => { stdoutEnded = true; });
		child.stdout.on("data", (chunk) => {
			if (!acceptingUsage) return;
			try { decoder.push(chunk, (event) => {
				observeUsage(event);
				if (failure || !accepting) return;
				if (event.type === "extension_error") return fail(new Error("Child guard extension error"));
				if (event.type === "response" && event.id === "startup" && guardReady && !prompted) {
					if (!event.success || `${event.data?.model?.provider}/${event.data?.model?.id}` !== manifest.model || event.data?.thinkingLevel !== result.reasoning) return fail(new Error("RPC startup state mismatch"));
					effectiveModel = `${event.data.model.provider}/${event.data.model.id}`;
					resolveReady();
				}
				if (event.type === "response" && event.id === "work" && !event.success) fail(new Error(`Prompt rejected: ${event.error}`));
				if (!prompted || settled) return;
				// A deadline can expire mid-answer, so the text streamed so far is kept as well.
				if (event.type === "message_update" && event.message?.role === "assistant") streaming = event.message;
				if (event.type === "message_end" && event.message?.role === "assistant") { finalMessage = event.message; streaming = undefined; }
				if (event.type === "agent_settled") { settled = true; resolveSettled(); }
			}, (head) => {
				const type = SKIPPABLE_RECORD.exec(head)?.[1];
				if (!type) oversized();
				diagnose(`Skipped oversized ${type} RPC record.\n`);
			}); } catch (error) { incompleteUsage("malformed or oversized RPC record"); fail(error); }
		});
		if (signal?.aborted) cancel();
		await ready;
		clearTimeout(startTimer);
		if (failure || signal?.aborted) throw failure ?? new Error("Task cancelled");
		prompted = true;
		observe("running");
		send({ id: "work", type: "prompt", message: prompt });
		await completion;
		if (!finalMessage || !["stop", "length"].includes(finalMessage.stopReason)) throw new Error(`Child response failed: ${finalMessage?.errorMessage ?? finalMessage?.stopReason ?? "missing final response"}`);
		const text = responseText(finalMessage);
		if (!text) throw new Error("Child returned an empty final response");
		response = text;
		result.status = "completed";
	} catch (error) {
		result.status = timedOut ? "timed_out" : signal?.aborted ? "cancelled" : "failed";
		diagnose(`${error instanceof Error ? error.message : String(error)}\n`);
		// A deadline keeps the work so far: the answer being streamed, else the last finished one.
		const partial = timedOut ? responseText(streaming) || responseText(finalMessage) : "";
		if (partial) response = `${PARTIAL_PREFIX}\n\n${partial}`;
	} finally {
		disposeBridge?.cancel();
		observe("stopping");
		clearTimeout(startTimer); clearTimeout(taskTimer);
		signal?.removeEventListener("abort", cancel);
		accepting = false;
		if (child && !exited) {
			if (result.status !== "completed") {
				send({ id: "cancel", type: "abort" });
				await waitForExit(() => exited, stopGrace);
			}
			child.stdin.end();
			await waitForExit(() => exited, stopGrace);
			if (!exited) { child.kill("SIGTERM"); await waitForExit(() => exited, stopGrace); }
			if (!exited) { child.kill("SIGKILL"); await waitForExit(() => exited, stopGrace); }
		}
		if (child && exited && !closed && (!ipcClosed || !stdoutEnded || !stderrEnded)) {
			await waitForExit(() => closed || (ipcClosed && stdoutEnded && stderrEnded), stopGrace);
			if (!closed && !ipcClosed) diagnose("IPC write-notification drain was not confirmed before the deadline.\n");
		}
		acceptingWrites = false;
		acceptingStderr = false;
		acceptingUsage = false;
		disposeBridge?.();
		if (child && !closed && !stdoutEnded) incompleteUsage("stdout accounting drain was not confirmed before the deadline");
		if (responseOpen || decoder.buffer.trim()) incompleteUsage("unfinished response or RPC record");
		result.terminated = !child || exited;
		if (!result.terminated) {
			options.onUnterminated?.(child);
			result.status = "termination_failed";
			diagnose("Child exit could not be confirmed; new launches must remain blocked.\n");
		} else if (result.status === "completed" && (exitCode !== 0 || exitSignal)) {
			result.status = "failed";
			diagnose(`Child did not exit cleanly (${exitCode ?? exitSignal}).\n`);
		}
		if (result.terminated && directory) {
			try { await rm(directory, { recursive: true, force: true }); }
			catch (error) {
				if (result.status === "completed") result.status = "failed";
				incompleteUsage(`temporary task cleanup failed: ${String(error)}`);
			}
		}
		result.usageComplete = result.status === "completed" && result.usage !== undefined && usageReliable;
		if (!result.usageComplete) diagnose("Usage accounting is incomplete; observed totals may understate consumption.\n");
	}
	// Capped last, so the final diagnostic and status count against the handoff.
	Object.assign(result, await fitHandoff(result, maxHandoff, response ?? ""));
	observe(result.status, { terminated: result.terminated,
		diagnostic: result.diagnostic.slice(0, PROGRESS_DETAIL_LIMIT),
		finalResponse: result.finalResponse.slice(0, PROGRESS_DETAIL_LIMIT) });
	return result;
}

/** Pi's pattern for truncated tool output (`utils/output-files.js`, not exported): keep whole
 * leading lines and save the full text to a new owner-only file in the OS temp directory. The cap
 * covers the handoff as serialized, so JSON escaping, the marker, diagnostic and fields count. */
async function capResponse(text, result, diagnose, cap = MAX_HANDOFF, savedPath) {
	if (serializedBytes(handoff({ ...result, finalResponse: text })) <= cap) return { finalResponse: text };
	const path = savedPath ?? join(tmpdir(), `pi-subagent-response-${randomBytes(8).toString("hex")}.md`);
	let saved = true;
	if (!savedPath) {
		try { await writeFile(path, text, { mode: 0o600, flag: "wx" }); }
		catch (error) { saved = false; diagnose(`Full response could not be saved: ${String(error)}\n`); }
	}
	const marker = (next) => `\n\n[Response truncated at ${Number((cap / 1024).toFixed(1))}KB.${saved ? ` Full response: ${path}; continue with read offset=${next}.]` : " The full response could not be saved.]"}`;
	// The widest possible offset reserves room for the marker before the head is known.
	const { head, whole } = leadingText(text, cap - serializedBytes(handoff({ ...result, finalResponse: marker(text.length + 2) })));
	return { finalResponse: `${head}${marker(whole ? head.split("\n").length + 1 : 1)}`, ...(saved ? { fullResponsePath: path } : {}) };
}

const appendDiagnostic = (current, text) => {
	const combined = current + text;
	return combined.length > MAX_DIAGNOSTIC ? `${DIAGNOSTIC_MARK}${combined.slice(-MAX_DIAGNOSTIC)}` : combined;
};

/** Fits one handoff to its share of the budget. Diagnostics keep their tail within half the share,
 * so ten failed children still fit; the response keeps its leading lines, its full text saved once. */
async function fitHandoff(result, cap, text, savedPath) {
	const fitted = { ...result };
	const half = Math.floor(cap / 2);
	if (serializedBytes(fitted.diagnostic) > half) {
		const body = fitted.diagnostic.startsWith(DIAGNOSTIC_MARK) ? fitted.diagnostic.slice(DIAGNOSTIC_MARK.length) : fitted.diagnostic;
		fitted.diagnostic = `${DIAGNOSTIC_MARK}${trailingText(body, half - serializedBytes(DIAGNOSTIC_MARK))}`;
	}
	if (text) Object.assign(fitted, await capResponse(text, fitted, (message) => { fitted.diagnostic = appendDiagnostic(fitted.diagnostic, message); }, cap, savedPath));
	return fitted;
}

/** Results delivered together share the budget. One stored under a larger share, from a launch
 * with fewer pending readers, is cut again from its saved full text. */
export async function fitDelivered(results) {
	const cap = handoffCap(results.length);
	return Promise.all(results.map(async (result) => {
		if (serializedBytes(handoff(result)) <= cap) return result;
		let text = result.finalResponse, savedPath;
		if (result.fullResponsePath) {
			try { text = await readFile(result.fullResponsePath, "utf8"); savedPath = result.fullResponsePath; }
			catch { /* A missing full text leaves the stored head to cut again. */ }
		}
		return fitHandoff(result, cap, text, savedPath);
	}));
}

/** The tail of `text` within `budget` bytes once JSON-escaped; each dropped character frees at least a byte. */
function trailingText(text, budget) {
	budget = Math.max(0, budget);
	let part = text.slice(Math.max(0, text.length - budget));
	for (let excess; (excess = serializedBytes(part) - 2 - budget) > 0;) part = part.slice(excess);
	return part;
}

const responseText = (message) => message?.content?.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim() ?? "";

/** Leading whole lines within `budget` bytes once JSON-escaped; a first line over budget is cut by characters. */
function leadingText(text, budget) {
	const escaped = (part) => serializedBytes(part) - 2;
	let end = 0, used = 0;
	for (let start = 0, newline; (newline = text.indexOf("\n", start)) !== -1; start = newline + 1) {
		used += escaped(text.slice(start, newline)) + (start ? 2 : 0);
		if (used > budget) break;
		end = newline;
	}
	if (end > 0) return { head: text.slice(0, end), whole: true };
	let index = 0;
	used = 0;
	for (const character of text) {
		used += escaped(character);
		if (used > budget) break;
		index += character.length;
	}
	return { head: text.slice(0, index), whole: false };
}

async function waitForExit(exited, timeout) {
	const deadline = Date.now() + timeout;
	while (!exited() && Date.now() < deadline) await sleep(Math.min(20, Math.max(1, deadline - Date.now())));
}
