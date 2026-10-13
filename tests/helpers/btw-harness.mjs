import { after } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { loadUiModule } from "./ui-harness.mjs";

export const {
	btw, buildSideContext, SIDE_QUESTION_INSTRUCTIONS, SideConversation, CHAT_STATUS, EMPTY_RESPONSE_TEXT,
	CANCELLED_RESPONSE_TEXT, FAILED_RESPONSE_TEXT, TRUNCATED_RESPONSE_TEXT, TOOL_REQUEST_TEXT, LOADING_TEXT,
	fitParts, formatProgress, formatThinking, thinkingPreview,
	BtwMarkdown, BtwPopup, BUSY_HELP, FOOTER_HELP, LATEST_CONTROL, STATUS_TICK_MS, WELCOME_TEXT, selectTranscript,
	initTheme, SessionManager, CURSOR_MARKER, KeybindingsManager, TUI_KEYBINDINGS, visibleWidth,
} = await loadUiModule({ after }, "tests/fixtures/btw-modules.ts");

/** Content of the first side question, which carries BTW's instructions once. */
export const firstQuestion = (text) => [{ type: "text", text: SIDE_QUESTION_INSTRUCTIONS }, { type: "text", text }];

const WAIT_FOR_ATTEMPTS = 100;
const WAIT_FOR_INTERVAL_MS = 10;

export async function waitFor(assertion) {
	for (let attempt = 0; attempt < WAIT_FOR_ATTEMPTS; attempt++) {
		try {
			await assertion();
			return;
		} catch (error) {
			if (attempt === WAIT_FOR_ATTEMPTS - 1) throw error;
		}
		await delay(WAIT_FOR_INTERVAL_MS);
	}
}
