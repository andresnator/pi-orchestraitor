import { renderMermaidASCII } from "beautiful-mermaid";
import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, sliceByColumn, stripTerminalSequences, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

export const MAX_DIAGRAM_SOURCE = 12000;
export const MAX_DIAGRAM_LINES = 80;
export const MAX_CACHED_DIAGRAMS = 20;
const LOGICAL_RENDER_PADDING = 4;
const DIAGRAM_TILE_HEADER_ROWS = 1;
export const SUPPORTED_DIAGRAM = /^(?:flowchart|graph|stateDiagram(?:-v2)?|sequenceDiagram|classDiagram|erDiagram|xychart(?:-beta)?)\b/;
import type { MarkdownPart, SearchTable, SearchTableRow } from "./types.ts";
const SEARCH_GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const TABLE_TOP_BORDER = /^┌[─┬]+┐$/;
const TABLE_ROW_BORDER = /^[├└][─┼┴]+[┤┘]$/;
const TABLE_CELL_BORDER_COLUMNS = 2;

/** Local text-only renderer; unsupported, malformed, or oversized fences remain source code. */
export class BtwMarkdown implements Component {
	private text = "";
	private parts: MarkdownPart[] = [];
	private cachedWidth = 0;
	private cachedLines?: string[];
	private readonly diagrams = new Map<string, string[]>();
	constructor(private readonly theme: Theme) {}

	setText(text: string): void {
		if (text === this.text) return;
		this.text = text;
		this.rebuild();
	}

	private rebuild(): void {
		this.parts = [];
		const lines = this.text.split("\n");
		let ordinary: string[] = [];
		const flush = () => {
			if (ordinary.length) this.parts.push({
				markdown: new Markdown(ordinary.join("\n"), 0, 0, getMarkdownTheme()),
				// Reserve native prefixes while keeping logical search independent of terminal width.
				logicalWidth: ordinary.reduce((width, line) => Math.max(width, visibleWidth(line)), 1) + LOGICAL_RENDER_PADDING,
			});
			ordinary = [];
		};
		for (let index = 0; index < lines.length; index++) {
			const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[index]);
			if (!opening || (opening[1][0] === "`" && opening[2].includes("`"))) { ordinary.push(lines[index]); continue; }
			const marker = opening[1][0], length = opening[1].length;
			let end = index + 1;
			const closing = new RegExp(`^ {0,3}${marker}{${length},}\\s*$`);
			while (end < lines.length && !closing.test(lines[end])) end++;
			if (end === lines.length) { ordinary.push(...lines.slice(index)); break; }
			const source = lines.slice(index + 1, end).join("\n").trim();
			const isMermaid = opening[2].trim().toLowerCase() === "mermaid";
			if (isMermaid && source.length <= MAX_DIAGRAM_SOURCE && end - index <= MAX_DIAGRAM_LINES && SUPPORTED_DIAGRAM.test(source)) {
				try {
					let diagram = this.diagrams.get(source);
					if (!diagram) {
						diagram = renderMermaidASCII(source, { useAscii: false, colorMode: "none", paddingX: 2, paddingY: 2 }).split("\n").map(stripTerminalSequences);
						if (this.diagrams.size >= MAX_CACHED_DIAGRAMS) this.diagrams.delete(this.diagrams.keys().next().value!);
						this.diagrams.set(source, diagram);
					}
					flush();
					this.parts.push({ diagram });
					index = end;
					continue;
				} catch { /* Render the original fence on unsupported Mermaid syntax. */ }
			}
			ordinary.push(...lines.slice(index, end + 1));
			index = end;
		}
		flush();
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		width = Math.max(1, width);
		if (this.cachedLines && width === this.cachedWidth) return this.cachedLines;
		const lines: string[] = [];
		for (const part of this.parts) {
			if (part.markdown) lines.push(...part.markdown.render(width));
			else if (part.diagram) {
				const diagramWidth = Math.max(...part.diagram.map(visibleWidth));
				// Tile oversized diagrams horizontally instead of overflowing or silently cutting nodes.
				for (let column = 0; column < diagramWidth; column += width) {
					if (diagramWidth > width) lines.push(this.theme.fg("dim", truncateToWidth(`Diagram · columns ${column + 1}–${Math.min(column + width, diagramWidth)}`, width, "")));
					lines.push(...part.diagram.map(line => this.theme.fg("accent", sliceByColumn(line, column, column + width))));
				}
				lines.push("");
			}
		}
		this.cachedWidth = width;
		this.cachedLines = lines.map(line => truncateToWidth(line, width, ""));
		return this.cachedLines;
	}

	getSearchRows(query: string, width: number): number[] {
		query = query.toLocaleLowerCase();
		if (!query) return [];
		width = Math.max(1, width);
		const matches: number[] = [];
		let rowOffset = 0;
		for (const part of this.parts) {
			if (part.markdown) {
				const logical = part.logicalLines ??= part.markdown.render(part.logicalWidth ?? width).map(line => searchText(line, false));
				const wrapped = part.markdown.render(width);
				matches.push(...mapSearchRows(logical, wrapped, query).map(row => rowOffset + row));
				rowOffset += wrapped.length;
			} else if (part.diagram) {
				const diagramWidth = Math.max(...part.diagram.map(visibleWidth));
				const headerRows = diagramWidth > width ? DIAGRAM_TILE_HEADER_ROWS : 0;
				part.diagram.forEach((line, row) => {
					for (const position of findOriginalOccurrences(line, query)) {
						const tile = Math.floor(visibleWidth(line.slice(0, position)) / width);
						matches.push(rowOffset + tile * (part.diagram!.length + headerRows) + headerRows + row);
					}
				});
				rowOffset += Math.ceil(diagramWidth / width) * (part.diagram.length + headerRows) + 1;
			}
		}
		return matches.sort((left, right) => left - right);
	}

	invalidate(): void { this.rebuild(); }

	dispose(): void {
		this.text = "";
		this.parts = [];
		this.cachedLines = undefined;
		this.diagrams.clear();
	}
}

