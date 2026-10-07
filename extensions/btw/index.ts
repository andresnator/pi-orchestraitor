import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildSideContext } from "./context.ts";
import { SideConversation } from "./conversation.ts";
import { BtwPopup } from "./popup.ts";

export const COMMAND_NAME = "btw";
export const POPUP_WIDTH = "70%";
export const POPUP_MAX_HEIGHT = "70%";

export default function (pi: ExtensionAPI) {
	let active = false;
	let closeDialog: (() => void) | undefined;

	pi.on("session_shutdown", () => closeDialog?.());

	pi.registerCommand(COMMAND_NAME, {
		description: "Open a temporary side conversation: /btw [question]. Discarded on close.",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") { ctx.ui.notify("/btw requires interactive terminal mode.", "error"); return; }
			if (active) { ctx.ui.notify("A BTW panel is already open.", "warning"); return; }
			active = true;
			let conversation: SideConversation | undefined;
			let popup: BtwPopup | undefined;
			try {
				conversation = new SideConversation(ctx, buildSideContext(ctx.sessionManager.getBranch(), ctx.getSystemPrompt()));
				const current = conversation;
				const imported = await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
					popup = new BtwPopup(tui, theme, keybindings, current, done);
					closeDialog = () => popup?.close();
					if (args.trim()) void popup.submit(args);
					return popup;
				}, { overlay: true, overlayOptions: { anchor: "center", width: POPUP_WIDTH, maxHeight: POPUP_MAX_HEIGHT } });
				if (imported !== undefined) pi.sendMessage({ customType: "btw-import", content: imported, display: true }, { triggerTurn: false });
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			} finally {
				popup?.dispose();
				conversation?.dispose();
				closeDialog = undefined;
				active = false;
			}
		},
	});
}
