import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, writeFile, lstat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { basename, dirname, join, resolve } from "node:path";
import { validatePath, protectedPath, projectRelativePath, PROTECTED_PARTS } from "./policy.mjs";

const MAX_SEARCH_FILES = 2000;
const MAX_SEARCH_BYTES = 1024 * 1024;
const MAX_OUTPUT = 32 * 1024;
const MAX_STDERR = 4096;
const OUTPUT_RESERVE = 128;
// Pi's grep returns 100 matches by default; a larger limit must be requested.
const DEFAULT_SEARCH_LIMIT = 100;
// Protected parts below the search root, case-insensitively; validatePath still checks every match.
const EXCLUDED = [...PROTECTED_PARTS].flatMap((part) => ["--iglob", `!${part}`, "--iglob", `!**/${part}/**`]);
const textResult = (text) => ({ content: [{ type: "text", text }], details: {} });
const pathSchema = { type: "object", properties: { path: { type: "string", description: "Project-relative path (default .)" } }, additionalProperties: false };

let ripgrep;
/** The bundled ripgrep binary, or undefined when this platform's optional package is missing. */
export const resolveRipgrep = () => ripgrep ??= import("@vscode/ripgrep").then(({ rgPath }) => rgPath, () => undefined);

/** The only child extension. The SDK is injected by the isolated bootstrap. */
export function createGuard(sdk, manifest, digest, report, { ripgrepPath = resolveRipgrep } = {}) {
	return (pi) => {
		const factories = [sdk.createReadToolDefinition];
		if (manifest.role === "implement") factories.push(sdk.createEditToolDefinition, sdk.createWriteToolDefinition);
		for (const factory of factories) {
			const native = factory(manifest.cwd);
			pi.registerTool({ ...native, defaultActive: false,
				async execute(id, args, signal, update, ctx) {
					const writing = native.name !== "read";
					const path = await validatePath(manifest, args.path, writing);
					if (signal?.aborted) throw new Error("Task cancelled");
					// Native tools normalize paths and read may try alternate filenames.
					// Validate every final operation path, after that resolution has happened.
					const operations = guardedFileOperations(sdk, manifest, path, writing, report, signal);
					return factory(manifest.cwd, { operations }).execute(id, { ...args, path }, signal, update, ctx);
				},
			});
		}
		pi.registerTool({ name: "list", label: "List", description: "List safe entries in a project or selected skill directory", parameters: pathSchema, defaultActive: false,
			async execute(_id, args, signal) {
				const directory = await validatePath(manifest, args.path ?? ".");
				const entries = [];
				for (const entry of await readdir(directory, { withFileTypes: true })) {
					if (signal?.aborted) throw new Error("Task cancelled");
					try { await validatePath(manifest, join(directory, entry.name)); } catch { continue; }
					entries.push(`${entry.name}${entry.isDirectory() ? "/" : ""}`);
				}
				return textResult(limit(entries.sort().join("\n")));
			},
		});
		pi.registerTool({ name: "search", label: "Search", description: `Search literal text recursively in safe project or selected skill files, honoring .gitignore like Pi's grep; name an ignored directory as path to search it. Returns ${DEFAULT_SEARCH_LIMIT} results unless limit is set. No shell or regular expressions`, defaultActive: false,
			parameters: { ...pathSchema, properties: { ...pathSchema.properties, text: { type: "string", minLength: 1 }, mode: { type: "string", enum: ["content", "files"] }, limit: { type: "integer", minimum: 1, maximum: 2000 } }, required: ["text"] },
			async execute(_id, args, signal) {
				return textResult(await searchText(manifest, args, signal, { rgPath: await ripgrepPath(), truncateLine: sdk.truncateLine }));
			},
		});
		pi.on("tool_call", (event) => {
			if (!manifest.tools.includes(event.toolName)) return { block: true, reason: "Tool forbidden in child session" };
		});
		pi.on("session_start", (_event, ctx) => {
			const tools = pi.getActiveTools().sort();
			if (JSON.stringify(tools) !== JSON.stringify([...manifest.tools].sort())) throw new Error("Guard tool selection mismatch");
			report({ type: "guard_ready", id: manifest.id, digest, cwd: ctx.cwd, tools,
				model: `${ctx.model.provider}/${ctx.model.id}`, reasoning: pi.getThinkingLevel() });
		});
	};
}