function searchText(line: string, stripBorder = true): string {
	const plain = stripTerminalSequences(line);
	return (stripBorder ? plain.replace(/^(?:│ )+/, "") : plain).trimEnd().toLocaleLowerCase();
}

function findOccurrences(text: string, query: string): number[] {
	const positions: number[] = [];
	for (let position = text.indexOf(query); position !== -1; position = text.indexOf(query, position + query.length)) positions.push(position);
	return positions;
}

function findOriginalOccurrences(text: string, query: string): number[] {
	const positions = findOccurrences(text.toLocaleLowerCase(), query);
	if (!positions.length || /^[\x00-\x7f]*$/.test(text)) return positions;
	const originalOffsets: number[] = [];
	for (const { segment, index } of SEARCH_GRAPHEMES.segment(text)) {
		for (let offset = 0; offset < segment.toLocaleLowerCase().length; offset++) originalOffsets.push(index);
	}
	return positions.map(position => originalOffsets[position]);
}

function mapSearchRows(logical: string[], wrapped: string[], query: string): number[] {
	const plainLogical = logical.map(line => searchText(line));
	const occurrences = plainLogical.map(line => findOccurrences(line, query));
	if (occurrences.every(positions => positions.length === 0)) {
		return wrapped.flatMap((line, row) => findOccurrences(searchText(line), query).map(() => row));
	}
	const matches: number[] = [];
	let logicalRow = 0;
	let characterOffset = 0;
	let occurrenceIndex = 0;
	let skipUntil = 0;
	wrapped.forEach((line, row) => {
		if (row < skipUntil) return;
		const fragment = searchText(line).trim();
		if (TABLE_TOP_BORDER.test(fragment)) {
			while (logicalRow < logical.length && !TABLE_TOP_BORDER.test(searchText(logical[logicalRow]).trim())) logicalRow++;
			if (logicalRow < logical.length) {
				const logicalTable = readSearchTable(logical, logicalRow);
				const wrappedTable = readSearchTable(wrapped, row);
				matches.push(...mapTableSearchRows(logicalTable, wrappedTable, query));
				logicalRow = logicalTable.end;
				skipUntil = wrappedTable.end;
				characterOffset = 0;
				occurrenceIndex = 0;
				return;
			}
		}
		if (!fragment) return;
		let candidateRow = logicalRow;
		let position = -1;
		while (candidateRow < logical.length) {
			position = plainLogical[candidateRow].indexOf(fragment, candidateRow === logicalRow ? characterOffset : 0);
			if (position !== -1) break;
			candidateRow++;
		}
		if (position === -1) {
			// Width-dependent table borders/layout may not align with the logical projection.
			// Preserve direct visible matches without joining unrelated rows.
			matches.push(...findOccurrences(searchText(line), query).map(() => row));
			return;
		}
		if (candidateRow !== logicalRow) { logicalRow = candidateRow; occurrenceIndex = 0; }
		characterOffset = position + fragment.length;
		const pending = occurrences[logicalRow];
		while (occurrenceIndex < pending.length && pending[occurrenceIndex] < characterOffset) {
			matches.push(row);
			occurrenceIndex++;
		}
	});
	return matches;
}

function readSearchTable(lines: string[], start: number): SearchTable {
	const prefix = searchText(lines[start], false).indexOf("┌");
	const rows: SearchTableRow[] = [];
	let current: SearchTableRow = { cells: [], rows: [] };
	let row = start + 1;
	for (; row < lines.length; row++) {
		const line = searchText(lines[row], false).slice(prefix);
		if (TABLE_ROW_BORDER.test(line)) {
			if (current.rows.length) rows.push(current);
			current = { cells: [], rows: [] };
			if (line.startsWith("└")) return { rows, end: row + 1 };
		} else if (line.startsWith("│ ") && line.endsWith(" │")) {
			line.slice(TABLE_CELL_BORDER_COLUMNS, -TABLE_CELL_BORDER_COLUMNS).split(" │ ").forEach((cell, column) => {
				(current.cells[column] ??= []).push(cell.trim());
			});
			current.rows.push(row);
		} else break;
	}
	if (current.rows.length) rows.push(current);
	return { rows, end: row };
}

function mapTableSearchRows(logical: SearchTable, wrapped: SearchTable, query: string): number[] {
	const matches: number[] = [];
	wrapped.rows.forEach((group, index) => {
		const source = logical.rows[index];
		if (!source) return;
		group.cells.forEach((fragments, column) => {
			const text = source.cells[column]?.join(" ") ?? "";
			const occurrences = findOccurrences(text, query);
			let characterOffset = 0;
			let occurrenceIndex = 0;
			fragments.forEach((fragment, row) => {
				if (!fragment) return;
				const start = text.indexOf(fragment, characterOffset);
				if (start === -1) return;
				characterOffset = start + fragment.length;
				while (occurrenceIndex < occurrences.length && occurrences[occurrenceIndex] < characterOffset) {
					matches.push(group.rows[row]);
					occurrenceIndex++;
				}
			});
		});
	});
	return matches;
}
