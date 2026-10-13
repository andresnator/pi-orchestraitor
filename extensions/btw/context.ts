import type { Context } from "@earendil-works/pi-ai";
import { buildSessionContext, convertToLlm, type SessionEntry } from "@earendil-works/pi-coding-agent";

// Sent once, ahead of the first side question, so the parent's prompt cache prefix stays intact.
export const SIDE_QUESTION_INSTRUCTIONS = `You are now in a temporary /btw side conversation about the main conversation.
The preceding conversation is background, not a request to continue the main task.
Answer only the final question, in the user's language. Be concise unless more detail is requested.
The tools declared above belong to the main conversation. Do not call them: tool calls are never executed here. Answer with text only.
Do not execute commands, modify files, or claim to have done so.
Use only the supplied context and your knowledge; acknowledge missing information.
Follow-up questions can refer to previous answers in this side conversation.
The side conversation stays separate from the main conversation. Closing the window discards it completely.
Only explicitly selected excerpts can be returned to the main conversation by the user.`;

export function buildSideContext(entries: SessionEntry[], systemPrompt: string): Context {
	// Pi's projection respects the current branch, compaction, and context edits.
	// Clone because provider transformations must not mutate the main session's messages.
	const messages = structuredClone(convertToLlm(buildSessionContext(entries).messages));
	// A side question starts immediately, even while the main agent is executing tools.
	// Remove calls lacking a persisted result, without modifying the active branch.
	const resolvedCalls = new Set(messages.filter(message => message.role === "toolResult").map(message => message.toolCallId));
	for (const message of messages) {
		if (message.role === "assistant") message.content = message.content.filter(block => block.type !== "toolCall" || resolvedCalls.has(block.id));
	}
	const kept = messages.filter(message => message.role !== "assistant" || message.content.length > 0);

	// System messages carry the parent's exact prompt and tool declarations. Replaying them
	// unchanged lets the provider reuse the parent's prompt cache; BTW never executes a tool.
	if (kept.some(message => message.role === "system")) return { messages: kept };
	return { systemPrompt, messages: kept };
}
