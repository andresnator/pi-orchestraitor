import { validateBatch } from "./policy.mjs";
import { BatchController } from "./controller.mjs";

/** Pending readers retain their capacity until collected, including completed readers. */
export class BackgroundTasks {
	jobs = new Map();
	blocked = false;
	foreground = false;
	async run(manifests, promptFor, signal, observer, options, persist) {
		validateBatch(manifests);
		if (this.blocked || this.foreground) throw new Error("Subagent launches blocked");
		if (manifests.some(task => task.role === "implement") && this.jobs.size) throw new Error("Collect pending readers before implementation");
		if (this.jobs.size + manifests.length > 2) throw new Error("At most two pending readers are allowed");
		const foreground = [], pending = [];
		// Reserve the complete batch before starting any child.
		for (const manifest of manifests) {
			const controller = new BatchController(options);
			const job = { id: manifest.id, manifest, controller, result: undefined, done: undefined, collected: false };
			this.jobs.set(job.id, job);
		}
		for (const manifest of manifests) {
			// Foreground results are accounted on the launcher's native tool receipt,
			// including its outer receipt when called through ctx.executeTool().
			// Only deferred results need custom recovery receipts for collection.
			if (manifest.mode !== "background") continue;
			const job = this.jobs.get(manifest.id);
			try { persist({ id: job.id, state: "pending", role: manifest.role }); }
			catch (error) { for (const task of manifests) this.jobs.delete(task.id); throw error; }
		}
		for (const manifest of manifests) {
			const job = this.jobs.get(manifest.id);
			job.done = job.controller.run([manifest], promptFor, signal, observer).then(results => {
				job.result = results[0]; this.blocked ||= job.controller.blocked;
				if (manifest.mode === "background") {
					try { persist({ id: job.id, state: "result", result: job.result }); }
					catch (error) { job.persistenceError = String(error); }
				}
				return job.result;
			});
			if (manifest.mode === "background") pending.push(job.id);
			else foreground.push(job);
		}
		this.foreground = foreground.length > 0;
		try {
			const results = await Promise.all(foreground.map(job => job.done));
			for (const job of foreground) this.jobs.delete(job.id);
			return { results, pending };
		} finally { this.foreground = false; }
	}
	status() { return [...this.jobs.values()].map(job => ({ id: job.id, role: job.manifest.role, status: job.result?.status ?? "running", usagePending: true, ...(job.persistenceError ? { persistenceError: job.persistenceError } : {}) })); }
	async wait(ids = [...this.jobs.keys()]) { await Promise.all(ids.map(id => this.jobs.get(id)?.done)); }
	collect(ids = [...this.jobs.keys()]) {
		const results = [];
		for (const id of ids) { const job = this.jobs.get(id); if (job?.result) { results.push(job.result); this.jobs.delete(id); } }
		return results;
	}
	async cancel(ids = [...this.jobs.keys()]) { await Promise.all(ids.map(id => this.jobs.get(id)?.controller.cancel())); }
}

export const RECEIPT = "orchestraitor-subagent-receipt";
/** Native receipts anywhere in the session tree commit accounting, even off-branch. */
export function collectedIds(entries) {
	const delivered = new Set();
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message?.role !== "toolResult") continue;
		for (const result of entry.message.details?.results ?? []) if (typeof result?.id === "string") delivered.add(result.id);
	}
	return delivered;
}
/** Result visibility is branch-local; accounting deduplication can be session-wide. */
export function recoverReceipts(entries, delivered = collectedIds(entries)) {
	const pending = new Map();
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === RECEIPT && entry.data?.id) pending.set(entry.data.id, entry.data);
	}
	for (const id of delivered) pending.delete(id);
	return pending;
}
