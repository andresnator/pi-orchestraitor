import type { Usage } from "@earendil-works/pi-ai";
import type { Markdown } from "@earendil-works/pi-tui";

export interface SideTurn {
	question: string;
	answer: string;
	note?: string;
}

/** BTW's own reasoning choice; `inherit` follows the parent's level when each request starts. */
export type SideThinking = "off" | "low" | "inherit";

export type SidePhase = "sending" | "thinking" | "streaming" | "done" | "error" | "cancelled";

/** Live measurements of the latest request, rendered as the panel's status line. */
export interface SideProgress {
	phase: SidePhase;
	startedAt: number;
	firstTextAt?: number;
	endedAt?: number;
	/** Visible sizes estimate tokens until the provider reports usage. */
	answerChars: number;
	thinking: string;
	usage?: Usage;
}

export interface MarkdownPart {
	markdown?: Markdown;
	diagram?: string[];
	logicalWidth?: number;
	logicalLines?: string[];
}

export interface SearchTableRow {
	cells: string[][];
	rows: number[];
}

export interface SearchTable {
	rows: SearchTableRow[];
	end: number;
}
