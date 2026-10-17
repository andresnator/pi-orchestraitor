import type { SideTurn } from "./types.ts";

/** Latest answer containing text, including any truncation or cancellation note. */
export function latestAnswer(turns: readonly SideTurn[]): string {
	const latest = [...turns].reverse().find(turn => turn.answer);
	if (!latest) throw new Error("The side conversation has no answers yet.");
	return latest.answer + (latest.note ? "\n\n> " + latest.note : "");
}
