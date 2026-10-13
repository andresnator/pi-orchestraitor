import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FLAG = "orchestraitor-codemode-max-output";
const OPTIONS_PREFIX = "// @options:";
const SCRIPT_ERROR = "Script error:\n";
const FRAME = /(\(|\bat )codemode\.js:(\d+):(\d+)/g;

/** Lower the output cap of model-issued codemode scripts that set no options; the transcript keeps the original script. */
export default function contextBudget(pi: ExtensionAPI) {
	let cap = 0;
	// Calls whose script gained a first line, so their error frames sit one line lower.
	const shifted = new Set<string>();
	pi.registerFlag(FLAG, { type: "string", default: "8000",
		description: "Codemode output cap in estimated tokens for scripts without an options line; 0 keeps Pi's default" });
	pi.on("session_start", () => {
		const requested = pi.getFlag(FLAG);
		if (typeof requested !== "string" || !/^\d+$/.test(requested) || !Number.isSafeInteger(Number(requested))) {
			throw new Error(`--${FLAG} must be a non-negative integer`);
		}
		cap = Number(requested);
	});
	pi.on("tool_call", (event) => {
		if (event.toolName !== "codemode" || event.parentToolCallId || !cap) return;
		// A throwing tool_call handler blocks the call. The cap is optional, so leave the script untouched instead.
		try {
			const capped = withOutputCap(event.input.code, cap);
			if (!capped) return;
			event.input.code = capped.code;
			if (capped.shifted) shifted.add(event.toolCallId);
		} catch {}
	});
	pi.on("tool_result", (event) => {
		if (!shifted.delete(event.toolCallId) || !event.isError) return;
		let changed = false;
		const content = event.content.map((item) => {
			if (item.type !== "text") return item;
			const text = unshiftFrames(item.text);
			if (text === item.text) return item;
			changed = true;
			return { ...item, text };
		});
		if (changed) return { content };
	});
	// Blocked or aborted calls end without a tool_result.
	pi.on("tool_execution_end", (event) => { shifted.delete(event.toolCallId); });
}

/** Pi reads options only from the first line. Reuse a blank or comment first line so reported lines still match the script. */
function withOutputCap(code: unknown, cap: number) {
	if (typeof code !== "string" || !code.trim()) return;
	// Pi rejects options on later lines, so explicit and misplaced options both stay Pi's to handle.
	if (code.split("\n").some((line) => line.trimStart().startsWith(OPTIONS_PREFIX))) return;
	const options = `${OPTIONS_PREFIX} {"max_output_tokens": ${cap}}`;
	const newline = code.indexOf("\n");
	const first = newline === -1 ? code : code.slice(0, newline);
	if (newline !== -1 && (!first.trim() || first.trimStart().startsWith("//")) && code.slice(newline).trim()) {
		return { code: options + code.slice(newline), shifted: false };
	}
	return { code: `${options}\n${code}`, shifted: true };
}

/** Restore the script's own line numbers in the error block Pi appends last. */
function unshiftFrames(text: string) {
	const start = text.lastIndexOf(SCRIPT_ERROR);
	if (start === -1) return text;
	return text.slice(0, start) + text.slice(start).replace(FRAME, (frame, lead: string, line: string, column: string) =>
		Number(line) > 1 ? `${lead}codemode.js:${Number(line) - 1}:${column}` : frame);
}
