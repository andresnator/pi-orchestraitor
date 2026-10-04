import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { START_TIMEOUT_MS, TASK_TIMEOUT_MS, validateBatch, concreteFile } from "./policy.mjs";

const MAX_RECORD = 1024 * 1024;
const MAX_DIAGNOSTIC = 8192;
const MAX_RESPONSE = 128 * 1024;
const STOP_GRACE_MS = 1000;
const CHILD_PATH = fileURLToPath(new URL("./child.mjs", import.meta.url));
const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"];
const OPTIONAL_TOKEN_FIELDS = ["reasoning", "cacheWrite1h"];
const COST_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "total"];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** One manager per parent session; poison survives lifecycle cancellation. */
export class BatchController {
	active;
	blocked = false;
	orphans = new Set();
	constructor(options = {}) { this.options = options; }
	async run(manifests, promptFor, signal) {
		validateBatch(manifests);
		if (this.blocked) throw new Error("Subagent launches blocked: child termination was not confirmed");
		if (this.active) throw new Error("A subagent batch is already active");
		const abort = new AbortController();
		const cancel = () => abort.abort();
		signal?.addEventListener("abort", cancel, { once: true });
		if (signal?.aborted) cancel();
		const batch = { abort, done: undefined };
		this.active = batch;
		batch.done = Promise.all(manifests.map(async (manifest) => {
			let child, exited = false;
			try {
				return await runTask(manifest, promptFor(manifest), { ...this.options, signal: abort.signal,
					onSpawn: (process) => { child = process; }, onExit: () => { exited = true; },
					onUnterminated: (process) => this.orphans.add(process), onTimeout: cancel });
			} catch (error) {
				// Preparation and cleanup failures cannot orphan a process that never started
				// or whose exit was already observed. Retain the lock only for a live unknown child.
				const terminated = !child || exited;
				if (!terminated) this.orphans.add(child);
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

/** Bounded JSONL decoder; oversized/malformed records fail closed rather than losing events. */
export class RpcDecoder {
	buffer = "";
	decoder = new StringDecoder("utf8");
	push(chunk, receive) {
		this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
		let newline;
		while ((newline = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, newline);
			this.buffer = this.buffer.slice(newline + 1);
			if (line.length > MAX_RECORD) throw new Error("RPC record exceeded limit; truncated");
			if (line.trim()) receive(JSON.parse(line));
		}
		if (this.buffer.length > MAX_RECORD) throw new Error("RPC record exceeded limit; truncated");
	}
}

export async function runTask(manifest, prompt, options = {}) {
	const { signal, sdkRoot, credentialDir, childPath = CHILD_PATH, spawnProcess = spawn,
		startTimeout = START_TIMEOUT_MS, taskTimeout = TASK_TIMEOUT_MS, stopGrace = STOP_GRACE_MS } = options;
	const result = { id: manifest.id, role: manifest.role, cwd: manifest.cwd, model: manifest.model, reasoning: manifest.reasoning,
		status: "failed", finalResponse: "", writes: [], diagnostic: "", terminated: false, usageComplete: false };
	if (signal?.aborted) return { ...result, status: "cancelled", diagnostic: "Cancelled before startup", terminated: true };
	let directory;
	let timedOut = false;
	let child, exited = false, closed = false, ipcClosed = false, exitCode, exitSignal, failure, settled = false, accepting = true, acceptingWrites = true, guardReady = false, prompted = false;
	let finalMessage, resolveReady, rejectReady, resolveSettled, rejectSettled;
	let acceptingUsage = true, usageReliable = true, responseOpen = false, lastEnd, stdoutEnded = false;
	const decoder = new RpcDecoder();
	const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
	const completion = new Promise((resolve, reject) => { resolveSettled = resolve; rejectSettled = reject; });
	// Cancellation may reject completion before startup has finished.
	ready.catch(() => {}); completion.catch(() => {});
	const diagnose = (text) => {
		const combined = result.diagnostic + text;
		result.diagnostic = combined.length > MAX_DIAGNOSTIC ? `[Diagnostics truncated]\n${combined.slice(-MAX_DIAGNOSTIC)}` : combined;
	};
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
	const fail = (error) => {
		if (!accepting || failure) return;
		failure = error instanceof Error ? error : new Error(String(error));
		rejectReady(failure); rejectSettled(failure);
		if (/timeout/i.test(failure.message)) { timedOut = true; options.onTimeout?.(); }
	};
	const send = (command) => {
		if (!child?.stdin.writable || exited) return;
		child.stdin.write(`${JSON.stringify(command)}\n`, (error) => { if (error) fail(error); });
	};
	const cancel = () => fail(new Error("Task cancelled"));
	signal?.addEventListener("abort", cancel, { once: true });
	const startTimer = setTimeout(() => fail(new Error("Guard/RPC startup timeout")), startTimeout);
	const taskTimer = setTimeout(() => fail(new Error("Task timeout")), taskTimeout);
	try {
		directory = await mkdtemp(join(tmpdir(), "pi-subagent-"));
		const raw = JSON.stringify(manifest);
		const digest = createHash("sha256").update(raw).digest("hex");
		const manifestPath = join(directory, "task.json");
		await writeFile(manifestPath, raw, { mode: 0o600 });
		if (signal?.aborted) throw new Error("Task cancelled");
		// No shell, no inherited stdin, no CLI startup switches or preload flags.
		const env = { ...process.env };
		delete env.NODE_OPTIONS; delete env.NODE_PATH;
		child = spawnProcess(process.execPath, [childPath, manifestPath, sdkRoot ?? "", credentialDir ?? ""], {
			cwd: manifest.cwd, env, stdio: ["pipe", "pipe", "pipe", "ipc"],
		});
		options.onSpawn?.(child);
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
		child.stderr.on("data", (chunk) => { if (accepting) diagnose(chunk.toString()); });
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
					resolveReady();
				}
				if (event.type === "response" && event.id === "work" && !event.success) fail(new Error(`Prompt rejected: ${event.error}`));
				if (!prompted || settled) return;
				if (event.type === "message_end" && event.message?.role === "assistant") finalMessage = event.message;
				if (event.type === "agent_settled") { settled = true; resolveSettled(); }
			}); } catch (error) { incompleteUsage("malformed or oversized RPC record"); fail(error); }
		});
		if (signal?.aborted) cancel();
		await ready;
		clearTimeout(startTimer);
		if (failure || signal?.aborted) throw failure ?? new Error("Task cancelled");
		prompted = true;
		send({ id: "work", type: "prompt", message: prompt });
		await completion;
		if (!finalMessage || !["stop", "length"].includes(finalMessage.stopReason)) throw new Error(`Child response failed: ${finalMessage?.errorMessage ?? finalMessage?.stopReason ?? "missing final response"}`);
		const text = finalMessage.content?.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
		if (!text) throw new Error("Child returned an empty final response");
		result.finalResponse = text.length > MAX_RESPONSE ? `${text.slice(0, MAX_RESPONSE)}\n[Response truncated]` : text;
		result.status = "completed";
	} catch (error) {
		result.status = timedOut ? "timed_out" : signal?.aborted ? "cancelled" : "failed";
		diagnose(`${error instanceof Error ? error.message : String(error)}\n`);
	} finally {
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
		if (child && exited && !closed && (!ipcClosed || !stdoutEnded)) {
			await waitForExit(() => closed || (ipcClosed && stdoutEnded), stopGrace);
			if (!closed && !ipcClosed) diagnose("IPC write-notification drain was not confirmed before the deadline.\n");
		}
		acceptingWrites = false;
		acceptingUsage = false;
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
	return result;
}

async function waitForExit(exited, timeout) {
	const deadline = Date.now() + timeout;
	while (!exited() && Date.now() < deadline) await sleep(Math.min(20, Math.max(1, deadline - Date.now())));
}
