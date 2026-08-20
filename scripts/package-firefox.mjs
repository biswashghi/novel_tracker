import { mkdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist-firefox");
const releaseDir = path.join(root, "release");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`)));
    child.on("error", reject);
  });
}

// .github/workflows/pr.yml passes --version-override through to keep PR
// validation builds distinct from a real release's version (see AGENTS.md
// — Versioning); production packaging gets neither and uses pkg.version as
// before. Forwarded to build.mjs, which does the actual substitution —
// without it, this script's own internal build.mjs call below would
// silently redo the build with the production version.
const versionOverride = process.argv.find((argument) => argument.startsWith("--version-override="))?.split("=")[1];
const effectiveVersion = versionOverride || pkg.version;

const buildArgs = [path.join(root, "scripts", "build.mjs"), "--target=firefox"];
if (versionOverride) buildArgs.push(`--version-override=${versionOverride}`);
await run(process.execPath, buildArgs);

const manifest = JSON.parse(await readFile(path.join(distDir, "manifest.json"), "utf8"));
const gecko = manifest.browser_specific_settings?.gecko;
if (manifest.version !== effectiveVersion) throw new Error(`Firefox manifest version ${manifest.version} does not match expected version ${effectiveVersion}`);
if (gecko?.id !== "novel-tracker@bghimire.com") throw new Error("Firefox package is missing its stable add-on ID");
if (!manifest.browser_specific_settings?.gecko_android) throw new Error("Firefox Android compatibility is not declared");

await mkdir(releaseDir, { recursive: true });
const zipPath = path.join(releaseDir, `${pkg.name}-firefox-${effectiveVersion}.zip`);
await rm(zipPath, { force: true });
await run("zip", ["-r", zipPath, ".", "-x", "*.DS_Store", "__MACOSX/*"], distDir);

console.log(`Created Firefox AMO package at ${zipPath}`);
