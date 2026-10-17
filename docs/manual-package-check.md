# Manual pnpm package check

Run this from the repository root in a Bash-compatible console. Use Node 22.19+ and pnpm 12.9.1, with the locked development dependencies already installed.

This replaces only the removed `shouldLoadOnlyPackagedResourcesWhenpnpmTarballIsExtractedElsewhere` test. The npm equivalent remains automated. The procedure checks that a pnpm tarball loads outside the checkout, under a `node_modules` path containing spaces, without bundled host peers or accidental imports from the repository. It does not test live Claude authentication, model responses, MCP services, or the separately installed Pretty/Claude Bridge companions.

## 1. Pack and extract into a temporary workspace

Paste this block from the repository root. Keep the same console for the next steps. All generated files stay in the temporary directory; no personal Pi registration is changed.

```bash
export HARNESS_ROOT="$PWD"
export CHECK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/pi-package-manual.XXXXXX")"
export PACKAGE_DIR="$CHECK_ROOT/node_modules/harness package with spaces"
export PI_CODING_AGENT_DIR="$CHECK_ROOT/agent"
export PI_OFFLINE=1
export PI_TELEMETRY=0

pnpm pack --ignore-scripts --json --pack-destination "$CHECK_ROOT" > "$CHECK_ROOT/pack.json"
TARBALL="$(node --input-type=module -e '
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const result = JSON.parse(readFileSync(process.argv[1], "utf8"));
const packed = Array.isArray(result) ? result[0] : result;
console.log(resolve(process.env.CHECK_ROOT, packed.filename));
' "$CHECK_ROOT/pack.json")"
tar -tzf "$TARBALL"
tar -xzf "$TARBALL" -C "$CHECK_ROOT"
mkdir -p "$CHECK_ROOT/node_modules" "$PI_CODING_AGENT_DIR" "$CHECK_ROOT/consumer"
mv "$CHECK_ROOT/package" "$PACKAGE_DIR"
cp "$HARNESS_ROOT/pnpm-lock.yaml" "$HARNESS_ROOT/pnpm-workspace.yaml" "$PACKAGE_DIR/"
```

Stop if any command fails. Inspect the archive listing: it should contain package resources, not `tests/`, `.ai/`, personal `.pi/` settings, credentials, or the development host's `node_modules/`. The two files copied afterward are validation fixtures, not part of the distributed archive.

## 2. Provision production dependencies

The original offline setup is:

```bash
(cd "$PACKAGE_DIR" && pnpm install --prod --offline --frozen-lockfile --ignore-scripts)
```

`ERR_PNPM_NO_OFFLINE_META` means registry metadata is missing from the local pnpm cache. It is a setup failure, not a failed resource-loading assertion. If you explicitly want to allow registry access, retry without `--offline`:

```bash
(cd "$PACKAGE_DIR" && pnpm install --prod --frozen-lockfile --ignore-scripts)
```

This network-enabled fallback still uses the frozen lockfile and the repository's release-age and dependency policies; lifecycle scripts remain disabled. Do not disable those policies, regenerate the lockfile, or approve build scripts to make this check pass. Stop on a different policy or installation error and inspect it first. A pass using this fallback is **not** evidence that offline installation works.

## 3. Load the extracted resources without model or MCP requests

Paste this block in the same console. It uses the checkout's installed Pi SDK only as the host; all harness resources and the child bootstrap come from the extracted tarball.

