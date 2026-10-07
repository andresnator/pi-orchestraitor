import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SessionManager, buildSideContext } from "./helpers/btw-harness.mjs";

const SYSTEM_PROMPT = "Main instructions";
const user = (text) => ({ role: "user", content: text, timestamp: 1 });

describe("current branch snapshot", () => {
	it("shouldIsolateTheSnapshotAndRemoveToolsWhenOpening", () => {
		// Given
		const session = SessionManager.inMemory();
		session.appendMessage({ role: "system", content: SYSTEM_PROMPT, timestamp: 1,
			toolsAdded: [{ name: "dangerous", description: "Tool", parameters: {} }] });
		session.appendMessage(user("Main question"));
		const before = structuredClone(session.getEntries());
		// When
		const context = buildSideContext(session.getBranch(), SYSTEM_PROMPT);
		context.messages[0].content = "Provider mutation";
		// Then
		assert.deepEqual({ entries: session.getEntries(), tools: context.tools, roles: context.messages.map(m => m.role) },
			{ entries: before, tools: [], roles: ["user"] });
		assert.ok(context.systemPrompt.includes("Closing the window discards it completely."));
	});

	it("shouldExcludeAbandonedBranchesWhenOpening", () => {
		// Given
		const session = SessionManager.inMemory();
		const root = session.appendMessage(user("Shared root"));
		session.appendMessage(user("Abandoned branch"));
		session.branch(root);
		session.appendMessage(user("Current branch"));
		const leaf = session.getLeafId();
		// When
		const context = buildSideContext(session.getBranch(), SYSTEM_PROMPT);
		// Then
		assert.deepEqual({ contents: context.messages.map(m => m.content), leaf: session.getLeafId() },
			{ contents: ["Shared root", "Current branch"], leaf });
	});

	it("shouldRespectCompactionAndContextEditsWhenBuildingTheSnapshot", () => {
		// Given
		const session = SessionManager.inMemory();
		session.appendMessage(user("Already summarized"));
		const kept = session.appendMessage(user("Unedited text"));
		session.appendCompaction("Earlier decisions", kept, 100);
		session.appendContextEdit(kept, { content: "Edited text" });
		// When
		const context = JSON.stringify(buildSideContext(session.getBranch(), SYSTEM_PROMPT));
		// Then
		assert.ok(context.includes("Earlier decisions"));
		assert.ok(context.includes("Edited text"));
		assert.doesNotMatch(context, /Already summarized|Unedited text/);
	});

	it("shouldDropUnfinishedCallsWhenTheParentIsRunningTools", () => {
		// Given
		const session = SessionManager.inMemory();
		session.appendMessage(user("Main task"));
		session.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "pending", name: "bash", arguments: { command: "sleep 10" } }] });
		const before = structuredClone(session.getEntries());
		// When
		const context = buildSideContext(session.getBranch(), SYSTEM_PROMPT);
		// Then
		assert.deepEqual({ messages: context.messages, entries: session.getEntries() },
			{ messages: [user("Main task")], entries: before });
	});
});