function limit(text) {
	return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n[Output truncated]` : text;
}

/** Literal search through the bundled ripgrep, or a bounded Node walk without it. Every reported file passes validatePath. */
export async function searchText(manifest, args, signal, { rgPath, truncateLine }) {
	if (args.mode !== undefined && !["content", "files"].includes(args.mode)) throw new Error("Invalid search mode");
	if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 2000)) throw new Error("Invalid search limit");
	if (!args.text) throw new Error("Search text is required");
	const start = await validatePath(manifest, args.path ?? ".");
	const results = collector(manifest, args, truncateLine);
	let searched = false;
	if (rgPath) {
		try { await ripgrepSearch(rgPath, manifest, start, args, signal, results); searched = true; }
		catch (error) { if (!["ENOENT", "EACCES"].includes(error?.code)) throw error; }
	}
	if (!searched) await walkSearch(manifest, start, args, signal, results);
	return limit(results.lines.join("\n") + (results.reason ? `\n[Search truncated: ${results.reason}]` : ""));
}

/** Accumulates formatted results; add returns false once the search must stop. */
function collector(manifest, args, truncateLine) {
	const max = args.limit ?? DEFAULT_SEARCH_LIMIT;
	const lines = [], files = new Set();
	let size = 0, reason;
	return {
		lines,
		get reason() { return reason; },
		stop(why) { reason ??= why; },
		add(path, lineNumber, text) {
			if (reason) return false;
			const relative = projectRelativePath(manifest.cwd, path);
			if (args.mode === "files") {
				if (files.has(relative)) return true;
				files.add(relative);
			}
			// One more result than the limit proves the output is incomplete.
			if (lines.length >= max) { reason = `${max}-${args.mode === "files" ? "file" : "match"} limit; pass limit for more`; return false; }
			// Lines are cut as Pi's grep cuts them, so one minified line cannot fill the output.
			const entry = args.mode === "files" ? relative : `${relative}:${lineNumber}: ${truncateLine(text.replace(/\r$/, "")).text}`;
			// Reserve room for the truncation reason, so the final cap never cuts it.
			if (size + entry.length + 1 > MAX_OUTPUT - OUTPUT_RESERVE) { reason = `${MAX_OUTPUT / 1024} KB output`; return false; }
			lines.push(entry);
			size += entry.length + 1;
			return true;
		},
	};
}

const decode = (value) => value?.text ?? (typeof value?.bytes === "string" ? Buffer.from(value.bytes, "base64").toString("utf8") : undefined);

/** ripgrep runs below the validated start, so exclusions only apply beneath it. Symlinks are not followed and no shell is used. */
async function ripgrepSearch(rgPath, manifest, start, args, signal, results) {
	if (signal?.aborted) throw new Error("Task cancelled");
	const directory = (await lstat(start)).isDirectory();
	const cwd = directory ? start : dirname(start);
	const child = spawn(rgPath, ["--json", "--line-number", "--color=never", "--hidden", "--fixed-strings", "--no-config",
		"--max-filesize", `${MAX_SEARCH_BYTES}`, ...(args.mode === "files" ? ["--max-count", "1"] : []), ...EXCLUDED,
		"--", args.text, directory ? "." : basename(start)], { cwd, stdio: ["ignore", "pipe", "pipe"] });
	const finished = new Promise((done) => { child.once("close", (code) => done(code)); child.once("error", (error) => done(error)); });
	let stderr = "", stopped = false;
	const stop = () => { stopped = true; child.kill(); };
	signal?.addEventListener("abort", stop, { once: true });
	child.stderr.on("data", (chunk) => { if (stderr.length < MAX_STDERR) stderr += chunk; });
	const allowed = new Map();
	try {
		for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
			if (stopped) break;
			let event;
			try { event = JSON.parse(line); } catch { continue; }
			if (event.type !== "match") continue;
			const relative = decode(event.data?.path), text = decode(event.data?.lines);
			if (relative === undefined || text === undefined) continue;
			const path = resolve(cwd, relative);
			if (!allowed.has(path)) allowed.set(path, await validatePath(manifest, path).then(() => true, () => false));
			if (!allowed.get(path)) continue;
			if (!results.add(path, event.data.line_number, text.replace(/\n$/, ""))) { stop(); break; }
		}
	} finally {
		signal?.removeEventListener("abort", stop);
		if (!stopped && child.exitCode === null) child.kill();
	}
	const outcome = await finished;
	if (signal?.aborted) throw new Error("Task cancelled");
	if (outcome instanceof Error) throw outcome;
	// Exit 1 means no match; 2 can accompany partial results such as unreadable files.
	if (!stopped && outcome !== 0 && outcome !== 1 && !results.lines.length) throw new Error(`Search failed: ${stderr.trim() || `ripgrep exited with code ${outcome}`}`);
}

/** Fallback without ripgrep: breadth-first in name order, bounded by file count. */
async function walkSearch(manifest, start, args, signal, results) {
	const queue = [start];
	for (let index = 0; index < queue.length; index++) {
		if (index >= MAX_SEARCH_FILES) { results.stop(`${MAX_SEARCH_FILES}-file budget`); return; }
		if (signal?.aborted) throw new Error("Task cancelled");
		const path = queue[index];
		try { await validatePath(manifest, path); } catch { continue; }
		const stat = await lstat(path);
		if (stat.isDirectory()) {
			for (const entry of (await readdir(path)).sort()) {
				if (!protectedPath(entry)) queue.push(join(path, entry));
			}
			continue;
		}
		if (!stat.isFile() || stat.size > MAX_SEARCH_BYTES) continue;
		const content = await readFile(path, "utf8");
		if (content.includes("\0")) continue;
		for (const [number, line] of content.split("\n").entries()) {
			if (!line.includes(args.text)) continue;
			if (!results.add(path, number + 1, line)) return;
			if (args.mode === "files") break;
		}
	}
}

function guardedFileOperations(sdk, manifest, requestedPath, writing, report, signal) {
	const checkedPath = async (path, write = writing) => {
		const target = await validatePath(manifest, path, write);
		if (signal?.aborted) throw new Error("Task cancelled");
		return target;
	};
	return {
		async access(path) {
			await access(await checkedPath(path), writing ? constants.R_OK | constants.W_OK : constants.R_OK);
		},
		async readFile(path) {
			return readFile(await checkedPath(path));
		},
		async detectImageMimeType(path) {
			return sdk.detectSupportedImageMimeTypeFromFile(await checkedPath(path, false));
		},
		async mkdir(directory) {
			// Native write calls mkdir before writeFile. Allow only the requested file's parent.
			if (directory !== dirname(requestedPath)) throw new Error("Write outside assigned file directory");
			await checkedPath(requestedPath, true);
			await mkdir(directory, { recursive: true });
		},
		async writeFile(path, content) {
			const target = await checkedPath(path, true);
			const relativePath = projectRelativePath(manifest.cwd, target);
			// An attempted operation can leave partial content if native writing fails.
			report({ type: "write", path: relativePath, phase: "attempted" });
			await writeFile(target, content, "utf8");
			report({ type: "write", path: relativePath, phase: "completed" });
		},
	};
}