```bash
node --input-type=module <<'JS'
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { HARNESS_ROOT, CHECK_ROOT, PACKAGE_DIR, PI_CODING_AGENT_DIR } = process.env;
const hostRoot = await realpath(join(HARNESS_ROOT, "node_modules/@earendil-works/pi-coding-agent"));
const pi = await import(pathToFileURL(join(hostRoot, "dist/index.js")).href);
const cwd = join(CHECK_ROOT, "consumer");
const settingsManager = pi.SettingsManager.inMemory({ packages: [PACKAGE_DIR], theme: "system" });
const disabledMcp = pi.createMcpExtension({
  loadConfig: () => ({ errors: [], servers: [
    { name: "context7", config: { url: "https://example.invalid", enabled: false }, source: "manual" },
    { name: "engram", config: { command: "engram", enabled: false }, source: "manual" },
  ] }),
  createTransport: () => { throw new Error("No MCP connection is allowed"); },
});
const loader = new pi.DefaultResourceLoader({
  cwd, agentDir: PI_CODING_AGENT_DIR, settingsManager,
  noSkills: true, additionalSkillPaths: [join(PACKAGE_DIR, "skills")],
  noThemes: true, noContextFiles: true, extensionFactories: [disabledMcp],
});
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, []);
assert.deepEqual(loader.getSkills().diagnostics, []);
assert.deepEqual(loader.getPrompts().prompts.map(({ name }) => name).sort(), ["absorb", "orchestraitor", "plan", "review"]);
assert.equal(loader.getSkills().skills.length, 37);
assert.ok(loader.getExtensions().extensions.every(({ path }) => path.startsWith(PACKAGE_DIR)));
const provenance = JSON.parse(await readFile(join(PACKAGE_DIR, "docs/skills-provenance.json"), "utf8"));
for (const skill of provenance.skills) {
  for (const resource of skill.resources) {
    const bytes = await readFile(join(PACKAGE_DIR, "skills", skill.name, resource.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), resource.sha256);
  }
}
const { session } = await pi.createAgentSession({
  cwd, agentDir: PI_CODING_AGENT_DIR, settingsManager, resourceLoader: loader,
  sessionManager: pi.SessionManager.inMemory(cwd),
});
try {
  const errors = [];
  await session.bindExtensions({ onError: (error) => errors.push(error) });
  const result = await session.extensionRunner.emitBeforeAgentStart("Manual package check", undefined, {
    cwd, customPrompt: "Host instructions", selectedTools: ["read", "bash", "edit", "write"],
    sections: { existing: "Project-specific instructions" },
  });
  assert.deepEqual(errors, []);
  assert.equal(result.systemPromptOptions.customPrompt, "Host instructions");
  assert.equal(result.systemPromptOptions.sections.existing, "Project-specific instructions");
  assert.match(result.systemPromptOptions.sections.pi_orchestraitor_core, /Personal harness rules/);
  assert.match(result.systemPromptOptions.sections.pi_orchestraitor_personality, /Colombian software architect/);
  assert.equal(session.modelRuntime.getProvider("nan")?.name, "NaN");
  for (const tool of ["subagent_run", "subagent_collect", "orchestraitor_tasks", "orchestraitor_ask", "skill_registry"]) {
    assert.ok(session.getActiveToolNames().includes(tool), `Missing tool: ${tool}`);
  }
  const { BatchController } = await import(pathToFileURL(join(PACKAGE_DIR, "extensions/subagent/controller.mjs")).href);
  const [child] = await new BatchController({
    sdkRoot: hostRoot, credentialDir: PI_CODING_AGENT_DIR,
    childPath: join(PACKAGE_DIR, "extensions/subagent/child.mjs"),
  }).run([{
    id: "manual", role: "explore", instruction: "inspect", cwd,
    model: "unavailable/model", reasoning: "high", skills: [], files: [], contextFiles: [], tools: ["read", "search", "list"],
  }], () => "No model call is allowed");
  assert.deepEqual({ status: child.status, terminated: child.terminated }, { status: "failed", terminated: true });
  assert.match(child.diagnostic, /Model unavailable/);
  console.log("PASS: extracted pnpm resources, instructions, skill hashes and child bootstrap");
} finally {
  try { await session.extensionRunner.emit({ type: "session_shutdown" }); }
  finally { session.dispose(); }
}
JS
```

Success means the final `PASS` line appears with exit code zero and no assertion/loader errors. The child's `Model unavailable` result is intentional: it proves the extracted bootstrap starts and terminates without making a model call. This console smoke check does not reproduce every exact archive-inventory assertion in the retained npm test.

## 4. Record and clean up

Record Node/pnpm/Pi versions, whether dependency provisioning was offline or network-enabled, and the final result. Inspect any failed workspace before removing it.

Once you no longer need the generated files, remove **only** the temporary directory printed by `printf '%s\n' "$CHECK_ROOT"`. Close this console afterward or unset the exported variables; `PI_CODING_AGENT_DIR` must not point at a removed directory when starting your normal Pi session.
