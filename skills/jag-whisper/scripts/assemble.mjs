// Assemble local Whisper JSON without sending transcript text to a model.
import { constants } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const USAGE = "Usage: node assemble.mjs <input.json> <new-output.md> [--summary <file> --coverage complete|partial]";

export function buildArtifact(result, { source, summary, coverage, processedAt = new Date().toISOString().slice(0, 10) } = {}) {
	validateTranscript(result);
	if (summary !== undefined && (typeof summary !== "string" || !summary.trim() || !["complete", "partial"].includes(coverage))) {
		throw new Error("A nonempty summary and explicit summary coverage (complete or partial) are required");
	}
	if (summary === undefined && coverage !== undefined) throw new Error("Cannot set coverage without a summary");
	let longestFence = 0;
	for (const match of result.text.matchAll(/`+/gu)) longestFence = Math.max(longestFence, match[0].length);
	const fence = "`".repeat(Math.max(3, longestFence + 1));
	const metadata = {
		processing_date: processedAt,
		transcript_source: source ?? null,
		language: typeof result.language === "string" ? result.language : null,
		summary_coverage: summary === undefined ? "none" : coverage,
	};
	return [
		"---", ...Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`), "---",
		"", "# Recording Transcript", "", "Machine-generated recognition; may contain errors. Not a verified record of speech.",
		...(summary === undefined ? [] : ["", "## Summary", "", summary]),
		"", "## Full Transcript", "", fence + "text", result.text, fence, "",
	].join("\n");
}

export async function readTranscript(path) {
	const raw = await readBounded(path);
	let result;
	try { result = JSON.parse(raw); } catch { throw new Error("Invalid transcript JSON; inspect the local file without exposing its contents"); }
	validateTranscript(result);
	return result;
}

export async function writeArtifact(input, output, options = {}) {
	const result = await readTranscript(input);
	const markdown = buildArtifact(result, { ...options, source: basename(input) });
	await writeFile(output, markdown, { encoding: "utf8", flag: "wx", mode: 0o600 });
	return { output, words: result.text.trim().split(/\s+/u).length, characters: result.text.length,
		summaryCoverage: options.summary === undefined ? "none" : options.coverage };
}

function validateTranscript(result) {
	if (!result || typeof result.text !== "string") throw new Error("Transcript JSON requires a string text field");
	if (!result.text.trim()) throw new Error("Transcript is empty; check silence, source file and transcription errors");
	if (!result.text.isWellFormed()) throw new Error("Transcript text contains invalid Unicode");
}

async function readBounded(path) {
	const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
	try {
		const info = await file.stat();
		if (!info.isFile() || info.size > MAX_INPUT_BYTES) throw new Error("Input must be a regular file no larger than 64 MiB");
		const chunks = [];
		let total = 0;
		while (total <= MAX_INPUT_BYTES) {
			const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, MAX_INPUT_BYTES + 1 - total));
			const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
			if (!bytesRead) break;
			total += bytesRead;
			if (total > MAX_INPUT_BYTES) throw new Error("Input exceeds 64 MiB");
			chunks.push(buffer.subarray(0, bytesRead));
		}
		try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total)); }
		catch { throw new Error("Input contains invalid UTF-8"); }
	} finally {
		await file.close();
	}
}

async function main() {
	try {
		const { values, positionals } = parseArgs({
			options: { summary: { type: "string" }, coverage: { type: "string" } }, allowPositionals: true,
		});
		if (positionals.length !== 2) throw new Error(USAGE);
		const summary = values.summary === undefined ? undefined : await readBounded(values.summary);
		const result = await writeArtifact(positionals[0], positionals[1], { summary, coverage: values.coverage });
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(`Transcript assembly failed: ${error.message}`);
		process.exitCode = 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
