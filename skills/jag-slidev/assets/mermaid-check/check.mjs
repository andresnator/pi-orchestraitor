// Adapted from agents-orchestrator's MIT mermaid-check helper for Pi.
// This validates a documented fence subset and Mermaid syntax, not rendering.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const USAGE = "Usage: node check.mjs <slides.md> --expect <nonnegative-block-count>";

export function extractMermaidBlocks(source) {
	const blocks = [];
	let fence;
	for (const [index, line] of source.split(/\r?\n/u).entries()) {
		if (fence) {
			const closing = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/u);
			if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) {
				if (fence.mermaid) {
					const code = fence.lines.join("\n");
					if (!code.trim()) throw new Error(`Empty Mermaid block at line ${fence.line}`);
					blocks.push({ line: fence.line, code });
				}
				fence = undefined;
			} else {
				fence.lines.push(line);
			}
			continue;
		}
		const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
		if (!opening) continue;
		const info = opening[2].trim();
		if (opening[1][0] === "`" && info.includes("`")) continue;
		fence = {
			marker: opening[1][0], length: opening[1].length, line: index + 1,
			mermaid: /^mermaid(?:\s|$)/iu.test(info), lines: [],
		};
	}
	if (fence?.mermaid) throw new Error(`Unclosed Mermaid fence at line ${fence.line}`);
	return blocks;
}

export async function checkMarkdown(source, { expected, parse } = {}) {
	const blocks = extractMermaidBlocks(source);
	if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 0)) {
		throw new Error("Expected count must be a nonnegative integer");
	}
	if (expected !== undefined && blocks.length !== expected) {
		throw new Error(`Expected ${expected} Mermaid blocks; found ${blocks.length}`);
	}
	if (!blocks.length) return { count: 0, failures: [] };
	const parseDiagram = parse ?? await loadParser();
	const failures = [];
	for (const block of blocks) {
		try {
			if (await parseDiagram(block.code) === false) throw new Error("Parser rejected diagram");
		} catch (error) {
			failures.push({ line: block.line, message: error instanceof Error ? error.message : "Parser rejected diagram" });
		}
	}
	return { count: blocks.length, failures };
}

async function loadParser() {
	// Initialize the DOM before importing Mermaid/DOMPurify; never stub sanitization.
	const { JSDOM } = await import("jsdom");
	const dom = new JSDOM("<!DOCTYPE html><body></body>");
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	const mermaid = (await import("mermaid")).default;
	mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
	return (code) => mermaid.parse(code);
}

async function main() {
	try {
		const { values, positionals } = parseArgs({ options: { expect: { type: "string" } }, allowPositionals: true });
		if (positionals.length !== 1 || !/^\d+$/u.test(values.expect ?? "")) throw new Error(USAGE);
		const source = await readFile(positionals[0], "utf8");
		const result = await checkMarkdown(source, { expected: Number(values.expect) });
		console.log(result.count ? `${result.count} Mermaid blocks checked` : "0 Mermaid blocks; no diagrams validated");
		for (const failure of result.failures) console.error(`line ${failure.line}: ${failure.message}`);
		process.exitCode = result.failures.length ? 1 : 0;
	} catch (error) {
		console.error(`Mermaid check failed: ${error.message}`);
		process.exitCode = 2;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
