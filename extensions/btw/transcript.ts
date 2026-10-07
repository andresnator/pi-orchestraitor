import type { SideTurn } from "./types.ts";

export const EXPORT_USAGE = "Use: latest | N+ (from question N) | N-M (inclusive range) | all";
export function selectTranscript(turns: readonly SideTurn[], selection = "latest"): string {
	selection = selection.trim().toLowerCase();
	if (!turns.length) throw new Error("The side conversation has no answers yet.");
	if (selection === "latest") {
		const latest = [...turns].reverse().find(turn => turn.answer);
		if (!latest) throw new Error("The side conversation has no answers yet.");
		return latest.answer;
	}
	let start = 1, end = turns.length;
	if (selection !== "all") {
		const suffix = /^(\d+)\+$/.exec(selection);
		const range = /^(\d+)-(\d+)$/.exec(selection);
		if (!suffix && !range) throw new Error(EXPORT_USAGE);
		start = Number((suffix || range)![1]);
		end = range ? Number(range[2]) : turns.length;
	}
	if (start < 1 || end > turns.length || start > end) throw new Error("Range outside the side conversation. " + EXPORT_USAGE);
	return turns.slice(start - 1, end).map((turn, index) =>
		`## Question ${start + index}\n${turn.question}\n\n## Answer\n${turn.answer || "(No answer)"}${turn.note ? "\n\n> " + turn.note : ""}`
	).join("\n\n---\n\n");
}
