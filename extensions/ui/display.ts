import { stripVTControlCharacters } from "node:util";

/** One concise native-footer contribution; native usage/model/context stay native. */
export function workStatus(state: { awaitingInput: boolean }): string | undefined {
	return state.awaitingInput ? "Awaiting input" : undefined;
}

/** Sanitize untrusted terminal text before adding theme escapes. Never mutate tool data. */
export function sanitizeDisplay(text: string): string {
	return stripVTControlCharacters(text)
		.replace(/\r\n/g, "\n")
		.replace(/\t/g, "    ")
		.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "");
}
