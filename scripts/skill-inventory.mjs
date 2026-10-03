import { join, resolve } from "node:path";
import { isWithin } from "./skill-migration.mjs";

/** Keep Pi's lexical paths before it deduplicates aliases for effective loading. */
export async function inventorySkills(pi, { cwd, agentDir }) {
	// These hooks are private host APIs; fail before migration if they disappear.
	const hooks = ["resolveLocalEntries", "collectFilesFromPaths", "addResource", "toResolvedPaths"];
	if (hooks.some((name) => typeof pi.DefaultPackageManager.prototype[name] !== "function")) {
		throw new Error("This Pi version cannot provide a complete skill migration inventory.");
	}
	const protectedRoots = new Set([resolve(agentDir), join(cwd, ".pi")]);
	class InventoryPackageManager extends pi.DefaultPackageManager {
		discoveryRoots = new Map();

		resolveLocalEntries(entries, resourceType, target, metadata, baseDir) {
			if (resourceType !== "skills") return super.resolveLocalEntries(entries, resourceType, target, metadata, baseDir);
			protectedRoots.add(resolve(baseDir));
			this.localRoots = new Map();
			try {
				return super.resolveLocalEntries(entries, resourceType, target, metadata, baseDir);
			} finally {
				this.localRoots = undefined;
			}
		}

		collectFilesFromPaths(paths, resourceType) {
			if (resourceType !== "skills" || !this.localRoots) return super.collectFilesFromPaths(paths, resourceType);
			return paths.flatMap((root) => {
				const files = super.collectFilesFromPaths([root], resourceType);
				for (const file of files) {
					const previous = this.localRoots.get(file);
					// An explicit file must not hide a wider configured symlink tree.
					if (!previous || isWithin(previous, root)) this.localRoots.set(file, resolve(root));
				}
				return files;
			});
		}

		addResource(map, path, metadata, enabled) {
			let discoveryRoot = this.localRoots?.get(path);
			if (metadata.source === "auto" && metadata.baseDir && isWithin(path, join(metadata.baseDir, "skills"))) {
				protectedRoots.add(resolve(metadata.baseDir));
				discoveryRoot = join(metadata.baseDir, "skills");
			}
			if (discoveryRoot) {
				const previous = this.discoveryRoots.get(path);
				if (!previous || isWithin(previous, discoveryRoot)) this.discoveryRoots.set(path, resolve(discoveryRoot));
			}
			return super.addResource(map, path, metadata, enabled);
		}

		toResolvedPaths(accumulator) {
			if (!(accumulator.skills instanceof Map)) throw new Error("Pi returned an unsupported skill inventory.");
			this.migrationSkills = [...accumulator.skills].map(([path, { metadata, enabled }]) => {
				return { path, metadata: { ...metadata, discoveryRoot: this.discoveryRoots.get(path) }, enabled };
			});
			return super.toResolvedPaths(accumulator);
		}
	}
	// Inspect project declarations without loading extensions or persisting trust.
	const settingsManager = pi.SettingsManager.create(cwd, agentDir, { projectTrusted: true });
	const errors = settingsManager.drainErrors();
	if (errors.length) throw new Error(errors.map(({ path, error }) => `${path}: ${error.message}`).join("\n"));
	const manager = new InventoryPackageManager({ cwd, agentDir, settingsManager });
	const resources = await manager.resolve(async () => "skip");
	if (!manager.migrationSkills) throw new Error("Pi did not provide a complete skill migration inventory.");
	return { skills: resources.skills, migrationSkills: manager.migrationSkills, protectedRoots: [...protectedRoots] };
}
