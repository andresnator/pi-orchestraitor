import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Upstream FFF defaults to HOME/.pi/agent independently of PI_CODING_AGENT_DIR.
// Resolve its installed source first, then give the entire child an isolated home.
const prettyRoot = process.env.PI_PRETTY_PACKAGE_DIR ?? join(homedir(), ".pi", "agent", "npm", "node_modules", "@heyhuynhgiabuu/pi-pretty");
const testHome = await mkdtemp(join(tmpdir(), "pi-pretty-test-home-"));
const agentDir = join(testHome, ".pi", "agent");
try {
	await mkdir(agentDir, { recursive: true });
	const result = spawnSync(process.execPath, ["--test", fileURLToPath(new URL("../integration/pi-pretty.test.mjs", import.meta.url))], {
		stdio: "inherit", timeout: 60000,
		env: { ...process.env, HOME: testHome, PI_CODING_AGENT_DIR: agentDir, PRETTY_CONFIG_DIR: agentDir,
			PRETTY_DISABLE_TOOLS: "", PRETTY_ENABLE_TOOLS: "",
			PI_PRETTY_PACKAGE_DIR: prettyRoot, PI_PRETTY_ISOLATED_HOME: "1", PI_OFFLINE: "1", PI_TELEMETRY: "0" },
	});
	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
} finally { await rm(testHome, { recursive: true, force: true }); }
