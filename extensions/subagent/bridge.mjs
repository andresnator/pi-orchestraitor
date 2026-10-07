/** Bounded IPC provider bridge. Credentials and provider implementations stay in the parent. */
export const MAX_BRIDGE_RECORD = 1024 * 1024;
export const MAX_BRIDGE_CONTEXT = 8 * 1024 * 1024;
const MAX_STREAM_BYTES = 32 * 1024 * 1024;
const CANCEL_GRACE_MS = 1000;
const bytes = value => Buffer.byteLength(JSON.stringify(value));
// Pi delta events still contain the whole partial message. Transport only the
// changed span, retaining at most one bounded serialized snapshot on each side.
function encodeRecord(previous, current) {
	let prefix = 0, suffix = 0;
	while (prefix < previous.length && prefix < current.length && previous[prefix] === current[prefix]) prefix++;
	while (suffix < previous.length - prefix && suffix < current.length - prefix && previous[previous.length - 1 - suffix] === current[current.length - 1 - suffix]) suffix++;
	return { prefix, suffix, text: current.slice(prefix, current.length - suffix) };
}
function decodeRecord(previous, record) {
	if (!record || !Number.isSafeInteger(record.prefix) || !Number.isSafeInteger(record.suffix) || record.prefix < 0 || record.suffix < 0 ||
		record.prefix + record.suffix > previous.length || typeof record.text !== "string" ||
		record.prefix + record.suffix + record.text.length > MAX_BRIDGE_RECORD) throw new Error("Invalid or oversized provider bridge record");
	const current = previous.slice(0, record.prefix) + record.text + (record.suffix ? previous.slice(-record.suffix) : "");
	if (Buffer.byteLength(current) > MAX_BRIDGE_RECORD) throw new Error("Provider bridge stream limit exceeded");
	return current;
}
export function publicModel(model) {
	return Object.fromEntries(["id", "provider", "name", "api", "reasoning", "thinkingLevelMap", "input", "cost", "contextWindow", "maxTokens", "samplingParams", "samplingParamsByThinkingLevel"].filter(key => model[key] !== undefined).map(key => [key, model[key]]));
}
export function parentBridge(child, registry, model, signal, fail) {
	let active, disposed = false, closing = false;
	const send = message => new Promise((resolve, reject) => {
		if (disposed || !child.connected) return reject(new Error("Provider bridge disconnected"));
		child.send(message, error => error ? reject(error) : resolve());
	});
	const abort = () => { active?.abort.abort(); active?.ack?.resolve(); };
	const cancel = () => { closing = true; abort(); };
	signal?.addEventListener("abort", cancel);
	const receive = message => {
		if (message?.type === "model_ack") {
			if (active?.id === message.id && active.ack?.sequence === message.sequence) active.ack.resolve();
			return;
		}
		if (message?.type === "model_cancel") { if (active?.id === message.id) abort(); return; }
		if (message?.type !== "model_request" || disposed) return;
		if (closing) { void send({ type: "model_error", id: message.id, error: "Provider bridge is stopping" }).catch(() => {}); return; }
		if (active || typeof message.id !== "string" || bytes(message) > MAX_BRIDGE_CONTEXT) { fail(new Error("Invalid or oversized provider bridge request")); return; }
		const request = { id: message.id, abort: new AbortController(), sequence: 0 }; active = request;
		if (signal?.aborted) request.abort.abort();
		void (async () => {
			try {
				let total = 0, previous = "";
				const options = { signal: request.abort.signal, ...(message.reasoning && message.reasoning !== "off" ? { reasoning: message.reasoning } : {}) };
				for await (const event of registry.streamSimple(model, message.context, options)) {
					const terminal = event.type === "done" || event.type === "error";
					if (request.abort.signal.aborted && !terminal) continue;
					const current = JSON.stringify(event);
					if (Buffer.byteLength(current) > MAX_BRIDGE_RECORD) throw new Error("Provider bridge stream limit exceeded");
					const packet = { type: "model_event", id: request.id, sequence: ++request.sequence, record: encodeRecord(previous, current) };
					const size = bytes(packet); total += size;
					if (size > MAX_BRIDGE_RECORD || total > MAX_STREAM_BYTES) throw new Error("Provider bridge stream limit exceeded");
					// Socket writes do not mean Pi consumed a snapshot. Permit one
					// nonterminal event at a time, with credit returned by its iterator.
					const consumed = terminal ? undefined : new Promise(resolve => { request.ack = { sequence: request.sequence, resolve }; });
					// A final event can immediately lead to the next native tool turn.
					if (terminal && active === request) active = undefined;
					await send(packet);
					previous = current;
					if (terminal) return;
					if (!request.abort.signal.aborted) await consumed;
					request.ack = undefined;
				}
				await send({ type: "model_end", id: request.id });
			} catch (error) {
				request.abort.abort();
				try { await send({ type: "model_error", id: request.id, error: String(error).slice(0, 1000) }); } catch { /* Parent teardown owns child termination. */ }
			} finally { if (active === request) active = undefined; }
		})();
	};
	child.on("message", receive);
	const dispose = () => { disposed = true; cancel(); child.off("message", receive); signal?.removeEventListener("abort", cancel); };
	// Stop new requests while finalized provider events drain through native RPC.
	dispose.cancel = cancel;
	return dispose;
}
export function childBridge(channel, createStream, model) {
	let sequence = 0;
	return (_model, context, options = {}) => {
		const stream = createStream(), id = String(++sequence);
		let ended = false, total = 0, previous = "", cancelTimer, received = 0, pendingSnapshots = 0;
		const send = message => { if (channel.connected) channel.send(message); };
		const credits = new WeakMap(), iterate = stream[Symbol.asyncIterator].bind(stream);
		stream[Symbol.asyncIterator] = async function* () {
			for await (const event of iterate()) {
				try { yield event; }
				finally {
					const sequence = credits.get(event);
					if (sequence !== undefined) { credits.delete(event); pendingSnapshots--; send({ type: "model_ack", id, sequence }); }
				}
			}
		};
		const cleanup = () => { ended = true; clearTimeout(cancelTimer); channel.off("message", receive); channel.off("disconnect", disconnected); options.signal?.removeEventListener("abort", abort); };
		const error = (text, reason = "error") => {
			if (ended) return;
			const message = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: reason, errorMessage: text,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
			stream.push({ type: "error", reason, error: message }); stream.end(message); cleanup();
		};
		const abort = () => {
			if (ended || cancelTimer) return;
			// The provider's terminal aborted message may contain billable usage.
			// Keep accepting it during teardown before falling back to zero usage.
			cancelTimer = setTimeout(() => error("Provider request cancelled before finalized usage arrived", "aborted"), CANCEL_GRACE_MS);
			send({ type: "model_cancel", id });
		};
		const disconnected = () => error("Parent provider bridge disconnected");
		const receive = message => {
			if (message?.id !== id || ended) return;
			if (message.type === "model_error") return error(message.error);
			if (message.type === "model_end") return error("Provider ended without a final event");
			if (message.type !== "model_event") return;
			try {
				const size = bytes(message); total += size;
				if (size > MAX_BRIDGE_RECORD || total > MAX_STREAM_BYTES) throw new Error("Provider bridge stream limit exceeded");
				if (message.sequence !== received + 1) throw new Error("Invalid provider bridge sequence");
				previous = decodeRecord(previous, message.record);
				const event = JSON.parse(previous);
				received++;
				if (event.type !== "done" && event.type !== "error") {
					if (pendingSnapshots) throw new Error("Provider bridge snapshot window exceeded");
					pendingSnapshots++; credits.set(event, message.sequence);
				}
				stream.push(event);
				if (event.type === "done" || event.type === "error") { stream.end(event.message ?? event.error); cleanup(); }
			} catch (failure) { send({ type: "model_cancel", id }); error(String(failure)); }
		};
		channel.on("message", receive); channel.on("disconnect", disconnected); options.signal?.addEventListener("abort", abort, { once: true });
		const request = { type: "model_request", id, context, reasoning: options.reasoning ?? "off" };
		if (options.signal?.aborted) error("Provider request cancelled before startup", "aborted");
		else if (bytes(request) > MAX_BRIDGE_CONTEXT) error("Provider context exceeds bridge limit");
		else send(request);
		return stream;
	};
}
