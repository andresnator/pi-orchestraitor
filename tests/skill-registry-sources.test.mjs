import assert from "node:assert/strict";
import { rmSync, symlinkSync } from "node:fs";
import { mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createWorkspace, pi } from "./helpers/pi-host.mjs";
import { inspectCatalog, MAX_RESOURCE_ENTRIES } from "../extensions/skills/sources.mjs";

const NAME = "registry-fixture";
async function fixture(t, { manual = false, scope = "user" } = {}) {
	const cwd = await createWorkspace(t);
	const baseDir = join(cwd, "configured", ".claude", "skills", NAME);
	await mkdir(join(baseDir, "references"), { recursive: true });
	const filePath = join(baseDir, "SKILL.md");
	await writeFile(filePath, `---\nname: ${NAME}\ndescription: Test registry discovery.\ndisable-model-invocation: ${manual}\n---\nRead the fixture.\n`);
	await writeFile(join(baseDir, "references", "details.md"), "Original resource\n");
	const [skill] = pi.loadSkillsFromDir({ dir: baseDir, source: "fixture" }).skills;
	skill.sourceInfo = { path: filePath, source: "fixture", scope, origin: "top-level" };
	return { cwd, baseDir, filePath, skill };
}

test("shouldFingerprintBodiesAndResourcesWhenNativeCatalogIsInspected", async (t) => {
	// Given
	const { cwd, baseDir, filePath, skill } = await fixture(t);
	// When
	const first = await inspectCatalog(pi, [skill], { cwd, trusted: true });
	await writeFile(join(baseDir, "references", "details.md"), "Modified resource\n");
	const second = await inspectCatalog(pi, [skill], { cwd, trusted: true });
	await writeFile(filePath, (await readFile(filePath, "utf8")).replace("Read the fixture.", "Read the changed fixture."));
	const third = await inspectCatalog(pi, [skill], { cwd, trusted: true });
	// Then
	assert.deepEqual(first.entries.map(({ name, source, status }) => ({ name, source, status })), [{ name: NAME, source: "claude", status: "available" }]);
	assert.match(first.entries[0].fingerprint, /^[a-f0-9]{64}$/);
	assert.notEqual(first.entries[0].fingerprint, second.entries[0].fingerprint);
	assert.notEqual(second.entries[0].fingerprint, third.entries[0].fingerprint);
});

test("shouldKeepUnregisteredFilesUnavailableWhenAnotherSkillAppearsOnDisk", async (t) => {
	// Given
	const { cwd, baseDir, skill } = await fixture(t);
	const extra = join(baseDir, "..", "not-registered");
	await mkdir(extra);
	await writeFile(join(extra, "SKILL.md"), "---\nname: not-registered\ndescription: Unregistered skill.\n---\nDo not auto-enable.\n");
	// When
	const snapshot = await inspectCatalog(pi, [skill], { cwd, trusted: true });
	// Then
	assert.deepEqual(snapshot.entries.map(({ name }) => name), [NAME]);
});

test("shouldRejectRenamedAndMissingSkillsWhenTheNativeSnapshotIsStale", async (t) => {
	// Given
	const { cwd, filePath, skill } = await fixture(t);
	await writeFile(filePath, "---\nname: renamed\ndescription: A renamed skill.\n---\nNeeds reload.\n");
	// When
	const renamed = await inspectCatalog(pi, [skill], { cwd, trusted: true });
	const missing = await inspectCatalog(pi, [{ ...skill, filePath: join(cwd, "missing", "SKILL.md") }], { cwd, trusted: true });
	// Then
	assert.deepEqual([renamed.entries[0].status, missing.entries[0].status], ["unavailable", "unavailable"]);
	assert.match(renamed.entries[0].diagnostic, /reload/i);
});

test("shouldPreserveManualInvocationAndTrustWhenNativeCatalogIsInspected", async (t) => {
	// Given
	const { cwd, skill } = await fixture(t, { manual: true, scope: "project" });
	// When
	const trusted = await inspectCatalog(pi, [skill], { cwd, trusted: true });
	const untrusted = await inspectCatalog(pi, [skill], { cwd, trusted: false });
	// Then
	assert.deepEqual([trusted.entries[0].status, untrusted.entries[0].status], ["manual-only", "unavailable"]);
});

