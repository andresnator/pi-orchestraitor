import { after } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { loadUiModule } from "./ui-harness.mjs";

export const {
	btw, buildSideContext, SideConversation, CHAT_STATUS, EMPTY_RESPONSE_TEXT,
	CANCELLED_RESPONSE_TEXT, FAILED_RESPONSE_TEXT, TRUNCATED_RESPONSE_TEXT,
	BtwMarkdown, BtwPopup, LATEST_CONTROL, WELCOME_TEXT, selectTranscript,
	initTheme, SessionManager, CURSOR_MARKER, KeybindingsManager, TUI_KEYBINDINGS, visibleWidth,
} = await loadUiModule({ after }, "tests/fixtures/btw-modules.ts");

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
