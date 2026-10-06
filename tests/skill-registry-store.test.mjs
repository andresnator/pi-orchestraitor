import assert from "node:assert/strict";
import { mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createWorkspace } from "./helpers/pi-host.mjs";
import { publishRegistry, REGISTRY_MARKER } from "../extensions/skills/store.mjs";

function snapshot(cwd, context = "fixture-context") {
	return { cwd, context, trusted: true, version: 1, entries: [{ name: "fixture", description: "A fixture | description.", filePath: join(cwd, "SKILL.md"), source: "pi", origin: "fixture-configured-source", scope: "temporary", status: "available", fingerprint: "fixture-fingerprint", body: "PRIVATE BODY MUST NOT BE PUBLISHED" }] };
}

test("shouldCreateAndReuseTheRegistryWhenItsSnapshotDoesNotChange", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const state = snapshot(cwd);
	// When
	const first = await publishRegistry(state);
	const original = await stat(first.path);
	const second = await publishRegistry(state);
	const content = await readFile(first.path, "utf8");
	// Then
	assert.deepEqual({ first: first.changed, second: second.changed, persisted: second.persisted, sameTime: original.mtimeMs === (await stat(second.path)).mtimeMs }, {
		first: true, second: false, persisted: true, sameTime: true,
	});
	assert.ok(content.startsWith(REGISTRY_MARKER));
	assert.match(content, /A fixture \\\| description/);
	assert.doesNotMatch(content, /PRIVATE BODY/);
	assert.match(content, /fixture-configured-source/);
});

test("shouldPreserveAnOwnedResolvedRegistryWhenAnotherSessionStartsPending", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const first = await publishRegistry(snapshot(cwd));
	const original = await readFile(first.path, "utf8");
	// When
	const pending = await publishRegistry({ ...snapshot(cwd, "pending-other-session"), entries: [], pending: true });
	// Then
	assert.deepEqual({ persisted: pending.persisted, changed: pending.changed, content: await readFile(pending.path, "utf8") },
		{ persisted: true, changed: false, content: original });
});

test("shouldRepairOwnedCorruptionWhenTheRegistryContentIsInvalid", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const state = snapshot(cwd);
	const first = await publishRegistry(state);
	await writeFile(first.path, `${REGISTRY_MARKER}\ncorrupt snapshot\n`);
	// When
	const repaired = await publishRegistry(state);
	// Then
	assert.deepEqual({ changed: repaired.changed, persisted: repaired.persisted }, { changed: true, persisted: true });
	assert.match(await readFile(repaired.path, "utf8"), /fixture-fingerprint/);
});

test("shouldPreserveForeignFilesAndSymbolicDirectoriesWhenPersistenceIsUnsafe", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	await mkdir(join(cwd, ".ai", "skills"), { recursive: true });
	const target = join(cwd, ".ai", "skills", "registry.md");
	await writeFile(target, "User-owned file\n");
	const linkedCwd = await createWorkspace(t);
	await symlink(join(cwd, ".ai"), join(linkedCwd, ".ai"));
	// When
	const foreign = await publishRegistry(snapshot(cwd));
	const linked = await publishRegistry(snapshot(linkedCwd));
	// Then
	assert.deepEqual([foreign.persisted, linked.persisted, await readFile(target, "utf8")], [false, false, "User-owned file\n"]);
});

test("shouldKeepAnInMemorySnapshotWhenTheProjectIsUntrustedOrUnwritable", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const blocked = await createWorkspace(t);
	await writeFile(join(blocked, ".ai"), "Not a directory\n");
	// When
	const untrusted = await publishRegistry({ ...snapshot(cwd), trusted: false });
	const unavailable = await publishRegistry(snapshot(blocked));
	// Then
	assert.deepEqual([untrusted.persisted, unavailable.persisted], [false, false]);
	await assert.rejects(stat(join(cwd, ".ai")), { code: "ENOENT" });
});

test("shouldPublishCompleteContextSpecificSnapshotsWhenTwoSessionsWriteConcurrently", async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const first = snapshot(cwd, "first-profile");
	const second = snapshot(cwd, "second-profile");
	// When
	const results = await Promise.all([publishRegistry(first), publishRegistry(second)]);
	const content = await readFile(results[0].path, "utf8");
	// Then
	assert.deepEqual(results.map(({ persisted }) => persisted), [true, true]);
	assert.equal((content.match(/Context:/g) ?? []).length, 1);
	assert.match(content, /Context: `(?:first|second)-profile`/);
	assert.match(content, /fixture-fingerprint/);
});
