import type { Markdown } from "@earendil-works/pi-tui";

export interface SideTurn {
	question: string;
	answer: string;
	note?: string;
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
