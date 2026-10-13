import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createWorkspace, hostRoot, isolatedAgentDir, packageRoot, pi, startSession } from "../helpers/pi-host.mjs";

const bridgeRoot = process.env.PI_CLAUDE_BRIDGE_PACKAGE_DIR;
assert.ok(bridgeRoot, "Set PI_CLAUDE_BRIDGE_PACKAGE_DIR to the pinned companion in an isolated HOME");
assert.equal(JSON.parse(await readFile(join(bridgeRoot, "package.json"))).version, "0.9.2");
assert.equal(JSON.parse(await readFile(join(hostRoot, "package.json"))).version, "1.2.0");

test("Claude Bridge 0.9.2 registers against Pi 1.2.0 and survives reload without model requests", async t => {
	const cwd = await createWorkspace(t);
	const settingsManager = pi.SettingsManager.inMemory();
	const loader = new pi.DefaultResourceLoader({ cwd, agentDir: isolatedAgentDir, settingsManager,
		noExtensions: true, additionalExtensionPaths: [join(bridgeRoot, "src/index.ts"), join(packageRoot, "extensions/nan.ts")],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session, errors } = await startSession(t, cwd, { loader, settingsManager });
	for (let round = 0; round < 2; round++) {
		assert.ok(session.modelRuntime.getProvider("claude-bridge"));
		assert.ok(session.modelRuntime.getModels("claude-bridge").length > 0);
		assert.ok(session.modelRuntime.getProvider("nan"));
		if (round === 0) await session.reload();
	}
	assert.deepEqual(errors, []);
});