test("shouldRejectAmbiguousNamesAndEscapingResourceLinksWhenNativeDataIsInvalid", async (t) => {
	// Given
	const { cwd, baseDir, skill } = await fixture(t);
	await writeFile(join(cwd, "outside.md"), "Outside the skill directory.\n");
	await symlink(join(cwd, "outside.md"), join(baseDir, "references", "outside.md"));
	// When
	const linked = await inspectCatalog(pi, [skill], { cwd, trusted: true });
	const duplicate = await inspectCatalog(pi, [skill, { ...skill }], { cwd, trusted: true });
	// Then
	assert.deepEqual([linked.entries[0].status, duplicate.entries[0].status], ["unavailable", "unavailable"]);
	assert.match(linked.entries[0].diagnostic, /symbolic/i);
	assert.match(duplicate.entries[0].diagnostic, /ambiguous/i);
});

test("shouldRejectOversizedDirectoryTreesWhenEmptyResourcesExceedTheTraversalBudget", async (t) => {
	// Given
	const { cwd, baseDir, skill } = await fixture(t);
	for (let index = 0; index <= MAX_RESOURCE_ENTRIES; index++) await mkdir(join(baseDir, "references", `empty-${index}`));
	// When
	const snapshot = await inspectCatalog(pi, [skill], { cwd, trusted: true });
	// Then
	assert.equal(snapshot.entries[0].status, "unavailable");
	assert.match(snapshot.entries[0].diagnostic, /resource entries/);
});

test("shouldRejectRetargetedNativeAliasesWhenACanonicalTargetWasAlreadyValidated", async (t) => {
	// Given
	const { cwd, baseDir, skill } = await fixture(t);
	const other = join(cwd, "excluded-target");
	await mkdir(other);
	await writeFile(join(other, "SKILL.md"), `---\nname: ${NAME}\ndescription: Excluded target.\n---\nDo not grant eligibility through an alias.\n`);
	const alias = join(cwd, "authorized-alias");
	await symlink(baseDir, alias);
	const nativeAlias = { ...skill, filePath: join(alias, "SKILL.md") };
	const options = { cwd, trusted: true, canonicalPaths: new Map() };
	const first = await inspectCatalog(pi, [nativeAlias], options);
	// When
	await rm(alias);
	await symlink(other, alias);
	const retargeted = await inspectCatalog(pi, [nativeAlias], options);
	// Then
	assert.deepEqual([first.entries[0].status, retargeted.entries[0].status], ["available", "unavailable"]);
	assert.match(retargeted.entries[0].diagnostic, /canonical target.*reload/i);
});

async function aliasFixture(t, manual = false) {
	const cwd = await realpath(await createWorkspace(t));
	const target = join(cwd, "vendor", "original"), alias = join(cwd, "chosen");
	await mkdir(target, { recursive: true });
	const body = `---\ndescription: Native alias fixture.\ndisable-model-invocation: ${manual}\n---\nAliased instructions.\n`;
	await writeFile(join(target, "SKILL.md"), body);
	await symlink(target, alias);
	const [skill] = pi.loadSkills({ cwd, skillPaths: [join(alias, "SKILL.md")], includeDefaults: false }).skills;
	assert.equal(skill.name, "chosen");
	return { cwd, target, alias, body, skill };
}

for (const manual of [false, true]) {
	test(`shouldPreserveNativeAliasFallbackNamesWithManualInvocation${manual}`, async (t) => {
		const { cwd, target, body, skill } = await aliasFixture(t, manual);
		const canonicalPaths = new Map();
		const { entries: [entry] } = await inspectCatalog(pi, [skill], { cwd, trusted: true, canonicalPaths });
		assert.equal(entry.status, manual ? "manual-only" : "available");
		assert.equal(entry.skill.name, "chosen");
		assert.equal(entry.skill.baseDir, target);
		assert.equal(entry.skill.filePath, join(target, "SKILL.md"));
		assert.equal(entry.body, body);
		assert.equal(canonicalPaths.get(skill.filePath), join(target, "SKILL.md"));
	});
}

test("shouldRejectAliasRetargetingDuringNativeMetadataParsing", async (t) => {
	const { cwd, alias, body, skill } = await aliasFixture(t);
	const replacement = join(cwd, "excluded");
	await mkdir(replacement);
	await writeFile(join(replacement, "SKILL.md"), body);
	const sdk = { ...pi, loadSkills(options) {
		const result = pi.loadSkills(options);
		rmSync(alias);
		symlinkSync(replacement, alias);
		return result;
	} };
	const { entries: [entry] } = await inspectCatalog(sdk, [skill], { cwd, trusted: true, canonicalPaths: new Map() });
	assert.equal(entry.status, "unavailable");
	assert.match(entry.diagnostic, /canonical target.*reload/i);
});
