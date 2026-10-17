// Stands in for npm through Pi's `npmCommand` setting. `install <spec>... --prefix <root>` creates
// each package's manifest without the registry, so installer tests do not depend on network speed.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [command, ...args] = process.argv.slice(2);
const prefixAt = args.indexOf("--prefix");
if (command !== "install" || prefixAt < 0) {
	console.error(`fake npm: unsupported command: ${process.argv.slice(2).join(" ")}`);
	process.exit(1);
}
const prefix = args[prefixAt + 1];
for (const spec of args.filter((arg, index) => !arg.startsWith("-") && index !== prefixAt + 1)) {
	const at = spec.lastIndexOf("@");
	const [name, version] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, "0.0.0"];
	const directory = join(prefix, "node_modules", name);
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "package.json"), JSON.stringify({ name, version }));
}
if (process.env.FAKE_NPM_LOG) appendFileSync(process.env.FAKE_NPM_LOG, `${JSON.stringify(process.argv.slice(2))}\n`);
