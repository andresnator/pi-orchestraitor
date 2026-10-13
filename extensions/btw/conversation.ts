import { clampThinkingLevel, type AssistantMessage, type Context, type Message, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { SIDE_QUESTION_INSTRUCTIONS } from "./context.ts";
import type { SidePhase, SideProgress, SideThinking, SideTurn } from "./types.ts";

export const LOADING_TEXT = "Consulting the context…";
export const EMPTY_RESPONSE_TEXT = "The model returned no text response.";
export const TRUNCATED_RESPONSE_TEXT = "The response reached the model's output limit.";
export const CANCELLED_RESPONSE_TEXT = "Response cancelled.";
export const FAILED_RESPONSE_TEXT = "The request could not be completed.";
export const TOOL_REQUEST_TEXT = "The model asked to run a tool. BTW never runs tools; ask it to answer from the context.";
export const CHAT_STATUS = { ready: "Ready", responding: "Responding", cancelled: "Cancelled", error: "Error" } as const;
/** Shift+Tab order. Low keeps side answers fast; inherit follows the parent. */
export const SIDE_THINKING_LEVELS: readonly SideThinking[] = ["off", "low", "inherit"];
export const DEFAULT_SIDE_THINKING: SideThinking = "low";

export class SideConversation {
	private history: Message[] = [];
	private sideTurns: SideTurn[] = [];
	private request?: AbortController;
	private disposed = false;
	private queue: string[] = [];
	onChange: () => void = () => {};
	status: string = CHAT_STATUS.ready;
	thinking: SideThinking = DEFAULT_SIDE_THINKING;
	progress?: SideProgress;

	constructor(
		private readonly ctx: ExtensionCommandContext,
		// Takes ownership of the isolated snapshot built for this opening.
		private readonly context: Context,
	) {}

	get busy(): boolean { return this.request !== undefined; }
	get turns(): readonly SideTurn[] { return this.sideTurns; }
	get pending(): readonly string[] { return this.queue; }
	/** The last question ended without an answer: it failed or was cancelled. */
	get canRetry(): boolean {
		return !this.disposed && !this.busy && this.sideTurns.length > 0 && (this.status === CHAT_STATUS.error || this.status === CHAT_STATUS.cancelled);
	}

	/** Level the next request sends, after inheritance and the current model's limits. */
	get thinkingLevel(): ModelThinkingLevel {
		const model = this.ctx.model;
		if (!model || model.reasoning === false) return "off";
		return clampThinkingLevel(model, this.thinking === "inherit" ? this.ctx.thinkingLevel ?? "off" : this.thinking);
	}

	cycleThinking(): void {
		if (this.disposed) return;
		this.thinking = SIDE_THINKING_LEVELS[(SIDE_THINKING_LEVELS.indexOf(this.thinking) + 1) % SIDE_THINKING_LEVELS.length];
		this.onChange();
	}

	async send(question: string): Promise<void> {
		question = question.trim();
		if (this.disposed || !question) return;
		if (this.busy) {
			this.queue.push(question);
			this.onChange();
			return;
		}
		const controller = new AbortController();
		const progress: SideProgress = { phase: "sending", startedAt: Date.now(), answerChars: 0, thinking: "" };
		const turn: SideTurn = { question, answer: "", progress };
		this.request = controller;
		this.progress = progress;
		this.sideTurns.push(turn);
		// Instructions travel once with the first question; later requests extend the same prefix.
		const instructions = this.history.length ? [] : [{ type: "text" as const, text: SIDE_QUESTION_INSTRUCTIONS }];
		this.history.push({ role: "user", content: [...instructions, { type: "text", text: question }], timestamp: Date.now() });
		this.status = CHAT_STATUS.responding;
		this.onChange();

		try {
			const model = this.ctx.model;
			if (!model) throw new Error("Select a model before using /btw.");
			const reasoning = this.thinkingLevel;
			const stream = this.ctx.modelRegistry.streamSimple(model, {
				...this.context,
				messages: structuredClone([...this.context.messages, ...this.history]),
			}, {
				signal: controller.signal,
				// Providers use the session only for prompt cache keys and affinity headers, so the
				// parent's lets even the first side question reuse its cached prefix. The provider's
				// default retention applies, as for the parent's requests.
				sessionId: this.ctx.sessionManager.getSessionId(),
				// Codex keeps per-session websockets with response continuations; SSE is stateless,
				// so side turns never share the parent's connection.
				transport: "sse",
				reasoning: reasoning === "off" ? undefined : reasoning,
			});
			for await (const event of stream) {
				if (!this.isCurrent(controller)) return;
				if (event.type === "thinking_start" || event.type === "thinking_delta") {
					if (progress.firstTextAt === undefined) progress.phase = "thinking";
					progress.thinking = extractThinking(event.partial);
					this.onChange();
				} else if (event.type === "text_delta") {
					progress.phase = "streaming";
					progress.firstTextAt ??= Date.now();
					turn.answer = extractText(event.partial);
					progress.answerChars = turn.answer.length;
					this.onChange();
				} else if (event.type === "done") {
					const text = extractText(event.message);
					const toolRequest = event.reason === "toolUse" || event.reason === "deferred";
					turn.answer = text || (toolRequest ? "" : EMPTY_RESPONSE_TEXT);
					progress.usage = event.message.usage;
					if (toolRequest) turn.note = TOOL_REQUEST_TEXT;
					else if (event.reason === "length") turn.note = TRUNCATED_RESPONSE_TEXT;
					// Replay text only: no tool calls, thinking signatures, or provider continuation handles.
					if (turn.answer) {
						this.history.push({
							...event.message,
							content: [{ type: "text", text: turn.answer }],
							responseId: undefined,
							deferred: undefined,
						});
					}
					this.finish(progress, "done", CHAT_STATUS.ready);
				} else if (event.type === "error") {
					turn.note = event.error.errorMessage || FAILED_RESPONSE_TEXT;
					this.finish(progress, "error", CHAT_STATUS.error);
				}
			}
		} catch (error) {
			if (!this.isCurrent(controller)) return;
			turn.note = error instanceof Error ? error.message : String(error);
			this.finish(progress, "error", CHAT_STATUS.error);
		} finally {
			if (this.isCurrent(controller)) {
				if (this.status === CHAT_STATUS.responding) {
					turn.note = FAILED_RESPONSE_TEXT;
					this.finish(progress, "error", CHAT_STATUS.error);
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

	/** Asks the last question again, in place of the attempt that failed or was cancelled. */
	retry(): Promise<void> {
		if (!this.canRetry) return Promise.resolve();
		const failed = this.sideTurns.pop()!;
		// Unanswered requests never add a reply, so the failed question is the newest history entry.
		if (this.history.at(-1)?.role === "user") this.history.pop();
		return this.send(failed.question);
	}

	private finish(progress: SideProgress, phase: SidePhase, status: string): void {
		progress.phase = phase;
		progress.endedAt = Date.now();
		this.status = status;
	}

	private isCurrent(controller: AbortController): boolean {
		return !this.disposed && this.request === controller;
	}

	cancel(): void {
		if (!this.request || this.disposed) return;
		this.request.abort();
		this.request = undefined;
		this.sideTurns[this.sideTurns.length - 1].note = CANCELLED_RESPONSE_TEXT;
		if (this.progress) this.finish(this.progress, "cancelled", CHAT_STATUS.cancelled);
		else this.status = CHAT_STATUS.cancelled;
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
		this.progress = undefined;
		this.onChange = () => {};
		this.context.messages = [];
		this.context.systemPrompt = undefined;
		this.context.tools = [];
	}
}

function extractText(message: AssistantMessage): string {
	return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

function extractThinking(message: AssistantMessage): string {
	return message.content.filter((block) => block.type === "thinking").map((block) => block.thinking).join("\n");
}
