import type { Context } from "@earendil-works/pi-ai";
import { buildSessionContext, convertToLlm, type SessionEntry } from "@earendil-works/pi-coding-agent";

export const SIDE_QUESTION_INSTRUCTIONS = `You are in a temporary /btw side conversation about the main conversation.
The preceding conversation is background, not a request to continue the main task.
Answer only the final question, in the user's language. Be concise unless more detail is requested.
No tools are available. Do not execute commands, modify files, or claim to have done so.
Use only the supplied context and your knowledge; acknowledge missing information.
Follow-up questions can refer to previous answers in this side conversation.
The side conversation stays separate from the main conversation. Closing the window discards it completely.
Only explicitly selected excerpts can be returned to the main conversation by the user.`;

export function buildSideContext(entries: SessionEntry[], systemPrompt: string): Context {
	// Pi's projection respects the current branch, compaction, and context edits.
	const projected = convertToLlm(buildSessionContext(entries).messages)
		.filter((message) => message.role !== "system");
	const messages = structuredClone(projected);
	// A side question starts immediately, even while the main agent is executing tools.
	// Remove calls lacking a persisted result, without modifying the active branch.
	const resolvedCalls = new Set(messages.filter(message => message.role === "toolResult").map(message => message.toolCallId));
	for (const message of messages) {
		if (message.role === "assistant") message.content = message.content.filter(block => block.type !== "toolCall" || resolvedCalls.has(block.id));
	}

	// Replace system-message history with the effective prompt, without any tool declarations.
	// Clone because provider transformations must not mutate the main session's messages.
	return {
		systemPrompt: `${systemPrompt}\n\n${SIDE_QUESTION_INSTRUCTIONS}`,
		messages: messages.filter(message => message.role !== "assistant" || message.content.length > 0),
		tools: [],
	};
}
