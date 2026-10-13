import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { integrationFingerprint } from "../../scripts/subagents-validation.mjs";
import { packageRoot } from "./pi-host.mjs";

/** Registration/cooldown fixture only; never claims native plugin acceptance. */
export async function installerFixture(root, { stubPi = true, npmVersion = "11.19.0" } = {}) {
	const bin = join(root, "installer-bin"), validation = join(root, "fixture-validation.json");
	await mkdir(bin, { recursive: true });
	await writeFile(validation, JSON.stringify({ status: "passed", pi: "1.2.0", plugin: "0.78.0", fingerprint: await integrationFingerprint(packageRoot) }));
	const npm = execFileSync("which", ["npm"], { encoding: "utf8" }).trim();
	await writeFile(join(bin, "npm"), `#!${process.execPath}
const {spawnSync}=require("node:child_process");
if (process.argv[2]==="--version") console.log(${JSON.stringify(npmVersion)});
else if (process.argv[2]==="view" && process.argv[4]==="time") console.log(JSON.stringify({"0.78.0":"2026-01-01T00:00:00Z"}));
else { const result=spawnSync(${JSON.stringify(npm)},process.argv.slice(2),{stdio:"inherit"});process.exit(result.status??1); }
`, { mode: 0o755 });
	if (stubPi) await writeFile(join(bin, "pi"), `#!${process.execPath}
const fs=require("node:fs"),path=require("node:path");
const args=process.argv.slice(2), source=args.at(-1);
if(args[0]!=="install") throw new Error("Fixture supports install only");
const target=args.includes("--local")?path.join(process.cwd(),".pi/settings.json"):path.join(process.env.PI_CODING_AGENT_DIR,"settings.json");
const settings=fs.existsSync(target)?JSON.parse(fs.readFileSync(target,"utf8")):{};
const identity=entry=>{const s=typeof entry==="string"?entry:entry.source;return s.startsWith("npm:")?s.replace(/@[^@]+$/," ").trim():path.resolve(s.startsWith("~/")?path.join(process.env.HOME,s.slice(2)):path.isAbsolute(s)?s:path.join(process.cwd(),".pi",s));};
settings.packages??=[];
const index=settings.packages.findIndex(entry=>identity(entry)===identity(source));
if(index<0)settings.packages.push(source);else {const before=settings.packages[index];settings.packages[index]=typeof before==="string"?source:{...before,source};}
fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(settings));
`, { mode: 0o755 });
	return { bin, validation, env: { PATH: `${bin}:${process.env.PATH}` } };
}
