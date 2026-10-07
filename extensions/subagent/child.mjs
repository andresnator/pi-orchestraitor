import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { childBridge } from "./bridge.mjs";
import { readFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createChildRuntime } from "./runtime.mjs";
import { validateManifest, validatePath } from "./policy.mjs";

// Credentials stay in the host's existing storage. Only paths cross this boundary.
const [manifestPath, sdkRoot, credentialDir] = process.argv.slice(2);
const raw = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(raw);
const digest = createHash("sha256").update(raw).digest("hex");
const report = (message) => process.connected && process.send(message);
const temporary = join(dirname(manifestPath), "settings");
await mkdir(temporary, { mode: 0o700 });
process.env.PI_CODING_AGENT_DIR = temporary;
process.env.PI_TELEMETRY = "0";
const sdk = await import(pathToFileURL(join(sdkRoot, "dist/index.js")).href);
try {
	validateManifest(manifest);
	for (const path of manifest.files) await validatePath(manifest, path, true);
	const modelRuntime = await sdk.ModelRuntime.create({
		authPath: join(manifest.bridgeModel ? temporary : credentialDir, "auth.json"), modelsPath: manifest.bridgeModel ? null : join(credentialDir, "models.json"),
		allowModelNetwork: false,
	});
	if (manifest.bridgeModel) {
		const require = createRequire(join(sdkRoot, "package.json"));
		const aiPath = require.resolve.paths("@earendil-works/pi-ai").map(root => join(root, "@earendil-works/pi-ai/dist/index.js")).find(existsSync);
		if (!aiPath) throw new Error("Cannot locate host pi-ai SDK");
		const { createAssistantMessageEventStream } = await import(pathToFileURL(aiPath).href);
		const model = manifest.bridgeModel;
		modelRuntime.registerProvider(model.provider, { api: model.api, baseUrl: "https://bridge.invalid", apiKey: "parent-bridge",
			models: [{ ...model, baseUrl: "https://bridge.invalid" }], streamSimple: childBridge(process, createAssistantMessageEventStream, model) });
	}
	const runtime = await createChildRuntime(sdk, manifest, digest, report, temporary, modelRuntime);
	// Native RPC owns stdin, framing, extension binding and settled events.
	await sdk.runRpcMode(runtime);
} catch (error) {
	report({ type: "startup_error", message: error instanceof Error ? error.message : String(error) });
	process.exitCode = 1;
}

if (process.exitCode) process.disconnect?.();
