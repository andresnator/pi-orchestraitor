import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const DEPENDENCY_PREFIX = "node_modules/";

// Private host fixtures must resolve from the host's module tree, not the repo's.
export function resolveHostPath(hostRoot, path) {
	if (!path.startsWith(DEPENDENCY_PREFIX)) return join(hostRoot, path);
	const relative = path.slice(DEPENDENCY_PREFIX.length);
	const parts = relative.split("/");
	const name = parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
	const require = createRequire(join(hostRoot, "package.json"));
	const resolved = (require.resolve.paths(name) ?? []).map((root) => join(root, relative)).find(existsSync);
	if (!resolved) throw new Error(`Cannot locate host dependency fixture: ${path}`);
	return resolved;
}
