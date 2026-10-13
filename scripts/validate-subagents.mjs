import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertReleaseAge, integrationFingerprint, PI_VERSION, SUBAGENTS_VERSION } from "./subagents-validation.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.argv[2] ?? ".ai/absorb/pi-subagents-validation.json");
if (process.argv.length > 3) throw new Error("Usage: pnpm run test:subagents [receipt.json]");
let scratch;
try {
	// Use the committed age policy, including the user's exact-version exceptions.
	await assertReleaseAge("@earendil-works/pi-coding-agent", PI_VERSION);
	await assertReleaseAge("pi-subagents", SUBAGENTS_VERSION);
	scratch = await realpath(await mkdtemp(join(tmpdir(), "pi-subagents-validation-")));
	const home = join(scratch, "home"), agentDir = join(home, ".pi/agent");
	await mkdir(agentDir, { recursive: true });
	const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
	await writeFile(join(scratch, "package.json"), JSON.stringify({ private: true, packageManager: manifest.packageManager, dependencies: {
		"@earendil-works/pi-coding-agent": PI_VERSION, "pi-subagents": SUBAGENTS_VERSION,
		"pi-claude-bridge": manifest.config.piClaudeBridge.split("@").at(-1),
		"@heyhuynhgiabuu/pi-pretty": manifest.config.piPretty.split("@").at(-1),
	} }));
	await writeFile(join(scratch, "pnpm-workspace.yaml"), await readFile(join(root, "pnpm-workspace.yaml")));
	const install = spawnSync("pnpm", ["install", "--ignore-scripts"], { cwd: scratch, stdio: "inherit", timeout: 120000 });
	if (install.error || install.status !== 0) throw new Error(`Isolated dependency installation failed: ${install.error?.message ?? install.status}`);
	const env = { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agentDir, PI_TEST_PACKAGE_DIR: await realpath(join(scratch, "node_modules/@earendil-works/pi-coding-agent")),
		PI_SUBAGENTS_PACKAGE_DIR: await realpath(join(scratch, "node_modules/pi-subagents")), PI_CLAUDE_BRIDGE_PACKAGE_DIR: await realpath(join(scratch, "node_modules/pi-claude-bridge")),
		PI_PRETTY_PACKAGE_DIR: await realpath(join(scratch, "node_modules/@heyhuynhgiabuu/pi-pretty")), PRETTY_CONFIG_DIR: agentDir,
		PI_SUBAGENTS_TEMP_ROOT: join(scratch, "native-runtime"), PI_SUBAGENTS_WORKTREE_DIR: join(scratch, "worktrees"),
		PRETTY_DISABLE_TOOLS: "", PRETTY_ENABLE_TOOLS: "", PI_OFFLINE: "1", PI_TELEMETRY: "0" };
	const checks = spawnSync(process.execPath, ["--test", "tests/integration/claude-bridge.test.mjs", "tests/integration/native-subagents.test.mjs"], { cwd: root, env, stdio: "inherit", timeout: 180000 });
	if (checks.error || checks.status !== 0) throw new Error(`Pi ${PI_VERSION} / pi-subagents ${SUBAGENTS_VERSION} validation failed: ${checks.error?.message ?? checks.status}`);
	await mkdir(join(output, ".."), { recursive: true });
	await writeFile(output, JSON.stringify({ status: "passed", pi: PI_VERSION, plugin: SUBAGENTS_VERSION,
		fingerprint: await integrationFingerprint(root), recordedAt: new Date().toISOString(),
		checks: "native-subagents integration", realModels: "pending" }, null, 2) + "\n");
	console.log(`Validation receipt: ${output}. Real-model acceptance remains separate.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (scratch) await rm(scratch, { recursive: true, force: true }); }
