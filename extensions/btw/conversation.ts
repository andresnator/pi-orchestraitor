import { randomUUID } from "node:crypto";
import { clampThinkingLevel, type AssistantMessage, type Context, type Message } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SideTurn } from "./types.ts";

export const LOADING_TEXT = "Consulting the context…";
export const EMPTY_RESPONSE_TEXT = "The model returned no text response.";
export const TRUNCATED_RESPONSE_TEXT = "The response reached the model's output limit.";
export const CANCELLED_RESPONSE_TEXT = "Response cancelled.";
export const FAILED_RESPONSE_TEXT = "The request could not be completed.";
export const CHAT_STATUS = { ready: "Ready", responding: "Responding", cancelled: "Cancelled", error: "Error" } as const;

export class SideConversation {
	private readonly sessionId = randomUUID();
	private history: Message[] = [];
	private sideTurns: SideTurn[] = [];
	private request?: AbortController;
	private disposed = false;
	private queue: string[] = [];
	onChange: () => void = () => {};
	status: string = CHAT_STATUS.ready;

	constructor(
		private readonly ctx: ExtensionCommandContext,
		// Takes ownership of the isolated snapshot built for this opening.
		private readonly context: Context,
	) {}

	get busy(): boolean { return this.request !== undefined; }
	get turns(): readonly SideTurn[] { return this.sideTurns; }
	get pending(): readonly string[] { return this.queue; }

	async send(question: string): Promise<void> {
		question = question.trim();
		if (this.disposed || !question) return;
		if (this.busy) {
			this.queue.push(question);
			this.onChange();
			return;
		}
		const controller = new AbortController();
		const turn: SideTurn = { question, answer: "" };
		this.request = controller;
		this.sideTurns.push(turn);
		this.history.push({ role: "user", content: [{ type: "text", text: question }], timestamp: Date.now() });
		this.status = CHAT_STATUS.responding;
		this.onChange();

		try {
			const model = this.ctx.model;
			if (!model) throw new Error("Select a model before using /btw.");
			const thinking = clampThinkingLevel(model, this.ctx.thinkingLevel ?? "off");
			const stream = this.ctx.modelRegistry.streamSimple(model, {
				...this.context,
				messages: structuredClone([...this.context.messages, ...this.history]),
				tools: [],
			}, {
				signal: controller.signal,
				// Side turns share an identity, never the main session's identity.
				sessionId: this.sessionId,
				cacheRetention: "none",
				reasoning: thinking === "off" || model.reasoning === false ? undefined : thinking,
			});
			for await (const event of stream) {
				if (!this.isCurrent(controller)) return;
				if (event.type === "text_delta") {
					turn.answer = extractText(event.partial);
					this.onChange();
				} else if (event.type === "done") {
					turn.answer = extractText(event.message) || EMPTY_RESPONSE_TEXT;
					if (event.reason === "toolUse" || event.reason === "deferred") {
						turn.note = FAILED_RESPONSE_TEXT;
						this.status = CHAT_STATUS.error;
					} else {
						// Replay text only: no tools, thinking signatures, or provider continuation handles.
						this.history.push({
							...event.message,
							content: [{ type: "text", text: turn.answer }],
							responseId: undefined,
							deferred: undefined,
						});
						if (event.reason === "length") turn.note = TRUNCATED_RESPONSE_TEXT;
						this.status = CHAT_STATUS.ready;
					}
				} else if (event.type === "error") {
					turn.note = event.error.errorMessage || FAILED_RESPONSE_TEXT;
					this.status = CHAT_STATUS.error;
				}
			}
		} catch (error) {
			if (!this.isCurrent(controller)) return;
			turn.note = error instanceof Error ? error.message : String(error);
			this.status = CHAT_STATUS.error;
		} finally {
			if (this.isCurrent(controller)) {
				if (this.status === CHAT_STATUS.responding) {
					turn.note = FAILED_RESPONSE_TEXT;
					this.status = CHAT_STATUS.error;
				}
				this.request = undefined;
				// Failed requests must not leave an invisible, paused queue.
				if (this.status !== CHAT_STATUS.ready) this.queue = [];
				this.onChange();
				const next = this.queue.shift();
				if (next !== undefined) void this.send(next);
			}
		}
	}

	private isCurrent(controller: AbortController): boolean {
		return !this.disposed && this.request === controller;
	}

	cancel(): void {
		if (!this.request || this.disposed) return;
		this.request.abort();
		this.request = undefined;
		this.sideTurns[this.sideTurns.length - 1].note = CANCELLED_RESPONSE_TEXT;
		this.status = CHAT_STATUS.cancelled;
		this.queue = [];
		this.onChange();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.request?.abort();
		this.request = undefined;
		this.history = [];
		this.sideTurns = [];
		this.queue = [];
		this.onChange = () => {};
		this.context.messages = [];
		this.context.systemPrompt = undefined;
		this.context.tools = [];
	}
}

function extractText(message: AssistantMessage): string {
	return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}
