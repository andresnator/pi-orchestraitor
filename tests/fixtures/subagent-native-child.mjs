import { readFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createChildRuntime } from "../../extensions/subagent/runtime.mjs";
import { RpcDecoder } from "../../extensions/subagent/controller.mjs";

const [manifestPath, sdkRoot] = process.argv.slice(2);
const raw = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(raw);
const temporary = join(dirname(manifestPath), "settings");
await mkdir(temporary);
process.env.PI_CODING_AGENT_DIR = temporary;
const sdk = await import(pathToFileURL(join(sdkRoot, "dist/index.js")).href);
const { createAssistantMessageEventStream } = await import(pathToFileURL(join(sdkRoot, "node_modules/@earendil-works/pi-ai/dist/index.js")).href);
const pendingWrites = [];
const report = (message) => {
	if (message.type !== "write") return process.send(message);
	pendingWrites.push(message);
	if (message.phase === "completed") process.send({ type: "file_changed" });
};

// Delay real guard notifications until the parent has requested RPC abort.
// This models notifications queued behind cancellation, without provider/network calls.
const decoder = new RpcDecoder();
process.stdin.on("data", (chunk) => decoder.push(chunk, (command) => {
	if (command.type === "abort") {
		void (async () => {
			for (const notification of pendingWrites.splice(0)) {
				await new Promise((resolve) => process.send(notification, resolve));
			}
		})();
	}
}));
let requests = 0;
const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(temporary, "auth.json"), modelsPath: null, refreshOnCreate: false });
modelRuntime.registerProvider("fixture", { api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "fixture",
	models: [{ id: "model", name: "Local mock", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }],
	streamSimple(model, _context, options) {
		const stream = createAssistantMessageEventStream();
		const turn = requests++;
		const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
			usage: manifest.fixtureUsage[turn],
			stopReason: "toolUse", content: [{ type: "toolCall", id: "write-once", name: "write", arguments: { path: manifest.files[0], content: "native write before cancellation" } }] };
		stream.push({ type: "start", partial: message });
		if (turn === 0) {
			stream.push({ type: "done", reason: "toolUse", message });
			stream.end(message);
		} else {
			const abort = () => {
				const error = { ...message, content: [], stopReason: "aborted", errorMessage: "Mock aborted" };
				stream.push({ type: "error", reason: "aborted", error });
				stream.end(error);
			};
			if (options.signal.aborted) abort();
			else options.signal.addEventListener("abort", abort, { once: true });
			process.send({ type: "model_waiting" });
		}
		return stream;
	},
});
const runtime = await createChildRuntime(sdk, manifest, createHash("sha256").update(raw).digest("hex"), report, temporary, modelRuntime);
await sdk.runRpcMode(runtime);
