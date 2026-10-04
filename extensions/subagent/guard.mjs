import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, writeFile, lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validatePath, protectedPath, projectRelativePath } from "./policy.mjs";

const MAX_SEARCH_FILES = 2000;
const MAX_SEARCH_BYTES = 1024 * 1024;
const MAX_OUTPUT = 32 * 1024;
const textResult = (text) => ({ content: [{ type: "text", text }], details: {} });
const pathSchema = { type: "object", properties: { path: { type: "string", description: "Project-relative path (default .)" } }, additionalProperties: false };

/** The only child extension. The SDK is injected by the isolated bootstrap. */
export function createGuard(sdk, manifest, digest, report) {
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
		pi.registerTool({ name: "search", label: "Search", description: "Search literal text recursively in safe project or selected skill files; no shell or regular expressions", defaultActive: false,
			parameters: { ...pathSchema, properties: { ...pathSchema.properties, text: { type: "string", minLength: 1 } }, required: ["text"] },
			async execute(_id, args, signal) {
				if (!args.text) throw new Error("Search text is required");
				const start = await validatePath(manifest, args.path ?? ".");
				const queue = [start], matches = [];
				let visited = 0, size = 0;
				while (queue.length && visited < MAX_SEARCH_FILES && size < MAX_OUTPUT) {
					if (signal?.aborted) throw new Error("Task cancelled");
					const path = queue.pop();
					try { await validatePath(manifest, path); } catch { continue; }
					const stat = await lstat(path);
					if (stat.isDirectory()) {
						for (const entry of await readdir(path)) {
							if (!protectedPath(entry)) queue.push(join(path, entry));
						}
						visited++;
						continue;
					}
					visited++;
					if (stat.size > MAX_SEARCH_BYTES) continue;
					const content = await readFile(path, "utf8");
					if (content.includes("\0")) continue;
					for (const [index, line] of content.split("\n").entries()) {
						if (line.includes(args.text)) {
							const match = `${projectRelativePath(manifest.cwd, path)}:${index + 1}: ${line}`;
							matches.push(match); size += match.length;
							if (size >= MAX_OUTPUT) break;
						}
					}
				}
				return textResult(limit(matches.join("\n") + (queue.length ? "\n[Search truncated]" : "")));
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
