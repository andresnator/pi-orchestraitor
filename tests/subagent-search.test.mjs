import assert from "node:assert/strict";
import { chmod, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createWorkspace, pi } from "./helpers/pi-host.mjs";
import { resolveRipgrep, searchText } from "../extensions/subagent/guard.mjs";

const rgPath = await resolveRipgrep();
const ripgrep = { skip: rgPath ? false : "bundled ripgrep is unavailable on this platform" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function project(t) {
	const cwd = await realpath(await createWorkspace(t));
	return { cwd, manifest: { id: "search", cwd, role: "explore", files: [], skills: [] } };
}

async function files(root, entries) {
	for (const [path, content] of Object.entries(entries)) {
		await mkdir(join(root, path, ".."), { recursive: true });
		await writeFile(join(root, path), content);
	}
}

const search = (manifest, args, options = {}) => searchText(manifest, args, options.signal, { rgPath, truncateLine: pi.truncateLine, ...options });

test("shouldSkipGitignoredBuildOutputUnlessPathNamesItWhenRipgrepSearches", ripgrep, async (t) => {
	// Given
	const { cwd, manifest } = await project(t);
	await mkdir(join(cwd, ".git"));
	await files(cwd, { ".gitignore": "target/\n", "target/Built.java": "needle built", "src/Main.java": "needle source" });
	// When
	const everywhere = await search(manifest, { text: "needle" });
	const named = await search(manifest, { text: "needle", path: "target" });
	// Then
	assert.equal(everywhere, "src/Main.java:1: needle source");
	assert.equal(named, "target/Built.java:1: needle built");
});

test("shouldNeverReportProtectedOrLinkedMatchesWhenRipgrepSearches", ripgrep, async (t) => {
	// Given
	const { cwd, manifest } = await project(t);
	const outside = await realpath(await createWorkspace(t));
	await files(outside, { "secret.txt": "needle SECRET" });
	await files(cwd, { "src/ok.txt": "needle ok", ".PI/settings.json": "needle upper", ".agents/notes.md": "needle agents",
		"node_modules/dep/index.js": "needle dependency", "nested/.git/config": "needle git", "nested/.codex/state": "needle codex" });
	await symlink(outside, join(cwd, "linked"));
	await symlink(join(outside, "secret.txt"), join(cwd, "alias.txt"));
	// When
	const content = await search(manifest, { text: "needle" });
	const listed = await search(manifest, { text: "needle", mode: "files" });
	// Then
	assert.equal(content, "src/ok.txt:1: needle ok");
	assert.equal(listed, "src/ok.txt");
});

test("shouldSearchSelectedSkillBelowProtectedHostWhenPathNamesIt", ripgrep, async (t) => {
	// Given
	const { cwd, manifest } = await project(t);
	await files(cwd, { ".agents/skills/chosen/SKILL.md": "needle skill", ".agents/skills/chosen/references/guide.md": "needle reference" });
	const filePath = join(cwd, ".agents/skills/chosen/SKILL.md");
	manifest.skills = [{ name: "chosen", filePath, baseDir: join(cwd, ".agents/skills/chosen") }];
	// When
	const output = await search(manifest, { text: "needle", path: ".agents/skills/chosen" });
	// Then
	assert.deepEqual(output.split("\n").sort(), [".agents/skills/chosen/SKILL.md:1: needle skill", ".agents/skills/chosen/references/guide.md:1: needle reference"]);
});

test("shouldReturnHundredMatchesWithReasonWhenNoLimitIsGiven", ripgrep, async (t) => {
	// Given
	const { cwd, manifest } = await project(t);
	await files(cwd, { "many.txt": Array.from({ length: 150 }, (_, index) => `needle ${index + 1}`).join("\n") });
	// When
	const capped = await search(manifest, { text: "needle" });
	const requested = await search(manifest, { text: "needle", limit: 150 });
	// Then
	const lines = capped.split("\n");
	assert.equal(lines.length, 101);
	assert.equal(lines[99], "many.txt:100: needle 100");
	assert.equal(lines[100], "[Search truncated: 100-match limit; pass limit for more]");
	assert.equal(requested.split("\n").length, 150);
	assert.doesNotMatch(requested, /Search truncated/);
});

test("shouldStopAtOutputBudgetWithReasonWhenMatchesAreLong", ripgrep, async (t) => {
	// Given
	const { cwd, manifest } = await project(t);
	await files(cwd, { "wide.txt": Array.from({ length: 200 }, () => `needle ${"x".repeat(400)}`).join("\n") });
	// When
	const output = await search(manifest, { text: "needle", limit: 2000 });
	// Then
	assert.ok(output.length <= 32 * 1024);
	assert.match(output, /\n\[Search truncated: 32 KB output\]$/);
});

test("shouldKillRipgrepWhenSearchIsAborted", { skip: process.platform === "win32" ? "POSIX script fixture" : false }, async (t) => {
	// Given
	const { cwd, manifest } = await project(t);
	const pidFile = join(cwd, "rg.pid");
	const fake = join(await realpath(await createWorkspace(t)), "rg");
	await writeFile(fake, `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 30\n`);
	await chmod(fake, 0o755);
	const controller = new AbortController();
	// When
	const pending = search(manifest, { text: "needle" }, { rgPath: fake, signal: controller.signal });
	for (let attempt = 0; attempt < 100; attempt++) {
		try { await readFile(pidFile, "utf8"); break; } catch { await sleep(20); }
	}
	controller.abort();
	// Then
	await assert.rejects(pending, /Task cancelled/);
	const pid = Number((await readFile(pidFile, "utf8")).trim());
	let alive = true;
	for (let attempt = 0; attempt < 50 && alive; attempt++) {
		try { process.kill(pid, 0); await sleep(20); } catch { alive = false; }
	}
	assert.equal(alive, false);
});

test("shouldWalkBreadthFirstInNameOrderWhenRipgrepIsUnavailable", async (t) => {
	// Given
	const { cwd, manifest } = await project(t);
	await files(cwd, { "b/deep/x.txt": "needle deep", "a.txt": "needle a", "c.txt": "needle c", ".pi/settings.json": "needle protected" });
	// When
	const missing = await search(manifest, { text: "needle" }, { rgPath: undefined });
	const absent = await search(manifest, { text: "needle" }, { rgPath: join(cwd, "no-such-rg") });
	// Then
	assert.equal(missing, "a.txt:1: needle a\nc.txt:1: needle c\nb/deep/x.txt:1: needle deep");
	assert.equal(absent, missing);
});

test("shouldCapFallbackAtHundredMatchesWithReasonWhenNoLimitIsGiven", async (t) => {
	// Given
	const { cwd, manifest } = await project(t);
	await files(cwd, { "many.txt": Array.from({ length: 150 }, (_, index) => `needle ${index + 1}`).join("\n") });
	// When
	const output = await search(manifest, { text: "needle" }, { rgPath: undefined });
	// Then
	const lines = output.split("\n");
	assert.equal(lines.length, 101);
	assert.equal(lines[100], "[Search truncated: 100-match limit; pass limit for more]");
});
